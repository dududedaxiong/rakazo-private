import { t } from "@lingui/core/macro";
import type {
  KeyHealthStatus,
  ModelCredential,
  ModelKeyHealth,
  ModelKeyHealthResult,
} from "@rakazo/contracts";
import { toast } from "@rakazo/ui-web";
import type { createSpaceRpc } from "./rpc";

/**
 * Key health, from the list probe: the server calls the provider's model
 * list with the stored key, so a check costs no tokens. `keyHealth` on a
 * connection is the last persisted result; a connection never checked has
 * none.
 */
export type {
  KeyHealthStatus,
  ModelKeyHealth as KeyHealth,
  ModelKeyHealthResult as KeyHealthResult,
};

/** One probe gets five seconds; a slow provider must not stall the page. */
const CHECK_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Checks every given connection, or every connection when none are given.
 * A failed or timed-out check yields no results instead of failing the
 * whole page.
 */
export async function checkKeys(
  rpc: ReturnType<typeof createSpaceRpc>,
  credentialIds?: string[],
): Promise<ModelKeyHealthResult[]> {
  const response = await withTimeout(
    rpc.models.checkKeys(credentialIds ? { credentialIds } : {}),
  ).catch(() => undefined);
  return response?.results ?? [];
}

/** Checks one connection; undefined when the probe fails or times out. */
export async function checkKey(
  rpc: ReturnType<typeof createSpaceRpc>,
  credentialId: string,
): Promise<ModelKeyHealthResult | undefined> {
  return withTimeout(rpc.models.checkKey({ credentialId })).catch(() => undefined);
}

/** The connection id for a provider, or undefined when it has none. */
export async function resolveCredentialIdForProvider(
  rpc: ReturnType<typeof createSpaceRpc>,
  provider: string,
): Promise<string | undefined> {
  try {
    const credentials = await rpc.models.credentials();
    return credentials.find((entry) => entry.provider === provider)?.id;
  } catch {
    return undefined;
  }
}

/** Checks the connection behind a provider; undefined when it cannot be checked. */
export async function checkKeyForProvider(
  rpc: ReturnType<typeof createSpaceRpc>,
  provider: string,
): Promise<KeyHealthStatus | undefined> {
  const credentialId = await resolveCredentialIdForProvider(rpc, provider);
  if (!credentialId) return undefined;
  return (await checkKey(rpc, credentialId))?.status;
}

/** The persisted last check on a connection, when the server sent one. */
export function credentialKeyHealth(credential: ModelCredential): ModelKeyHealth | undefined {
  return credential.keyHealth;
}

/** Reports a key check the way the failure prompt does: one line, no detail. */
export function toastKeyCheckResult(status: KeyHealthStatus | undefined): void {
  if (status === "ok") toast(t`Key works`);
  else if (status === "invalid_key") toast(t`Key is invalid`);
  else if (status === "unreachable") toast(t`Could not reach the provider`);
  else if (status === "timeout") toast(t`Key check timed out`);
  else if (status === "unsupported") toast(t`This connection cannot be checked`);
  else toast(t`Key check is not available`);
}
