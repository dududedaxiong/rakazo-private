import type { BotModelEntry, BotPromptPreset } from "@rakazo/contracts";
import { BOT_MODEL_LIST_MAX } from "@rakazo/contracts";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import type { MobileModel } from "../../lib/mobile-types";
import { BottomSheetShell, SheetHeader } from "../bottom-sheet-shell";
import { NativeSwitch } from "../native-switch";
import { Chevron } from "../row-accessories";
import type { ThreadModelSave } from "./thread-model-picker-sheet";
import { PromptPresetSection } from "./prompt-preset-section";

export type MediaModelRole = "video" | "image";

/** Which generated-media action a display toggle controls. */
export type MediaActionKind = "favorite" | "share" | "preview" | "download";

/**
 * The 影图模式 panel from the chat's Media model card: two sections, one per
 * kind, each with its ordered model list (primary plus fallbacks), its prompt
 * presets, and its save directory; then the switches for which actions show
 * on generated media. Model picks happen in the model picker sheet, in
 * place, without leaving the chat; everything else saves here.
 */
export function ThreadMediaModelSheet({
  visible,
  catalog,
  video,
  image,
  videoModels,
  imageModels,
  videoPresets,
  imagePresets,
  activeVideoPreset,
  activeImagePreset,
  videoSaveDirectory,
  imageSaveDirectory,
  showMediaFavorite,
  showMediaShare,
  showMediaPreview,
  showMediaDownload,
  onPickRole,
  onPickPreset,
  onPresetsChange,
  onSaveDirectory,
  onToggleMediaAction,
  onClose,
}: {
  visible: boolean;
  catalog: MobileModel[] | null;
  /** The primary model per role, with any just-picked override applied. */
  video: ThreadModelSave;
  image: ThreadModelSave;
  /** The full ordered model lists; first is primary, rest are fallbacks. */
  videoModels: readonly BotModelEntry[] | null;
  imageModels: readonly BotModelEntry[] | null;
  videoPresets: readonly BotPromptPreset[] | null;
  imagePresets: readonly BotPromptPreset[] | null;
  activeVideoPreset: string | null;
  activeImagePreset: string | null;
  /** The directory generated videos save to; null means the default. */
  videoSaveDirectory: string | null;
  /** The directory generated images save to; null means the default. */
  imageSaveDirectory: string | null;
  /** Whether the favorite action shows on generated media. */
  showMediaFavorite: boolean;
  /** Whether the share action shows on generated media. */
  showMediaShare: boolean;
  /** Whether the preview action shows on generated media. */
  showMediaPreview: boolean;
  /** Whether the download action shows on generated media. */
  showMediaDownload: boolean;
  onPickRole: (role: MediaModelRole) => void;
  onPickPreset: (role: MediaModelRole, name: string | null) => void;
  onPresetsChange: (role: MediaModelRole, next: BotPromptPreset[]) => void;
  onSaveDirectory: (role: MediaModelRole, value: string | null) => void;
  onToggleMediaAction: (action: MediaActionKind, value: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [expandedPresets, setExpandedPresets] = useState<MediaModelRole | null>(null);
  if (!visible) return null;

  const labelFor = (save: ThreadModelSave) => {
    if (!save.provider || !save.modelId) return t("Not set");
    const entry = catalog?.find(
      (item) => item.provider === save.provider && item.id === save.modelId,
    );
    return entry?.label ?? save.modelId;
  };
  const labelForEntry = (entry: BotModelEntry) =>
    labelFor({ provider: entry.provider, modelId: entry.model });

  const kindBlock = (role: MediaModelRole) => {
    const isVideo = role === "video";
    const primary = isVideo ? video : image;
    const models = isVideo ? videoModels : imageModels;
    const presets = isVideo ? videoPresets : imagePresets;
    const activePreset = isVideo ? activeVideoPreset : activeImagePreset;
    const saveDirectory = isVideo ? videoSaveDirectory : imageSaveDirectory;
    const modelLabel = isVideo ? t("Video generation model") : t("Image generation model");
    const presetsLabel = isVideo ? t("Video prompt presets") : t("Image prompt presets");
    const addBackupLabel = isVideo ? t("Add video backup") : t("Add image backup");
    const primaryKey =
      primary.provider && primary.modelId
        ? `${primary.provider}\u0000${primary.modelId}`
        : null;
    // The primary row already shows the first entry; list the rest numbered
    // by their position in the ordered list.
    const fallbacks = (models ?? [])
      .map((entry, index) => ({ entry, number: index + 1 }))
      .filter(({ entry }) => `${entry.provider}\u0000${entry.model}` !== primaryKey);
    const presetsExpanded = expandedPresets === role;

    return (
      <View key={role}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
            {isVideo ? t("Video generation settings") : t("Image generation settings")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${modelLabel}: ${labelFor(primary)}`}
          onPress={() => onPickRole(role)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 20,
            paddingVertical: 14,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: tokens.foreground, fontSize: 16 }}>{modelLabel}</Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
              {labelFor(primary)}
            </Text>
          </View>
          <Chevron />
        </Pressable>
        {fallbacks.map(({ entry, number }) => (
          <Pressable
            key={`${entry.provider}:${entry.model}`}
            accessibilityRole="button"
            accessibilityLabel={`${t("Backup")} ${number}: ${labelForEntry(entry)}`}
            onPress={() => onPickRole(role)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 20,
              paddingLeft: 36,
              paddingVertical: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                {number}. {labelForEntry(entry)}
              </Text>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
                {t("Backup")}
              </Text>
            </View>
            <Chevron />
          </Pressable>
        ))}
        {(models ?? []).length < BOT_MODEL_LIST_MAX ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addBackupLabel}
            onPress={() => onPickRole(role)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 20,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: tokens.link, fontSize: 15 }}>{addBackupLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${presetsLabel}: ${activePreset ?? t("Not set")}`}
          onPress={() => setExpandedPresets(presetsExpanded ? null : role)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 20,
            paddingVertical: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: tokens.foreground, fontSize: 15 }}>{presetsLabel}</Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
              {activePreset ?? t("Not set")}
            </Text>
          </View>
          <Chevron />
        </Pressable>
        {presetsExpanded ? (
          <PromptPresetSection
            label={presetsLabel}
            showHeading={false}
            presets={[...(presets ?? [])]}
            active={activePreset}
            onChange={(next) => onPresetsChange(role, next)}
            onActiveChange={(name) => onPickPreset(role, name)}
          />
        ) : null}
        <SaveDirectoryRow
          key={`${role}:${saveDirectory ?? ""}`}
          label={t("Save directory")}
          value={saveDirectory}
          onSave={(value) => onSaveDirectory(role, value)}
        />
      </View>
    );
  };

  const toggles: { action: MediaActionKind; label: string; value: boolean }[] = [
    { action: "favorite", label: t("Favorite"), value: showMediaFavorite },
    { action: "share", label: t("Share"), value: showMediaShare },
    { action: "preview", label: t("Preview"), value: showMediaPreview },
    { action: "download", label: t("Download"), value: showMediaDownload },
  ];

  return (
    <BottomSheetShell visible={visible} label={t("Media model")} onClose={onClose}>
      <SheetHeader title={t("Media model")} onClose={onClose} />
      {kindBlock("image")}
      {kindBlock("video")}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
          {t("Generated media actions")}
        </Text>
      </View>
      {toggles.map(({ action, label, value }) => (
        <View
          key={action}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 20,
            paddingVertical: 10,
          }}
        >
          <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15 }}>{label}</Text>
          <NativeSwitch
            value={value}
            accessibilityLabel={label}
            onValueChange={(next) => onToggleMediaAction(action, next)}
          />
        </View>
      ))}
    </BottomSheetShell>
  );
}

/**
 * The directory a kind saves to: an empty value means the default location.
 * Saves on blur or submit, not on every keystroke.
 */
function SaveDirectoryRow({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [draft, setDraft] = useState(value ?? "");
  const commit = () => {
    const trimmed = draft.trim();
    const next = trimmed ? trimmed : null;
    if (next !== value) onSave(next);
  };
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 6 }}>
      <Text style={{ color: tokens.foreground, fontSize: 15 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={t("Default")}
        placeholderTextColor={tokens.mutedForeground}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        style={{
          color: tokens.foreground,
          fontSize: 15,
          borderWidth: 1,
          borderColor: tokens.border,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}
      />
    </View>
  );
}
