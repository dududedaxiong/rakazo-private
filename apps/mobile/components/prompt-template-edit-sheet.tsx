import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import {
  BOT_INSTRUCTIONS_MAX_LENGTH,
  PROMPT_TEMPLATE_NAME_MAX_LENGTH,
} from "@rakazo_mickvvw/contracts";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { errorText } from "../lib/user-error";
import { BottomSheetShell, SheetHeader } from "./bottom-sheet-shell";
import { NativeActionButton } from "./native-action-button";
import { NativeSwitch } from "./native-switch";

/**
 * Create or edit one template, in a bottom sheet. Editing the template the
 * bot uses offers to apply the new version to the bot at once; otherwise
 * saving only changes the template.
 */
export function PromptTemplateEditSheet({
  visible,
  template,
  botId,
  isInUse,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** Null creates a template; a template edits it. */
  template: PromptTemplate | null;
  botId?: string;
  /** The template is the one this bot uses now. */
  isInUse: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [applyToBot, setApplyToBot] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(template?.name ?? "");
    setContent(template?.content ?? "");
    setApplyToBot(true);
    setSaving(false);
    setError(null);
  }, [visible, template]);

  if (!visible) return null;

  const trimmedName = name.trim();
  const trimmedContent = content.trim();
  const canSave = Boolean(trimmedName && trimmedContent) && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (!template) {
        await rpc("promptTemplates/create", { name: trimmedName, content: trimmedContent });
      } else {
        const changedName = trimmedName !== template.name;
        const changedContent = trimmedContent !== template.content;
        if (changedName || changedContent) {
          await rpc("promptTemplates/update", {
            templateId: template.id,
            ...(changedName ? { name: trimmedName } : {}),
            ...(changedContent ? { content: trimmedContent } : {}),
          });
        }
        if (applyToBot && isInUse && botId) {
          await rpc("promptTemplates/apply", { templateId: template.id, botId });
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, t("Could not save that template")));
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = {
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: tokens.foreground,
    fontSize: 15,
  } as const;

  return (
    <BottomSheetShell
      visible={visible}
      label={template ? t("Edit template") : t("New template")}
      expanded
      onClose={onClose}
    >
      <SheetHeader title={template ? t("Edit template") : t("New template")} onClose={onClose} />
      <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", marginTop: 8 }}>
        {t("Name")}
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={PROMPT_TEMPLATE_NAME_MAX_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={tokens.mutedForeground}
        style={[fieldStyle, { marginTop: 8 }]}
      />
      <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", marginTop: 16 }}>
        {t("Prompt content")}
      </Text>
      <TextInput
        value={content}
        onChangeText={setContent}
        maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
        multiline
        textAlignVertical="top"
        placeholderTextColor={tokens.mutedForeground}
        style={[fieldStyle, { marginTop: 8, height: 140, lineHeight: 22 }]}
      />
      <Text
        style={{ color: tokens.mutedForeground, fontSize: 12, textAlign: "right", marginTop: 6 }}
      >
        {t("{count} / {max} characters", {
          count: content.length,
          max: BOT_INSTRUCTIONS_MAX_LENGTH,
        })}
      </Text>
      {isInUse ? (
        <>
          <Text
            style={{
              color: tokens.mutedForeground,
              fontSize: 13,
              lineHeight: 19,
              backgroundColor: tokens.muted,
              borderRadius: 10,
              padding: 12,
              marginTop: 12,
            }}
          >
            {t(
              "Saving alone only changes the template. The bot keeps its old persona unless you apply it below.",
            )}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 14,
            }}
          >
            <Text style={{ color: tokens.foreground, fontSize: 15, flex: 1 }}>
              {t("Save and apply to this bot")}
            </Text>
            <NativeSwitch
              accessibilityLabel={t("Save and apply to this bot")}
              value={applyToBot}
              onValueChange={setApplyToBot}
            />
          </View>
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 12 }}>
          {error}
        </Text>
      ) : null}
      <NativeActionButton
        label={saving ? t("Saving…") : t("Save")}
        disabled={!canSave}
        busy={saving}
        onPress={() => void save()}
        style={{ marginTop: 18 }}
      />
      <NativeActionButton label={t("Cancel")} prominence="plain" onPress={onClose} />
    </BottomSheetShell>
  );
}
