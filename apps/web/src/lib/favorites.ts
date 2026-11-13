import type { MessageFavorite } from "@rakazo/contracts";
import {
  favoriteMessageId,
  favoriteSnippet,
  isTranslationFavorite,
  translationFavoriteId,
} from "@rakazo/contracts";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { createSpaceRpc } from "./rpc";

export type { MessageFavorite };
export { favoriteMessageId, favoriteSnippet, isTranslationFavorite, translationFavoriteId };

export type FavoritesRpc = ReturnType<typeof createSpaceRpc>;

/** The space's saved messages, newest first; pass a bot to scope them to one thread. */
export async function listFavorites(
  rpc: FavoritesRpc,
  input: { botId?: string } = {},
): Promise<MessageFavorite[]> {
  return rpc.favorites.list(input);
}

/** Saves one message (or its translation) as a favorite. */
export async function addFavorite(
  rpc: FavoritesRpc,
  input: { botId: string; messageId: string; snippet: string; text?: string },
): Promise<MessageFavorite> {
  return rpc.favorites.add(input);
}

/** Drops one favorite; removing one that is not saved is a no-op. */
export async function removeFavorite(
  rpc: FavoritesRpc,
  input: { botId: string; messageId: string },
): Promise<{ ok: true }> {
  return rpc.favorites.remove(input);
}

// One fetch per bot (or one for the whole space) shared by every message row,
// the translation panel, and the favorites list, so toggling in one place
// shows in the others without another round trip.
type CacheEntry = {
  items: MessageFavorite[] | null;
  loading: Promise<MessageFavorite[]> | null;
  error: unknown;
};
const ALL_KEY = "";
const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function entryFor(key: string): CacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { items: null, loading: null, error: null };
    cache.set(key, entry);
  }
  return entry;
}

/** Forgets every cached list, so the next read fetches again. Tests only. */
export function resetFavoritesCache(): void {
  cache.clear();
  notify();
}

/**
 * Loads a bot's favorites (or the whole space's when no bot is given),
 * sharing one in-flight request across every reader.
 */
export function loadFavorites(rpc: FavoritesRpc, botId?: string): Promise<MessageFavorite[]> {
  const entry = entryFor(botId ?? ALL_KEY);
  if (entry.items) return Promise.resolve(entry.items);
  entry.loading ??= listFavorites(rpc, botId ? { botId } : {})
    .then((items) => {
      entry.items = items;
      entry.loading = null;
      entry.error = null;
      notify();
      return items;
    })
    .catch((error: unknown) => {
      entry.loading = null;
      entry.error = error;
      notify();
      throw error;
    });
  return entry.loading;
}

function updateCaches(
  botId: string,
  update: (items: MessageFavorite[]) => MessageFavorite[],
): void {
  for (const [key, entry] of cache) {
    if (entry.items && (key === ALL_KEY || key === botId)) entry.items = update(entry.items);
  }
  notify();
}

function snapshotCaches(botId: string): Map<string, MessageFavorite[] | null> {
  const snapshot = new Map<string, MessageFavorite[] | null>();
  for (const [key, entry] of cache) {
    if (key === ALL_KEY || key === botId) snapshot.set(key, entry.items);
  }
  return snapshot;
}

function restoreCaches(snapshot: Map<string, MessageFavorite[] | null>): void {
  for (const [key, items] of snapshot) {
    const entry = cache.get(key);
    if (entry) entry.items = items;
  }
  notify();
}

const inFlight = new Set<string>();

/**
 * Toggles one favorite, updating the shared lists first and rolling back when
 * the server call fails. Returns whether the message is favorited now.
 */
