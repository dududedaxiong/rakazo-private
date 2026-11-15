import type { ModelSwitchAttempt } from "@rakazo/contracts";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import type { ModelSwitchTimeline, ModelSwitchTimelineRow } from "../lib/model-switches";
import {
  finalSwitchProvider,
  modelSwitchTimelineRows,
  switchAttemptErrorLabel,
} from "../lib/model-switches";
import { useMobileTokens, useResolvedAppearance } from "../lib/native";
import { BottomSheetShell, SheetHeader } from "./bottom-sheet-shell";

/**
 * The tappable "当前模型:" line under a message: the mark text itself,
 * with the final model bolded. With a switch timeline it opens the
 * timeline; with only the trailing mark it opens the model list instead.
 * Only rendered when the message carries a timeline or a mark; anything
 * without either keeps its text untouched.
 */
export function ModelSwitchBar({
  switches,
  model,
  presetName,
  onPress,
}: {
  /** The switch timeline, when the message carries one. */
  switches?: ModelSwitchTimeline;
  /** The model the trailing mark names, when the message carries no timeline. */
  model?: string;
  /** The prompt preset from the media mark, when the message is generated media. */
  presetName?: string;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const finalModel = switches?.finalModel ?? model ?? "";
  const provider = switches ? finalSwitchProvider(switches) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={switches ? t("Switch history") : t("Change model")}
      onPress={onPress}
      hitSlop={4}
      style={{ marginTop: 8 }}
    >
      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
        {t("Active model")}:{" "}
        <Text style={{ color: tokens.foreground, fontWeight: "600" }}>
          {finalModel}
          {provider ? ` · ${provider}` : ""}
          {presetName ? ` · ${presetName}` : ""}
        </Text>{" "}
        <Text style={{ color: tokens.mutedForeground }}>›</Text>
      </Text>
    </Pressable>
  );
}

/**
 * The switch-history timeline, shared by chat, image, video, and
 * translation: each failed try (model name in link blue, tappable to locate
 * it in the model list; provider after it; a short error tag that expands
 * to the full error), a "switched to" line before the next try, and a done
 * line for the model that finally produced the message.
 */
export function ModelSwitchTimelineSheet({
  visible,
  switches,
  onClose,
  onLocateModel,
}: {
  visible: boolean;
  switches: ModelSwitchTimeline;
  onClose: () => void;
  /** Opens the model list for this role, located on the tapped model. */
  onLocateModel: (attempt: ModelSwitchAttempt) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const blue = colorScheme === "dark" ? tokens.link : "#2f6bff";
  const rows = modelSwitchTimelineRows(switches);
  return (
    <BottomSheetShell visible={visible} label={t("Switch history")} onClose={onClose}>
      <SheetHeader title={t("Switch history")} onClose={onClose} />
      <View style={{ paddingTop: 4, paddingBottom: 8 }}>
        {rows.map((row, index) => (
          <TimelineRowView
            key={`${row.kind}-${index}`}
            row={row}
            blue={blue}
            onLocateModel={onLocateModel}
          />
        ))}
      </View>
    </BottomSheetShell>
  );
}

function TimelineRowView({
  row,
  blue,
  onLocateModel,
}: {
  row: ModelSwitchTimelineRow;
  blue: string;
  onLocateModel: (attempt: ModelSwitchAttempt) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  if (row.kind === "switch") {
    return (
      <View style={{ flexDirection: "row", paddingLeft: 26, paddingVertical: 6 }}>
        <Text style={{ color: blue, fontSize: 13 }}>
          ↓{" "}
          {t("Switched to {model}", {
            model: row.provider ? `${row.model} · ${row.provider}` : row.model,
          })}
        </Text>
      </View>
    );
  }
  if (row.kind === "done") {
    return (
      <View style={{ flexDirection: "row", paddingLeft: 26, paddingVertical: 6 }}>
        <Text style={{ color: tokens.success, fontSize: 14 }}>
          ✓{" "}
          {t("Finished, current model {model}", {
            model: row.provider ? `${row.model} · ${row.provider}` : row.model,
          })}
        </Text>
      </View>
    );
  }
  return <FailedAttemptRow attempt={row.attempt} blue={blue} onLocateModel={onLocateModel} />;
}

function FailedAttemptRow({
  attempt,
  blue,
  onLocateModel,
}: {
  attempt: ModelSwitchAttempt;
  blue: string;
  onLocateModel: (attempt: ModelSwitchAttempt) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [expanded, setExpanded] = useState(false);
  const detail = attempt.errorMessage ?? attempt.errorCode ?? "";
  return (
    <View style={{ paddingVertical: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={attempt.model}
          onPress={() => onLocateModel(attempt)}
          hitSlop={4}
        >
          <Text style={{ color: blue, fontSize: 14, fontWeight: "700" }}>{attempt.model}</Text>
        </Pressable>
        {attempt.provider ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>· {attempt.provider}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={detail ? t("View error") : switchAttemptErrorLabel(attempt)}
          disabled={!detail}
          onPress={() => setExpanded((value) => !value)}
          hitSlop={4}
        >
          <Text style={{ color: tokens.destructive, fontSize: 13 }}>
            {t(switchAttemptErrorLabel(attempt))}
            {detail ? ` ${expanded ? t("Collapse") : `${t("View error")} ›`}` : ""}
          </Text>
        </Pressable>
      </View>
      {expanded && detail ? (
        <Text
          selectable
          style={{
            color: tokens.mutedForeground,
            fontSize: 12,
            lineHeight: 18,
            backgroundColor: tokens.muted,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            marginTop: 6,
          }}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
