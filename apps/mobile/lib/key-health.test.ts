import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkKey,
  checkKeyForProvider,
  checkKeys,
  keyCheckResultText,
  keyHealthFromCredential,
  keyHealthLabel,
} from "./key-health";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ rpc: rpcMock }));

const t = (message: string, values?: Record<string, string | number>) =>
  message.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? name));

const checkedAt = "2026-11-15T12:00:00.000Z";

describe("checkKeys", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("returns one result per connection and drops malformed rows", async () => {
    rpcMock.mockResolvedValue({
      results: [
        { credentialId: "cred-1", status: "ok", checkedAt, modelCount: 3 },
        { credentialId: "cred-2", status: "invalid_key", checkedAt },
        { credentialId: "cred-3", status: "bogus", checkedAt },
        "nope",
      ],
    });
    await expect(checkKeys(["cred-1", "cred-2", "cred-3"])).resolves.toEqual([
      { credentialId: "cred-1", status: "ok", checkedAt, modelCount: 3 },
      { credentialId: "cred-2", status: "invalid_key", checkedAt },
    ]);
    expect(rpcMock).toHaveBeenCalledWith(
      "models/checkKeys",
      { credentialIds: ["cred-1", "cred-2", "cred-3"] },
      { timeoutMs: 30_000 },
    );
  });

  it("does not call the server with no connections", async () => {
    await expect(checkKeys([])).resolves.toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws when the envelope is not a result list", async () => {
    rpcMock.mockResolvedValue({});
    await expect(checkKeys(["cred-1"])).rejects.toThrow("Could not check keys");
  });
});

describe("checkKey", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("returns the single result", async () => {
    rpcMock.mockResolvedValue({ credentialId: "cred-1", status: "timeout", checkedAt });
    await expect(checkKey("cred-1")).resolves.toEqual({
      credentialId: "cred-1",
      status: "timeout",
      checkedAt,
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "models/checkKey",
      { credentialId: "cred-1" },
      { timeoutMs: 5_000 },
    );
  });

  it("throws when the result is unusable", async () => {
    rpcMock.mockResolvedValue({ nope: true });
    await expect(checkKey("cred-1")).rejects.toThrow("Could not check this key");
  });
});

describe("checkKeyForProvider", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("checks the saved connection for the provider", async () => {
    rpcMock.mockImplementation(async (proc: string) => {
      if (proc === "models/credentials")
        return [{ id: "cred-1", provider: "anthropic", label: "A", hasKey: true }];
      if (proc === "models/checkKey") return { credentialId: "cred-1", status: "ok", checkedAt };
      throw new Error(`unexpected rpc ${proc}`);
    });
    await expect(checkKeyForProvider("anthropic")).resolves.toEqual({
      credentialId: "cred-1",
      result: { credentialId: "cred-1", status: "ok", checkedAt },
    });
  });

  it("returns null when the provider has no saved connection", async () => {
    rpcMock.mockResolvedValue([]);
    await expect(checkKeyForProvider("anthropic")).resolves.toBeNull();
  });
});

describe("keyHealthFromCredential", () => {
  it("reads the persisted health, when the server stored one", () => {
    expect(
      keyHealthFromCredential({
        id: "cred-1",
        keyHealth: { status: "invalid_key", checkedAt },
      } as never),
    ).toEqual({ status: "invalid_key", checkedAt });
    expect(keyHealthFromCredential({ id: "cred-1" } as never)).toBeUndefined();
  });
});

describe("keyHealthLabel", () => {
  it("says never checked without a health record", () => {
    expect(keyHealthLabel(t, undefined, "en-US")).toEqual({
      text: "Key not checked",
      invalid: false,
    });
  });

  it("marks an invalid key and stamps the check time", () => {
    const label = keyHealthLabel(t, { status: "invalid_key", checkedAt }, "en-US");
    expect(label.invalid).toBe(true);
    expect(label.text.startsWith("Key invalid · ")).toBe(true);
  });

  it("keeps a good key out of the red state", () => {
    const label = keyHealthLabel(t, { status: "ok", checkedAt }, "en-US");
    expect(label.invalid).toBe(false);
    expect(label.text.startsWith("Key OK · ")).toBe(true);
  });
});

describe("keyCheckResultText", () => {
  it("says what each status means", () => {
    expect(keyCheckResultText(t, "ok")).toBe("This key works.");
    expect(keyCheckResultText(t, "invalid_key")).toBe("This key was rejected.");
    expect(keyCheckResultText(t, "unreachable")).toBe(
      "Could not reach the provider to check the key.",
    );
    expect(keyCheckResultText(t, "timeout")).toBe("Checking the key timed out.");
    expect(keyCheckResultText(t, "unsupported")).toBe("This provider can't be checked this way.");
  });
});
