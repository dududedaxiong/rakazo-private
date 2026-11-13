import type { BotPromptPreset } from "@rakazo/contracts";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import type { MobileModel } from "../../lib/mobile-types";
import { BottomSheetShell, SheetHeader } from "../bottom-sheet-shell";
import { Chevron } from "../row-accessories";
import type { ThreadModelSave } from "./thread-model-picker-sheet";

export type MediaModelRole = "video" | "image";

/**
 * The media models as one sheet from the chat's 影图模型 card: two rows, one
 * per role, each opening the detected-model list for that role. Saving happens
 * in the model picker sheet, in place, without leaving the chat. Under each
 * role with presets, a preset row expands the preset list; tapping one sets
 * it active for the next generation.
 */
export function ThreadMediaModelSheet({
  visible,
  catalog,
  video,
  image,
  videoPresets,
  imagePresets,
  activeVideoPreset,
  activeImagePreset,
  onPickRole,
  onPickPreset,
  onClose,
}: {
  visible: boolean;
  catalog: MobileModel[] | null;
  video: ThreadModelSave;
  image: ThreadModelSave;
  videoPresets: readonly BotPromptPreset[] | null;
  imagePresets: readonly BotPromptPreset[] | null;
  activeVideoPreset: string | null;
  activeImagePreset: string | null;
  onPickRole: (role: MediaModelRole) => void;
  onPickPreset: (role: MediaModelRole, name: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [expandedRole, setExpandedRole] = useState<MediaModelRole | null>(null);
  if (!visible) return null;

  const labelFor = (save: ThreadModelSave) => {
    if (!save.provider || !save.modelId) return t("Not set");
    const entry = catalog?.find(
      (item) => item.provider === save.provider && item.id === save.modelId,
    );
    return entry?.label ?? save.modelId;
  };

  const rows: { role: MediaModelRole; label: string; value: string }[] = [
    { role: "video", label: t("Video generation model"), value: labelFor(video) },
    { role: "image", label: t("Image generation model"), value: labelFor(image) },
  ];

  const presetRows: {
    role: MediaModelRole;
    label: string;
    value: string;
    presets: readonly BotPromptPreset[];
    active: string | null;
  }[] = [
    {
      role: "video",
      label: t("Video prompt preset"),
      value: activeVideoPreset ?? t("Not set"),
      presets: videoPresets ?? [],
      active: activeVideoPreset,
    },
    {
      role: "image",
      label: t("Image prompt preset"),
      value: activeImagePreset ?? t("Not set"),
      presets: imagePresets ?? [],
      active: activeImagePreset,
    },
  ];

  return (
    <BottomSheetShell visible={visible} label={t("Media model")} onClose={onClose}>
      <SheetHeader title={t("Media model")} onClose={onClose} />
      {rows.map((row) => (
        <View key={row.role}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.label}: ${row.value}`}
            onPress={() => onPickRole(row.role)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 20,
              paddingVertical: 14,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: tokens.foreground, fontSize: 16 }}>{row.label}</Text>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
                {row.value}
              </Text>
            </View>
            <Chevron />
          </Pressable>
          {(() => {
            const presetRow = presetRows.find((item) => item.role === row.role);
            if (!presetRow || presetRow.presets.length === 0) return null;
            const expanded = expandedRole === row.role;
            return (
              <View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${presetRow.label}: ${presetRow.value}`}
                  onPress={() => setExpandedRole(expanded ? null : row.role)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                      {presetRow.label}
                    </Text>
                    <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
                      {presetRow.value}
                    </Text>
                  </View>
                  <Chevron />
                </Pressable>
                {expanded
                  ? [
                      ...presetRow.presets.map((preset) => (
                        <PresetOption
                          key={preset.name}
                          name={preset.name}
                          active={presetRow.active === preset.name}
                          onPress={() => {
                            onPickPreset(row.role, preset.name);
                            setExpandedRole(null);
                          }}
                        />
                      )),
                      presetRow.active ? (
                        <PresetOption
                          key="__none"
                          name={t("No preset")}
                          active={false}
                          onPress={() => {
                            onPickPreset(row.role, null);
                            setExpandedRole(null);
                          }}
                        />
                      ) : null,
                    ]
                  : null}
              </View>
            );
          })()}
        </View>
      ))}
    </BottomSheetShell>
  );
}

function PresetOption({
  name,
  active,
  onPress,
}: {
  name: string;
  active: boolean;
  onPress: () => void;
}) {
  const tokens = mobileTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 20,
        paddingLeft: 36,
        paddingVertical: 10,
      }}
    >
      <Text
        style={{
          color: active ? tokens.link : tokens.foreground,
          fontSize: 15,
          fontWeight: active ? "600" : "400",
        }}
      >
        {active ? `✓ ${name}` : name}
      </Text>
    </Pressable>
  );
}
