import type { Bot } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import { botFamilyPools } from "./bot-model-pools";

const a = { provider: "p1", model: "a" };
const b = { provider: "p1", model: "b" };
const c = { provider: "p2", model: "c" };

function botWith(overrides: Record<string, unknown>): Bot {
  return overrides as unknown as Bot;
}

describe("botFamilyPools", () => {
  it("reads the explicit pools when the server sent them", () => {
    expect(
      botFamilyPools(
        botWith({
          imageMainModels: [a],
          imageBackupModels: [b, c],
          imageModels: [c, b, a],
        }),
        "image",
      ),
    ).toEqual({ main: [a], backup: [b, c] });
  });

  it("splits a legacy list first/rest when no pool fields are present", () => {
    expect(botFamilyPools(botWith({ videoModels: [a, b, c] }), "video")).toEqual({
      main: [a],
      backup: [b, c],
    });
    expect(botFamilyPools(botWith({ translationModels: [a] }), "translation")).toEqual({
      main: [a],
      backup: [],
    });
    expect(botFamilyPools(botWith({ imageEditModels: null }), "imageEdit")).toEqual({
      main: [],
      backup: [],
    });
  });

  it("treats a present-but-empty pool as a pool, not a legacy split", () => {
    expect(
      botFamilyPools(
        botWith({ videoEditMainModels: [], videoEditBackupModels: [a], videoEditModels: [b] }),
        "videoEdit",
      ),
    ).toEqual({ main: [], backup: [a] });
  });

  it("shows the backup pool when the server sends a null main pool with models in backup", () => {
    expect(
      botFamilyPools(
        botWith({ imageMainModels: null, imageBackupModels: [a, b], imageModels: null }),
        "image",
      ),
    ).toEqual({ main: [], backup: [a, b] });
  });
});
