import type { BotModelEntry, BotPromptPreset } from "@rakazo/contracts";
import { primaryBotModel } from "@rakazo/contracts";
import { modelOptionKey } from "@rakazo/core";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { getSupplementaryPrompt, setSupplementaryPrompt } from "../lib/media-supplementary";
import type { MediaTitleBarSegment } from "../lib/media-title-bar";
import { mediaTitleBarRows } from "../lib/media-title-bar";
import type { MobileBot, MobileModel } from "../lib/mobile-types";
import { useMobileTokens, useResolvedAppearance } from "../lib/native";
import { errorText } from "../lib/user-error";
import { BottomSheetShell, SheetHeader } from "./bottom-sheet-shell";
import type { ThreadModelPickerRole } from "./thread/thread-model-picker-sheet";
import { ThreadModelPickerSheet } from "./thread/thread-model-picker-sheet";

/**
 * The title bar under a generated image or video preview: prompt preset,
 * supplementary prompt, and model. Each segment opens its own sheet; the
 * preset and model switches only change the bot's settings, so they apply
 * to the next generation, never to the file on screen. The supplementary
 * prompt is per artifact and feeds the next regeneration. One row when it
 * fits, two when it does not, with the longest segment on its own row.
 * Nothing renders without a bot (group threads have no bot settings).
 */
