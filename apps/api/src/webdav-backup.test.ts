import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { StoredWebdavBackupAccount } from "./webdav-backup.js";
import {
  mountWebdavBackupRoutes,
  normalizeWebdavServerUrl,
  resolveWebdavProxyPath,
  sanitizeBackupDirectory,
} from "./webdav-backup.js";

const actor = { userId: "user-1", spaceId: "space-1" } as never;

const account: StoredWebdavBackupAccount = {
  serverUrl: "https://dav.example.com/dav",
  username: "alice",
  password: "s3cret-pass",
  directory: "rakazo-backup",
};

describe("normalizeWebdavServerUrl", () => {
  it("accepts https and strips a trailing slash", () => {
    expect(normalizeWebdavServerUrl("https://dav.example.com/dav/")).toEqual({
      ok: true,
      serverUrl: "https://dav.example.com/dav",
    });
  });

  it("refuses http and credentials in the URL", () => {
    expect(normalizeWebdavServerUrl("http://dav.example.com")).toEqual({
      ok: false,
      error: "Use an https address.",
    });
    expect(normalizeWebdavServerUrl("https://alice:s3cret@dav.example.com")).toEqual({
      ok: false,
      error: "Put the account and password in their own fields, not in the address.",
    });
  });
});

describe("sanitizeBackupDirectory", () => {
  it("defaults an empty directory and refuses traversal", () => {
    expect(sanitizeBackupDirectory("")).toEqual({ ok: true, segments: ["rakazo-backup"] });
    expect(sanitizeBackupDirectory("backups/rakazo")).toEqual({
      ok: true,
      segments: ["backups", "rakazo"],
    });
    for (const bad of ["../etc", "/rakazo-backup", "a\\b", "a//b"]) {
      expect(sanitizeBackupDirectory(bad)).toEqual({
        ok: false,
        error: "The directory is not valid.",
      });
    }
  });
});

describe("resolveWebdavProxyPath", () => {
  it("resolves the directory and the two backup files", () => {
    expect(resolveWebdavProxyPath(account, "rakazo-backup")).toEqual({
      ok: true,
      url: "https://dav.example.com/dav/rakazo-backup",
    });
    expect(resolveWebdavProxyPath(account, "rakazo-backup/rakazo-backup.zip")).toEqual({
      ok: true,
      url: "https://dav.example.com/dav/rakazo-backup/rakazo-backup.zip",
    });
    expect(resolveWebdavProxyPath(account, "rakazo-backup/rakazo-backup.json")).toEqual({
      ok: true,
      url: "https://dav.example.com/dav/rakazo-backup/rakazo-backup.json",
    });
  });

  it("refuses paths outside the backup directory", () => {
    for (const bad of [
      "other-dir",
      "rakazo-backup/../etc/passwd",
      "rakazo-backup/%2e%2e/etc",
      "rakazo-backup/notes.txt",
      "rakazo-backup/nested/file.zip",
      "rakazo-backup/rakazo-settings.json",
      "",
    ]) {
      expect(resolveWebdavProxyPath(account, bad)).toEqual({
        ok: false,
        error: "Send a WebDAV path inside the backup directory.",
      });
    }
  });

  it("percent-encodes segments", () => {
    const nested = { ...account, directory: "my backup" };
    expect(resolveWebdavProxyPath(nested, "my%20backup/rakazo-backup.zip")).toEqual({
      ok: true,
      url: "https://dav.example.com/dav/my%20backup/rakazo-backup.zip",
    });
  });
});

function fakeSecrets() {
  const sealed = new Map<string, string>();
  return {
    sealed,
    put: vi.fn(async (plaintext: string) => {
      const id = `sec-${sealed.size + 1}`;
      sealed.set(id, plaintext);
      return { id, ref: id, ciphertext: `cipher:${id}` };
    }),
    load: vi.fn(async (ciphertext: string) => {
      const id = ciphertext.replace("cipher:", "");
      const value = sealed.get(id);
      if (value === undefined) throw new Error("missing secret");
      return value;
    }),
  };
}

