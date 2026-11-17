import type { MessageFavorite } from "@rakazo_mickvvw/contracts";
import {
  favoriteMessageId as contractFavoriteMessageId,
  favoriteSnippet,
  isTranslationFavorite,
  translationFavoriteId,
} from "@rakazo_mickvvw/contracts";
import { useSyncExternalStore } from "react";
import { rpc } from "./api";
import { onConversationCleared } from "./conversation-cleared";

export { favoriteSnippet, isTranslationFavorite, translationFavoriteId };

const THREAD_FAVORITES_KEY = "rakazo.thread-favorites";
/** Set once the local cache has been merged onto the server. */
const MIGRATION_KEY = "rakazo.thread-favorites-migrated";
/** Thread keys the server does not know as bots, kept across launches. */
const LOCAL_ONLY_KEY = "rakazo.thread-favorites-local-only";
/** Thread keys the server does not know as bots (group threads): favorites for these stay local only. */
const localOnlyKeys = new Set<string>();

/** An oRPC NOT_FOUND: the server has no such bot, so the key is not a bot thread. */
function isNotFoundError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "NOT_FOUND";
}

export type ThreadFavorite = {
  messageId: string;
  /** The reply's first line or so, shown in the favorites list. */
  snippet: string;
  /** The reply's full text, for in-place translation; older favorites lack it. */
  text?: string;
  createdAt: number;
};

type FavoritesMap = Record<string, ThreadFavorite[]>;
const EMPTY: ThreadFavorite[] = [];
let favorites: FavoritesMap = {};
let localLoaded = false;
let localLoading: Promise<void> | null = null;
/** Bots whose list the server has confirmed, so a later mount skips the fetch. */
const loadedBots = new Set<string>();
const loadingBots = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let clearingSubscribed = false;
let migrationRun: Promise<boolean> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function isFavoriteItem(value: unknown): value is ThreadFavorite {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.messageId === "string" &&
    typeof item.snippet === "string" &&
    typeof item.createdAt === "number" &&
    (item.text === undefined || typeof item.text === "string")
  );
}

