import * as z from "zod";
import { Id } from "./ids.js";

/** The suffix that marks a favorite of a message's translation. */
export const TRANSLATION_FAVORITE_SUFFIX = ":translation";

/**
 * The favorite id for a message's translation, distinct from the message's
 * own favorite, so favoriting a translation never toggles the original.
 */
export function translationFavoriteId(messageId: string): string {
  return `${messageId}${TRANSLATION_FAVORITE_SUFFIX}`;
}

/** Whether a favorite id saves a translation rather than the message itself. */
export function isTranslationFavorite(messageId: string): boolean {
  return messageId.endsWith(TRANSLATION_FAVORITE_SUFFIX);
}

/** The message a favorite belongs to, whether it saves the reply or its translation. */
export function favoriteMessageId(messageId: string): string {
  return isTranslationFavorite(messageId)
    ? messageId.slice(0, -TRANSLATION_FAVORITE_SUFFIX.length)
    : messageId;
}

/** The first 64 characters of a favorited text, for the favorites list. */
export function favoriteSnippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 64 ? `${flat.slice(0, 64)}…` : flat;
}

export const MessageFavoriteSchema = z.object({
  id: Id,
  botId: Id,
  messageId: z.string().min(1).max(512),
  snippet: z.string().max(200),
  text: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageFavorite = z.infer<typeof MessageFavoriteSchema>;

export const ListFavoritesInputSchema = z.object({
  botId: Id.optional(),
});
export type ListFavoritesInput = z.infer<typeof ListFavoritesInputSchema>;

const FavoriteItemSchema = z.object({
  messageId: z.string().min(1).max(512),
  snippet: z.string().min(1).max(200),
  text: z.string().max(100000).optional(),
});

export const AddFavoriteInputSchema = z.object({
  botId: Id,
  messageId: z.string().min(1).max(512),
  snippet: z.string().min(1).max(200),
  text: z.string().max(100000).optional(),
});
export type AddFavoriteInput = z.infer<typeof AddFavoriteInputSchema>;

export const RemoveFavoriteInputSchema = z.object({
  botId: Id,
  messageId: z.string().min(1).max(512),
});
export type RemoveFavoriteInput = z.infer<typeof RemoveFavoriteInputSchema>;

export const SyncFavoritesInputSchema = z.object({
  botId: Id,
  favorites: z.array(FavoriteItemSchema).max(500),
});
export type SyncFavoritesInput = z.infer<typeof SyncFavoritesInputSchema>;
