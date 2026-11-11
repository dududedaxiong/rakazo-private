import { Text, useWindowDimensions, View } from "react-native";
import type { AvailableModel, AvailableModelProbe } from "../lib/available-model-probe";
import { availableModelKey } from "../lib/available-model-probe";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { NativeActionButton } from "./native-action-button";

/** The one action that fixes a failed run; it fills its row once large text would crowd it. */
export function RunErrorAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { fontScale } = useWindowDimensions();
  return (
    <NativeActionButton
      label={label}
      onPress={onPress}
      prominence="primary"
      fill={fontScale > 1.3}
    />
  );
}

export function RunErrorTextAction({
  label,
  onPress,
  expanded,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  expanded?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <NativeActionButton
      variant="text"
      label={label}
      onPress={onPress}
      disabled={disabled}
      busy={busy}
      fill={false}
      icon={
        expanded === undefined
          ? undefined
          : {
              ios: expanded ? "chevron.down" : "chevron.right",
              android: expanded ? "chevron-down" : "chevron-forward",
            }
      }
    />
  );
}

/**
 * The failed run's way out through another model: one test across the run's
 * providers, then a button per model that answered. Renders nothing when the
 * failure is not a provider or model error.
 */
export function ModelProbeActions({ probe }: { probe: AvailableModelProbe }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  if (!probe.available) return null;
  const switching = probe.switchingKey !== null;
  return (
    <View style={{ gap: 12 }}>
      {probe.status === "idle" ? (
        <RunErrorTextAction label={t("Test available models")} onPress={probe.onTest} />
      ) : null}
      {probe.status === "testing" ? (
        <RunErrorTextAction label={t("Testing…")} onPress={() => {}} disabled />
      ) : null}
      {probe.status === "failed" ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 15, lineHeight: 21 }}>
            {t("Could not test these models")}
          </Text>
          <RunErrorTextAction label={t("Test available models")} onPress={probe.onTest} />
        </View>
      ) : null}
      {probe.status === "done" && probe.models.length > 0
        ? probe.models.map((model: AvailableModel) => (
            <RunErrorTextAction
              key={availableModelKey(model)}
              label={model.label}
              onPress={() => probe.onSelect(model)}
              disabled={switching}
              busy={probe.switchingKey === availableModelKey(model)}
            />
          ))
        : null}
      {probe.status === "done" && probe.models.length === 0 ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 15, lineHeight: 21 }}>
          {t("No available models.")}
        </Text>
      ) : null}
    </View>
  );
}
