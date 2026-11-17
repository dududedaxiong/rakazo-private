import type { SecretStore } from "@rakazo_mickvvw/adapter-kit";
import type { Actor } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { Prisma, withTransactionRetry } from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import type { Hono } from "hono";
import { cancelBody } from "./http-body.js";

/**
 * WebDAV backup, server side: the account lives sealed in the secrets table
 * (same encryption as a provider key), and the proxy forwards WebDAV
 * requests so the browser never has to — a browser talking to a user's own
 * WebDAV server would hit CORS preflights most servers do not answer.
 *
 * Two boundaries the proxy holds:
 *
 * - It only talks to the account's stored server, only inside the stored
 *   backup directory, only for the two files the web backup reads and
 *   writes. The path comes from the client but is re-validated here.
 * - The WebDAV password never leaves the server: the proxy builds the
 *   Basic header from the sealed account, and no password, URL, or server
 *   body ever enters a log line or an error message.
 */

export const WEBDAV_BACKUP_SECRET_KIND = "webdav-backup";
export const WEBDAV_BACKUP_ZIP_NAME = "rakazo-backup.zip";
export const WEBDAV_BACKUP_MANIFEST_NAME = "rakazo-backup.json";
export const WEBDAV_BACKUP_DIRECTORY_DEFAULT = "rakazo-backup";

const WEBDAV_METHODS = ["PROPFIND", "MKCOL", "PUT", "GET"] as const;
type WebdavMethod = (typeof WEBDAV_METHODS)[number];

/** A request may only touch the backup directory and these two files. */
const WEBDAV_PROXY_FILES = [WEBDAV_BACKUP_ZIP_NAME, WEBDAV_BACKUP_MANIFEST_NAME] as const;

/** Ten minutes: a large zip over a slow link takes a while, and the client can abort. */
const WEBDAV_PROXY_TIMEOUT_MS = 10 * 60 * 1000;

export type StoredWebdavBackupAccount = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
};

export type WebdavBackupAccountMeta = {
  serverUrl: string;
  username: string;
  directory: string;
  hasPassword: boolean;
};

function isStoredAccount(value: unknown): value is StoredWebdavBackupAccount {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.serverUrl === "string" &&
    typeof item.username === "string" &&
    typeof item.password === "string" &&
    typeof item.directory === "string"
  );
}

function toMeta(account: StoredWebdavBackupAccount): WebdavBackupAccountMeta {
  return {
    serverUrl: account.serverUrl,
    username: account.username,
    directory: account.directory,
    hasPassword: account.password.length > 0,
  };
}

/**
 * Normalizes a WebDAV server address. Only https is accepted: a backup
 * password sent over http would travel in the clear. Credentials in the URL
 * are refused outright. Mirrors the web client's check; the server is the
 * authority, so a stored value is re-checked before every use.
 */
