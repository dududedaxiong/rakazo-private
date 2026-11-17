import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { glassHeaderOptions } from "../components/glass-title";
import { NativeActionButton } from "../components/native-action-button";
import { PromptTemplateEditSheet } from "../components/prompt-template-edit-sheet";
import { PromptTemplateImportSheet } from "../components/prompt-template-import-sheet";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { isTemplateInUse } from "../lib/prompt-template-display";
import { exportPromptTemplates, PromptTemplateFileError } from "../lib/prompt-template-files";
import { invalidatePromptTemplates, usePromptTemplates } from "../lib/prompt-templates";
import { queryClient, rpcQuery } from "../lib/query";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

type EditTarget = { mode: "create" } | { mode: "edit"; template: PromptTemplate };

/**
 * The prompt template library: every template with a two-line preview, and
 * the actions to use, edit, export or delete it. Import and edit open as
 * bottom sheets; a tap on a row edits it.
 */
export default function PromptTemplatesScreen() {
  const sideInsets = useSideInsets();
  const tokens = mobileTokens();
  const { t } = useI18n();
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  const templatesQuery = usePromptTemplates();
  const templates = templatesQuery.data ?? [];
  const botQuery = useQuery(
    { ...rpcQuery("bots/get", botId ? { botId } : undefined), enabled: Boolean(botId) },
    queryClient,
  );
  const currentTemplateId = botQuery.data?.promptTemplateId ?? null;
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await invalidatePromptTemplates();
    if (botId) await botQuery.refetch();
  }, [botId, botQuery]);

  async function applyTemplate(template: PromptTemplate) {
    if (!botId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("promptTemplates/apply", { templateId: template.id, botId });
      await refresh();
      Alert.alert(t("Switched to {name}", { name: template.name }));
    } catch (err) {
      setError(errorText(err, t("Could not apply that template")));
    } finally {
      setBusy(false);
    }
  }

  function deleteTemplate(template: PromptTemplate) {
    Alert.alert(
      t("Delete {name}?", { name: template.name }),
      isTemplateInUse(template, { promptTemplateId: currentTemplateId })
        ? t("The bot keeps its current persona.")
        : undefined,
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete"),
          style: "destructive",
          onPress: () => {
            void rpc("promptTemplates/remove", { templateId: template.id })
              .then(() => refresh())
              .catch((err: unknown) => setError(errorText(err)));
          },
        },
      ],
    );
  }

  async function exportAndReport(targets: PromptTemplate[]) {
    if (!targets.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await exportPromptTemplates(targets);
      if (result.kind === "saved") {
        Alert.alert(t("Exported to {path}", { path: result.path }));
      } else {
        Alert.alert(t("Shared {name}", { name: result.fileName }));
      }
    } catch (err) {
      if (err instanceof PromptTemplateFileError && err.code === "cancelled") return;
      setError(errorText(err, t("Could not export")));
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrentPersona() {
    if (!botId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await rpc("promptTemplates/saveCurrentAsTemplate", { botId });
      await refresh();
      Alert.alert(t("Saved as {name}", { name: saved.name }));
    } catch (err) {
      setError(errorText(err, t("Could not import")));
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefaults() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("promptTemplates/restoreDefaults");
      await refresh();
    } catch (err) {
      setError(errorText(err, t("Could not restore the default templates")));
    } finally {
      setBusy(false);
    }
  }

  const chip = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderWidth: 1.5,
        borderColor: tokens.border,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
        ...(pressed || disabled ? { opacity: 0.5 } : null),
      })}
    >
      <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(t("Prompt templates"))} />
      <ScrollView
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <NativeActionButton
          label={t("New template")}
          onPress={() => setEditTarget({ mode: "create" })}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          {chip(t("Import"), () => setImportOpen(true))}
          {chip(t("Export all"), () => void exportAndReport(templates), templates.length === 0)}
          {botId ? chip(t("Save current persona"), () => void saveCurrentPersona()) : null}
        </View>

        {templatesQuery.isPending ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 15, marginTop: 24 }}>
            {t("Loading…")}
          </Text>
        ) : templatesQuery.isError ? (
          <View style={{ gap: 12, marginTop: 24 }}>
            <Text accessibilityRole="alert" style={{ color: tokens.destructive, fontSize: 15 }}>
              {errorText(templatesQuery.error, t("Could not load templates"))}
            </Text>
            <NativeActionButton
              label={t("Try again.")}
              prominence="secondary"
              onPress={() => void templatesQuery.refetch()}
            />
          </View>
        ) : templates.length === 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 15, marginTop: 24 }}>
            {t("No templates yet")}
          </Text>
        ) : (
          templates.map((template) => {
            const inUse = isTemplateInUse(template, { promptTemplateId: currentTemplateId });
            return (
              <View
                key={template.id}
                style={{
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: inUse ? tokens.primary : tokens.border,
                  borderRadius: 16,
                  padding: 14,
                  backgroundColor: inUse ? tokens.muted : tokens.card,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Edit template")}
                  onPress={() => setEditTarget({ mode: "edit", template })}
                >
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
                    numberOfLines={2}
                    style={{
                      color: tokens.mutedForeground,
                      fontSize: 13,
                      lineHeight: 19,
                      marginTop: 5,
                    }}
                  >
                    {template.content}
                  </Text>
                </Pressable>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 16,
                    marginTop: 11,
                    paddingTop: 11,
                    borderTopWidth: 1,
                    borderTopColor: tokens.border,
                  }}
                >
                  {inUse ? (
                    <Text
                      style={{ color: tokens.mutedForeground, fontSize: 14, fontWeight: "600" }}
                    >
                      {t("In use")}
                    </Text>
                  ) : botId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Use")}
                      disabled={busy}
                      onPress={() => void applyTemplate(template)}
                    >
                      <Text style={{ color: tokens.link, fontSize: 14, fontWeight: "600" }}>
                        {t("Use")}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Edit")}
                    onPress={() => setEditTarget({ mode: "edit", template })}
                  >
                    <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>
                      {t("Edit")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Export")}
                    disabled={busy}
                    onPress={() => void exportAndReport([template])}
                  >
                    <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>
                      {t("Export")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Delete")}
                    style={{ marginLeft: "auto" }}
                    onPress={() => deleteTemplate(template)}
                  >
                    <Text style={{ color: tokens.destructive, fontSize: 14, fontWeight: "600" }}>
                      {t("Delete")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        {error ? (
          <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 16 }}>
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Restore default templates")}
          disabled={busy}
          onPress={() => void restoreDefaults()}
          style={{ alignSelf: "center", marginTop: 18 }}
        >
          <Text style={{ color: tokens.link, fontSize: 14, fontWeight: "600" }}>
            {t("Restore default templates")}
          </Text>
        </Pressable>
        <View
          style={{
            marginTop: 14,
            backgroundColor: tokens.muted,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            {t("Tap a row to edit it. Tap Use to switch to it.")}
          </Text>
          {Platform.OS === "android" ? (
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 6 }}
            >
              {t(
                "Exported files go to Download/Rakazo/提示词模板/. Edit one in an external editor, then import the same name to update it. A template in use applies at once.",
              )}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <PromptTemplateEditSheet
        visible={editTarget !== null}
        template={editTarget?.mode === "edit" ? editTarget.template : null}
        botId={botId}
        isInUse={
          editTarget?.mode === "edit"
            ? isTemplateInUse(editTarget.template, { promptTemplateId: currentTemplateId })
            : false
        }
        onClose={() => setEditTarget(null)}
        onSaved={() => void refresh()}
      />
      <PromptTemplateImportSheet
        visible={importOpen}
        botId={botId}
        onClose={() => setImportOpen(false)}
        onImported={() => void refresh()}
      />
    </>
  );
}
