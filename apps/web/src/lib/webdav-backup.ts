import { recheckSessionOnUnauthorized } from "./rpc";

/**
 * WebDAV backup: the pure, testable half, ported from the mobile client.
 * The native file transfers live in webdav-backup-transfer.ts; the account
 * store in webdav-backup-account.ts.
 *
 * Two deliberate divergences from mobile, both worth knowing before review:
 *
 * 1. The web client never touches the WebDAV password. The server proxy
 *    (`POST /api/webdav-backup/proxy`) authenticates with the sealed
 *    account, so no Authorization header is built here and no credential
 *    ever enters a request the browser sends. The pure functions below
 *    therefore send no auth header at all; the fetch implementation is the
 *    proxy, and tests assert the password stays out of it.
 * 2. No sync decision and no settings file in v1. The web writes only the
 *    zip and the manifest: it has no appearance settings to contribute, and
 *    a settings file would carry a made-up expression pack that a mobile
 *    restore would then apply to every bot. A mobile-made settings file is
 *    left alone on restore; the zip import is the restore.
 */

export const WEBDAV_BACKUP_DIRECTORY_DEFAULT = "rakazo-backup";
export const WEBDAV_BACKUP_ZIP_NAME = "rakazo-backup.zip";
export const WEBDAV_BACKUP_MANIFEST_NAME = "rakazo-backup.json";
export const BACKUP_MANIFEST_VERSION = 1;

export type WebdavBackupErrorCode =
  | "https-required"
  | "invalid-url"
  | "credentials-in-url"
  | "invalid-directory"
  | "auth"
  | "parent-missing"
  | "not-found"
  | "server-error"
  | "unreachable"
  | "export-failed"
  | "export-expired"
  | "import-failed";

/**
 * Fixed-message errors only: no URL, server body, or credential ever lands in
 * a message, so a password cannot leak through a log line or an alert.
 */
export class WebdavBackupError extends Error {
  readonly code: WebdavBackupErrorCode;

  constructor(code: WebdavBackupErrorCode) {
    super(code);
    this.code = code;
  }
}

export type WebdavBackupAccount = {
  /** https origin, no trailing slash, no credentials in the URL. */
  serverUrl: string;
  username: string;
  /** The WebDAV account password. The backup password is never stored. */
  password: string;
  /** Raw directory segments, e.g. ["rakazo-backup"]. */
  directory: string;
};

/**
 * Normalizes a WebDAV server address. Only https is accepted: a backup
 * password sent over http would travel in the clear. Credentials in the URL
 * are refused outright.
 */
