import type { BotModelEntry, BotPromptPreset } from "@rakazo_mickvvw/contracts";
import { BOT_MODEL_LIST_MAX } from "@rakazo_mickvvw/contracts";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import type { MobileModel } from "../../lib/mobile-types";
import type { TranslationSourceLanguage, TranslationTargetLanguage } from "../../lib/translation";
import {
  isTranslationTargetLanguage,
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  translationSourceLabel,
  translationTargetLabel,
  translationTargetShortLabel,
} from "../../lib/translation";
import { BottomSheetShell, SheetHeader } from "../bottom-sheet-shell";
import type { MenuPickerChoice } from "../menu-picker";
import { MenuPicker } from "../menu-picker";
import { NativeSwitch } from "../native-switch";
import { Chevron } from "../row-accessories";
import { PromptPresetSection } from "./prompt-preset-section";
import type { ThreadModelSave } from "./thread-model-picker-sheet";

export type MediaModelRole = "video" | "image";

/** The five ordered model lists in the sheet; a removal names its list. */
export type MediaModelListKey = "video" | "image" | "videoEdit" | "imageEdit" | "translation";

/** Which generated-media action a display toggle controls. */
export type MediaActionKind = "favorite" | "share" | "preview" | "download";

/**
 * The 其他模型 panel from the chat's Other models card: one section per
 * media kind (image, video), each with its ordered generation model list
 * (primary plus fallbacks), its ordered edit model list right after it,
 * its prompt presets, and its save directory; then the translation section
 * (ordered model list, direction, source and target languages,
 * auto-translate and its action switches); then the switches for which
 * actions show on generated media. Model picks happen in the model picker
 * sheet, in place, without leaving the chat; everything else saves here.
 */