/** The server's ISO timestamp as the local millisecond timestamp. */
function fromServer(item: MessageFavorite): ThreadFavorite {
  const createdAt = Date.parse(item.createdAt);
  return {
    messageId: item.messageId,
    snippet: item.snippet,
    ...(item.text !== null ? { text: item.text } : {}),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

async function loadLocalFavorites(): Promise<void> {
  if (localLoaded) return;
  if (!localLoading) {
    localLoading = (async () => {
      try {
        // Deferred so importing this module never pulls the native store into tests.
        const SecureStore = await import("expo-secure-store");
        const stored = JSON.parse(
          (await SecureStore.getItemAsync(THREAD_FAVORITES_KEY)) ?? "null",
        ) as FavoritesMap | null;
        if (stored && typeof stored === "object") {
          for (const [key, list] of Object.entries(stored)) {
            if (Array.isArray(list)) favorites[key] = list.filter(isFavoriteItem);
          }
        }
        const localOnly = JSON.parse((await SecureStore.getItemAsync(LOCAL_ONLY_KEY)) ?? "null") as
          | string[]
          | null;
        if (Array.isArray(localOnly)) {
          for (const key of localOnly) {
            if (typeof key === "string") localOnlyKeys.add(key);
          }
        }
      } catch {
        // Unreadable storage keeps every thread's favorites empty, the default.
      }
      localLoaded = true;
      notify();
    })();
  }
  await localLoading;
}

let saving: Promise<void> = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(favorites);
  saving = saving
    .then(async () => {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.setItemAsync(THREAD_FAVORITES_KEY, snapshot);
    })
    .catch(() => undefined);
}

/** Records a thread key as local-only, so a later launch still knows the server has no such bot. */
function persistLocalOnly() {
  const snapshot = JSON.stringify([...localOnlyKeys]);
  saving = saving
    .then(async () => {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.setItemAsync(LOCAL_ONLY_KEY, snapshot);
    })
    .catch(() => undefined);
}

/**
 * Merges every locally cached favorite onto the server, once. A bot the
 * migration synced already holds the server's merged list, so its later
 * load skips the list fetch. A key the server does not know as a bot (a
 * group thread) keeps its favorites local only and never blocks the rest:
 * the merge skips it and still sets the flag. A failed merge leaves the
 * flag unset, so the next launch retries it; merging twice is safe, the
 * server upserts. Returns whether the migration is done (flag set or merge
 * succeeded).
 */
async function migrateLocalFavorites(): Promise<boolean> {
  migrationRun ??= (async () => {
    try {
      const SecureStore = await import("expo-secure-store");
      if (await SecureStore.getItemAsync(MIGRATION_KEY)) return true;
      const botIds = Object.keys(favorites).filter((botId) => (favorites[botId] ?? []).length > 0);
      for (const botId of botIds) {
        const local = favorites[botId] ?? [];
        let merged: MessageFavorite[];
        try {
          merged = await rpc("favorites/sync", {
            botId,
            favorites: local.map((item) => ({
              messageId: item.messageId,
              // The merge schema requires a non-empty snippet; a favorite
              // whose text was blank still keeps its message id.
              snippet: item.snippet ? item.snippet.slice(0, 200) : item.messageId,
              ...(item.text !== undefined ? { text: item.text } : {}),
            })),
          });
        } catch (error) {
          if (isNotFoundError(error)) {
            localOnlyKeys.add(botId);
            persistLocalOnly();
            continue;
          }
          throw error;
        }
        favorites = { ...favorites, [botId]: merged.map(fromServer) };
        loadedBots.add(botId);
        notify();
        persist();
      }
      await SecureStore.setItemAsync(MIGRATION_KEY, "1");
      return true;
    } catch {
      // Offline or a refusing server: the local cache stays, and the next
      // launch retries the merge instead of dropping anything.
      migrationRun = null;
      return false;
    }
  })();
  return migrationRun;
}

/**
 * Loads one bot's favorites from the server, which is the source of truth:
 * the returned list replaces the local cache. While the server cannot be
 * reached the local cache stays visible as a read-only fallback, and the
 * next mount retries the fetch.
 */
async function loadFavorites(botId: string): Promise<void> {
  if (!botId || loadedBots.has(botId)) return;
  await loadLocalFavorites();
  if (loadedBots.has(botId)) return;
  const inFlight = loadingBots.get(botId);
  if (inFlight) return inFlight;
  const run = (async () => {
    const migrated = await migrateLocalFavorites();
    if (loadedBots.has(botId)) return;
    // A key the server does not know as a bot keeps its local favorites;
    // the server list for it is always empty and would wipe them.
    if (localOnlyKeys.has(botId)) return;
    // Until the local favorites are merged, the server list does not hold
    // them yet; replacing the cache with it would drop unmigrated items.
    if (!migrated && (favorites[botId] ?? []).length > 0) return;
    // An optimistic toggle or removal that landed while loading wins over
    // this snapshot; its own server call brings the server up to date.
    const before = favorites[botId];
    let serverList: MessageFavorite[];
    try {
      serverList = await rpc("favorites/list", { botId });
    } catch (error) {
      // The server has no such bot, so this key is not a bot thread: its
      // favorites stay local only, and the empty list must not wipe them.
      if (isNotFoundError(error)) {
        localOnlyKeys.add(botId);
        persistLocalOnly();
        return;
      }
      throw error;
    }
    if (favorites[botId] !== before) return;
    favorites = { ...favorites, [botId]: serverList.map(fromServer) };
    loadedBots.add(botId);
    notify();
    persist();
  })().catch(() => undefined);
  loadingBots.set(botId, run);
  try {
    await run;
  } finally {
    if (loadingBots.get(botId) === run) loadingBots.delete(botId);
  }
}

/** The message a favorite belongs to, whether it saves the reply or its translation. */
export function favoriteMessageId(favorite: ThreadFavorite): string {
  return contractFavoriteMessageId(favorite.messageId);
}

/** This thread's favorites, newest first. */
export function threadFavoritesFor(threadKey: string | undefined): ThreadFavorite[] {
  if (!threadKey) return EMPTY;
  return favorites[threadKey] ?? EMPTY;
}

export function useThreadFavorites(threadKey: string | undefined): ThreadFavorite[] {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (threadKey) void loadFavorites(threadKey);
      if (!clearingSubscribed) {
        clearingSubscribed = true;
        // A cleared conversation's favorites point at messages that no longer exist.
        onConversationCleared((botId) => {
          const cleared = favorites[botId];
          if (!cleared) return;
          favorites = { ...favorites };
          delete favorites[botId];
          loadedBots.delete(botId);
          notify();
          persist();
          // Best effort and unblocking: a removal the server misses is
          // picked up again by the next load, which trusts the server.
          // A local-only thread never touches the server at all.
          void (async () => {
            if (localOnlyKeys.has(botId)) return;
            for (const item of cleared) {
              try {
                await rpc("favorites/remove", { botId, messageId: item.messageId });
              } catch {
                // The local list is already cleared; nothing left to roll back to.
              }
            }
          })();
        });
      }
      return () => {
        listeners.delete(listener);
      };
    },
    () => threadFavoritesFor(threadKey),
  );
  return threadFavoritesFor(threadKey);
}