export function normalizeWebdavServerUrl(
  input: string,
): { ok: true; serverUrl: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That server address is not valid." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Use an https address." };
  if (url.username || url.password)
    return {
      ok: false,
      error: "Put the account and password in their own fields, not in the address.",
    };
  if (url.search || url.hash) return { ok: false, error: "That server address is not valid." };
  return { ok: true, serverUrl: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}` };
}

/**
 * Sanitizes a backup directory. `..`, a leading `/`, backslashes, and empty
 * segments are all refused. Mirrors the web client's check.
 */
export function sanitizeBackupDirectory(
  input: string,
): { ok: true; segments: string[] } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, segments: [WEBDAV_BACKUP_DIRECTORY_DEFAULT] };
  if (trimmed.startsWith("/") || trimmed.includes("\\"))
    return { ok: false, error: "The directory is not valid." };
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return { ok: false, error: "The directory is not valid." };
    }
  }
  return { ok: true, segments };
}

/** The sealed account for this user, or null when none is stored. A damaged row reads as none. */
export async function loadStoredWebdavAccount(
  prisma: PrismaClient,
  secrets: SecretStore,
  userId: string,
): Promise<StoredWebdavBackupAccount | null> {
  const row = await prisma.secret.findFirst({
    where: { userId, kind: WEBDAV_BACKUP_SECRET_KIND, spaceId: null },
    select: { id: true, ciphertext: true },
  });
  if (!row) return null;
  let plaintext: string;
  try {
    plaintext = await secrets.load(row.ciphertext, row.id);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!isStoredAccount(parsed)) return null;
  const normalized = normalizeWebdavServerUrl(parsed.serverUrl);
  if (!normalized.ok) return null;
  const directory = sanitizeBackupDirectory(parsed.directory);
  if (!directory.ok) return null;
  return {
    serverUrl: normalized.serverUrl,
    username: parsed.username,
    password: parsed.password,
    directory: directory.segments.join("/"),
  };
}

async function saveStoredWebdavAccount(
  prisma: PrismaClient,
  secrets: SecretStore,
  actor: Actor,
  account: StoredWebdavBackupAccount,
): Promise<void> {
  const stored = await secrets.put(JSON.stringify(account), {
    operationId: "webdav-backup",
    traceId: "webdav-backup",
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: new AbortController().signal,
  });
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const old = await tx.secret.findMany({
          where: { userId: actor.userId, kind: WEBDAV_BACKUP_SECRET_KIND, spaceId: null },
          select: { id: true },
        });
        await tx.secret.create({
          data: {
            id: stored.id,
            userId: actor.userId,
            spaceId: null,
            kind: WEBDAV_BACKUP_SECRET_KIND,
            ciphertext: stored.ciphertext,
          },
        });
        if (old.length > 0) {
          await tx.secret.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/**
 * Resolves a proxy path against the stored account. The path arrives
 * percent-encoded, one segment per part, relative to the server root; it
 * must be the backup directory itself or one of the two backup files inside
 * it. Anything else — `..`, an empty segment, a file outside the directory —
 * is refused before any request leaves the server.
 */
export function resolveWebdavProxyPath(
  account: StoredWebdavBackupAccount,
  rawPath: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) return { ok: false, error: directory.error };
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const rawSegments = rawPath.split("/");
  if (rawSegments.length < directory.segments.length) {
    return { ok: false, error: "Send a WebDAV path inside the backup directory." };
  }
  const segments: string[] = [];
  for (const raw of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return { ok: false, error: "Send a WebDAV path inside the backup directory." };
    }
    if (
      decoded === "" ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("\\") ||
      decoded.includes("/")
    ) {
      return { ok: false, error: "Send a WebDAV path inside the backup directory." };
    }
    segments.push(decoded);
  }
  for (let i = 0; i < directory.segments.length; i += 1) {
    if (segments[i] !== directory.segments[i]) {
      return { ok: false, error: "Send a WebDAV path inside the backup directory." };
    }
  }
  const extra = segments.slice(directory.segments.length);
  if (extra.length > 1) {
    return { ok: false, error: "Send a WebDAV path inside the backup directory." };
  }
  if (extra.length === 1 && !(WEBDAV_PROXY_FILES as readonly string[]).includes(extra[0]!)) {
    return { ok: false, error: "Send a WebDAV path inside the backup directory." };
  }
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return { ok: true, url: `${normalized.serverUrl}/${encoded}` };
}

export type WebdavBackupRouteDeps = {
  prisma: PrismaClient;
  secrets: SecretStore;
  /** Overridden in tests so no real WebDAV server is needed. */
  fetchImpl?: typeof fetch;
};

export function mountWebdavBackupRoutes(
  app: Hono,
  deps: WebdavBackupRouteDeps,
  authenticate: (request: Request) => Promise<Actor | null>,
): void {
  const fetchUpstream = deps.fetchImpl ?? fetch;

  app.get("/api/webdav-backup/account", async (c) => {
    const actor = await authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const account = await loadStoredWebdavAccount(deps.prisma, deps.secrets, actor.userId);
    return c.json({ account: account ? toMeta(account) : null }, 200, {
      "cache-control": "no-store",
    });
  });

  app.put("/api/webdav-backup/account", async (c) => {
    const actor = await authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Send a JSON body with the WebDAV account." }, 400, {
        "cache-control": "no-store",
      });
    }
    const input = (body ?? {}) as Record<string, unknown>;
    const normalized = normalizeWebdavServerUrl(
      typeof input.serverUrl === "string" ? input.serverUrl : "",
    );
    if (!normalized.ok)
      return c.json({ error: normalized.error }, 400, { "cache-control": "no-store" });
    const username = typeof input.username === "string" ? input.username.trim() : "";
    if (!username)
      return c.json({ error: "Enter the username." }, 400, { "cache-control": "no-store" });
    const directory = sanitizeBackupDirectory(
      typeof input.directory === "string" ? input.directory : "",
    );
    if (!directory.ok)
      return c.json({ error: directory.error }, 400, { "cache-control": "no-store" });
    // An empty password keeps the stored one: the client never sees it, so
    // it cannot send it back. A first save with no password is refused.
    const password = typeof input.password === "string" ? input.password : "";
    const stored = await loadStoredWebdavAccount(deps.prisma, deps.secrets, actor.userId);
    const keptPassword = password === "" ? (stored?.password ?? "") : password;
    if (keptPassword === "")
      return c.json({ error: "Enter the WebDAV password." }, 400, {
        "cache-control": "no-store",
      });
    const account: StoredWebdavBackupAccount = {
      serverUrl: normalized.serverUrl,
      username,
      password: keptPassword,
      directory: directory.segments.join("/"),
    };
    await saveStoredWebdavAccount(deps.prisma, deps.secrets, actor, account);
    return c.json({ account: toMeta(account) }, 200, { "cache-control": "no-store" });
  });

  app.delete("/api/webdav-backup/account", async (c) => {
    const actor = await authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    await deps.prisma.secret.deleteMany({
      where: { userId: actor.userId, kind: WEBDAV_BACKUP_SECRET_KIND, spaceId: null },
    });
    return c.json({ account: null }, 200, { "cache-control": "no-store" });
  });

  /**
   * `POST /api/webdav-backup/proxy` forwards one WebDAV request to the
   * stored server. The method rides `x-webdav-method`, the path (relative
   * to the server root, percent-encoded) rides `x-webdav-path`, and a PUT
   * body streams through untouched. The answer comes back as the proxy's
   * own 200 with the WebDAV status in `x-webdav-status` and the body
   * verbatim, so a WebDAV 401 stays a WebDAV 401 and never looks like the
   * session went away.
   */
  app.post("/api/webdav-backup/proxy", async (c) => {
    const request = c.req.raw;
    const actor = await authenticate(request);
    if (!actor) {
      cancelBody(request.body);
      return c.json({ error: "Unauthorized" }, 401);
    }
    const account = await loadStoredWebdavAccount(deps.prisma, deps.secrets, actor.userId);
    if (!account) {
      cancelBody(request.body);
      return c.json({ error: "Set up the WebDAV account first." }, 400, {
        "cache-control": "no-store",
      });
    }
    const method = request.headers.get("x-webdav-method") ?? "";
    if (!(WEBDAV_METHODS as readonly string[]).includes(method)) {
      cancelBody(request.body);
      return c.json({ error: "Send a WebDAV method." }, 400, { "cache-control": "no-store" });
    }
    const rawPath = request.headers.get("x-webdav-path") ?? "";
    if (!rawPath) {
      cancelBody(request.body);
      return c.json({ error: "Send a WebDAV path." }, 400, { "cache-control": "no-store" });
    }
    const resolved = resolveWebdavProxyPath(account, rawPath);
    if (!resolved.ok) {
      cancelBody(request.body);
      return c.json({ error: resolved.error }, 400, { "cache-control": "no-store" });
    }
    const depth = request.headers.get("depth");
    if (method === "PROPFIND" && depth !== null && depth !== "0" && depth !== "1") {
      cancelBody(request.body);
      return c.json({ error: "Send Depth 0 or 1." }, 400, { "cache-control": "no-store" });
    }
    const headers: Record<string, string> = {
      // The password travels only here, built from the sealed account.
      Authorization: `Basic ${Buffer.from(`${account.username}:${account.password}`, "utf8").toString("base64")}`,
    };
    if (method === "PROPFIND" && depth !== null) headers.Depth = depth;
    const contentType = request.headers.get("content-type");
    if (method === "PUT" && contentType) headers["content-type"] = contentType;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(WEBDAV_PROXY_TIMEOUT_MS)]);
    let upstream: Response;
    try {
      upstream = await fetchUpstream(resolved.url, {
        method: method as WebdavMethod,
        headers,
        ...(method === "PUT" && request.body
          ? { body: request.body, duplex: "half" as const }
          : {}),
        redirect: "error",
        signal,
      });
    } catch {
      // Fixed message only: the thrown error may carry the target URL.
      getLogger().warn("webdav-backup.proxy.unreachable");
      cancelBody(request.body);
      return c.json({ error: "Could not reach the WebDAV server" }, 502, {
        "cache-control": "no-store",
      });
    }
    const responseHeaders: Record<string, string> = {
      "x-webdav-status": String(upstream.status),
      "cache-control": "no-store",
    };
    const upstreamContentType = upstream.headers.get("content-type");
    if (upstreamContentType) responseHeaders["content-type"] = upstreamContentType;
    return new Response(upstream.body, { status: 200, headers: responseHeaders });
  });
}
