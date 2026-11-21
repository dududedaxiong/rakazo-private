import type { MiscSettings } from "@rakazo_mickvvw/contracts";
import type { ArtifactCategory, ArtifactSoftwareKind } from "@rakazo_mickvvw/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { NativeSymbol } from "../../components/native-symbol";
import { SettingsGroup, SettingsRow } from "../../components/settings-group";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { getMiscSettings, saveMiscSettings } from "../../lib/misc-settings";
import { native, useThemedStyles } from "../../lib/native";
import { createQueuedSave } from "../../lib/queued-save";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

type CategoryIcon = Pick<Parameters<typeof NativeSymbol>[0], "ios" | "android">;

function ExtensionEditor({
  extensions,
  onAdd,
  onRemove,
  blocked,
}: {
  extensions: string[];
  onAdd: (extension: string) => void;
  onRemove: (extension: string) => void;
  blocked?: readonly string[];
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState("");
  function submit() {
    const cleaned = draft.trim().replace(/^\./, "").toLowerCase();
    setDraft("");
    if (!/^[a-z0-9]+$/.test(cleaned)) return;
    if (extensions.includes(cleaned)) return;
    if (blocked?.includes(cleaned)) return;
    onAdd(cleaned);
  }
  return (
    <View style={styles.editor}>
      <View style={styles.chips}>
        {extensions.map((extension) => (
          <Pressable
            key={extension}
            accessibilityRole="button"
            accessibilityLabel={t('Remove "{extension}"', { extension })}
            onPress={() => onRemove(extension)}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>{extension}</Text>
            <Text style={styles.chipRemove}>×</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.addRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={t("Add extension")}
          placeholderTextColor={native.tertiaryLabel}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={styles.input}
        />
        <Pressable accessibilityRole="button" onPress={submit} style={styles.addButton}>
          <Text style={styles.addLabel}>{t("Add")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function MiscSettingsScreen() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const insets = useSideInsets();
  const [settings, setSettings] = useState<MiscSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Device-local only: the SAF grant is per device, so this never goes
  // through the synced misc settings above.
  const [downloadDir, setDownloadDir] = useState("Download/Rakazo");
  const [dirBusy, setDirBusy] = useState(false);
  const saveQueue = useRef<ReturnType<typeof createQueuedSave<MiscSettings>> | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await getMiscSettings();
      setSettings(next);
      saveQueue.current?.reset(next);
    } catch (cause) {
      setLoadError(errorText(cause, t("Could not load settings")));
    }
  }, [t]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadDownloadDir = useCallback(async () => {
    if (Platform.OS !== "android") return;
    try {
      const { downloadDirectoryDisplay } = await import("../../lib/gallery-export");
      setDownloadDir(await downloadDirectoryDisplay());
    } catch {
      // Keeps the default label; the next download asks for the folder.
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void loadDownloadDir();
    }, [loadDownloadDir]),
  );

  async function pickDirectory() {
    if (dirBusy) return;
    setDirBusy(true);
    try {
      const { pickDownloadDirectory } = await import("../../lib/gallery-export");
      const picked = await pickDownloadDirectory();
      if (picked) setDownloadDir(picked);
    } catch (cause) {
      setSaveError(errorText(cause, t("Could not save settings")));
    } finally {
      setDirBusy(false);
    }
  }

  function updateSettings(next: MiscSettings) {
    if (!settings) return;
    saveQueue.current ??= createQueuedSave(settings, {
      save: async (value) => {
        await saveMiscSettings(value);
      },
      onChange: (value) => {
        setSettings(value);
        setSaveError(null);
      },
      onError: (cause) => setSaveError(errorText(cause, t("Could not save settings"))),
    });
    saveQueue.current.update(next);
  }

  const categorySections: {
    key: Exclude<ArtifactCategory, "software" | "other">;
    label: string;
    icon: CategoryIcon;
  }[] = [
    { key: "image", label: t("Images"), icon: { ios: "photo", android: "image-outline" } },
    {
      key: "video",
      label: t("Film and video"),
      icon: { ios: "video", android: "videocam-outline" },
    },
    {
      key: "archive",
      label: t("Archives"),
      icon: { ios: "archivebox", android: "archive-outline" },
    },
    {
      key: "script",
      label: t("Scripts"),
      icon: { ios: "chevron.left.forwardslash.chevron.right", android: "code-slash-outline" },
    },
    {
      key: "document",
      label: t("Documents"),
      icon: { ios: "doc.text", android: "document-text-outline" },
    },
  ];
  const softwareSections: { key: ArtifactSoftwareKind; label: string; icon: CategoryIcon }[] = [
    {
      key: "desktop",
      label: t("Desktop software"),
      icon: { ios: "desktopcomputer", android: "desktop-outline" },
    },
    {
      key: "apple",
      label: t("Apple software"),
      icon: { ios: "apple.logo", android: "logo-apple" },
    },
    {
      key: "android",
      label: t("Android software"),
      icon: { ios: "phone", android: "logo-android" },
    },
    { key: "other", label: t("Other software"), icon: { ios: "cube", android: "cube-outline" } },
  ];

  if (settings === null) {
    return (
      <ScrollView contentContainerStyle={[styles.page, insets]}>
        {loadError ? (
          <>
            <Text style={styles.error}>{loadError}</Text>
            <SettingsGroup>
              <SettingsRow title={t("Try again.")} onPress={() => void load()} />
            </SettingsGroup>
          </>
        ) : (
          <ActivityIndicator color={native.secondaryLabel} style={styles.spinner} />
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, insets]}>
      {categorySections.map((section) => (
        <SettingsGroup key={section.key}>
          <SettingsRow
            title={section.label}
            leading={
              <NativeSymbol ios={section.icon.ios} android={section.icon.android} size={20} />
            }
          />
          <ExtensionEditor
            extensions={settings.categories[section.key]}
            onAdd={(extension) =>
              updateSettings({
                ...settings,
                categories: {
                  ...settings.categories,
                  [section.key]: [...settings.categories[section.key], extension],
                },
              })
            }
            onRemove={(extension) =>
              updateSettings({
                ...settings,
                categories: {
                  ...settings.categories,
                  [section.key]: settings.categories[section.key].filter(
                    (item) => item !== extension,
                  ),
                },
              })
            }
          />
        </SettingsGroup>
      ))}
      <SettingsGroup>
        <SettingsRow
          title={t("Software")}
          leading={<NativeSymbol ios="square.grid.2x2" android="apps-outline" size={20} />}
        />
        {softwareSections.map((section) => (
          <View key={section.key}>
            <SettingsRow
              title={section.label}
              leading={
                <NativeSymbol ios={section.icon.ios} android={section.icon.android} size={20} />
              }
            />
            <ExtensionEditor
              extensions={settings.categories.software[section.key]}
              onAdd={(extension) =>
                updateSettings({
                  ...settings,
                  categories: {
                    ...settings.categories,
                    software: {
                      ...settings.categories.software,
                      [section.key]: [...settings.categories.software[section.key], extension],
                    },
                  },
                })
              }
              onRemove={(extension) =>
                updateSettings({
                  ...settings,
                  categories: {
                    ...settings.categories,
                    software: {
                      ...settings.categories.software,
                      [section.key]: settings.categories.software[section.key].filter(
                        (item) => item !== extension,
                      ),
                    },
                  },
                })
              }
            />
          </View>
        ))}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          title={t("Upload formats")}
          leading={<NativeSymbol ios="square.and.arrow.up" android="share-outline" size={20} />}
        />
        <ExtensionEditor
          extensions={settings.uploadExtensions}
          blocked={["env"]}
          onAdd={(extension) =>
            updateSettings({
              ...settings,
              uploadExtensions: [...settings.uploadExtensions, extension],
            })
          }
          onRemove={(extension) =>
            updateSettings({
              ...settings,
              uploadExtensions: settings.uploadExtensions.filter((item) => item !== extension),
            })
          }
        />
      </SettingsGroup>
      {Platform.OS === "android" ? (
        <SettingsGroup>
          <SettingsRow
            title={t("Save directory")}
            value={downloadDir}
            chevron="right"
            leading={<NativeSymbol ios="folder" android="folder-outline" size={20} />}
            onPress={() => void pickDirectory()}
            dimmed={dirBusy}
          />
        </SettingsGroup>
      ) : null}
      {saveError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {saveError}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const createStyles = () => {
  const tokens = mobileTokens();
  return StyleSheet.create({
    page: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 48,
      gap: 16,
    },
    spinner: {
      marginTop: 32,
    },
    error: {
      color: tokens.destructive,
      fontSize: 15,
      lineHeight: 21,
      textAlign: "center",
    },
    editor: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: native.fill,
      borderRadius: 999,
      paddingVertical: 4,
      paddingLeft: 10,
      paddingRight: 8,
    },
    chipLabel: {
      color: tokens.foreground,
      fontSize: 14,
      lineHeight: 20,
    },
    chipRemove: {
      color: native.secondaryLabel,
      fontSize: 14,
      lineHeight: 20,
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    input: {
      flex: 1,
      minWidth: 0,
      backgroundColor: native.fill,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 15,
      color: tokens.foreground,
    },
    addButton: {
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    addLabel: {
      color: tokens.link,
      fontSize: 15,
    },
  });
};
