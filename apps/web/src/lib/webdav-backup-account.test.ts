import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rpc", () => ({ recheckSessionOnUnauthorized: () => undefined }));

import {
  clearWebdavBackupAccount,
  loadWebdavBackupAccount,
  saveWebdavBackupAccount,
} from "./webdav-backup-account";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("loadWebdavBackupAccount", () => {
  it("returns null when nothing is stored", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { account: null }));
    await expect(loadWebdavBackupAccount()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/webdav-backup/account", {
      credentials: "include",
    });
  });

  it("returns metadata, never a password", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        account: {
          serverUrl: "https://dav.example.com",
          username: "alice",
          directory: "rakazo-backup",
          hasPassword: true,
        },
      }),
    );
    await expect(loadWebdavBackupAccount()).resolves.toEqual({
      serverUrl: "https://dav.example.com",
      username: "alice",
      directory: "rakazo-backup",
      hasPassword: true,
    });
  });

  it("throws on a server failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));
    await expect(loadWebdavBackupAccount()).rejects.toThrow("Could not load the WebDAV account");
  });
});

describe("saveWebdavBackupAccount", () => {
  it("PUTs the account and returns metadata", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        account: {
          serverUrl: "https://dav.example.com",
          username: "alice",
          directory: "rakazo-backup",
          hasPassword: true,
        },
      }),
    );
    await expect(
      saveWebdavBackupAccount({
        serverUrl: "https://dav.example.com",
        username: "alice",
        password: "s3cret-pass",
        directory: "",
      }),
    ).resolves.toEqual({
      serverUrl: "https://dav.example.com",
      username: "alice",
      directory: "rakazo-backup",
      hasPassword: true,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/webdav-backup/account");
    expect((init as { method: string }).method).toBe("PUT");
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      serverUrl: "https://dav.example.com",
      username: "alice",
      password: "s3cret-pass",
      directory: "",
    });
  });

  it("surfaces the server's validation message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "Use an https address." }));
    await expect(
      saveWebdavBackupAccount({
        serverUrl: "http://dav.example.com",
        username: "alice",
        password: "x",
        directory: "",
      }),
    ).rejects.toThrow("Use an https address.");
  });
});

describe("clearWebdavBackupAccount", () => {
  it("DELETEs the stored account", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { account: null }));
    await clearWebdavBackupAccount();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/webdav-backup/account");
    expect((init as { method: string }).method).toBe("DELETE");
  });
});
