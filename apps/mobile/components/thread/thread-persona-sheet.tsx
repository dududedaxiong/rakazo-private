import type { PromptTemplate } from "@rakazo/contracts";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { rpc } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { usePromptTemplates } from "../../lib/prompt-templates";
import { errorText } from "../../lib/user-error";
import { BottomSheetShell, SheetHeader } from "../bottom-sheet-shell";
import { NativeActionButton } from "../native-action-button";

/**
 * Switch the chat's persona: one tap applies a template at once, and the
 * next message uses its prompt. The bot menu stays on the avatar; this sheet
 * opens from the name under it.
 */
export function ThreadPersonaSheet({
  visible,
  botId,
  currentTemplateId,
  onClose,
  onManageTemplates,
  onApplied,
}: {
  visible: boolean;
  botId: string;
  currentTemplateId: string | null;
  onClose: () => void;
  onManageTemplates: () => void;
  onApplied: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const templatesQuery = usePromptTemplates();
  const templates = templatesQuery.data;
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  if (!visible) return null;

  async function apply(template: PromptTemplate) {
    if (applyingId || template.id === currentTemplateId) return;
    setApplyingId(template.id);
    setError(null);
    try {
      await rpc("promptTemplates/apply", { templateId: template.id, botId });
      onApplied();
      onClose();
      Alert.alert(t("Switched to {name}", { name: template.name }));
    } catch (err) {
      setError(errorText(err, t("Could not apply that template")));
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <BottomSheetShell visible={visible} label={t("Switch persona")} onClose={onClose}>
      <SheetHeader title={t("Switch persona")} onClose={onClose} />
      {templatesQuery.isPending ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 15, paddingVertical: 12 }}>
          {t("Loading…")}
        </Text>
      ) : templatesQuery.isError ? (
        <View style={{ gap: 12, paddingVertical: 12 }}>
          <Text accessibilityRole="alert" style={{ color: tokens.destructive, fontSize: 15 }}>
            {errorText(templatesQuery.error, t("Could not load templates"))}
          </Text>
          <NativeActionButton
            label={t("Try again.")}
            prominence="secondary"
            onPress={() => void templatesQuery.refetch()}
          />
        </View>
      ) : templates?.length ? (
        templates.map((template) => {
          const inUse = template.id === currentTemplateId;
          const applying = applyingId === template.id;
          return (
            <Pressable
              key={template.id}
              accessibilityRole="radio"
              accessibilityLabel={template.name}
              accessibilityState={{ checked: inUse, busy: applying }}
              disabled={applying}
              onPress={() => void apply(template)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 12,
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: tokens.border,
                ...(pressed ? { opacity: 0.6 } : null),
              })}
            >
              <View style={{ flex: 1 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" }}
                >
                  <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "600" }}>
                    {template.name}
                  </Text>
                  {inUse ? (
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        borderRadius: 999,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        backgroundColor: tokens.primary,
                        color: tokens.primaryForeground,
                      }}
                    >
                      {t("In use")}
                    </Text>
                  ) : null}
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      borderRadius: 999,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      backgroundColor: tokens.muted,
                      color: tokens.mutedForeground,
                    }}
                  >
                    {template.isBuiltIn ? t("Built-in") : t("My template")}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 3 }}
                >
                  {template.content}
                </Text>
              </View>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  marginTop: 2,
                  alignItems: "center",
                  justifyContent: "center",
                  ...(inUse
                    ? { backgroundColor: tokens.primary }
                    : { borderWidth: 2, borderColor: tokens.border }),
                }}
              >
                {inUse ? (
                  <Text style={{ color: tokens.primaryForeground, fontSize: 13 }}>✓</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })
      ) : (
        <Text style={{ color: tokens.mutedForeground, fontSize: 15, paddingVertical: 12 }}>
          {t("No templates yet")}
        </Text>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 12 }}>
          {error}
        </Text>
      ) : null}
      <NativeActionButton
        label={t("Manage templates")}
        onPress={() => {
          onClose();
          onManageTemplates();
        }}
        style={{ marginTop: 16 }}
      />
      <Text
        style={{ color: tokens.mutedForeground, fontSize: 12, textAlign: "center", marginTop: 12 }}
      >
        {t("Tap once to apply. The next message uses the new prompt.")}
      </Text>
    </BottomSheetShell>
  );
}
