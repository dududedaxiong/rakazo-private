import type { MenuAction } from "@expo/ui/community/menu";
import type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import {
  canonicalPiProviderId,
  connectionDisplayName,
  MAX_MODEL_CONNECTION_LABEL,
} from "@rakazo/contracts";
import { Alert, Platform } from "react-native";
import { useI18n } from "../lib/i18n";
import type { KeyHealth } from "../lib/key-health";
import { keyHealthFromCredential, keyHealthLabel } from "../lib/key-health";
import { useMobileTokens } from "../lib/native";
import { RowMenu } from "./model-role-settings";
import { SettingsGroup, SettingsRow } from "./settings-group";

/** Every connection the account has, with the actions that act on one of them. */
export function ModelProviders({
  catalog,
  credentials,
  keyHealth,
  checkingKeys = false,
  onCheckAllKeys,
  onManage,
  onAdd,
  onRename,
  onDisconnect,
}: {
  catalog: ModelCatalogEntry[];
  credentials: ModelCredential[];
  /** Fresh check results for this visit; a row without one falls back to its persisted health. */
  keyHealth?: Map<string, KeyHealth>;
  /** A whole-list check is running; the check-all row reads busy meanwhile. */
  checkingKeys?: boolean;
  /** Re-checks every connection with the list probe. */
  onCheckAllKeys?: () => void;
  onManage: (credential: ModelCredential) => void;
  onAdd: () => void;
  onRename: (credential: ModelCredential, label: string) => void;
  onDisconnect: (credential: ModelCredential) => void;
}) {
  const { t, locale } = useI18n();
  const tokens = useMobileTokens();
  const providerName = (credential: ModelCredential) =>
    catalog.find(
      (entry) =>
        canonicalPiProviderId(entry.provider) === canonicalPiProviderId(credential.provider),
    )?.providerName ?? credential.provider;
  const rows = credentials
    .map((credential) => {
      const provider = providerName(credential);
      const name = connectionDisplayName(credential, provider);
      const health = keyHealth?.get(credential.id) ?? keyHealthFromCredential(credential);
      // Every row names its key state: a fresh check, the last stored one,
      // or that no check has run yet.
      const healthLine = keyHealthLabel(t, health, locale);
      const baseDetail = credential.reconnectRequired
        ? t("Sign in again")
        : name.startsWith(provider)
          ? undefined
          : provider;
      return {
        credential,
        name,
        detail: baseDetail ? `${baseDetail} · ${healthLine.text}` : healthLine.text,
        invalidKey: healthLine.invalid,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  function act(credential: ModelCredential, name: string, id: string) {
    if (id === "manage") onManage(credential);
    else if (id === "rename")
      // Alert.prompt, which renames, exists only on iOS.
      Alert.prompt(
        t("Rename"),
        undefined,
        [
          { text: t("Cancel"), style: "cancel" },
          {
            text: t("Save"),
            onPress: (value?: string) => {
              const label = value?.trim().slice(0, MAX_MODEL_CONNECTION_LABEL);
              if (label && label !== credential.label) onRename(credential, label);
            },
          },
        ],
        "plain-text",
        credential.label,
      );
    else if (id === "disconnect")
      Alert.alert(
        t("Disconnect {name}?", { name }),
        t("This removes the connection from every space."),
        [
          { text: t("Cancel"), style: "cancel" },
          { text: t("Disconnect"), style: "destructive", onPress: () => onDisconnect(credential) },
        ],
      );
  }

  return (
    <SettingsGroup accessibilityLabel={t("Providers")} label={t("Providers")}>
      {rows.map(({ credential, name, detail, invalidKey }) => {
        const actions: MenuAction[] = [
          ...(Platform.OS === "ios" ? [{ id: "rename", title: t("Rename") }] : []),
          {
            id: "manage",
            title: credential.authKind === "oauth" ? t("Sign in again") : t("Replace API key"),
          },
          { id: "disconnect", title: t("Disconnect"), attributes: { destructive: true } },
        ];
        return (
          <RowMenu
            key={credential.id}
            title={name}
            actions={actions}
            onAction={(id) => act(credential, name, id)}
          >
            <SettingsRow
              accessibilityRole="button"
              title={name}
              detail={detail}
              detailColor={invalidKey ? tokens.destructive : undefined}
              chevron="right"
              onPress={() => onManage(credential)}
              accessibilityActions={actions.map((action) => ({
                name: action.id ?? action.title,
                label: action.title,
              }))}
              onAccessibilityAction={({ nativeEvent }) =>
                act(credential, name, nativeEvent.actionName)
              }
            />
          </RowMenu>
        );
      })}
      <SettingsRow key="add" title={t("Add provider")} onPress={onAdd} />
      {onCheckAllKeys ? (
        <SettingsRow
          key="check-all"
          title={checkingKeys ? t("Checking keys…") : t("Check all keys")}
          onPress={onCheckAllKeys}
          disabled={checkingKeys}
        />
      ) : null}
    </SettingsGroup>
  );
}
