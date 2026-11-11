import type { ChatModelChoice } from "@rakazo/core";

import { rpc } from "./api";
import type { MobileModelCredential } from "./mobile-types";
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
 * removing it, or null when the row cannot be removed. Only rows whose model
 * is in a connection's stored enabled list are removable: managed catalog
 * rows and the space default have no stored list to remove from, and a
 * connection's last model cannot be removed (an empty list reads as "no
 * explicit list" and the catalog models would come back).
 */
export function removableModel(
  credentials: MobileModelCredential[],
  choice: ChatModelChoice,
): RemovableModel | null {
  if (!choice.provider || !choice.providerLabel || !choice.modelId) return null;
  const credential = credentials.find(
    (item) => item.provider === choice.provider && item.label === choice.providerLabel,
  );
  const enabled = credential?.enabledModelIds ?? [];
  if (!credential || !enabled.includes(choice.modelId)) return null;
  const remainingModelIds = enabled.filter((id) => id !== choice.modelId);
  if (remainingModelIds.length === 0) return null;
  return {
    credential,
    remainingModelIds,
    nextModelId: credential.modelId === choice.modelId ? remainingModelIds[0] : credential.modelId,
  };
}

/**
 * Removes a model from its connection by saving the remaining list, the same
 * `models/connect` call the "keep usable models" flow uses. The saved key is
 * inherited, so no key is sent.
 */
export async function removeModelFromConnection(removable: RemovableModel): Promise<void> {
  await rpc(
    "models/connect",
    {
      provider: removable.credential.provider,
      credentialId: removable.credential.id,
      ...(removable.credential.baseUrl ? { baseUrl: removable.credential.baseUrl } : {}),
      ...(removable.nextModelId ? { modelId: removable.nextModelId } : {}),
      enabledModelIds: removable.remainingModelIds,
      makeDefault: false,
    },
    { timeoutMs: MODEL_CONNECT_TIMEOUT_MS },
  );
}