export async function toggleFavorite(
  rpc: FavoritesRpc,
  input: { botId: string; messageId: string; snippet: string; text?: string },
): Promise<boolean> {
  const key = `${input.botId}:${input.messageId}`;
  if (inFlight.has(key)) return isCachedFavorite(input.botId, input.messageId);
  const favorited = isCachedFavorite(input.botId, input.messageId);
  const snapshot = snapshotCaches(input.botId);
  inFlight.add(key);
  try {
    if (favorited) {
      updateCaches(input.botId, (items) =>
        items.filter((item) => item.messageId !== input.messageId),
      );
      await removeFavorite(rpc, { botId: input.botId, messageId: input.messageId });
      return false;
    }
    const optimistic: MessageFavorite = {
      id: `local:${key}`,
      botId: input.botId,
      messageId: input.messageId,
      snippet: input.snippet,
      text: input.text ?? null,
      createdAt: new Date().toISOString(),
    };
    updateCaches(input.botId, (items) => [
      optimistic,
      ...items.filter((item) => item.messageId !== input.messageId),
    ]);
    const saved = await addFavorite(rpc, input);
    updateCaches(input.botId, (items) =>
      items.map((item) => (item.messageId === input.messageId ? saved : item)),
    );
    return true;
  } catch (error) {
    restoreCaches(snapshot);
    throw error;
  } finally {
    inFlight.delete(key);
  }
}

/** Drops one favorite from the shared lists, rolling back when the server call fails. */
export async function removeFavoriteItem(
  rpc: FavoritesRpc,
  favorite: MessageFavorite,
): Promise<void> {
  const key = `${favorite.botId}:${favorite.messageId}`;
  if (inFlight.has(key)) return;
  const snapshot = snapshotCaches(favorite.botId);
  inFlight.add(key);
  try {
    updateCaches(favorite.botId, (items) =>
      items.filter((item) => item.messageId !== favorite.messageId),
    );
    await removeFavorite(rpc, { botId: favorite.botId, messageId: favorite.messageId });
  } catch (error) {
    restoreCaches(snapshot);
    throw error;
  } finally {
    inFlight.delete(key);
  }
}

/** Whether a bot's loaded favorites hold this message; false until loaded. */
export function isCachedFavorite(botId: string, messageId: string): boolean {
  return (entryFor(botId).items ?? []).some((item) => item.messageId === messageId);
}

/**
 * A bot's favorites, newest first, shared with every other reader of that bot.
 * Pass `null` for no bot (a message that cannot be favorited); pass nothing
 * for the whole space, which is what the favorites list reads.
 */
export function useFavorites(
  rpc: FavoritesRpc,
  botId?: string | null,
): { favorites: MessageFavorite[] | null; loading: boolean; error: unknown } {
  const key = botId === undefined ? ALL_KEY : botId;
  const items = useSyncExternalStore(subscribe, () => (key === null ? null : entryFor(key).items));
  const error = useSyncExternalStore(subscribe, () => (key === null ? null : entryFor(key).error));
  useEffect(() => {
    if (key === null || entryFor(key).items !== null) return;
    void loadFavorites(rpc, key === ALL_KEY ? undefined : key).catch(() => undefined);
  }, [rpc, key]);
  return { favorites: items, loading: key !== null && items === null && !error, error };
}

/**
 * One message's favorite switch: the shared list answers whether it is saved,
 * and toggling updates the list first, calling the server behind it.
 */
export function useMessageFavorite({
  rpc,
  botId,
  messageId,
  snippet,
  text,
}: {
  rpc: FavoritesRpc;
  botId: string | undefined;
  messageId: string;
  snippet: string;
  text: string;
}): { favorited: boolean; busy: boolean; toggle: () => Promise<boolean> } {
  const { favorites } = useFavorites(rpc, botId ?? null);
  const favorited = Boolean(botId && favorites?.some((item) => item.messageId === messageId));
  const [busy, setBusy] = useState(false);
  const toggle = useCallback(async () => {
    if (!botId || !snippet.trim() || busy) return favorited;
    setBusy(true);
    try {
      return await toggleFavorite(rpc, {
        botId,
        messageId,
        snippet: favoriteSnippet(text),
        text,
      });
    } catch {
      return favorited;
    } finally {
      setBusy(false);
    }
  }, [botId, busy, favorited, messageId, rpc, snippet, text]);
  return { favorited, busy, toggle };
}
