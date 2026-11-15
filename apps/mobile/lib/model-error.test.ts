import { describe, expect, it } from "vitest";
import {
  describeModelError,
  modelErrorActionKinds,
  modelErrorActionLabel,
  modelErrorSummary,
  modelErrorTranslator,
} from "./model-error";

const t = (message: string) => message;

describe("modelErrorSummary", () => {
  // A capped key with a future reset date takes the quota branch, whose
  // summary carries the "Resets …" tail.
  const rateReset =
    '403: {"message":"OpenRouter weekly key limit exceeded; resets 2026-12-01T00:00:00Z"}';

  it("keeps the reset tail by default", () => {
    expect(modelErrorSummary(t, rateReset, "en-US")).toContain("Resets");
  });

  it("drops the reset tail for the translation headline, like the sheet hook", () => {
    expect(modelErrorSummary(t, rateReset, "en-US", false)).not.toContain("Resets");
  });
});

describe("modelErrorTranslator", () => {
  it("keeps provider names literal", () => {
    const translate = modelErrorTranslator(t);
    expect(translate("Your OpenRouter")).toBe("OpenRouter");
    expect(translate("Your OpenAI")).toBe("OpenAI");
    expect(translate("Your Anthropic")).toBe("Anthropic");
    expect(translate("Your model provider")).toBe("Model provider");
  });

  it("strips the reset tail when the caller asks for no reset", () => {
    const translate = modelErrorTranslator(t, false);
    expect(translate("{summary} Resets {date}.", { summary: "Slow down." })).toBe("Slow down.");
    expect(
      modelErrorTranslator(t, true)("{summary} Resets {date}.", { summary: "Slow down." }),
    ).toBe("{summary} Resets {date}.");
  });
});

describe("describeModelError", () => {
  it.each([
    ['401: {"error": {"message": "Incorrect API key provided"}}', "invalid_key"],
    ['403: {"error": {"message": "invalid api key"}}', "invalid_key"],
    ['404: {"error": {"message": "model not found"}}', "model_not_found"],
    ['429: {"error": {"message": "rate limit exceeded"}}', "rate_limited"],
    ["The request timed out after 30s", "timeout"],
    ["504 Gateway Time-out", "timeout"],
    ["Connection error.", "connection"],
    // The shared classifier reads "fetch failed" as a timeout, not a refused host.
    ["fetch failed", "timeout"],
    ['402: {"error": {"message": "insufficient quota"}}', "quota"],
    ["something nobody recognizes", "unknown"],
  ] as const)("maps %s to %s", (details, key) => {
    expect(describeModelError(details).key).toBe(key);
  });

  it("maps a key limit to invalid_key, per the shared contract", () => {
    expect(
      describeModelError(
        '403: {"message":"OpenRouter weekly key limit exceeded; resets 2026-10-21T00:00:00Z"}',
      ).key,
    ).toBe("invalid_key");
  });

  it("keeps the recovery for the fixable classes", () => {
    expect(describeModelError("401 Unauthorized")).toEqual({
      key: "invalid_key",
      recovery: "connection",
    });
    expect(describeModelError("404 Not Found")).toEqual({
      key: "model_not_found",
      recovery: "model",
    });
    expect(describeModelError("boom")).toEqual({ key: "unknown" });
  });

  it("does not blame the key when the provider refuses the model to the account", () => {
    expect(
      describeModelError(
        '403: {"error": {"code": "model_terms_required", "message": "terms required"}}',
      ),
    ).toEqual({ key: "unknown", recovery: "model" });
  });
});

describe("modelErrorActionKinds", () => {
  it.each([
    ["invalid_key", ["test-key", "switch-provider"]],
    ["model_not_found", ["change-model"]],
    ["rate_limited", ["try-later", "change-model"]],
    ["timeout", ["check-network", "change-model"]],
    ["connection", ["check-network", "change-model"]],
    ["quota", ["switch-provider"]],
    ["unknown", ["retry"]],
  ] as const)("offers %s for %s", (key, kinds) => {
    expect(modelErrorActionKinds(key)).toEqual(kinds);
  });

  it("labels every action kind", () => {
    for (const kind of [
      "test-key",
      "switch-provider",
      "change-model",
      "try-later",
      "check-network",
      "retry",
    ] as const) {
      expect(modelErrorActionLabel(t, kind).length).toBeGreaterThan(0);
    }
    expect(modelErrorActionLabel(t, "test-key")).toBe("Test this key");
    expect(modelErrorActionLabel(t, "switch-provider")).toBe("Switch provider");
    expect(modelErrorActionLabel(t, "try-later")).toBe("Try again later");
    expect(modelErrorActionLabel(t, "check-network")).toBe("Check network");
  });
});
