import type { ModelHealthReport, ModelHealthState } from "@rakazo/contracts";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { NativeActionButton } from "./native-action-button";

function healthStateColor(state: ModelHealthState, tokens: ReturnType<typeof useMobileTokens>) {
  switch (state) {
    case "ok":
      return tokens.success;
    case "empty":
      return tokens.mutedForeground;
    case "limited":
    case "timeout":
      return tokens.warning;
    default:
      return tokens.destructive;
  }
}

function HealthStateBadge({ state }: { state: ModelHealthState }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const label =
    state === "ok"
      ? t("Usable")
      : state === "empty"
        ? t("Empty reply")
        : state === "limited"
          ? t("Rate limited")
          : state === "auth"
            ? t("No permission")
            : state === "notfound"
              ? t("Not found")
              : state === "timeout"
                ? t("Timed out")
                : t("Failed");
  return <Text style={{ color: healthStateColor(state, tokens), fontWeight: "600" }}>{label}</Text>;
}

/**
 * One connection's health result: how many models answered, then every model
 * with its state and, for failures, the upstream's own reason. "Keep only
 * usable models" is off when there is nothing to drop, nothing usable, or
 * the run stopped at the cap and untested models would be lost with it. The
 * keep action is omitted where it is not an action, such as the model picker.
 */
export function ModelHealthDialog({
  result,
  keeping,
  onClose,
  onKeepUsable,
}: {
  result: ModelHealthReport;
  keeping: boolean;
  onClose: () => void;
  onKeepUsable?: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const usable = result.ok.length;
  const canKeep = !result.truncated && usable > 0 && usable < result.total;
  const groups: Array<[string, number]> = [
    [t("Rate limited"), result.summary.limited],
    [t("No permission"), result.summary.auth],
    [t("Not found"), result.summary.notfound],
    [t("Failed"), result.summary.badreq + result.summary.servererr + result.summary.neterr],
    [t("Timed out"), result.summary.timeout],
    [t("Empty reply"), result.summary.empty],
  ];
  const failures = groups
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
  return (
    <Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View
        testID="model-health-dialog"
        style={[styles.sheet, { backgroundColor: tokens.background }]}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.foreground }]}>
          {t("Test results · {label}", { label: result.label })}
        </Text>
        <Text style={{ color: tokens.foreground }}>
          {t("{usable} of {total} models work", { usable, total: result.total })}
        </Text>
        {failures ? (
          <Text style={[styles.secondary, { color: tokens.mutedForeground }]}>{failures}</Text>
        ) : null}
        {result.truncated ? (
          <Text style={[styles.secondary, { color: tokens.mutedForeground }]}>
            {t("Only the first 50 models were tested.")}
          </Text>
        ) : null}
        <ScrollView style={styles.list}>
          {result.results.length === 0 ? (
            <Text style={{ color: tokens.mutedForeground }}>{t("No models to test")}</Text>
          ) : (
            result.results.map((row) => (
              <View key={row.model} style={styles.row}>
                <View style={styles.rowHeader}>
                  <Text style={[styles.model, { color: tokens.foreground }]}>{row.model}</Text>
                  <HealthStateBadge state={row.state} />
                </View>
                {row.state !== "ok" ? (
                  <Text style={[styles.detail, { color: tokens.mutedForeground }]}>
                    {row.detail}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
        {onKeepUsable ? (
          <NativeActionButton
            label={t("Keep only usable models")}
            disabled={!canKeep}
            busy={keeping}
            fill
            onPress={onKeepUsable}
          />
        ) : null}
        <NativeActionButton
          label={t("Close")}
          prominence="secondary"
          fill
          onPress={onClose}
          style={{ marginTop: 8 }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  secondary: {
    fontSize: 14,
  },
  list: {
    flex: 1,
    marginTop: 8,
  },
  row: {
    paddingVertical: 8,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  model: {
    flex: 1,
    fontSize: 16,
  },
  detail: {
    marginTop: 2,
    fontSize: 14,
  },
});
