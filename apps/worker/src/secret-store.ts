import type { RealtimeFanout, SecretStore } from "@rakazo_mickvvw/adapter-kit";
import { createSecretStore } from "@rakazo_mickvvw/adapters";
import { resolveEncryptionKey } from "@rakazo_mickvvw/core";

/** Worker composition without starting job hosts or database connections. */
export async function createWorkerSecretStore(
  source: NodeJS.ProcessEnv,
  realtime?: RealtimeFanout,
): Promise<SecretStore> {
  const store = createSecretStore(resolveEncryptionKey(source), source, realtime);
  await store.start();
  return store;
}