export function normalizeWebdavServerUrl(
  input: string,
): { ok: true; serverUrl: string } | { ok: false; error: WebdavBackupErrorCode } {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "https-required" };
  if (url.username || url.password) return { ok: false, error: "credentials-in-url" };
  if (url.search || url.hash) return { ok: false, error: "invalid-url" };
  return { ok: true, serverUrl: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}` };
}

/**
 * Sanitizes a backup directory. `..`, a leading `/`, backslashes, and empty
 * segments are all refused; each segment is percent-encoded when a URL is
 * built, never trusted raw.
 */
export function sanitizeBackupDirectory(
  input: string,
): { ok: true; segments: string[] } | { ok: false; error: "invalid-directory" } {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, segments: [WEBDAV_BACKUP_DIRECTORY_DEFAULT] };
  if (trimmed.startsWith("/") || trimmed.includes("\\"))
    return { ok: false, error: "invalid-directory" };
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return { ok: false, error: "invalid-directory" };
    }
  }
  return { ok: true, segments };
}

/** A directory URL with every segment percent-encoded, and no credentials. */
export function webdavUrl(base: string, segments: string[], fileName?: string): string {
  const parts = [...segments, ...(fileName ? [fileName] : [])].map((part) =>
    encodeURIComponent(part),
  );
  return `${base}/${parts.join("/")}`;
}

/** `d:href` values out of a PROPFIND multistatus body, percent-decoded. */
export function parsePropfindHrefs(xml: string): string[] {
  const hrefs: string[] = [];
  const pattern = /<[^>]*:?href>([^<]*)<\/[^>]*:?href>/gi;
  for (;;) {
    const match = pattern.exec(xml);
    if (match === null) break;
    const raw = match[1]!.trim();
    try {
      hrefs.push(decodeURIComponent(raw));
    } catch {
      hrefs.push(raw);
    }
  }
  return hrefs;
}

export type WebdavResponse = {
  status: number;
  text: () => Promise<string>;
};

export type WebdavFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<WebdavResponse>;

/**
 * The proxy fetch: a WebDAV request becomes a POST to
 * `/api/webdav-backup/proxy`, with the method in `x-webdav-method` and the
 * path (relative to the server root, percent-encoded) in `x-webdav-path`.
 * The proxy answers its own 200 with the WebDAV status in
 * `x-webdav-status`, so a WebDAV 401 never looks like the session went
 * away. A proxy 401 is the session: recheck it and fail plainly.
 */
export function createProxyWebdavFetch(account: WebdavBackupAccount): WebdavFetch {
  return async (url, init) => {
    const normalized = normalizeWebdavServerUrl(account.serverUrl);
    if (!normalized.ok) throw new WebdavBackupError(normalized.error);
    let path: string;
    try {
      const target = new URL(url);
      const base = new URL(normalized.serverUrl);
      if (target.origin !== base.origin) throw new Error("origin mismatch");
      const basePath = base.pathname.replace(/\/+$/, "");
      if (
        basePath !== "" &&
        target.pathname !== basePath &&
        !target.pathname.startsWith(`${basePath}/`)
      ) {
        throw new Error("path mismatch");
      }
      path = target.pathname.slice(basePath.length).replace(/^\/+/, "");
    } catch (error) {
      if (error instanceof WebdavBackupError) throw error;
      throw new WebdavBackupError("invalid-url");
    }
    let response: Response;
    try {
      response = await fetch("/api/webdav-backup/proxy", {
        method: "POST",
        headers: {
          "x-webdav-method": init.method,
          "x-webdav-path": path,
          ...(init.headers.Depth ? { Depth: init.headers.Depth } : {}),
          ...(init.headers["content-type"] ? { "content-type": init.headers["content-type"] } : {}),
        },
        credentials: "include",
        body: init.body,
      });
    } catch {
      throw new WebdavBackupError("unreachable");
    }
    if (response.status === 401) {
      recheckSessionOnUnauthorized(response.status);
      throw new Error("WebDAV proxy session expired");
    }
    const statusHeader = response.headers.get("x-webdav-status");
    if (!statusHeader) throw new WebdavBackupError("server-error");
    const status = Number(statusHeader);
    if (!Number.isInteger(status)) throw new WebdavBackupError("server-error");
    return { status, text: () => response.text() };
  };
}

async function propfind(
  account: WebdavBackupAccount,
  segments: string[],
  depth: "0" | "1",
  fetchImpl: WebdavFetch,
): Promise<WebdavResponse> {
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) throw new WebdavBackupError(normalized.error);
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) throw new WebdavBackupError(directory.error);
  return fetchImpl(webdavUrl(normalized.serverUrl, segments), {
    method: "PROPFIND",
    headers: { Depth: depth },
  });
}

export type WebdavConnectionTest =
  | { status: "ok" }
  | { status: "auth-error" }
  | { status: "missing-directory" }
  | { status: "server-error" }
  | { status: "unreachable" };

/**
 * PROPFIND Depth:0 on the backup directory. 207 means the directory is
 * there, 401 means the password is wrong, 404 means the login worked but
 * the directory does not exist yet.
 */
export async function testWebdavConnection(
  account: WebdavBackupAccount,
  fetchImpl: WebdavFetch = createProxyWebdavFetch(account),
): Promise<WebdavConnectionTest> {
  let response: WebdavResponse;
  try {
    const directory = sanitizeBackupDirectory(account.directory);
    if (!directory.ok) return { status: "server-error" };
    response = await propfind(account, directory.segments, "0", fetchImpl);
  } catch (error) {
    if (error instanceof WebdavBackupError) return { status: "server-error" };
    return { status: "unreachable" };
  }
  if (response.status === 207) return { status: "ok" };
  if (response.status === 401 || response.status === 403) return { status: "auth-error" };
  if (response.status === 404) return { status: "missing-directory" };
  return { status: "server-error" };
}

/**
 * Makes sure the backup directory exists: PROPFIND first, MKCOL on a 404.
 * A 405 from MKCOL means it already exists; a 409 means a parent directory
 * is missing; 401/403 stop with an auth error.
 */
export async function ensureWebdavDirectory(
  account: WebdavBackupAccount,
  fetchImpl: WebdavFetch = createProxyWebdavFetch(account),
): Promise<void> {
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) throw new WebdavBackupError(directory.error);
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) throw new WebdavBackupError(normalized.error);
  let response: WebdavResponse;
  try {
    response = await propfind(account, directory.segments, "0", fetchImpl);
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  if (response.status === 207) return;
  if (response.status === 401 || response.status === 403) throw new WebdavBackupError("auth");
  if (response.status !== 404) throw new WebdavBackupError("server-error");
  let created: WebdavResponse;
  try {
    created = await fetchImpl(webdavUrl(normalized.serverUrl, directory.segments), {
      method: "MKCOL",
      headers: {},
    });
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  if (created.status === 201 || created.status === 204 || created.status === 405) return;
  if (created.status === 409) throw new WebdavBackupError("parent-missing");
  if (created.status === 401 || created.status === 403) throw new WebdavBackupError("auth");
  throw new WebdavBackupError("server-error");
}

/** File names directly inside the backup directory, from a Depth:1 listing. */
export async function listWebdavDirectory(
  account: WebdavBackupAccount,
  fetchImpl: WebdavFetch = createProxyWebdavFetch(account),
): Promise<string[]> {
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) throw new WebdavBackupError(directory.error);
  let response: WebdavResponse;
  try {
    response = await propfind(account, directory.segments, "1", fetchImpl);
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  if (response.status === 401 || response.status === 403) throw new WebdavBackupError("auth");
  if (response.status !== 207) throw new WebdavBackupError("server-error");
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) throw new WebdavBackupError(normalized.error);
  // The directory's own path, so a server mounted under a prefix
  // (https://host/dav/rakazo-backup/) still lists correctly.
  const directoryPath = new URL(
    webdavUrl(normalized.serverUrl, directory.segments),
  ).pathname.replace(/\/+$/, "");
  const hrefs = parsePropfindHrefs(await response.text());
  const names = new Set<string>();
  for (const href of hrefs) {
    let path: string;
    try {
      path = new URL(href, "https://webdav.invalid").pathname;
    } catch {
      continue;
    }
    const decoded = (() => {
      try {
        return decodeURIComponent(path);
      } catch {
        return path;
      }
    })().replace(/\/+$/, "");
    if (!decoded.startsWith(`${directoryPath}/`)) continue;
    const rest = decoded.slice(directoryPath.length + 1);
    if (rest && !rest.includes("/")) names.add(rest);
  }
  return [...names];
}

/** Small text file up to the backup directory (the manifest). */
export async function putWebdavTextFile(
  account: WebdavBackupAccount,
  fileName: string,
  content: string,
  contentType: string,
  fetchImpl: WebdavFetch = createProxyWebdavFetch(account),
): Promise<void> {
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) throw new WebdavBackupError(directory.error);
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) throw new WebdavBackupError(normalized.error);
  let response: WebdavResponse;
  try {
    response = await fetchImpl(webdavUrl(normalized.serverUrl, directory.segments, fileName), {
      method: "PUT",
      headers: { "content-type": contentType },
      body: content,
    });
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  if (response.status === 401 || response.status === 403) throw new WebdavBackupError("auth");
  if (response.status < 200 || response.status >= 300) throw new WebdavBackupError("server-error");
}

/** Small text file down from the backup directory; null when it is not there. */
export async function getWebdavTextFile(
  account: WebdavBackupAccount,
  fileName: string,
  fetchImpl: WebdavFetch = createProxyWebdavFetch(account),
): Promise<string | null> {
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) throw new WebdavBackupError(directory.error);
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) throw new WebdavBackupError(normalized.error);
  let response: WebdavResponse;
  try {
    response = await fetchImpl(webdavUrl(normalized.serverUrl, directory.segments, fileName), {
      method: "GET",
      headers: {},
    });
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) throw new WebdavBackupError("auth");
  if (response.status !== 200) throw new WebdavBackupError("server-error");
  return response.text();
}

export type BackupManifest = {
  version: 1;
  exportedAt: string;
  size: number;
  sha256: string;
};

export function buildBackupManifest(input: {
  size: number;
  sha256: string;
  exportedAt?: Date;
}): BackupManifest {
  return {
    version: BACKUP_MANIFEST_VERSION,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    size: input.size,
    sha256: input.sha256,
  };
}

export function parseBackupManifest(value: unknown): BackupManifest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.version !== BACKUP_MANIFEST_VERSION) return null;
  if (typeof item.exportedAt !== "string" || Number.isNaN(Date.parse(item.exportedAt))) return null;
  if (typeof item.size !== "number" || !Number.isInteger(item.size) || item.size < 0) return null;
  if (typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) return null;
  return {
    version: BACKUP_MANIFEST_VERSION,
    exportedAt: item.exportedAt,
    size: item.size,
    sha256: item.sha256,
  };
}