export function ThreadMediaModelSheet({
  visible,
  catalog,
  video,
  image,
  videoModels,
  imageModels,
  videoEdit,
  imageEdit,
  videoEditModels,
  imageEditModels,
  videoPresets,
  imagePresets,
  activeVideoPreset,
  activeImagePreset,
  videoSaveDirectory,
  imageSaveDirectory,
  translation,
  translationModels,
  translationSource,
  translationTarget,
  autoTranslate,
  showTranslationActions,
  showMediaFavorite,
  showMediaShare,
  showMediaPreview,
  showMediaDownload,
  onPickRole,
  onPickEditRole,
  onPickTranslation,
  onRemoveModel,
  onTranslationSourceChange,
  onTranslationTargetChange,
  onToggleAutoTranslate,
  onToggleTranslationActions,
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
  /** The primary edit model per role, with any just-picked override applied. */
  videoEdit: ThreadModelSave;
  imageEdit: ThreadModelSave;
  /** The full ordered edit model lists; first is primary, rest are fallbacks. */
  videoEditModels: readonly BotModelEntry[] | null;
  imageEditModels: readonly BotModelEntry[] | null;
  videoPresets: readonly BotPromptPreset[] | null;
  imagePresets: readonly BotPromptPreset[] | null;
  activeVideoPreset: string | null;
  activeImagePreset: string | null;
  /** The directory generated videos save to; null means the default. */
  videoSaveDirectory: string | null;
  /** The directory generated images save to; null means the default. */
  imageSaveDirectory: string | null;
  /** The primary translation model, with any just-picked override applied. */
  translation: ThreadModelSave;
  /** The full ordered translation model list; first is primary, rest are fallbacks. */
  translationModels: readonly BotModelEntry[] | null;
  translationSource: TranslationSourceLanguage;
  translationTarget: TranslationTargetLanguage;
  autoTranslate: boolean;
  /** Whether read-aloud, share, and favorite show on translations. */
  showTranslationActions: boolean;
  /** Whether the favorite action shows on generated media. */
  showMediaFavorite: boolean;
  /** Whether the share action shows on generated media. */
  showMediaShare: boolean;
  /** Whether the preview action shows on generated media. */
  showMediaPreview: boolean;
  /** Whether the download action shows on generated media. */
  showMediaDownload: boolean;
  onPickRole: (role: MediaModelRole) => void;
  onPickEditRole: (role: MediaModelRole) => void;
  onPickTranslation: () => void;
  /** Drops one fallback from its ordered list; the primary is never swiped. */
  onRemoveModel: (list: MediaModelListKey, entry: BotModelEntry) => void;
  onTranslationSourceChange: (source: TranslationSourceLanguage) => void;
  onTranslationTargetChange: (target: TranslationTargetLanguage) => void;
  onToggleAutoTranslate: (value: boolean) => void;
  onToggleTranslationActions: (value: boolean) => void;
  onPickPreset: (role: MediaModelRole, name: string | null) => void;
  onPresetsChange: (role: MediaModelRole, next: BotPromptPreset[]) => void;
  onSaveDirectory: (role: MediaModelRole, value: string | null) => void;
  onToggleMediaAction: (action: MediaActionKind, value: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [expandedPresets, setExpandedPresets] = useState<MediaModelRole | null>(null);
  const translationTargetChoices: MenuPickerChoice[] = useMemo(
    () =>
      TRANSLATION_TARGET_LANGUAGES.map((code) => ({
        key: code,
        label: translationTargetLabel(code),
      })),
    [],
  );
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

  /**
   * The ordered model list shared by the media kinds and translation: the
   * primary row, the numbered fallbacks, and the add-backup row. Tapping
   * any of them opens the model picker sheet for that list.
   */
  const modelList = ({
    listKey,
    primary,
    models,
    modelLabel,
    addBackupLabel,
    onPick,
  }: {
    listKey: MediaModelListKey;
    primary: ThreadModelSave;
    models: readonly BotModelEntry[] | null;
    modelLabel: string;
    addBackupLabel: string;
    onPick: () => void;
  }) => {
    const primaryKey =
      primary.provider && primary.modelId ? `${primary.provider}\u0000${primary.modelId}` : null;
    // The primary row already shows the first entry; list the rest numbered
    // by their position in the ordered list.
    const fallbacks = (models ?? [])
      .map((entry, index) => ({ entry, number: index + 1 }))
      .filter(({ entry }) => `${entry.provider}\u0000${entry.model}` !== primaryKey);
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${modelLabel}: ${labelFor(primary)}`}
          onPress={onPick}
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
          <Swipeable
            key={`${entry.provider}:${entry.model}`}
            renderRightActions={() => (
              <View
                style={{
                  width: 88,
                  justifyContent: "center",
                  backgroundColor: tokens.destructiveFill,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Remove")}
                  onPress={() => onRemoveModel(listKey, entry)}
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    paddingHorizontal: 12,
                  }}
                >
                  <Text
                    style={{
                      color: tokens.destructiveForeground,
                      fontSize: 15,
                      fontWeight: "600",
                    }}
                  >
                    {t("Remove")}
                  </Text>
                </Pressable>
              </View>
            )}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t("Fallback")} ${number}: ${labelForEntry(entry)}`}
              onPress={onPick}
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
                  {t("Fallback")}
                </Text>
              </View>
              <Chevron />
            </Pressable>
          </Swipeable>
        ))}
        {(models ?? []).length < BOT_MODEL_LIST_MAX ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addBackupLabel}
            onPress={onPick}
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
      </>
    );
  };

  const kindBlock = (role: MediaModelRole) => {
    const isVideo = role === "video";
    const presets = isVideo ? videoPresets : imagePresets;
    const activePreset = isVideo ? activeVideoPreset : activeImagePreset;
    const saveDirectory = isVideo ? videoSaveDirectory : imageSaveDirectory;
    const presetsLabel = isVideo ? t("Video prompt presets") : t("Image prompt presets");
    const presetsExpanded = expandedPresets === role;

    return (
      <View key={role}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
            {isVideo ? t("Video generation settings") : t("Image generation settings")}
          </Text>
        </View>
        {modelList({
          listKey: isVideo ? "video" : "image",
          primary: isVideo ? video : image,
          models: isVideo ? videoModels : imageModels,
          modelLabel: isVideo ? t("Video generation model") : t("Image generation model"),
          addBackupLabel: isVideo ? t("Add video backup") : t("Add image backup"),
          onPick: () => onPickRole(role),
        })}
        {modelList({
          listKey: isVideo ? "videoEdit" : "imageEdit",
          primary: isVideo ? videoEdit : imageEdit,
          models: isVideo ? videoEditModels : imageEditModels,
          modelLabel: isVideo ? t("Video edit model") : t("Image edit model"),
          addBackupLabel: isVideo ? t("Add video edit backup") : t("Add image edit backup"),
          onPick: () => onPickEditRole(role),
        })}
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

  /**
   * The translation section, mirroring the robot settings' translation
   * rows: the ordered model list, the direction summary, the source
   * chips, the target picker, and the auto-translate switches.
   */
  const translationBlock = () => (
    <View key="translation">
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "700" }}>
          {t("Translation settings")}
        </Text>
      </View>
      {modelList({
        listKey: "translation",
        primary: translation,
        models: translationModels,
        modelLabel: t("Translation model"),
        addBackupLabel: t("Add translation backup"),
        onPick: onPickTranslation,
      })}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 20,
          paddingVertical: 12,
        }}
      >
        <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15 }}>
          {t("Translation direction")}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>
          {`${translationSourceLabel(translationSource)} → ${translationTargetShortLabel(translationTarget)}`}
        </Text>
      </View>
      <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}>
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{t("Source language")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TRANSLATION_SOURCE_LANGUAGES.map((code) => {
            const selected = translationSource === code;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={translationSourceLabel(code)}
                onPress={() => onTranslationSourceChange(code)}
                style={{
                  minHeight: 36,
                  justifyContent: "center",
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: selected ? "transparent" : tokens.border,
                  backgroundColor: selected ? tokens.link : "transparent",
                }}
              >
                <Text
                  style={{
                    color: selected ? "#fff" : tokens.foreground,
                    fontSize: 15,
                    fontWeight: selected ? "600" : "400",
                  }}
                >
                  {translationSourceLabel(code)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* The picker row pads 16 itself; 4 more lines it up with the rest. */}
      <View style={{ paddingHorizontal: 4 }}>
        <MenuPicker
          choices={translationTargetChoices}
          label={t("Target language")}
          onChange={(key) => {
            if (isTranslationTargetLanguage(key)) onTranslationTargetChange(key);
          }}
          value={translationTarget}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 20,
          paddingVertical: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t("Auto-translate")}</Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
            {t("Replies are translated into the target language automatically.")}
          </Text>
        </View>
        <NativeSwitch
          value={autoTranslate}
          accessibilityLabel={t("Auto-translate")}
          onValueChange={onToggleAutoTranslate}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 20,
          paddingVertical: 10,
        }}
      >
        <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15 }}>
          {t("Show read-aloud, share, and favorite on translations")}
        </Text>
        <NativeSwitch
          value={showTranslationActions}
          accessibilityLabel={t("Show read-aloud, share, and favorite on translations")}
          onValueChange={onToggleTranslationActions}
        />
      </View>
    </View>
  );

  const toggles: { action: MediaActionKind; label: string; value: boolean }[] = [
    { action: "favorite", label: t("Favorite"), value: showMediaFavorite },
    { action: "share", label: t("Share"), value: showMediaShare },
    { action: "preview", label: t("Preview"), value: showMediaPreview },
    { action: "download", label: t("Download"), value: showMediaDownload },
  ];

  return (
    <BottomSheetShell visible={visible} label={t("Other models")} onClose={onClose}>
      <SheetHeader title={t("Other models")} onClose={onClose} />
      {kindBlock("image")}
      {kindBlock("video")}
      {translationBlock()}
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
