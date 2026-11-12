import type { ChatModelChoice } from "@rakazo/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useLayoutEffect, useState } from "react";
import { ModelPickerList } from "../../components/model-picker-list";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { MobileModelCredential } from "../../lib/mobile-types";
import { modelPickerRequest, selectPickerModel } from "../../lib/model-picker-selection";
import { removableModel, removeModelFromConnection } from "../../lib/model-removal";
import { errorText } from "../../lib/user-error";

export default function SettingsModelPickerScreen() {
  const { requestId = "" } = useLocalSearchParams<{ requestId?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useI18n();
  const [request] = useState(() => modelPickerRequest(requestId));
  const title = request?.title ?? t("Model");
  // The request is a snapshot: rows removed here drop out locally, and the
  // credentials refresh after a save so a second removal in this picker
  // still sees the saved list.
  const [credentials, setCredentials] = useState<MobileModelCredential[] | null>(
    () => request?.credentials ?? null,
  );
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);
  const shownChoices = (request?.choices ?? []).filter((choice) => !removedKeys.has(choice.key));

  /** Removes a swiped model from its connection; the row drops at once. */
  async function removeChoice(choice: ChatModelChoice) {
    const target = removableModel(credentials ?? [], choice, shownChoices);
    if (!target || saving) return;
    setSaving(true);
    setRemoveError(null);
    setRemovedKeys((prev) => new Set(prev).add(choice.key));
    try {
      await removeModelFromConnection(target);
    } catch (err) {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(choice.key);
        return next;
      });
      setRemoveError(errorText(err, t("Could not remove this model")));
      return;
    } finally {
      setSaving(false);
    }
    // The connection save landed; the caller still names the model
    // (e.g. a role list), so it cleans that reference up too.
    try {
      await request?.onRemoved?.(choice, target.credential.id);
    } catch (err) {
      setRemoveError(errorText(err, t("Could not remove this model")));
    }
    setCredentials(await rpc("models/credentials").catch(() => credentials ?? []));
  }

  return (
    <ModelPickerList
      choices={shownChoices}
      connectChoices={request?.connectChoices}
      selectedKey={request?.selectedKey ?? ""}
      providerLabel={request?.providerLabel}
      emptyMessage={request?.emptyMessage}
      error={removeError ?? (request ? null : t("Could not load model settings"))}
      onSelect={(choice) => {
        const next = selectPickerModel(requestId, choice.key);
        if (next === true) router.back();
        else if (next) router.replace(next);
      }}
      isRemovable={(choice) => removableModel(credentials ?? [], choice, shownChoices) !== null}
      onRemove={(choice) => void removeChoice(choice)}
    />
  );
}
