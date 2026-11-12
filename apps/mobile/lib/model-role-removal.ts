import type { ModelCredential, ModelRoleChoice } from "@rakazo/contracts";
import { modelRoleChoiceKey } from "@rakazo/contracts";

/**
 * Role rows left after dropping a model removed from its connection. A row
 * goes when it names the removed model on the removed connection: an exact
 * key match, or a row with no connection whose provider resolves to it.
 * The same model on another connection stays, as does every other model.
 */
export function dropRemovedRoleRows(
  rows: readonly ModelRoleChoice[],
  removed: { key: string; modelId: string; credentialId: string },
  connectionFor: (row: ModelRoleChoice) => Pick<ModelCredential, "id"> | undefined,
): ModelRoleChoice[] {
  return rows.filter((row) => {
    if (row.modelId !== removed.modelId) return true;
    if (modelRoleChoiceKey(row) === removed.key) return false;
    if (!row.credentialId && connectionFor(row)?.id === removed.credentialId) return false;
    return true;
  });
}
