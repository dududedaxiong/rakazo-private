import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo_mickvvw/contracts";
import type { ChatModelChoice } from "@rakazo_mickvvw/core";

import { rpc } from "./api";
import type { t as translate } from "./i18n";
import type { MobileModelCredential } from "./mobile-types";
import { saveWithModelRemovalConfirmation } from "./model-connect-confirm";
import { MODEL_CONNECT_TIMEOUT_MS } from "./model-connection-request";

export interface RemovableModel {
  credential: MobileModelCredential;
  /** The connection's model list without this model. */
  remainingModelIds: string[];
  /** The model id the connection should point at after removal. */
  nextModelId: string | undefined;
}

/**
 * Finds the connection backing a picker row and the list that remains after
 * removing it, or null when the row cannot be removed. A row whose model is in
 * a connection's stored enabled list removes from that list. A row that is a
 * connection's own default model, with no stored list, removes by writing the
 * list for the first time: the models the picker shows for that connection
 * minus this one. That first write only works on a third-party connection,
 * the only kind that stores an enabled list. Managed catalog rows and the
 * space default have no connection to remove from, and a connection's last
 * model cannot be removed (an empty list reads as "no explicit list" and the
 * catalog models would come back).
 */
export function removableModel(
  credentials: MobileModelCredential[],
  choice: ChatModelChoice,
  /** Rows currently shown in the picker; only read when the connection has no stored list. */
  choices: readonly ChatModelChoice[] = [],
): RemovableModel | null {
  if (!choice.provider || !choice.providerLabel || !choice.modelId) return null;
  const provider = choice.provider;
  const providerLabel = choice.providerLabel;
  const modelId = choice.modelId;
  const candidates = credentials.filter(
    (item) => item.provider === provider && item.label === providerLabel,
  );
  if (candidates.length === 0) return null;
  // The stored list owns the row when one connection lists it; a shared label
  // must not let another connection's empty list shadow it.
  const listed = candidates.find((item) => item.enabledModelIds?.includes(modelId));
  if (listed) {
    const remainingModelIds = (listed.enabledModelIds ?? []).filter((id) => id !== modelId);
    if (remainingModelIds.length === 0) return null;
    return {
      credential: listed,
      remainingModelIds,
      nextModelId: listed.modelId === modelId ? remainingModelIds[0] : listed.modelId,
    };
  }
  // No stored list: the row is the connection's own default model. It can go
  // only on a third-party connection, the only kind that stores an enabled
  // list — a native provider's save would drop the list and the row would
  // come back — and only when the picker shows another model for the same
  // connection to keep.
  if (provider !== OPENAI_COMPATIBLE_PROVIDER_ID) return null;
  const single = candidates.find((item) => item.modelId === modelId);
  if (!single) return null;
  const remainingModelIds = [
    ...new Set(
      choices.flatMap((item) =>
        item.provider === provider && item.providerLabel === providerLabel && item.modelId
          ? [item.modelId]
          : [],
      ),
    ),
  ].filter((id) => id !== modelId);
  if (remainingModelIds.length === 0) return null;
  return {
    credential: single,
    remainingModelIds,
    nextModelId: remainingModelIds[0],
  };
}

/**
 * Removes a model from its connection by saving the remaining list, the same
 * `models/connect` call the "keep usable models" flow uses. The saved key is
 * inherited, so no key is sent. When the save would drop a model a main pool
 * or a bot still uses, the server asks first and the user confirms in a
 * dialog; declining leaves the row in place.
 */
export async function removeModelFromConnection(
  removable: RemovableModel,
  t: typeof translate,
): Promise<void> {
  await saveWithModelRemovalConfirmation(
    {
      provider: removable.credential.provider,
      credentialId: removable.credential.id,
      ...(removable.credential.baseUrl ? { baseUrl: removable.credential.baseUrl } : {}),
      ...(removable.nextModelId ? { modelId: removable.nextModelId } : {}),
      enabledModelIds: removable.remainingModelIds,
      makeDefault: false,
    },
    (input) => rpc("models/connect", input, { timeoutMs: MODEL_CONNECT_TIMEOUT_MS }),
    t,
  );
}
