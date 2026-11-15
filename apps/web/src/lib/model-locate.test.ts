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
});
