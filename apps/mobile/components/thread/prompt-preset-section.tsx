import type { BotPromptPreset } from "@rakazo/contracts";
import { BOT_PROMPT_PRESET_MAX } from "@rakazo/contracts";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMobileTokens } from "../../lib/native";
import { NativeActionButton } from "../native-action-button";

/**
 * The prompt presets for one media kind: tap a preset to make it active, edit
 * or delete per row, add a new one. The editor is inline: name plus prompt.
 */
export function PromptPresetSection({
  label,
  presets,
  active,
  onChange,
  onActiveChange,
  showHeading = true,
}: {
  label: string;
  presets: BotPromptPreset[];
  active: string | null;
  onChange: (next: BotPromptPreset[]) => void;
  onActiveChange: (name: string | null) => void;
  /** Hide the section heading; the caller already labels the section. */
  showHeading?: boolean;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [editing, setEditing] = useState<{
    index: number | null;
    name: string;
    prompt: string;
    error: string | null;
  } | null>(null);
  const saveEditing = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const prompt = editing.prompt.trim();
    if (!name) {
      setEditing({ ...editing, error: t("Enter a preset name") });
      return;
    }
    if (presets.some((preset, i) => preset.name === name && i !== editing.index)) {
      setEditing({ ...editing, error: t("A preset with this name already exists") });
      return;
    }
    const next = [...presets];
    const wasActive = editing.index !== null && presets[editing.index]?.name === active;
    if (editing.index === null) {
      next.push({ name, prompt });
    } else {
      next[editing.index] = { name, prompt };
    }
    onChange(next);
    if (wasActive) onActiveChange(name);
    if (editing.index === null && next.length === 1) onActiveChange(name);
    setEditing(null);
  };
  return (
    <>
      {showHeading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>{label}</Text>
        </View>
      ) : null}
      {presets.map((preset, index) => {
        const isActive = active === preset.name;
        return (
          <View
            key={preset.name}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => onActiveChange(isActive ? null : preset.name)}
              style={{ flex: 1 }}
            >
              <Text
                style={{
                  color: isActive ? tokens.link : tokens.foreground,
                  fontSize: 15,
                  fontWeight: isActive ? "600" : "400",
                }}
                numberOfLines={1}
              >
                {isActive ? `✓ ${preset.name}` : preset.name}
              </Text>
              <Text
                style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}
                numberOfLines={2}
              >
                {preset.prompt}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t("Edit preset")}
              accessibilityRole="button"
              onPress={() =>
                setEditing({ index, name: preset.name, prompt: preset.prompt, error: null })
              }
              style={{
                minWidth: 32,
                minHeight: 32,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: tokens.link, fontSize: 15 }}>{t("Edit")}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t("Delete preset")}
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(t("Delete preset"), preset.name, [
                  { text: t("Cancel"), style: "cancel" },
                  {
                    text: t("Delete"),
                    style: "destructive",
                    onPress: () => {
                      onChange(presets.filter((_, i) => i !== index));
                      if (isActive) onActiveChange(null);
                    },
                  },
                ])
              }
              style={{
                minWidth: 32,
                minHeight: 32,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: tokens.destructive, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
        );
      })}
      {editing ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <TextInput
            accessibilityLabel={t("Preset name")}
            placeholder={t("Preset name")}
            placeholderTextColor={tokens.mutedForeground}
            value={editing.name}
            onChangeText={(name) => setEditing({ ...editing, name, error: null })}
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
          <TextInput
            accessibilityLabel={t("Preset prompt")}
            placeholder={t("Preset prompt")}
            placeholderTextColor={tokens.mutedForeground}
            value={editing.prompt}
            onChangeText={(prompt) => setEditing({ ...editing, prompt, error: null })}
            multiline
            style={{
              color: tokens.foreground,
              fontSize: 15,
              borderWidth: 1,
              borderColor: tokens.border,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              minHeight: 72,
              textAlignVertical: "top",
            }}
          />
          {editing.error ? (
            <Text style={{ color: tokens.destructive, fontSize: 13 }}>{editing.error}</Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 12, justifyContent: "flex-end" }}>
            <NativeActionButton
              label={t("Cancel")}
              prominence="quiet"
              onPress={() => setEditing(null)}
            />
            <NativeActionButton label={t("Save")} prominence="secondary" onPress={saveEditing} />
          </View>
        </View>
      ) : presets.length < BOT_PROMPT_PRESET_MAX ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing({ index: null, name: "", prompt: "", error: null })}
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: tokens.link, fontSize: 15 }}>{t("New preset")}</Text>
        </Pressable>
      ) : null}
    </>
  );
}
