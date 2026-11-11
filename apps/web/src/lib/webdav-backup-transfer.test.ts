import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rpc", () => ({ recheckSessionOnUnauthorized: () => undefined }));

import { WebdavBackupError } from "./webdav-backup";
import {
  downloadAccountExport,
  downloadZipFromWebdav,
  importAccountZip,
  uploadZipToWebdav,
  webdavProxyPath,
} from "./webdav-backup-transfer";

const account = {
  serverUrl: "https://dav.example.com",
  username: "alice",
  password: "s3cret-pass",
  directory: "rakazo-backup",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function proxyResponse(status: number, body?: BodyInit) {
  return new Response(body, {
    status: 200,
    headers: { "x-webdav-status": String(status) },
  });
}

describe("webdavProxyPath", () => {
  it("builds an encoded path inside the backup directory", () => {
    expect(webdavProxyPath(account, "rakazo-backup.zip")).toBe("rakazo-backup/rakazo-backup.zip");
    expect(webdavProxyPath({ ...account, directory: "my backup" }, "rakazo-backup.zip")).toBe(
      "my%20backup/rakazo-backup.zip",
    );
  });
});

describe("downloadAccountExport", () => {
  it("streams the zip, reports progress, and hashes as it goes", async () => {
    const zipBytes = new TextEncoder().encode("fake-zip-bytes");
    const expectedSha = createHash("sha256").update(zipBytes).digest("hex");
    fetchMock.mockResolvedValue(
      new Response(new Blob([zipBytes as BlobPart], { type: "application/zip" }), {
        status: 200,
        headers: { "content-length": String(zipBytes.length) },
      }),
    );
    const seen: Array<[number, number]> = [];
    const result = await downloadAccountExport({
      accountToken: "token-1",
      backupPassword: "a-long-backup-password",
      onProgress: (written, total) => seen.push([written, total]),
    });
    expect(result.size).toBe(zipBytes.length);
    expect(result.sha256).toBe(expectedSha);
    expect(await result.blob.text()).toBe("fake-zip-bytes");
    expect(seen.at(-1)).toEqual([zipBytes.length, zipBytes.length]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/account/export");
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      token: "token-1",
      backupPassword: "a-long-backup-password",
    });
  });

  it("maps an expired token to export-expired", async () => {
    fetchMock.mockResolvedValue(new Response("Export link expired", { status: 410 }));
    await expect(
      downloadAccountExport({ accountToken: "spent", backupPassword: "a-long-backup-password" }),
    ).rejects.toMatchObject({ code: "export-expired" });
  });

  it("maps a network failure to export-failed", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(
      downloadAccountExport({ accountToken: "token-1", backupPassword: "a-long-backup-password" }),
    ).rejects.toMatchObject({ code: "export-failed" });
  });
});

describe("uploadZipToWebdav", () => {
  it("PUTs through the proxy and reports upload progress", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body?: unknown }) => {
      // The network pulls the counting stream: consume it to drive progress.
      if (init.body) await new Response(init.body as BodyInit).arrayBuffer();
      return proxyResponse(201);
    });
    const seen: Array<[number, number]> = [];
    const blob = new Blob(["zip-bytes-here"], { type: "application/zip" });
    await uploadZipToWebdav({
      account,
      fileName: "rakazo-backup.zip",
      blob,
      onProgress: (sent, total) => seen.push([sent, total]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/webdav-backup/proxy");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["x-webdav-method"]).toBe("PUT");
    expect(headers["x-webdav-path"]).toBe("rakazo-backup/rakazo-backup.zip");
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers.Authorization).toBeUndefined();
    expect(seen.at(-1)).toEqual([blob.size, blob.size]);
  });

  it("maps a WebDAV auth failure to auth", async () => {
    fetchMock.mockResolvedValue(proxyResponse(401));
    await expect(
      uploadZipToWebdav({
        account,
        fileName: "rakazo-backup.zip",
        blob: new Blob(["x"]),
      }),
    ).rejects.toBeInstanceOf(WebdavBackupError);
    await expect(
      uploadZipToWebdav({
        account,
        fileName: "rakazo-backup.zip",
        blob: new Blob(["x"]),
      }),
    ).rejects.toMatchObject({ code: "auth" });
  });
});

describe("downloadZipFromWebdav", () => {
  it("GETs through the proxy and returns the blob", async () => {
    fetchMock.mockResolvedValue(
      proxyResponse(200, new Blob(["zip-bytes"], { type: "application/zip" })),
    );
    const blob = await downloadZipFromWebdav({ account, fileName: "rakazo-backup.zip" });
    expect(await blob.text()).toBe("zip-bytes");
    const headers = (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers["x-webdav-method"]).toBe("GET");
    expect(headers["x-webdav-path"]).toBe("rakazo-backup/rakazo-backup.zip");
  });

  it("maps a missing zip to not-found", async () => {
    fetchMock.mockResolvedValue(proxyResponse(404));
    await expect(
      downloadZipFromWebdav({ account, fileName: "rakazo-backup.zip" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("importAccountZip", () => {
  it("POSTs the zip with the backup password in a header and returns the result", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await importAccountZip({
      blob: new Blob(["zip-bytes"]),
      backupPassword: "a-long-backup-password",
    });
    expect(result).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/account/import");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers["x-rakazo-backup-password"]).toBe("a-long-backup-password");
  });

  it("returns the server's error body instead of throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "The file is not a readable Rakazo export." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await importAccountZip({
      blob: new Blob(["junk"]),
      backupPassword: "a-long-backup-password",
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "The file is not a readable Rakazo export." });
  });
});