export function isThreadFavorite(threadKey: string, messageId: string): boolean {
  return (favorites[threadKey] ?? []).some((item) => item.messageId === messageId);
}

/**
 * Toggles a favorite; returns true when the message is now favorited. The list
 * stores the snippet at favorite time, so the sheet works even after the
 * message has scrolled out of the loaded window. The change applies
 * immediately and is sent to the server behind it; a failed send rolls the
 * list back, so the phone never shows a favorite the server does not have.
 */
export function toggleThreadFavorite(threadKey: string, favorite: ThreadFavorite): boolean {
  const list = favorites[threadKey] ?? [];
  const at = list.findIndex((item) => item.messageId === favorite.messageId);
  const adding = at < 0;
  // A failed removal rolls back to the stored item, not the caller's copy,
  // so the full text the favorite already held is not lost.
  const existing = at >= 0 ? (list[at] as ThreadFavorite) : undefined;
  const next = adding
    ? [{ ...favorite }, ...list]
    : list.filter((item) => item.messageId !== favorite.messageId);
  favorites = { ...favorites, [threadKey]: next };
  notify();
  persist();
  void (async () => {
    try {
      if (adding) {
        await rpc("favorites/add", {
          botId: threadKey,
          messageId: favorite.messageId,
          snippet: favorite.snippet.slice(0, 200),
          ...(favorite.text !== undefined ? { text: favorite.text } : {}),
        });
      } else {
        await rpc("favorites/remove", { botId: threadKey, messageId: favorite.messageId });
      }
    } catch (error) {
      // A key the server does not know as a bot keeps its favorites local
      // only; the optimistic change stands and is never rolled back.
      if (isNotFoundError(error)) {
        localOnlyKeys.add(threadKey);
        persistLocalOnly();
        return;
      }
      const current = favorites[threadKey] ?? [];
      if (adding) {
        if (!current.some((item) => item.messageId === favorite.messageId)) return;
        favorites = {
          ...favorites,
          [threadKey]: current.filter((item) => item.messageId !== favorite.messageId),
        };
      } else {
        if (current.some((item) => item.messageId === favorite.messageId)) return;
        const restored = [...current];
        restored.splice(Math.min(at, restored.length), 0, { ...(existing ?? favorite) });
        favorites = { ...favorites, [threadKey]: restored };
      }
      notify();
      persist();
    }
  })();
  return adding;
}

export function removeThreadFavorite(threadKey: string, messageId: string): void {
  const list = favorites[threadKey];
  const at = list?.findIndex((item) => item.messageId === messageId) ?? -1;
  if (at < 0 || !list) return;
  const removed = list[at] as ThreadFavorite;
  favorites = {
    ...favorites,
    [threadKey]: list.filter((item) => item.messageId !== messageId),
  };
  notify();
  persist();
  void (async () => {
    try {
      await rpc("favorites/remove", { botId: threadKey, messageId });
    } catch (error) {
      // A key the server does not know as a bot keeps its favorites local
      // only; the optimistic removal stands and is never rolled back.
      if (isNotFoundError(error)) {
        localOnlyKeys.add(threadKey);
        persistLocalOnly();
        return;
      }
      const current = favorites[threadKey] ?? [];
      if (current.some((item) => item.messageId === messageId)) return;
      const restored = [...current];
      restored.splice(Math.min(at, restored.length), 0, removed);
      favorites = { ...favorites, [threadKey]: restored };
      notify();
      persist();
    }
  })();
}
