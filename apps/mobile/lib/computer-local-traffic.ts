import { useSyncExternalStore } from "react";

/**
 * The "走本地流量" (local traffic) preference for the computer screen.
 *
 * When on, the bot's browser/web requests should run on this phone, over the
 * user's own local network, instead of the server's datacenter IP — the same
 * way a device browser passes checks the server browser cannot. The routing
 * itself does not exist yet (it needs a server-to-client task channel, a
 * WebView runner and presence tracking); this store only records the user's
 * choice and the floating toggle's position, so the preference is ready when
 * the backend lands. Tapping the toggle must never claim the routing is live.
 *
 * One preference for the whole app, not per bot: it is about this phone's
 * network, not about a single bot. The position is shared by every screen
 * surface too — the small window and the full-screen view show the same
 * floating button, so it keeps one place wherever the user watches.
 *
 * Storage follows apps/mobile/lib/computer-float-settings.ts: a JSON blob in
 * expo-secure-store, loaded lazily, with an in-memory copy that updates
 * synchronously so the toggle reflects the tap immediately. The snapshot the
 * hook reads is a stable reference that only changes on update, as
 * useSyncExternalStore requires.
 */
const LOCAL_TRAFFIC_STORAGE_KEY = "rakazo.computer-local-traffic";

export type LocalTrafficSettings = {
  enabled: boolean;
  /** Fraction of the screen width, 0..1 (0 = left edge, 1 = right edge). */
  x: number;
  /** Fraction of the screen height, 0..1 (0 = top edge, 1 = bottom edge). */
  y: number;
};

const DEFAULT_SETTINGS: LocalTrafficSettings = {
  enabled: false,
  x: 0.86,
  y: 0.12,
};

let snapshot: LocalTrafficSettings = { ...DEFAULT_SETTINGS };
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

function clampFraction(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function parseStored(raw: string | null): LocalTrafficSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalTrafficSettings>;
    return {
      enabled: parsed.enabled === true,
      x: clampFraction(parsed.x ?? DEFAULT_SETTINGS.x),
      y: clampFraction(parsed.y ?? DEFAULT_SETTINGS.y),
    };
  } catch {
    return null;
  }
}

async function loadSettings(): Promise<void> {
  if (loaded) return;
  if (!loading) {
    loading = (async () => {
      try {
        const { default: SecureStore } = await import("expo-secure-store");
        const stored = parseStored(await SecureStore.getItemAsync(LOCAL_TRAFFIC_STORAGE_KEY));
        if (stored) snapshot = stored;
      } catch {
        // SecureStore is unavailable (tests, web): keep the in-memory defaults.
      }
      loaded = true;
    })();
  }
  await loading;
}

let saving: Promise<void> = Promise.resolve();

function save(): void {
  const stored = { ...snapshot };
  saving = saving
    .then(async () => {
      const { default: SecureStore } = await import("expo-secure-store");
      await SecureStore.setItemAsync(LOCAL_TRAFFIC_STORAGE_KEY, JSON.stringify(stored));
    })
    .catch(() => undefined);
}

function update(next: LocalTrafficSettings): void {
  snapshot = next;
  notify();
  save();
}

export function localTrafficSettings(): LocalTrafficSettings {
  return { ...snapshot };
}

export function localTrafficEnabled(): boolean {
  return snapshot.enabled;
}

export function setLocalTrafficEnabled(enabled: boolean): void {
  if (snapshot.enabled === enabled) return;
  update({ ...snapshot, enabled });
}

export function setLocalTrafficPosition(x: number, y: number): void {
  const next = { ...snapshot, x: clampFraction(x), y: clampFraction(y) };
  if (next.x === snapshot.x && next.y === snapshot.y) return;
  update(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void loadSettings().then(() => {
    if (loaded) notify();
  });
  return () => {
    listeners.delete(listener);
  };
}

/** Lets non-React owners (the client task runner) follow preference changes. */
export function subscribeLocalTraffic(listener: () => void): () => void {
  return subscribe(listener);
}

function getSnapshot(): LocalTrafficSettings {
  return snapshot;
}

export function useLocalTraffic(): LocalTrafficSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
