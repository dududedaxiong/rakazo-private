import type {
  KeyHealthStatus,
  ModelKeyHealth,
  ModelKeyHealthResult,
} from "@rakazo_mickvvw/contracts";
import { canonicalPiProviderId } from "@rakazo_mickvvw/contracts";
import type { RunErrorTranslator } from "@rakazo_mickvvw/core";
import { rpc } from "./api";
import type { MobileModelCredential } from "./mobile-types";

/**
 * The list-probe health of one supplier key: `models/checkKeys` asks the
 * server to list models with the saved key, which costs no tokens. A
 * connection's persisted health arrives on the credential itself
 * (`keyHealth`) once the server has checked it.
 */
export type { KeyHealthStatus };
export type KeyHealth = ModelKeyHealth;
export type KeyHealthResult = ModelKeyHealthResult;

const KEY_HEALTH_STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "invalid_key",
  "unreachable",
  "timeout",
  "unsupported",
]);

/** One check gets five seconds: past that the caller reports it uncheckable. */
export const KEY_HEALTH_CHECK_TIMEOUT_MS = 5_000;
/** A batch check runs its probes concurrently; the client waits longer. */
export const KEY_HEALTH_CHECK_ALL_TIMEOUT_MS = 30_000;

function parseKeyHealthResult(value: unknown): KeyHealthResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.credentialId !== "string") return null;
  if (typeof record.status !== "string" || !KEY_HEALTH_STATUSES.has(record.status)) return null;
  if (typeof record.checkedAt !== "string" || !Number.isFinite(Date.parse(record.checkedAt)))
    return null;
  return {
    credentialId: record.credentialId,
    status: record.status as KeyHealthStatus,
    checkedAt: record.checkedAt,
    ...(typeof record.modelCount === "number" ? { modelCount: record.modelCount } : {}),
  };
}

/**
 * Checks every visible connection at once. A whole-call failure throws so
 * the caller can say so; one bad key never blocks the rest, it comes back
 * as its own `invalid_key` result.
 */
export async function checkKeys(
  credentialIds: string[],
  callRpc: typeof rpc = rpc,
): Promise<KeyHealthResult[]> {
  if (credentialIds.length === 0) return [];
  const result = await callRpc(
    "models/checkKeys",
    { credentialIds },
    { timeoutMs: KEY_HEALTH_CHECK_ALL_TIMEOUT_MS },
  );
  const results = (result as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new Error("Could not check keys");
  return results
    .map((entry) => parseKeyHealthResult(entry))
    .filter((entry): entry is KeyHealthResult => entry !== null);
}

/** Checks one connection's key with the list probe. */
export async function checkKey(
  credentialId: string,
  callRpc: typeof rpc = rpc,
): Promise<KeyHealthResult> {
  const result = await callRpc(
    "models/checkKey",
    { credentialId },
    { timeoutMs: KEY_HEALTH_CHECK_TIMEOUT_MS },
  );
  const parsed =
    parseKeyHealthResult(result) ??
    parseKeyHealthResult((result as { result?: unknown } | null)?.result);
  if (!parsed) throw new Error("Could not check this key");
  return parsed;
}

/**
 * The saved connection for a provider, then its key check. Null when the
 * provider has no saved connection to test.
 */
export async function checkKeyForProvider(
  provider: string,
): Promise<{ credentialId: string; result: KeyHealthResult } | null> {
  const credentials = await rpc("models/credentials");
  const credential =
    credentials.find((entry) => entry.provider === provider) ??
    credentials.find(
      (entry) => canonicalPiProviderId(entry.provider) === canonicalPiProviderId(provider),
    );
  if (!credential) return null;
  return { credentialId: credential.id, result: await checkKey(credential.id) };
}

/** The persisted health on a credential, when the server has checked it. */
export function keyHealthFromCredential(credential: MobileModelCredential): KeyHealth | undefined {
  return credential.keyHealth;
}

/** One line for a connection row: its status, and when it was last checked. */
export function keyHealthLabel(
  t: RunErrorTranslator,
  health: KeyHealth | undefined,
  locale: string,
): { text: string; invalid: boolean } {
  if (!health) return { text: t("Key not checked"), invalid: false };
  const time = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(health.checkedAt));
  const status =
    health.status === "ok"
      ? t("Key OK")
      : health.status === "invalid_key"
        ? t("Key invalid")
        : health.status === "unreachable"
          ? t("Key unreachable")
          : health.status === "timeout"
            ? t("Key check timed out")
            : t("Key check not supported");
  return { text: `${status} · ${time}`, invalid: health.status === "invalid_key" };
}

/** The plain-language result of one key check. */
export function keyCheckResultText(t: RunErrorTranslator, status: KeyHealthStatus): string {
  switch (status) {
    case "ok":
      return t("This key works.");
    case "invalid_key":
      return t("This key was rejected.");
    case "unreachable":
      return t("Could not reach the provider to check the key.");
    case "timeout":
      return t("Checking the key timed out.");
    case "unsupported":
      return t("This provider can't be checked this way.");
  }
}