export function MediaViewerTitleBar({
  kind,
  artifactId,
  botId,
}: {
  kind: "image" | "video";
  artifactId: string;
  botId?: string | null;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const blue = colorScheme === "dark" ? tokens.link : "#2f6bff";
  const { width } = useWindowDimensions();
  const [bot, setBot] = useState<MobileBot | null>(null);
  const [catalog, setCatalog] = useState<MobileModel[] | null>(null);
  const [supplementary, setSupplementary] = useState("");
  const [presetSheetOpen, setPresetSheetOpen] = useState(false);
  const [supplementarySheetOpen, setSupplementarySheetOpen] = useState(false);
  const [supplementaryDraft, setSupplementaryDraft] = useState("");
  const [supplementarySaving, setSupplementarySaving] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);

  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    void rpc("bots/get", { botId })
      .then((next) => {
        if (!cancelled) setBot(next);
      })
      .catch(() => {
        if (!cancelled) setBot(null);
      });
    void rpc("models/list")
      .then((next) => {
        if (!cancelled) setCatalog(next);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [botId]);

  // The supplementary prompt loads with the viewer; a failed read counts as
  // empty, never as an error, so the bar still opens.
  useEffect(() => {
    let cancelled = false;
    setSupplementary("");
    void getSupplementaryPrompt(artifactId)
      .then((next) => {
        if (!cancelled) setSupplementary(next.supplementaryPrompt);
      })
      .catch(() => {
        if (!cancelled) setSupplementary("");
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  if (!botId || !bot) return null;

  const models: readonly BotModelEntry[] | null =
    kind === "image" ? bot.imageModels : bot.videoModels;
  const presets: readonly BotPromptPreset[] | null =
    kind === "image" ? bot.imagePromptPresets : bot.videoPromptPresets;
  const activePreset = kind === "image" ? bot.activeImagePromptPreset : bot.activeVideoPromptPreset;
  const primary = primaryBotModel(models ?? null);
  const labelFor = (provider: string, modelId: string) =>
    catalog?.find((entry) => entry.provider === provider && entry.id === modelId)?.label ?? modelId;
  const modelLabel = primary ? labelFor(primary.provider, primary.model) : t("Not set");
  const selectedKey = primary ? modelOptionKey(primary.provider, primary.model) : "";
  const role: ThreadModelPickerRole = kind;

  const segments: (MediaTitleBarSegment & {
    label: string;
    value: string;
    onPress: () => void;
    accessibilityLabel: string;
  })[] = [
    {
      key: "preset",
      label: kind === "image" ? t("Image generation") : t("Video generation"),
      value: activePreset ?? t("Not set"),
      text: `${kind === "image" ? t("Image generation") : t("Video generation")}: ${activePreset ?? t("Not set")}`,
      onPress: () => setPresetSheetOpen(true),
      accessibilityLabel: `${kind === "image" ? t("Image generation") : t("Video generation")}: ${activePreset ?? t("Not set")}`,
    },
    {
      key: "supplementary",
      label: t("Supplementary prompt"),
      value: supplementary || `+ ${t("Add")}`,
      text: `${t("Supplementary prompt")}: ${supplementary || `+ ${t("Add")}`}`,
      onPress: () => {
        setSupplementaryDraft(supplementary);
        setSupplementarySheetOpen(true);
      },
      accessibilityLabel: `${t("Supplementary prompt")}: ${supplementary || t("Add")}`,
    },
    {
      key: "model",
      label: t("Model"),
      value: modelLabel,
      text: `${t("Model")}: ${modelLabel}`,
      onPress: () => setModelPickerOpen(true),
      accessibilityLabel: `${t("Model")}: ${modelLabel}`,
    },
  ];
  const rows = mediaTitleBarRows(segments, width - 32);

  const switchPreset = (name: string) => {
    if (!botId || applyingPreset || name === activePreset) return;
    setApplyingPreset(true);
    void rpc("bots/update", {
      botId,
      ...(kind === "image" ? { activeImagePromptPreset: name } : { activeVideoPromptPreset: name }),
    })
      .then((next) => {
        setBot(next);
        setPresetSheetOpen(false);
      })
      .catch((err: unknown) =>
        Alert.alert(t("Could not switch prompt preset"), errorText(err, t("Try again."))),
      )
      .finally(() => setApplyingPreset(false));
  };

  const saveSupplementary = () => {
    if (supplementarySaving) return;
    setSupplementarySaving(true);
    void setSupplementaryPrompt(artifactId, supplementaryDraft.trim())
      .then(() => {
        setSupplementary(supplementaryDraft.trim());
        setSupplementarySheetOpen(false);
      })
      .catch((err: unknown) =>
        Alert.alert(t("Could not save supplementary prompt"), errorText(err, t("Try again."))),
      )
      .finally(() => setSupplementarySaving(false));
  };

  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        {rows.map((row, index) => (
          <View
            key={`title-row-${index}`}
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, paddingVertical: 2 }}
          >
            {row.map((segment) => (
              <Text
                key={segment.key}
                numberOfLines={1}
                style={{ flexShrink: 1, color: tokens.mutedForeground, fontSize: 14 }}
              >
                {segment.label}
                {": "}
                <Text
                  style={{ color: blue }}
                  onPress={segment.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={segment.accessibilityLabel}
                >
                  {segment.value}
                </Text>
              </Text>
            ))}
          </View>
        ))}
      </View>
      <BottomSheetShell
        visible={presetSheetOpen}
        label={kind === "image" ? t("Image generation") : t("Video generation")}
        onClose={() => setPresetSheetOpen(false)}
      >
        <SheetHeader
          title={kind === "image" ? t("Image generation") : t("Video generation")}
          onClose={() => setPresetSheetOpen(false)}
        />
        {(presets ?? []).map((preset) => (
          <Pressable
            key={preset.name}
            accessibilityRole="radio"
            accessibilityState={{ checked: preset.name === activePreset }}
            accessibilityLabel={preset.name}
            disabled={applyingPreset}
            onPress={() => switchPreset(preset.name)}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 11,
              opacity: applyingPreset ? 0.5 : 1,
            }}
          >
            <Text style={{ color: tokens.foreground, fontSize: 15 }}>{preset.name}</Text>
            {preset.name === activePreset ? (
              <Text style={{ color: blue, fontSize: 15, fontWeight: "700" }}>✓</Text>
            ) : null}
          </Pressable>
        ))}
        {applyingPreset ? <ActivityIndicator color={blue} style={{ marginTop: 8 }} /> : null}
      </BottomSheetShell>
      <BottomSheetShell
        visible={supplementarySheetOpen}
        label={t("Supplementary prompt")}
        onClose={() => setSupplementarySheetOpen(false)}
      >
        <SheetHeader
          title={t("Supplementary prompt")}
          onClose={() => setSupplementarySheetOpen(false)}
        />
        <TextInput
          accessibilityLabel={t("Supplementary prompt")}
          value={supplementaryDraft}
          onChangeText={setSupplementaryDraft}
          multiline
          autoFocus
          placeholder={t("Add")}
          placeholderTextColor={tokens.mutedForeground}
          style={{
            color: tokens.foreground,
            fontSize: 15,
            lineHeight: 21,
            minHeight: 80,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            marginTop: 8,
            textAlignVertical: "top",
          }}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 24, marginTop: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Cancel")}
            onPress={() => setSupplementarySheetOpen(false)}
            hitSlop={8}
          >
            <Text style={{ color: blue, fontSize: 15 }}>{t("Cancel")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Save")}
            disabled={supplementarySaving}
            onPress={saveSupplementary}
            hitSlop={8}
          >
            <Text style={{ color: blue, fontSize: 15, fontWeight: "600" }}>{t("Save")}</Text>
          </Pressable>
        </View>
      </BottomSheetShell>
      {modelPickerOpen ? (
        <ThreadModelPickerSheet
          visible
          role={role}
          botId={botId}
          userId=""
          selectedKey={selectedKey}
          currentModels={models}
          onClose={() => setModelPickerOpen(false)}
          onSaved={() => {
            setModelPickerOpen(false);
            void rpc("bots/get", { botId })
              .then((next) => setBot(next))
              .catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );
}
