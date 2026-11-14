import { describe, expect, it } from "vitest";
import {
  activeBotPromptPreset,
  BOT_MODEL_LIST_MAX,
  moveBotModelToFront,
  parseBotModelList,
  parseBotPromptPresets,
  primaryBotModel,
  UpdateBotInput,
  withPromptPreset,
} from "./domain.js";

const BOT_ID = "bot-1";

describe("parseBotModelList", () => {
  it("reads an ordered list in order", () => {
    expect(
      parseBotModelList([
        { provider: "a", model: "m1" },
        { provider: "b", model: "m2" },
      ]),
    ).toEqual([
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2" },
    ]);
  });

  it("deduplicates and treats null, stale singles and malformed rows as no list", () => {
    expect(
      parseBotModelList([
        { provider: "a", model: "m1" },
        { provider: "a", model: "m1" },
      ]),
    ).toEqual([{ provider: "a", model: "m1" }]);
    expect(parseBotModelList(null)).toBeNull();
    expect(parseBotModelList([])).toBeNull();
    expect(parseBotModelList({ provider: "a", model: "m1" })).toBeNull();
    expect(parseBotModelList([{ provider: "a" }])).toBeNull();
  });
});

describe("primaryBotModel and moveBotModelToFront", () => {
  it("takes the first entry as primary", () => {
    const list = [
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2" },
    ];
    expect(primaryBotModel(list)).toEqual({ provider: "a", model: "m1" });
    expect(primaryBotModel([])).toBeNull();
    expect(primaryBotModel(null)).toBeNull();
  });

  it("moves a pick to the front and keeps the rest as fallbacks", () => {
    const list = [
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2" },
    ];
    expect(moveBotModelToFront(list, { provider: "b", model: "m2" })).toEqual([
      { provider: "b", model: "m2" },
      { provider: "a", model: "m1" },
    ]);
    expect(moveBotModelToFront(list, { provider: "c", model: "m3" })).toEqual([
      { provider: "c", model: "m3" },
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2" },
    ]);
    const full = Array.from({ length: BOT_MODEL_LIST_MAX }, (_, i) => ({
      provider: "a",
      model: `m${i}`,
    }));
    expect(moveBotModelToFront(full, { provider: "z", model: "new" })).toHaveLength(
      BOT_MODEL_LIST_MAX,
    );
  });
});

describe("prompt presets", () => {
  it("reads presets with unique names and picks the active one by exact name", () => {
    const presets = [
      { name: "水彩", prompt: "用水彩风格画" },
      { name: "赛博", prompt: "赛博朋克风格" },
    ];
    expect(parseBotPromptPresets(presets)).toEqual(presets);
    expect(
      parseBotPromptPresets([
        { name: "水彩", prompt: "a" },
        { name: "水彩", prompt: "b" },
      ]),
    ).toEqual([{ name: "水彩", prompt: "a" }]);
    expect(parseBotPromptPresets(null)).toBeNull();
    expect(activeBotPromptPreset(presets, "赛博")).toEqual({
      name: "赛博",
      prompt: "赛博朋克风格",
    });
    // A missing name never silently swaps in a different preset.
    expect(activeBotPromptPreset(presets, "不存在")).toBeNull();
    expect(activeBotPromptPreset(presets, null)).toBeNull();
  });

  it("prepends the active preset to the request", () => {
    expect(withPromptPreset("用水彩风格画", "画一只猫")).toBe("用水彩风格画\n画一只猫");
    expect(withPromptPreset(null, "画一只猫")).toBe("画一只猫");
    expect(withPromptPreset("  ", "画一只猫")).toBe("画一只猫");
  });
});

describe("UpdateBotInput media settings", () => {
  it("accepts save directories and media action toggles", () => {
    const parsed = UpdateBotInput.parse({
      botId: BOT_ID,
      imageSaveDirectory: "Rakazo/猫",
      videoSaveDirectory: null,
      showMediaFavorite: false,
      showMediaShare: true,
      showMediaPreview: false,
      showMediaDownload: true,
    });
    expect(parsed.imageSaveDirectory).toBe("Rakazo/猫");
    expect(parsed.videoSaveDirectory).toBeNull();
    expect(parsed.showMediaFavorite).toBe(false);
    expect(parsed.showMediaShare).toBe(true);
    expect(parsed.showMediaPreview).toBe(false);
    expect(parsed.showMediaDownload).toBe(true);
  });

  it("rejects a save directory over 80 characters", () => {
    expect(
      UpdateBotInput.safeParse({ botId: BOT_ID, imageSaveDirectory: "a".repeat(81) }).success,
    ).toBe(false);
    expect(
      UpdateBotInput.safeParse({ botId: BOT_ID, videoSaveDirectory: "a".repeat(81) }).success,
    ).toBe(false);
  });

  it("rejects an empty or blank save directory", () => {
    expect(UpdateBotInput.safeParse({ botId: BOT_ID, imageSaveDirectory: "" }).success).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: BOT_ID, videoSaveDirectory: "   " }).success).toBe(
      false,
    );
  });

  it("rejects non-boolean media action toggles", () => {
    expect(UpdateBotInput.safeParse({ botId: BOT_ID, showMediaFavorite: "yes" }).success).toBe(
      false,
    );
    expect(UpdateBotInput.safeParse({ botId: BOT_ID, showMediaDownload: 1 }).success).toBe(false);
  });
});

describe("UpdateBotInput model lists", () => {
  it("accepts ordered model lists and presets", () => {
    const parsed = UpdateBotInput.parse({
      botId: BOT_ID,
      videoModels: [
        { provider: "a", model: "m1" },
        { provider: "b", model: "m2" },
      ],
      imageModels: [],
      translationModels: [{ provider: "a", model: "m1" }],
      videoPromptPresets: [{ name: "水彩", prompt: "用水彩风格画" }],
      activeVideoPromptPreset: "水彩",
    });
    expect(parsed.videoModels).toHaveLength(2);
    expect(parsed.imageModels).toEqual([]);
    expect(parsed.activeVideoPromptPreset).toBe("水彩");
  });

  it("rejects lists over the cap and duplicate preset names", () => {
    const tooMany = Array.from({ length: BOT_MODEL_LIST_MAX + 1 }, (_, i) => ({
      provider: "a",
      model: `m${i}`,
    }));
    expect(UpdateBotInput.safeParse({ botId: BOT_ID, videoModels: tooMany }).success).toBe(false);
    expect(
      UpdateBotInput.safeParse({
        botId: BOT_ID,
        videoPromptPresets: [
          { name: "水彩", prompt: "a" },
          { name: "水彩", prompt: "b" },
        ],
      }).success,
    ).toBe(false);
  });
});