function fakePrisma(secrets: ReturnType<typeof fakeSecrets>) {
  const rows: Array<{
    id: string;
    userId: string;
    kind: string;
    spaceId: string | null;
    ciphertext: string;
  }> = [];
  const client = {
    secret: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find(
            (row) =>
              row.userId === where.userId &&
              row.kind === where.kind &&
              row.spaceId === where.spaceId,
          ) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter(
          (row) =>
            row.userId === where.userId && row.kind === where.kind && row.spaceId === where.spaceId,
        ),
      ),
      create: vi.fn(
        async ({ data }: { data: { id: string; userId: string; ciphertext: string } }) => {
          rows.push({
            id: data.id,
            userId: data.userId,
            kind: "webdav-backup",
            spaceId: null,
            ciphertext: data.ciphertext,
          });
          return data;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = rows.length;
        const ids = (where.id as { in?: string[] } | undefined)?.in;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const matchesIds = ids?.includes(rows[i]!.id) ?? false;
          const matchesOwner =
            rows[i]!.userId === where.userId &&
            rows[i]!.kind === where.kind &&
            rows[i]!.spaceId === where.spaceId;
          if (matchesIds || matchesOwner) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { client, rows, secrets };
}

function mount(prisma: unknown, secrets: unknown, fetchImpl?: typeof fetch) {
  const app = new Hono();
  mountWebdavBackupRoutes(
    app,
    { prisma: prisma as never, secrets: secrets as never, fetchImpl },
    async () => actor,
  );
  return app;
}

async function putAccount(app: Hono, body: unknown) {
  return app.request("/api/webdav-backup/account", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/webdav-backup/account", () => {
  it("returns null when nothing is stored, and never the password", async () => {
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets);
    await expect((await app.request("/api/webdav-backup/account")).json()).resolves.toEqual({
      account: null,
    });
    const saved = await putAccount(app, {
      serverUrl: "https://dav.example.com",
      username: "alice",
      password: "s3cret-pass",
      directory: "",
    });
    expect(saved.status).toBe(200);
    await expect((await app.request("/api/webdav-backup/account")).json()).resolves.toEqual({
      account: {
        serverUrl: "https://dav.example.com",
        username: "alice",
        directory: "rakazo-backup",
        hasPassword: true,
      },
    });
    const stored = [...secrets.sealed.values()][0]!;
    expect(stored).toContain("s3cret-pass");
    expect(
      JSON.stringify(await (await app.request("/api/webdav-backup/account")).json()),
    ).not.toContain("s3cret-pass");
  });

  it("returns 401 without a session", async () => {
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = new Hono();
    mountWebdavBackupRoutes(
      app,
      { prisma: client as never, secrets: secrets as never },
      async () => null,
    );
    expect((await app.request("/api/webdav-backup/account")).status).toBe(401);
  });
});

describe("PUT /api/webdav-backup/account", () => {
  it("refuses http, credentials in the URL, and a bad directory", async () => {
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets);
    for (const body of [
      { serverUrl: "http://dav.example.com", username: "alice", password: "x", directory: "" },
      {
        serverUrl: "https://alice:x@dav.example.com",
        username: "alice",
        password: "x",
        directory: "",
      },
      {
        serverUrl: "https://dav.example.com",
        username: "alice",
        password: "x",
        directory: "../etc",
      },
      { serverUrl: "https://dav.example.com", username: " ", password: "x", directory: "" },
    ]) {
      expect((await putAccount(app, body)).status).toBe(400);
    }
  });

  it("refuses a first save with no password, and keeps the stored one after", async () => {
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets);
    const empty = await putAccount(app, {
      serverUrl: "https://dav.example.com",
      username: "alice",
      password: "",
      directory: "",
    });
    expect(empty.status).toBe(400);
    expect(
      (
        await putAccount(app, {
          serverUrl: "https://dav.example.com",
          username: "alice",
          password: "s3cret-pass",
          directory: "",
        })
      ).status,
    ).toBe(200);
    const kept = await putAccount(app, {
      serverUrl: "https://dav.example.com/dav",
      username: "bob",
      password: "",
      directory: "backups",
    });
    expect(kept.status).toBe(200);
    await expect(kept.json()).resolves.toEqual({
      account: {
        serverUrl: "https://dav.example.com/dav",
        username: "bob",
        directory: "backups",
        hasPassword: true,
      },
    });
    const stored = [...secrets.sealed.values()].at(-1)!;
    expect(JSON.parse(stored)).toEqual({
      serverUrl: "https://dav.example.com/dav",
      username: "bob",
      password: "s3cret-pass",
      directory: "backups",
    });
  });

  it("replaces the old sealed row on save", async () => {
    const { client, rows, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets);
    await putAccount(app, {
      serverUrl: "https://dav.example.com",
      username: "alice",
      password: "one",
      directory: "",
    });
    await putAccount(app, {
      serverUrl: "https://dav.example.com",
      username: "alice",
      password: "two",
      directory: "",
    });
    expect(rows).toHaveLength(1);
    expect(JSON.parse([...secrets.sealed.values()].at(-1)!).password).toBe("two");
  });

  it("deletes the stored account", async () => {
    const { client, rows, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets);
    await putAccount(app, {
      serverUrl: "https://dav.example.com",
      username: "alice",
      password: "s3cret-pass",
      directory: "",
    });
    expect(rows).toHaveLength(1);
    const deleted = await app.request("/api/webdav-backup/account", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(rows).toHaveLength(0);
  });
});

