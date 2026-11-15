import type { ModelErrorUserFacingKey, RunErrorTranslator } from "@rakazo/core";
import { normalizeRunError } from "@rakazo/core";

/** The failure classes the fifth batch speaks in plain language, as the shared classifier names them. */
export type ModelErrorKey = ModelErrorUserFacingKey;
export { describeModelError } from "@rakazo/core";

/** The plain-language reason for a failure, through the shared classifier. */
export function modelErrorSummary(
  t: RunErrorTranslator,
  details: string,
  locale = "en-US",
  includeReset = true,
): string {
  return normalizeRunError(details, modelErrorTranslator(t, includeReset), locale, Date.now())
    .summary;
}

/**
 * The translator normalizeRunError renders through: provider names stay
 * literal, and without a reset the "Resets …" tail is dropped. Shared by
 * the sheet hook and the plain summary so both word failures the same way.
 */
export function modelErrorTranslator(
  t: RunErrorTranslator,
  includeReset = true,
): RunErrorTranslator {
  return (message, values) => {
    if (!includeReset && message === "{summary} Resets {date}.")
      return String(values?.summary ?? "");
    if (message === "Your OpenRouter") return "OpenRouter";
    if (message === "Your OpenAI") return "OpenAI";
    if (message === "Your Anthropic") return "Anthropic";
    if (message === "Your model provider") return t("Model provider");
    return t(message, values);
  };
}

/** One button in the human-readable failure UI, by what it does. */
export type ModelErrorActionKind =
  | "test-key"
  | "switch-provider"
  | "change-model"
  | "try-later"
  | "check-network"
  | "retry";

/** The buttons for a failure class, in the order they read. */
export function modelErrorActionKinds(key: ModelErrorKey): ModelErrorActionKind[] {
  switch (key) {
    case "invalid_key":
      return ["test-key", "switch-provider"];
    case "model_not_found":
      return ["change-model"];
    case "rate_limited":
      return ["try-later", "change-model"];
    case "timeout":
    case "connection":
      return ["check-network", "change-model"];
    case "quota":
      return ["switch-provider"];
    case "unknown":
      return ["retry"];
  }
}

export function modelErrorActionLabel(t: RunErrorTranslator, kind: ModelErrorActionKind): string {
  switch (kind) {
    case "test-key":
      return t("Test this key");
    case "switch-provider":
      return t("Switch provider");
    case "change-model":
      return t("Change model");
    case "try-later":
      return t("Try again later");
    case "check-network":
      return t("Check network");
    case "retry":
      return t("Retry");
  }
}
