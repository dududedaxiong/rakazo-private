import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  checkKey,
  checkKeyForProvider,
  checkKeys,
  credentialKeyHealth,
  resolveCredentialIdForProvider,
} from "./key-health";

vi.mock("@rakazo/ui-web", () => ({ toast: vi.fn() }));

const results = (ids: string[]) =>
  ids.map((credentialId) => ({
    credentialId,
    status: "ok" as const,
    checkedAt: "2026-11-15T12:00:00.000Z",
  }));

function rpcWith(models: Record<string, unknown>) {
  return { models } as unknown as Parameters<typeof checkKeys>[0];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("checks every connection through the batch probe", async () => {
  const batch = vi.fn(async () => ({ results: results(["a", "b"]) }));
  const promise = checkKeys(rpcWith({ checkKeys: batch }));
  await vi.advanceTimersByTimeAsync(0);
  expect(await promise).toEqual(results(["a", "b"]));
  expect(batch).toHaveBeenCalledWith({});
});

it("checks only the given connections", async () => {
  const batch = vi.fn(async () => ({ results: results(["b"]) }));
  const promise = checkKeys(rpcWith({ checkKeys: batch }), ["b"]);
  await vi.advanceTimersByTimeAsync(0);
  await promise;
  expect(batch).toHaveBeenCalledWith({ credentialIds: ["b"] });
});

it("drops a timed-out batch instead of stalling", async () => {
  const batch = vi.fn(() => new Promise<never>(() => {}));
  const promise = checkKeys(rpcWith({ checkKeys: batch }));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await promise).toEqual([]);
});

it("returns nothing when the batch probe fails", async () => {
  const batch = vi.fn(async () => {
    throw new Error("offline");
  });
  const promise = checkKeys(rpcWith({ checkKeys: batch }));
  await vi.advanceTimersByTimeAsync(0);
  expect(await promise).toEqual([]);
  await expect(checkKey(rpcWith({ checkKey: batch }), "a")).resolves.toBeUndefined();
});

it("checks one connection through the single probe", async () => {
  const single = vi.fn(async () => ({
    credentialId: "a",
    status: "invalid_key" as const,
    checkedAt: "2026-11-15T12:00:00.000Z",
  }));
  const promise = checkKey(rpcWith({ checkKey: single }), "a");
  await vi.advanceTimersByTimeAsync(0);
  expect((await promise)?.status).toBe("invalid_key");
});

it("resolves a provider to its connection before checking", async () => {
  const single = vi.fn(async () => ({
    credentialId: "c1",
    status: "ok" as const,
    checkedAt: "2026-11-15T12:00:00.000Z",
  }));
  const rpc = rpcWith({
    checkKey: single,
    credentials: vi.fn(async () => [{ id: "c1", provider: "openai" }]),
  });
  const promise = checkKeyForProvider(rpc, "openai");
  await vi.advanceTimersByTimeAsync(0);
  expect(await promise).toBe("ok");
  expect(single).toHaveBeenCalledWith({ credentialId: "c1" });
  await expect(resolveCredentialIdForProvider(rpc, "missing")).resolves.toBeUndefined();
});

it("reads the persisted check off a credential", () => {
  const credential = {
    id: "c1",
    provider: "openai",
    label: "OpenAI",
    hasKey: true,
    isDefault: true,
    keyHealth: { status: "ok" as const, checkedAt: "2026-11-15T12:00:00.000Z" },
  };
  expect(credentialKeyHealth(credential)).toEqual({
    status: "ok",
    checkedAt: "2026-11-15T12:00:00.000Z",
  });
  expect(
    credentialKeyHealth({
      id: "c1",
      provider: "openai",
      label: "OpenAI",
      hasKey: true,
      isDefault: true,
    }),
  ).toBeUndefined();
});
