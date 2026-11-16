import { describe, expect, it } from "vitest";
import { modelLocateKey, modelLocateRowMatches } from "./model-locate";

describe("model locate", () => {
  it("builds the model-option key", () => {
    expect(modelLocateKey({ model: "model-a", provider: "p1" })).toBe("p1::model-a");
  });

  it("matches the exact row key, and the same model on another provider by token", () => {
    expect(modelLocateRowMatches("p1::model-a", { model: "model-a", provider: "p1" })).toBe(true);
    // The token fallback cannot tell same-named models apart; the exact key
    // above is what separates them when the provider is known.
    expect(modelLocateRowMatches("p2::model-a", { model: "model-a", provider: "p1" })).toBe(true);
    expect(modelLocateRowMatches("p1::model-b", { model: "model-a", provider: "p1" })).toBe(false);
  });

  it("matches a canonicalized display id by token", () => {
    expect(
      modelLocateRowMatches("deepseek::deepseek-flash", {
        model: "deepseek-v4.1-flash",
        provider: "deepseek",
      }),
    ).toBe(true);
    expect(
      modelLocateRowMatches("deepseek::deepseek-v4-pro", {
        model: "deepseek-v4.1-flash",
        provider: "deepseek",
      }),
    ).toBe(false);
  });

  it("matches an API id and its catalog id on a third-party connection, either way", () => {
    expect(
      modelLocateRowMatches("openai-compatible::deepseek-v4.1-flash", {
        model: "deepseek-flash",
        provider: "openai-compatible",
      }),
    ).toBe(true);
    expect(
      modelLocateRowMatches("openai-compatible::deepseek-flash", {
        model: "deepseek-v4.1-flash",
        provider: "openai-compatible",
      }),
    ).toBe(true);
    // A connection display name as the provider still locates by model.
    expect(
      modelLocateRowMatches("openai-compatible::deepseek-v4.1-flash", {
        model: "deepseek-flash",
        provider: "测试",
      }),
    ).toBe(true);
    expect(
      modelLocateRowMatches("openai-compatible::deepseek-v4-pro", {
        model: "deepseek-v4.1-flash",
        provider: "openai-compatible",
      }),
    ).toBe(false);
  });
});