describe("POST /api/webdav-backup/proxy", () => {
  function upstream(status: number, body = "") {
    return vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(body, { status }));
  }

  function proxyRequest(app: Hono, init: Record<string, string>, body?: BodyInit) {
    return app.request("/api/webdav-backup/proxy", {
      method: "POST",
      headers: init,
      ...(body !== undefined ? { body } : {}),
    });
  }

  async function withAccount() {
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets);
    await putAccount(app, {
      serverUrl: account.serverUrl,
      username: account.username,
      password: account.password,
      directory: account.directory,
    });
    return { app, secrets };
  }

  it("refuses to proxy without a stored account", async () => {
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = mount(client, secrets, upstream(207));
    const response = await proxyRequest(app, {
      "x-webdav-method": "PROPFIND",
      "x-webdav-path": "rakazo-backup",
      Depth: "0",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Set up the WebDAV account first.",
    });
  });

  it("refuses unknown methods and paths outside the directory", async () => {
    const { app } = await withAccount();
    const cases: Array<Record<string, string>> = [
      { "x-webdav-method": "DELETE", "x-webdav-path": "rakazo-backup" },
      { "x-webdav-method": "PROPFIND", "x-webdav-path": "rakazo-backup/../../etc" },
      { "x-webdav-method": "GET", "x-webdav-path": "rakazo-backup/notes.txt" },
      { "x-webdav-method": "PROPFIND" },
    ];
    for (const init of cases) {
      expect((await proxyRequest(app, init)).status).toBe(400);
    }
  });

  it("forwards PROPFIND with a Basic header and returns the WebDAV status", async () => {
    const fetchImpl = upstream(207, "<d:multistatus/>");
    const { client, secrets } = fakePrisma(fakeSecrets());
    const stubbed = new Hono();
    mountWebdavBackupRoutes(
      stubbed,
      { prisma: client as never, secrets: secrets as never, fetchImpl: fetchImpl as never },
      async () => actor,
    );
    await putAccount(stubbed, {
      serverUrl: account.serverUrl,
      username: account.username,
      password: account.password,
      directory: account.directory,
    });
    const response = await proxyRequest(stubbed, {
      "x-webdav-method": "PROPFIND",
      "x-webdav-path": "rakazo-backup",
      Depth: "0",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-webdav-status")).toBe("207");
    expect(await response.text()).toBe("<d:multistatus/>");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://dav.example.com/dav/rakazo-backup");
    expect(String(url)).not.toContain("s3cret");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("alice:s3cret-pass", "utf8").toString("base64")}`,
    );
    expect(headers.Depth).toBe("0");
  });

  it("carries a WebDAV 401 as x-webdav-status, not as the proxy's own status", async () => {
    const fetchImpl = upstream(401);
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = new Hono();
    mountWebdavBackupRoutes(
      app,
      { prisma: client as never, secrets: secrets as never, fetchImpl: fetchImpl as never },
      async () => actor,
    );
    await putAccount(app, {
      serverUrl: account.serverUrl,
      username: account.username,
      password: account.password,
      directory: account.directory,
    });
    const response = await proxyRequest(app, {
      "x-webdav-method": "GET",
      "x-webdav-path": "rakazo-backup/rakazo-backup.zip",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-webdav-status")).toBe("401");
  });

  it("answers 502 with a fixed message when the server is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED https://dav.example.com/dav/rakazo-backup");
    });
    const { client, secrets } = fakePrisma(fakeSecrets());
    const app = new Hono();
    mountWebdavBackupRoutes(
      app,
      { prisma: client as never, secrets: secrets as never, fetchImpl: fetchImpl as never },
      async () => actor,
    );
    await putAccount(app, {
      serverUrl: account.serverUrl,
      username: account.username,
      password: account.password,
      directory: account.directory,
    });
    const response = await proxyRequest(app, {
      "x-webdav-method": "PROPFIND",
      "x-webdav-path": "rakazo-backup",
      Depth: "0",
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Could not reach the WebDAV server",
    });
  });
});
