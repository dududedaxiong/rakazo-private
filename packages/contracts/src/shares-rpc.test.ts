import { describe, expect, it } from "vitest";
import { appContract } from "./rpc.js";

describe("shares.create expiry", () => {
  const create = appContract.shares.create["~orpc"].inputSchema!;

  it("accepts a custom number of days, never, and omitted", () => {
    for (const days of [1, 2, 7, 30, 90, 365]) {
      expect(create.safeParse({ botId: "bot-1", expiresInDays: days }).success).toBe(true);
    }
    expect(create.safeParse({ botId: "bot-1", expiresInDays: null }).success).toBe(true);
    expect(create.safeParse({ botId: "bot-1" }).success).toBe(true);
  });

  it("rejects out-of-range and non-integer durations", () => {
    for (const days of [0, 366, -1, 1.5, "30"]) {
      expect(create.safeParse({ botId: "bot-1", expiresInDays: days }).success).toBe(false);
    }
  });
});

describe("shares.delete", () => {
  const remove = appContract.shares.delete["~orpc"].inputSchema!;

  it("takes only a share id", () => {
    expect(remove.safeParse({ shareId: "share-1" }).success).toBe(true);
    expect(remove.safeParse({}).success).toBe(false);
    expect(remove.safeParse({ shareId: "share-1", revoked: true }).success).toBe(false);
  });
});
