import type { ModelConnectInput } from "@rakazo_mickvvw/contracts";
import { isModelRemovalConflict } from "@rakazo_mickvvw/core";
import { Alert } from "react-native";

import type { t as translate } from "./i18n";

function confirmModelRemoval(message: string, t: typeof translate): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Alert.alert(
      t("Save"),
      message,
      [
        { text: t("Cancel"), style: "cancel", onPress: () => settle(false) },
        { text: t("Save"), onPress: () => settle(true) },
      ],
      { cancelable: true, onDismiss: () => settle(false) },
    );
  });
}

/**
 * Saves a model connection, asking before dropping a model the save would
 * remove from a main pool or a bot. The server answers the first save with a
 * conflict naming the occupancies; confirming retries the same save with
 * `confirmRemovePins`. Backup-pool rows are dropped silently by the server
 * and never prompt. Declining rethrows the conflict, and any other failure
 * passes through untouched.
 */
export async function saveWithModelRemovalConfirmation<T>(
  input: ModelConnectInput,
  save: (input: ModelConnectInput) => Promise<T>,
  t: typeof translate,
): Promise<T> {
  try {
    return await save(input);
  } catch (error) {
    if (!isModelRemovalConflict(error) || !(error instanceof Error)) throw error;
    const confirmed = await confirmModelRemoval(error.message, t);
    if (!confirmed) throw error;
    return save({ ...input, confirmRemovePins: true });
  }
}
