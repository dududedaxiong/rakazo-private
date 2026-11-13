/**
 * A model's last known health, cached in localStorage so a picker can show
 * it without probing again. Populated by the existing test chain: the
 * media-model test in bot settings, and a translation's own outcome.
 * A probe that takes over this long counts as slow.
 */
export const MODEL_SLOW_SECONDS = 30;

export type ModelHealthState = "ok" | "slow" | "unavailable";

export type CachedModelStatus = {
  state: ModelHealthState;
  /** Seconds the probe took; null when the outcome carries no timing. */
  seconds: number | null;
  /** Unix milliseconds the probe ran. */
  checkedAt: number;
};

const STORAGE_KEY = "rakazo.modelStatus.v1";

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readCache(storage: Pick<Storage, "getItem"> | null): Record<string, CachedModelStatus> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, CachedModelStatus>;
  } catch {
    return {};
  }
}

/** The last known status for a model key (`provider::model`), if one was ever probed. */
export function readModelStatus(
  modelKey: string,
  storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): CachedModelStatus | null {
  return readCache(storage)[modelKey] ?? null;
}

/** Records a probe outcome for a model key. */
export function recordModelStatus(
  modelKey: string,
  status: Omit<CachedModelStatus, "checkedAt">,
  storage: Pick<Storage, "getItem" | "setItem"> | null = getLocalStorage(),
): void {
  if (!storage || !modelKey) return;
  try {
    const cache = readCache(storage);
    cache[modelKey] = { ...status, checkedAt: Date.now() };
    storage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // A full or unavailable store leaves the in-memory run without a record.
  }
}

/** Maps a probe outcome to a status: unsupported is unavailable, slow is over the threshold. */
export function modelStatusFromProbe({
  supported,
  seconds,
}: {
  supported: boolean;
  seconds: number;
}): { state: ModelHealthState; seconds: number } {
  if (!supported) return { state: "unavailable", seconds };
  return { state: seconds > MODEL_SLOW_SECONDS ? "slow" : "ok", seconds };
}
