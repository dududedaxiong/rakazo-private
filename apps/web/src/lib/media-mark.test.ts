// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMediaMark } from "./media-mark";

describe("parseMediaMark", () => {
  it("parses a model-only mark", () => {
    expect(parseMediaMark("经 model-a")).toEqual({ modelId: "model-a" });
  });

  it("parses a model and preset mark", () => {
    expect(parseMediaMark("经 model-a · 水彩")).toEqual({ modelId: "model-a", presetName: "水彩" });
  });

  it("ignores surrounding whitespace", () => {
    expect(parseMediaMark("  经 model-a · 水彩  ")).toEqual({
      modelId: "model-a",
      presetName: "水彩",
    });
  });

  it("rejects ordinary reply text", () => {
    expect(parseMediaMark("Here is your image.")).toBeNull();
    expect(parseMediaMark("经")).toBeNull();
    expect(parseMediaMark("经 ")).toBeNull();
  });

  it("rejects a multi-line block", () => {
    expect(parseMediaMark("经 model-a\nmore text")).toBeNull();
  });
});
