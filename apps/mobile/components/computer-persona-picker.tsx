import type { RpcInput, RpcPath, SettingsScope } from "@rakazo_mickvvw/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { StyleSheet, Text } from "react-native";
import type { RpcArgs } from "../lib/api";
import { captureApiRequestContext, rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { usePromptTemplates } from "../lib/prompt-templates";
import { queryClient, rpcQuery } from "../lib/query";
import { errorText } from "../lib/user-error";
import { MenuPicker } from "./menu-picker";
import { SettingsGroup, SettingsRow } from "./settings-group";

/** The prompt template the computer-use model answers as, or none. */
export function ComputerPersonaPicker({
  userId,
  spaceId,
  scope,
}: {
  userId: string;
  /** The Space the calls go to; a Space scope edits its override. */
  spaceId: string;
  scope: SettingsScope;
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const { send } = useMemo(() => {
    const requestContext = captureApiRequestContext(spaceId);
    const send = async <P extends RpcPath>(proc: P, input: RpcInput<P>) =>
      rpc(proc, ...([input, { requestContext: await requestContext }] as RpcArgs<P>));
    return { send };
  }, [spaceId]);
  const personaQuery = useQuery(
    { ...rpcQuery("models/computerPersona", { expectedUserId: userId, scope }, spaceId) },
    queryClient,
  );
  const templatesQuery = usePromptTemplates();
  const persona = personaQuery.data ?? null;
  const templates = templatesQuery.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(promptTemplateId: string | null) {
    if (saving || promptTemplateId === persona?.promptTemplateId) return;
    setSaving(true);
    setError(null);
    try {
      await send("models/setComputerPersona", {
        promptTemplateId,
        expectedUserId: userId,
        scope,
      });
      await personaQuery.refetch();
    } catch (err) {
      setError(errorText(err, t("Could not update computer persona")));
    } finally {
      setSaving(false);
    }
  }

  if (!persona && !personaQuery.isError) return null;
  return (
    <SettingsGroup accessibilityLabel={t("Computer persona")} label={t("Computer persona")}>
      <MenuPicker
        label={t("Computer persona")}
        choices={[
          { key: "", label: t("None") },
          ...templates.map((template) => ({ key: template.id, label: template.name })),
        ]}
        value={persona?.promptTemplateId ?? ""}
        onChange={(key) => void save(key === "" ? null : key)}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {personaQuery.isError ? (
        <SettingsRow
          title={t("Retry")}
          disabled={personaQuery.isFetching}
          onPress={() => void personaQuery.refetch()}
        />
      ) : null}
    </SettingsGroup>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    error: {
      color: tokens.destructive,
      fontSize: 15,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
  });
}
