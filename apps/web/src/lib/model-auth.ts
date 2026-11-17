import { waitForModelOAuthCompletion } from "@rakazo_mickvvw/core";
import type { RpcClient } from "./rpc";
import { rpc } from "./rpc";

export type {
  ModelCatalogEntry,
  ModelCredential,
  ModelOAuthBegin,
} from "@rakazo_mickvvw/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@rakazo_mickvvw/core";

/** `client` must be the one that began the sign-in: the login belongs to its space. */
export async function waitForModelOAuth(
  loginId: string,
  signal?: AbortSignal,
  client: RpcClient = rpc,
) {
  return waitForModelOAuthCompletion(() => client.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
