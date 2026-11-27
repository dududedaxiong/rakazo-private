import type { LoginFieldInput } from "@rakazo_mickvvw/contracts";
import { LoginSecretValue, loginCardFields } from "@rakazo_mickvvw/contracts";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { useSecretSheetClose } from "../lib/secret-sheet-close";
import type { CookieImportSummary } from "../lib/vault";
import type { LoginFieldRow } from "./login-fields-editor";
import { LoginFieldsEditor } from "./login-fields-editor";
import { NativeActionButton } from "./native-action-button";
import { NativeSegmentedControl } from "./native-segmented-control";
import { NativeSwitch } from "./native-switch";

/**
 * A website sign-in, typed or filled from saved passwords. The values live only in this sheet's
 * state and are cleared whether saving succeeds or fails, and before the sheet closes. The same
 * sheet also takes a pasted cookie export instead of a login: the cookies are imported into the
 * vault, the ask itself stays open, and the bot signs in with them on its next navigation.
 */
export function SecretAskSheet({
  title,
  destination,
  replacedSite,
  loginFields,
  pending,
  cookieOnly,
  onClose,
  onSave,
  onImportCookies,
}: {
  title: string;
  destination: string;
  /** The site of the saved login this answer replaces. */
  replacedSite?: string;
  /** The labels the card asks for; absent means the default username and password. */
  loginFields: readonly string[] | undefined;
  /** False once the card is answered or can no longer be answered; the sheet then closes. */
  pending: boolean;
  /** The card asked for cookies, so there is no login to switch to. */
  cookieOnly?: boolean;
  onClose: () => void;
  /** `remember` is false when "Save to Vault" was turned off: the login is for this run only. */
  onSave: (fields: LoginFieldInput[], remember: boolean) => Promise<void>;
  /** Imports a pasted cookie export into the vault for the card's site. */
  onImportCookies?: (input: {
    content: string;
    userAgent?: string;
  }) => Promise<CookieImportSummary>;
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const inputs = useRef<(TextInput | null)[]>([]);
  const [fields, setFields] = useState<LoginFieldRow[]>(() =>
    loginCardFields(loginFields).map((field, id) => ({ ...field, id })),
  );
  const labels = loginFields ?? [t("Username"), t("Password")];
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"login" | "cookies">(cookieOnly ? "cookies" : "login");
  const inCookieMode = mode === "cookies" && onImportCookies !== undefined;
  const [cookies, setCookies] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [importSummary, setImportSummary] = useState<CookieImportSummary | null>(null);
  const incomplete = inCookieMode
    ? cookies.trim().length === 0
    : !LoginSecretValue.safeParse({ fields }).success;

  function clear() {
    setFields((current) => current.map((field) => ({ ...field, value: "" })));
    setCookies("");
  }

  const { close, closing, endEditing } = useSecretSheetClose(inputs, clear, onClose);

  useEffect(() => {
    if (!pending) close();
  }, [pending]);

  async function save() {
    if (submitting || incomplete) return;
    if (inCookieMode && onImportCookies) {
      const content = cookies.trim();
      const agent = userAgent.trim();
      clear();
      setSubmitting(true);
      setError(null);
      try {
        // The ask stays open: the bot signs in with the cookies on its next navigation.
        setImportSummary(
          await onImportCookies({ content, ...(agent ? { userAgent: agent } : {}) }),
        );
      } catch {
        setError(t("Could not save cookies"));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const answer = fields.map(({ label, value, hidden }) => ({ label, value, hidden }));
    clear();
    setSubmitting(true);
    setError(null);
    try {
      await onSave(answer, remember);
    } catch {
      setError(t("Could not send answer"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
      // Focus once the sheet is up: a field focused while the sheet is still being laid out
      // clips its placeholder at large text sizes.
      onShow={() => inputs.current[0]?.focus()}
    >
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          // Page sheets clear the notch on iOS; Android modals are full-screen.
          {
            paddingTop: Platform.OS === "ios" ? 12 : insets.top + 12,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.header}>
          {importSummary ? (
            <NativeActionButton label={t("Done")} onPress={close} prominence="primary" />
          ) : (
            <>
              <NativeActionButton label={t("Cancel")} onPress={close} prominence="plain" />
              <NativeActionButton
                disabled={incomplete}
                busy={submitting}
                fill={false}
                label={inCookieMode ? t("Save") : remember ? t("Save") : t("Continue")}
                onPress={() => void save()}
                prominence={incomplete ? "plain" : "primary"}
              />
            </>
          )}
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          // A long title and site at large text sizes can leave the fields under the keyboard.
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.destination}>{destination}</Text>
          {replacedSite ? (
            <Text style={styles.replaced}>
              {t("Replaces the login saved for {site}", { site: replacedSite })}
            </Text>
          ) : null}
          {importSummary ? (
            <>
              <Text style={styles.summary}>
                {t("Imported {count} cookies", { count: importSummary.imported })}
              </Text>
              {importSummary.skipped.map((entry) => (
                <Text key={entry.reason} style={styles.summaryDetail}>
                  {t("{count} skipped: {reason}", { count: entry.count, reason: entry.reason })}
                </Text>
              ))}
            </>
          ) : null}
          {!importSummary && onImportCookies && !cookieOnly ? (
            <NativeSegmentedControl
              accessibilityLabel={t("Sign-in method")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "login" as const, label: t("Login") },
                { value: "cookies" as const, label: t("Cookie / UA") },
              ]}
            />
          ) : null}
          {!importSummary && inCookieMode ? (
            <>
              <View style={styles.group}>
                <View style={styles.fieldRow}>
                  <Text style={styles.label}>{t("Cookies")}</Text>
                  <TextInput
                    accessibilityLabel={t("Cookies")}
                    value={cookies}
                    onChangeText={setCookies}
                    placeholder={t("Paste the exported cookies")}
                    placeholderTextColor={styles.placeholder.color}
                    autoCorrect={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    multiline
                    editable={!submitting && !closing}
                    style={[styles.input, styles.cookiesInput]}
                  />
                </View>
                <View style={styles.separator} />
                <View style={styles.fieldRow}>
                  <Text style={styles.label}>{t("User-Agent")}</Text>
                  <TextInput
                    accessibilityLabel={t("User-Agent")}
                    value={userAgent}
                    onChangeText={setUserAgent}
                    placeholder="Mozilla/5.0 …"
                    placeholderTextColor={styles.placeholder.color}
                    autoCorrect={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    editable={!submitting && !closing}
                    style={styles.input}
                  />
                </View>
              </View>
              <Text style={styles.note}>
                {t("Encrypted on the server. The model never sees the values.")}
              </Text>
            </>
          ) : null}
          {!importSummary && !inCookieMode ? (
            <LoginFieldsEditor
              fields={fields}
              onChange={setFields}
              labels={labels}
              editable={!submitting && !closing}
              inputs={inputs}
              onEndEditing={endEditing}
              onSubmit={() => void save()}
            />
          ) : null}
          {!importSummary && !inCookieMode ? (
            <View style={[styles.group, styles.row]}>
              <Text style={styles.switchLabel}>{t("Save to Vault")}</Text>
              <NativeSwitch
                accessibilityLabel={t("Save to Vault")}
                disabled={submitting || closing}
                value={remember}
                onValueChange={setRemember}
              />
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: tokens.background },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    content: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
    title: { color: tokens.foreground, fontSize: 20, fontWeight: "600" },
    destination: { color: tokens.foreground, fontSize: 15, marginBottom: 8 },
    replaced: { color: tokens.mutedForeground, fontSize: 13, marginTop: -8, marginBottom: 8 },
    group: { backgroundColor: tokens.muted, borderRadius: 13, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 16 },
    fieldRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 2 },
    label: { color: tokens.mutedForeground, fontSize: 13 },
    input: { color: tokens.foreground, fontSize: 17, paddingVertical: 4, minHeight: 28 },
    cookiesInput: { minHeight: 120, textAlignVertical: "top", fontFamily: "monospace" },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.border,
      marginStart: 16,
    },
    summary: { color: tokens.foreground, fontSize: 17 },
    summaryDetail: { color: tokens.mutedForeground, fontSize: 15 },
    note: { color: tokens.mutedForeground, fontSize: 13 },
    switchLabel: { flex: 1, color: tokens.foreground, fontSize: 17 },
    placeholder: { color: tokens.faintForeground },
    error: { color: tokens.destructive, fontSize: 13 },
  });
}
