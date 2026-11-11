import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rpc", () => ({ recheckSessionOnUnauthorized: () => undefined }));

import type { WebdavFetch, WebdavResponse } from "./webdav-backup";
import {
  buildBackupManifest,
  createProxyWebdavFetch,
  ensureWebdavDirectory,
  getWebdavTextFile,
  listWebdavDirectory,
  normalizeWebdavServerUrl,
  parseBackupManifest,
  parsePropfindHrefs,
  putWebdavTextFile,
  sanitizeBackupDirectory,
  testWebdavConnection,
  WebdavBackupError,
  webdavUrl,
} from "./webdav-backup";

const account = {
  serverUrl: "https://dav.example.com",
  username: "alice",
  password: "s3cret-pass",
  directory: "rakazo-backup",
};

function response(status: number, body = ""): WebdavResponse {
  return { status, text: async () => body };
}

function fetchStub(
  handler: (url: string, init: Parameters<WebdavFetch>[1]) => WebdavResponse,
): WebdavFetch {
  const stub = vi.fn(async (url: string, init: Parameters<WebdavFetch>[1]) => handler(url, init));
  return stub as unknown as WebdavFetch;
}

describe("normalizeWebdavServerUrl", () => {
  it("accepts https and strips a trailing slash", () => {
    expect(normalizeWebdavServerUrl("https://dav.example.com/dav/")).toEqual({
      ok: true,
      serverUrl: "https://dav.example.com/dav",
    });
  });

  it("refuses http", () => {
    expect(normalizeWebdavServerUrl("http://dav.example.com")).toEqual({
      ok: false,
      error: "https-required",
    });
  });

  it("refuses credentials in the URL", () => {
    expect(normalizeWebdavServerUrl("https://alice:s3cret@dav.example.com")).toEqual({
      ok: false,
      error: "credentials-in-url",
    });
  });

  it("refuses garbage", () => {
    expect(normalizeWebdavServerUrl("not a url")).toEqual({
      ok: false,
      error: "invalid-url",
    });
  });
});

describe("sanitizeBackupDirectory", () => {
  it("defaults an empty directory", () => {
    expect(sanitizeBackupDirectory("")).toEqual({ ok: true, segments: ["rakazo-backup"] });
  });

  it("keeps nested segments", () => {
    expect(sanitizeBackupDirectory("backups/rakazo")).toEqual({
      ok: true,
      segments: ["backups", "rakazo"],
    });
  });

  it("refuses .., a leading slash, backslashes, and empty segments", () => {
    for (const bad of ["../etc", "/rakazo-backup", "a\\b", "a//b", "a/", ".", "a/./b"]) {
      expect(sanitizeBackupDirectory(bad)).toEqual({ ok: false, error: "invalid-directory" });
    }
  });
});

describe("webdavUrl", () => {
  it("percent-encodes segments and never carries credentials", () => {
    const url = webdavUrl("https://dav.example.com", ["my backup"], "rakazo-backup.zip");
    expect(url).toBe("https://dav.example.com/my%20backup/rakazo-backup.zip");
    expect(url).not.toContain("alice");
    expect(url).not.toContain("s3cret");
  });
});

describe("parsePropfindHrefs", () => {
  it("pulls d:href values out of a multistatus body", () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/rakazo-backup/</d:href></d:response>
      <d:response><d:href>/rakazo-backup/rakazo-backup.zip</d:href></d:response>
      <d:response><d:href>/rakazo-backup/my%20file.json</d:href></d:response>
    </d:multistatus>`;
    expect(parsePropfindHrefs(xml)).toEqual([
      "/rakazo-backup/",
      "/rakazo-backup/rakazo-backup.zip",
      "/rakazo-backup/my file.json",
    ]);
  });
});

describe("the pure functions never send credentials", () => {
  it("sends Depth 0 and no Authorization header", async () => {
    const fetchImpl = fetchStub(() => response(207));
    await testWebdavConnection(account, fetchImpl);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(url).toBe("https://dav.example.com/rakazo-backup");
    expect((init as { headers: Record<string, string> }).headers.Depth).toBe("0");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
    expect(String(url)).not.toContain("s3cret");
    expect(JSON.stringify(init)).not.toContain("s3cret");
  });
});

describe("testWebdavConnection", () => {
  it("maps 207/401/404 to ok/auth-error/missing-directory", async () => {
    for (const [status, expected] of [
      [207, "ok"],
      [401, "auth-error"],
      [403, "auth-error"],
      [404, "missing-directory"],
      [500, "server-error"],
    ] as const) {
      const fetchImpl = fetchStub(() => response(status));
      await expect(testWebdavConnection(account, fetchImpl)).resolves.toEqual({
        status: expected,
      });
    }
  });

  it("reports unreachable when fetch throws", async () => {
    const fetchImpl = fetchStub(() => {
      throw new Error("network down");
    });
    await expect(testWebdavConnection(account, fetchImpl)).resolves.toEqual({
      status: "unreachable",
    });
  });
});

describe("ensureWebdavDirectory", () => {
  it("does nothing when the directory exists", async () => {
    const fetchImpl = fetchStub(() => response(207));
    await expect(ensureWebdavDirectory(account, fetchImpl)).resolves.toBeUndefined();
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
  });

  it("creates the directory on a 404 and treats 405 as already there", async () => {
    for (const mkcolStatus of [201, 405]) {
      const calls: string[] = [];
      const fetchImpl = fetchStub((url, init) => {
        calls.push(`${init.method} ${url}`);
        return response(init.method === "PROPFIND" ? 404 : mkcolStatus);
      });
      await expect(ensureWebdavDirectory(account, fetchImpl)).resolves.toBeUndefined();
      expect(calls).toEqual([
        "PROPFIND https://dav.example.com/rakazo-backup",
        "MKCOL https://dav.example.com/rakazo-backup",
      ]);
    }
  });

  it("stops on a missing parent and on bad credentials", async () => {
    const parentMissing = fetchStub((_, init) => response(init.method === "PROPFIND" ? 404 : 409));
    await expect(ensureWebdavDirectory(account, parentMissing)).rejects.toMatchObject({
      code: "parent-missing",
    });
    const badAuth = fetchStub(() => response(401));
    await expect(ensureWebdavDirectory(account, badAuth)).rejects.toMatchObject({
      code: "auth",
    });
  });
});

describe("listWebdavDirectory", () => {
  it("lists direct children only", async () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/rakazo-backup/</d:href></d:response>
      <d:response><d:href>/rakazo-backup/rakazo-backup.zip</d:href></d:response>
      <d:response><d:href>/rakazo-backup/rakazo-backup.json</d:href></d:response>
      <d:response><d:href>/rakazo-backup/nested/file.txt</d:href></d:response>
    </d:multistatus>`;
    const fetchImpl = fetchStub(() => response(207, xml));
    await expect(listWebdavDirectory(account, fetchImpl)).resolves.toEqual([
      "rakazo-backup.zip",
      "rakazo-backup.json",
    ]);
  });
});

