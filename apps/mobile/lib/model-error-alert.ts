import type { RunErrorTranslator } from "@rakazo/core";
import { Alert } from "react-native";
import type { KeyHealthStatus } from "./key-health";
import { keyCheckResultText } from "./key-health";
import {
  describeModelError,
  modelErrorActionKinds,
  modelErrorActionLabel,
  modelErrorSummary,
} from "./model-error";
import { openModelSettings } from "./model-settings";
import { errorText } from "./user-error";

/**
 * The plain-language result of a single key check, for the alert that follows
 * a "Test this key" tap.
 */
export function keyCheckAlert(t: RunErrorTranslator, result: { status: KeyHealthStatus }): void {
  Alert.alert(t("Key check"), keyCheckResultText(t, result.status));
}

/**
 * A media failure as a native alert: the plain-language reason up front, the
 * original error only when nothing else explains it, and the button that
 * fixes the failure class. "Test this key" has no provider to test from a
 * media viewer, so an invalid key offers the provider switch instead.
 */
export function showModelErrorAlert(
  t: RunErrorTranslator,
  error: unknown,
  options?: { retry?: () => void; locale?: string },
): void {
  const details = errorText(error);
  const described = describeModelError(details);
  const summary = modelErrorSummary(t, details, options?.locale);
  const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [];
  let dismissible = false;
  for (const kind of modelErrorActionKinds(described.key)) {
    if (kind === "test-key") continue;
    if (kind === "retry") {
      if (options?.retry)
        buttons.push({ text: modelErrorActionLabel(t, kind), onPress: options.retry });
      continue;
    }
    if (kind === "try-later" || kind === "check-network") {
      buttons.push({ text: modelErrorActionLabel(t, kind), style: "cancel" });
      dismissible = true;
      continue;
    }
    buttons.push({
      text: modelErrorActionLabel(t, kind),
      onPress: () => openModelSettings(),
    });
  }
  // "Try again later" and "Check network" already dismiss the alert; only
  // failures without one get a plain Cancel.
  if (!dismissible) buttons.push({ text: t("Cancel"), style: "cancel" });
  Alert.alert(summary, described.key === "unknown" ? details : undefined, buttons);
}
