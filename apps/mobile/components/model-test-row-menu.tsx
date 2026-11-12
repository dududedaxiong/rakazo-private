import type { ReactNode } from "react";
import { useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import type { ModelTestResult } from "../lib/model-test-result";
import {
  formatModelTestClock,
  formatModelTestSeconds,
  formatModelTestTime,
  MODEL_TEST_TIMEOUT_SECONDS,
  modelTestReason,
  modelTestStateLabel,
  modelTestTypeName,
} from "../lib/model-test-result";
import { useMobileTokens } from "../lib/native";
import { NativeActionButton } from "./native-action-button";

/**
 * The menu a model row opens instead of selecting it: the model's test
 * detail on top, then switch, retest, remove, close. Tap the dim or swipe
 * the sheet down to dismiss it.
 */
export function ModelTestRowMenu({
  modelLabel,
  providerLabel,
  images,
  result,
  testing,
  interrupted,
  interruptedAt,
  isSelected,
  isRemovable,
  canRetest,
  onSwitch,
  onRetest,
  onRemove,
  onClose,
}: {
  modelLabel: string;
  providerLabel: string;
  images: boolean | undefined;
  result: ModelTestResult | null;
  testing: boolean;
  interrupted: boolean;
  interruptedAt: number | null;
  isSelected: boolean;
  isRemovable: boolean;
  canRetest: boolean;
  onSwitch: () => void;
  onRetest: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const dragStartY = useRef<number | null>(null);
  const reason = result ? modelTestReason(result.state, result.detail, t) : null;

  const statusText = testing
    ? t("Testing…")
    : result
      ? modelTestStateLabel(result.state, t)
      : interrupted && interruptedAt !== null
        ? t("Interrupted at {time}", { time: formatModelTestClock(interruptedAt) })
        : t("Not tested");
  const statusColor = testing
    ? tokens.link
    : result
      ? result.state === "ok"
        ? result.seconds >= 5
          ? tokens.link
          : result.seconds < 2
            ? tokens.success
            : tokens.mutedForeground
        : tokens.destructive
      : tokens.mutedForeground;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View testID="model-test-row-menu" style={styles.dim}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Close")}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[styles.sheet, { backgroundColor: tokens.card }]}
          onTouchStart={(event) => {
            dragStartY.current = event.nativeEvent.pageY;
          }}
          onTouchEnd={(event) => {
            const start = dragStartY.current;
            dragStartY.current = null;
            if (start !== null && event.nativeEvent.pageY - start > 60) onClose();
          }}
        >
          <View style={[styles.handle, { backgroundColor: tokens.border }]} />
          <Text style={[styles.title, { color: tokens.foreground }]}>{modelLabel}</Text>
          <Text style={[styles.subtitle, { color: tokens.mutedForeground }]}>
            {providerLabel} · {modelTestTypeName(images, t)}
          </Text>
          <MenuRow label={t("Status")}>
            <Text style={[styles.value, { color: statusColor, fontWeight: "600" }]}>
              {statusText}
            </Text>
          </MenuRow>
          {result ? (
            <>
              <MenuRow label={t("Latency")}>
                <Text style={[styles.value, { color: tokens.foreground }]}>
                  {formatModelTestSeconds(result.seconds)}s
                  {result.state === "timeout" && result.seconds >= MODEL_TEST_TIMEOUT_SECONDS
                    ? `（${t("Reached the {seconds}-second limit", { seconds: MODEL_TEST_TIMEOUT_SECONDS })}）`
                    : ""}
                </Text>
              </MenuRow>
              <MenuRow label={t("Test time")}>
                <Text style={[styles.value, { color: tokens.foreground }]}>
                  {formatModelTestTime(result.testedAt)}
                </Text>
              </MenuRow>
              {reason ? (
                <MenuRow label={t("Reason")}>
                  <Text style={[styles.value, { color: tokens.foreground }]}>{reason}</Text>
                </MenuRow>
              ) : null}
            </>
          ) : null}
          <View style={styles.actions}>
            <NativeActionButton
              label={isSelected ? t("Current model") : t("Switch to this model")}
              disabled={isSelected}
              fill
              onPress={onSwitch}
            />
            <NativeActionButton
              label={t("Retest this model")}
              prominence="secondary"
              disabled={!canRetest}
              fill
              onPress={onRetest}
            />
            {isRemovable ? (
              <NativeActionButton
                label={t("Remove this model")}
                prominence="destructive"
                fill
                onPress={onRemove}
              />
            ) : null}
            <NativeActionButton label={t("Close")} prominence="secondary" fill onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  const tokens = useMobileTokens();
  return (
    <View style={[styles.row, { borderBottomColor: tokens.border }]}>
      <Text style={[styles.rowLabel, { color: tokens.mutedForeground }]}>{label}</Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    width: 76,
    flexShrink: 0,
    fontSize: 15,
  },
  rowValue: {
    flex: 1,
  },
  value: {
    fontSize: 15,
    lineHeight: 21,
  },
  actions: {
    marginTop: 18,
    gap: 10,
  },
});
