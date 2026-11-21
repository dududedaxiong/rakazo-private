import { describe, expect, it } from "vitest";
import { mergeBotModelPools, splitBotModelPools } from "./bot-model-pools.js";

describe("splitBotModelPools", () => {
  it("splits a legacy single list: first entry to the main pool, rest to the backup pool", () => {
    expect(
      splitBotModelPools(
        [
          { provider: "a", model: "m1" },
          { provider: "b", model: "m2" },
          { provider: "c", model: "m3" },
        ],
        null,
      ),
    ).toEqual({
      mainPool: [{ provider: "a", model: "m1" }],
      backupPool: [
        { provider: "b", model: "m2" },
        { provider: "c", model: "m3" },
      ],
    });
  });

  it("keeps a single legacy entry in the main pool with an empty backup pool", () => {
    expect(splitBotModelPools([{ provider: "a", model: "m1" }], null)).toEqual({
      mainPool: [{ provider: "a", model: "m1" }],
      backupPool: null,
    });
  });

  it("reads stored pools as they are when the backup column was written, even when empty", () => {
    expect(
      splitBotModelPools(
        [
          { provider: "a", model: "m1" },
          { provider: "a", model: "m2" },
        ],
        [],
      ),
    ).toEqual({
      mainPool: [
        { provider: "a", model: "m1" },
        { provider: "a", model: "m2" },
      ],
      backupPool: null,
    });
  });

  it("returns empty pools when nothing was ever stored", () => {
    expect(splitBotModelPools(null, null)).toEqual({ mainPool: null, backupPool: null });
  });

  it("keeps the backup pool when the main pool was cleared", () => {
    expect(splitBotModelPools([], [{ provider: "b", model: "m2" }])).toEqual({
      mainPool: null,
      backupPool: [{ provider: "b", model: "m2" }],
    });
    expect(splitBotModelPools(null, [{ provider: "b", model: "m2" }])).toEqual({
      mainPool: null,
      backupPool: [{ provider: "b", model: "m2" }],
    });
  });

  it("keeps both pools empty when both were cleared", () => {
    expect(splitBotModelPools([], [])).toEqual({ mainPool: null, backupPool: null });
    expect(splitBotModelPools(null, [])).toEqual({ mainPool: null, backupPool: null });
  });
});

describe("mergeBotModelPools", () => {
  it("merges the pools back into the single ordered list older clients read", () => {
    expect(
      mergeBotModelPools({
        mainPool: [{ provider: "a", model: "m1" }],
        backupPool: [{ provider: "b", model: "m2" }],
      }),
    ).toEqual([
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2" },
    ]);
  });

  it("returns null when both pools are empty", () => {
    expect(mergeBotModelPools({ mainPool: null, backupPool: null })).toBeNull();
  });
});
