import { describe, expect, it } from "vitest";
import { sameModelList, samePresetList } from "./bot-model-lists";

describe("sameModelList", () => {
  it("treats null and undefined as empty", () => {
    expect(sameModelList(null, undefined)).toBe(true);
    expect(sameModelList([], null)).toBe(true);
    expect(sameModelList([{ provider: "a", model: "m" }], null)).toBe(false);
  });

  it("compares provider and model in order", () => {
    const list = [
      { provider: "a", model: "m1" },
      { provider: "b", model: "m2" },
    ];
    expect(sameModelList(list, [...list])).toBe(true);
    expect(sameModelList(list, [...list].reverse())).toBe(false);
    expect(
      sameModelList(list, [
        { provider: "a", model: "m1" },
        { provider: "b", model: "other" },
      ]),
    ).toBe(false);
  });
});

describe("samePresetList", () => {
  it("treats null and undefined as empty", () => {
    expect(samePresetList(null, undefined)).toBe(true);
    expect(samePresetList([], null)).toBe(true);
  });

  it("compares name and prompt in order", () => {
    const list = [
      { name: "A", prompt: "p1" },
      { name: "B", prompt: "p2" },
    ];
    expect(samePresetList(list, [...list])).toBe(true);
    expect(samePresetList(list, [{ name: "A", prompt: "p1" }])).toBe(false);
    expect(
      samePresetList(list, [
        { name: "A", prompt: "p1" },
        { name: "B", prompt: "other" },
      ]),
    ).toBe(false);
  });
});