describe("put/get text files", () => {
  it("PUTs and reads a 404 as null", async () => {
    const seen: { method: string; url: string }[] = [];
    const fetchImpl = fetchStub((url, init) => {
      seen.push({ method: init.method, url });
      return response(init.method === "PUT" ? 201 : 404);
    });
    await putWebdavTextFile(account, "rakazo-backup.json", "{}", "application/json", fetchImpl);
    await expect(getWebdavTextFile(account, "rakazo-backup.json", fetchImpl)).resolves.toBeNull();
    expect(seen).toEqual([
      { method: "PUT", url: "https://dav.example.com/rakazo-backup/rakazo-backup.json" },
      { method: "GET", url: "https://dav.example.com/rakazo-backup/rakazo-backup.json" },
    ]);
  });

  it("throws a fixed-code error, never the server body", async () => {
    const fetchImpl = fetchStub(() => response(500, "password=s3cret-pass"));
    await expect(
      putWebdavTextFile(account, "x.json", "{}", "application/json", fetchImpl),
    ).rejects.toBeInstanceOf(WebdavBackupError);
    await expect(
      putWebdavTextFile(account, "x.json", "{}", "application/json", fetchImpl),
    ).rejects.toMatchObject({ code: "server-error" });
  });
});

describe("backup manifest", () => {
  it("round-trips and rejects a bad version or sha", () => {
    const manifest = buildBackupManifest({
      size: 12,
      sha256: "a".repeat(64),
      exportedAt: new Date("2026-11-10T00:00:00.000Z"),
    });
    expect(parseBackupManifest(manifest)).toEqual(manifest);
    expect(parseBackupManifest({ ...manifest, version: 2 })).toBeNull();
    expect(parseBackupManifest({ ...manifest, sha256: "xyz" })).toBeNull();
    expect(parseBackupManifest({ ...manifest, size: -1 })).toBeNull();
    expect(parseBackupManifest(null)).toBeNull();
  });
});

describe("createProxyWebdavFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function proxyResponse(status: number, body = "") {
    return new Response(body, {
      status: 200,
      headers: { "x-webdav-status": String(status) },
    });
  }

  it("turns a WebDAV request into a proxy POST with method and path", async () => {
    fetchMock.mockResolvedValue(proxyResponse(207, "<d:multistatus/>"));
    vi.stubGlobal("fetch", fetchMock);
    const fetchImpl = createProxyWebdavFetch({
      ...account,
      serverUrl: "https://dav.example.com/dav",
    });
    const result = await fetchImpl("https://dav.example.com/dav/rakazo-backup", {
      method: "PROPFIND",
      headers: { Depth: "0" },
    });
    expect(result.status).toBe(207);
    expect(await result.text()).toBe("<d:multistatus/>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/webdav-backup/proxy");
    expect((init as { method: string }).method).toBe("POST");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["x-webdav-method"]).toBe("PROPFIND");
    expect(headers["x-webdav-path"]).toBe("rakazo-backup");
    expect(headers.Depth).toBe("0");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain("s3cret");
  });

  it("keeps a server prefix out of the proxy path", async () => {
    fetchMock.mockResolvedValue(proxyResponse(201));
    vi.stubGlobal("fetch", fetchMock);
    const fetchImpl = createProxyWebdavFetch(account);
    await fetchImpl("https://dav.example.com/rakazo-backup/rakazo-backup.zip", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: "zip-bytes",
    });
    const headers = (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers["x-webdav-path"]).toBe("rakazo-backup/rakazo-backup.zip");
    expect(headers["content-type"]).toBe("application/zip");
  });

  it("maps a missing status header to server-error and a network failure to unreachable", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const fetchImpl = createProxyWebdavFetch(account);
    await expect(
      fetchImpl("https://dav.example.com/rakazo-backup", { method: "PROPFIND", headers: {} }),
    ).rejects.toMatchObject({ code: "server-error" });
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(
      fetchImpl("https://dav.example.com/rakazo-backup", { method: "PROPFIND", headers: {} }),
    ).rejects.toMatchObject({ code: "unreachable" });
  });

  it("treats a proxy 401 as a session problem, not a wrong WebDAV password", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const fetchImpl = createProxyWebdavFetch(account);
    await expect(
      fetchImpl("https://dav.example.com/rakazo-backup", { method: "PROPFIND", headers: {} }),
    ).rejects.not.toBeInstanceOf(WebdavBackupError);
  });
});
