import type { PromptTemplateImportItem } from "@rakazo/contracts";
import { BOT_INSTRUCTIONS_MAX_LENGTH, parsePromptTemplateImport } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { PromptTemplateFileError, pickPromptTemplateFile } from "../lib/prompt-template-files";
import { errorText } from "../lib/user-error";
import { BottomSheetShell, SheetHeader } from "./bottom-sheet-shell";
import { NativeActionButton } from "./native-action-button";

type ImportTab = "local" | "subscription";

/**
 * Import personas, from a pasted or picked local file or from a subscription
 * address. What will be imported is always previewed first; confirming is
 * what writes it. Same names update, new names create.
 */
export function PromptTemplateImportSheet({
  visible,
  botId,
  onClose,
  onImported,
}: {
  visible: boolean;
  botId?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [tab, setTab] = useState<ImportTab>("local");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  /** Templates a file or a subscription returned; null means paste mode. */
  const [items, setItems] = useState<PromptTemplateImportItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTab("local");
    setName("");
    setContent("");
    setUrl("");
    setItems(null);
    setBusy(false);
    setFetching(false);
    setError(null);
  }, [visible]);

  if (!visible) return null;

  const multi = items !== null && items.length > 1;
  const single = items !== null && items.length === 1;
  const canConfirm = busy ? false : multi ? true : Boolean(name.trim() && content.trim());

  function showParsed(parsed: PromptTemplateImportItem[]) {
    setItems(parsed);
    if (parsed.length === 1) {
      setName(parsed[0]!.name);
      setContent(parsed[0]!.content);
    }
    setError(null);
  }

  function fileErrorText(err: unknown): string {
    if (err instanceof PromptTemplateFileError) {
      if (err.code === "invalid") return t("Choose a .txt, .md or .json file");
      if (err.code === "too_large") return t("That file is too large");
      return t("Could not read that file");
    }
    return errorText(err, t("Could not import"));
  }

  async function chooseFile() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await pickPromptTemplateFile();
      if (!picked) return;
      const suggestedName = picked.name.replace(/\.(txt|md|json)$/i, "");
      showParsed(parsePromptTemplateImport({ text: picked.text, suggestedName }));
    } catch (err) {
      setError(fileErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function fetchSubscription() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || fetching) return;
    setFetching(true);
    setError(null);
    try {
      const fetched = await rpc("promptTemplates/fetchFromUrl", { url: trimmedUrl });
      showParsed(fetched.templates);
    } catch (err) {
      setError(errorText(err, t("Could not import")));
    } finally {
      setFetching(false);
    }
  }

  async function importFromBot() {
    if (!botId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("promptTemplates/saveCurrentAsTemplate", {
        botId,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onImported();
      onClose();
    } catch (err) {
      setError(errorText(err, t("Could not import")));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const templates = multi
        ? items!
        : parsePromptTemplateImport({ text: content, suggestedName: name.trim() });
      await rpc("promptTemplates/confirmImport", {
        templates,
        ...(botId ? { botId } : {}),
        ...(tab === "subscription" && url.trim() ? { sourceUrl: url.trim() } : {}),
      });
      onImported();
      onClose();
    } catch (err) {
      setError(errorText(err, t("Could not import")));
    } finally {
      setBusy(false);
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

  const tabButton = (key: ImportTab, label: string) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === key }}
      onPress={() => setTab(key)}
      style={{
        flex: 1,
        alignItems: "center",
        paddingVertical: 8,
        borderRadius: 999,
        ...(tab === key ? { backgroundColor: tokens.card } : null),
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: tab === key ? tokens.foreground : tokens.mutedForeground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <BottomSheetShell visible={visible} label={t("Import persona")} expanded onClose={onClose}>
      <SheetHeader title={t("Import persona")} onClose={onClose} />
      <View
        style={{
          flexDirection: "row",
          backgroundColor: tokens.muted,
          borderRadius: 999,
          padding: 3,
          marginTop: 8,
        }}
      >
        {tabButton("local", t("Local file"))}
        {tabButton("subscription", t("Subscription"))}
      </View>

      {tab === "subscription" ? (
        <>
          <Text
            style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", marginTop: 16 }}
          >
            {t("Subscription URL")}
          </Text>
          <TextInput
            value={url}
            onChangeText={(next) => {
              setUrl(next);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholderTextColor={tokens.mutedForeground}
            style={[fieldStyle, { marginTop: 8 }]}
          />
          <Text
            style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 6, lineHeight: 17 }}
          >
            {t("Supports .txt, .md and .json. A .json file can hold several templates.")}
          </Text>
          <NativeActionButton
            label={fetching ? t("Fetching…") : t("Fetch")}
            prominence="secondary"
            disabled={!url.trim() || fetching}
            busy={fetching}
            onPress={() => void fetchSubscription()}
            style={{ marginTop: 12 }}
          />
        </>
      ) : null}

      {tab === "local" && !items ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          <View style={{ flex: 1 }}>
            <NativeActionButton
              label={t("Choose file")}
              prominence="secondary"
              disabled={busy}
              onPress={() => void chooseFile()}
            />
          </View>
          {botId ? (
            <View style={{ flex: 1 }}>
              <NativeActionButton
                label={t("Import from this bot")}
                prominence="secondary"
                disabled={busy}
                onPress={() => void importFromBot()}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {(tab === "local" && !items) || single ? (
        <>
          <Text
            style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", marginTop: 16 }}
          >
            {t("Name")}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={tokens.mutedForeground}
            style={[fieldStyle, { marginTop: 8 }]}
          />
        </>
      ) : null}

      {items && items.length > 0 ? (
        <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", marginTop: 16 }}>
          {t("Content preview")}
        </Text>
      ) : null}

      {multi ? (
        <View style={{ marginTop: 8, gap: 12 }}>
          {items!.map((item) => (
            <View
              key={item.name}
              style={{
                borderWidth: 1,
                borderColor: tokens.border,
                borderRadius: 10,
                padding: 12,
              }}
            >
              <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
                {item.name}
              </Text>
              <Text
                numberOfLines={2}
                style={{
                  color: tokens.mutedForeground,
                  fontSize: 13,
                  marginTop: 4,
                  lineHeight: 18,
                }}
              >
                {item.content}
              </Text>
            </View>
          ))}
        </View>
      ) : tab === "local" || single ? (
        <>
          {items ? null : (
            <Text
              style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", marginTop: 16 }}
            >
              {t("Prompt content")}
            </Text>
          )}
          <TextInput
            value={content}
            onChangeText={setContent}
            maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
            multiline
            textAlignVertical="top"
            placeholder={tab === "local" && !items ? t("Paste the prompt text") : undefined}
            placeholderTextColor={tokens.mutedForeground}
            style={[fieldStyle, { marginTop: 8, height: single ? 140 : 78, lineHeight: 22 }]}
          />
        </>
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 12 }}>
          {error}
        </Text>
      ) : null}
      <NativeActionButton
        label={busy ? t("Saving…") : t("Confirm import")}
        disabled={!canConfirm}
        busy={busy}
        onPress={() => void confirmImport()}
        style={{ marginTop: 18 }}
      />
      <NativeActionButton label={t("Cancel")} prominence="plain" onPress={onClose} />
    </BottomSheetShell>
  );
}
