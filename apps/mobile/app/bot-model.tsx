import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ModelPickerList } from "../components/model-picker-list";
import { rpc } from "../lib/api";
import { chatModelPickerChoices } from "../lib/chat-model";
import { useI18n } from "../lib/i18n";
import type { MobileModelCredential } from "../lib/mobile-types";
import { removableModel, removeModelFromConnection } from "../lib/model-removal";
import { errorText } from "../lib/user-error";

export default function BotModelScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { botId, value = "" } = useLocalSearchParams<{ botId: string; value?: string }>();
  const [choices, setChoices] = useState<ChatModelChoice[] | null>(null);
  const [credentials, setCredentials] = useState<MobileModelCredential[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reloadChoices() {
    try {
      const [me, catalog, nextCredentials] = await Promise.all([
        rpc("me"),
        rpc("models/list"),
        rpc("models/credentials"),
      ]);
      setCredentials(nextCredentials);
      setChoices(chatModelPickerChoices(me, catalog, nextCredentials, value, t));
    } catch (err) {
      setError(errorText(err, t("Could not load model settings")));
    }
  }

  useEffect(() => {
    void reloadChoices();
  }, [t, value]);

  /** Removes a swiped model from its connection; the row drops at once and the reload confirms it. */
  async function removeChoice(choice: ChatModelChoice) {
    const target = removableModel(credentials ?? [], choice, choices ?? []);
    if (!target || saving) return;
    setSaving(true);
    setError(null);
    setChoices((prev) => prev?.filter((item) => item.key !== choice.key) ?? null);
    try {
      await removeModelFromConnection(target, t);
      if (choice.key === value) {
        await rpc("bots/update", { botId, modelProvider: null, modelId: null });
      }
      await reloadChoices();
    } catch (err) {
      setError(errorText(err, t("Could not remove this model")));
      await reloadChoices();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModelPickerList
      choices={choices}
      selectedKey={value}
      error={error}
      onSelect={(item) =>
        router.dismissTo({ pathname: "/bot-settings", params: { botId, model: item.key } })
      }
      isRemovable={(choice) => removableModel(credentials ?? [], choice, choices ?? []) !== null}
      onRemove={(choice) => void removeChoice(choice)}
    />
  );
}
