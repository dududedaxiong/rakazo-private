// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMediaMark, splitTrailingMark } from "./media-mark";

describe("parseMediaMark", () => {
  it("parses a model-only mark", () => {
    expect(parseMediaMark("当前模型: model-a")).toEqual({ modelId: "model-a" });
  });

  it("parses a model and preset mark", () => {
    expect(parseMediaMark("当前模型: model-a · 水彩")).toEqual({
      modelId: "model-a",
      presetName: "水彩",
    });
  });

  it("still parses the older mark wording", () => {
    expect(parseMediaMark("经 model-a")).toEqual({ modelId: "model-a" });
    expect(parseMediaMark("经 model-a · 水彩")).toEqual({ modelId: "model-a", presetName: "水彩" });
  });

  it("ignores surrounding whitespace", () => {
    expect(parseMediaMark("  当前模型: model-a · 水彩  ")).toEqual({
      modelId: "model-a",
      presetName: "水彩",
    });
  });

  it("rejects ordinary reply text", () => {
    expect(parseMediaMark("Here is your image.")).toBeNull();
    expect(parseMediaMark("当前模型:")).toBeNull();
    expect(parseMediaMark("当前模型: ")).toBeNull();
    expect(parseMediaMark("经")).toBeNull();
    expect(parseMediaMark("经 ")).toBeNull();
  });

  it("rejects a multi-line block", () => {
    expect(parseMediaMark("当前模型: model-a\nmore text")).toBeNull();
    expect(parseMediaMark("经 model-a\nmore text")).toBeNull();
  });
});

describe("splitTrailingMark", () => {
  it("splits the mark line off the end of a reply", () => {
    expect(splitTrailingMark("今天天气不错。\n当前模型: model-a")).toEqual({
      text: "今天天气不错。",
      mark: { modelId: "model-a" },
    });
    expect(splitTrailingMark("今天天气不错。\n当前模型: model-a · 水彩")).toEqual({
      text: "今天天气不错。",
      mark: { modelId: "model-a", presetName: "水彩" },
    });
  });

  it("splits a mark-only text, leaving no prose", () => {
    expect(splitTrailingMark("当前模型: model-a")).toEqual({
      text: "",
      mark: { modelId: "model-a" },
    });
  });

  it("leaves a legacy trailing mark line alone, like the app", () => {
    expect(splitTrailingMark("今天天气不错。\n经 model-a")).toBeNull();
  });

  it("rejects text that does not end with a mark line", () => {
    expect(splitTrailingMark("今天天气不错。")).toBeNull();
    expect(splitTrailingMark("当前模型: model-a\n还有后话。")).toBeNull();
    expect(splitTrailingMark("今天天气不错。\n当前模型:")).toBeNull();
  });
});
