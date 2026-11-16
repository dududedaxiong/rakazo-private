import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/**
 * A conversation shared by link, as a versioned, normalised document — not
 * the thread's raw rows. The app's replay page and any future reader render
 * this shape; older readers refuse a newer `v` instead of guessing.
 */
export const SHARE_SNAPSHOT_VERSION = 2;
export const SHARE_SNAPSHOT_SCHEMA = 1;

/** Most entries one share carries; older readers skip what they do not know. */
export const SHARE_ENTRY_MAX = 1000;
/** Most characters one entry's text carries; the middle is cut, not refused. */
export const SHARE_TEXT_MAX = 100_000;

const shareImageRef = z.strictObject({ name: z.string().max(200) });
const shareFileRef = z.strictObject({
  name: z.string().max(200),
  kind: z.enum(["image", "video", "file"]),
});

export const SharedConversationEntrySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("user"),
    /** Milliseconds after `start`. */
    t: z.number().int().nonnegative(),
    text: z.string().max(SHARE_TEXT_MAX),
    images: z.array(shareImageRef).max(20).optional(),
    files: z.array(shareFileRef).max(20).optional(),
  }),
  z.strictObject({
    type: z.literal("reply"),
    t: z.number().int().nonnegative(),
    text: z.string().max(SHARE_TEXT_MAX),
    /** The model that wrote the reply, when the message names one. */
    model: z.string().max(200).optional(),
    images: z.array(shareImageRef).max(20).optional(),
    files: z.array(shareFileRef).max(20).optional(),
  }),
  z.strictObject({
    type: z.literal("tool"),
    t: z.number().int().nonnegative(),
    name: z.string().max(200),
    summary: z.string().max(2000).optional(),
    status: z.enum(["ok", "failed", "denied", "cancelled"]),
  }),
]);
export type SharedConversationEntry = z.infer<typeof SharedConversationEntrySchema>;

export const SharedConversationSchema = z.strictObject({
  v: z.literal(SHARE_SNAPSHOT_VERSION),
  kind: z.literal("conversation"),
  schema: z.literal(SHARE_SNAPSHOT_SCHEMA),
  title: z.string().max(200),
  /** The bot (or group) the conversation belongs to. */
  botName: z.string().max(200).optional(),
  /** The model of the last reply, when one names it. */
  model: z.string().max(200).optional(),
  /** Time of `t: 0`. */
  start: IsoDate,
  /** When the share was created. */
  created: IsoDate,
  /** Which slice of a longer thread this is (1-based, inclusive). */
  range: z
    .strictObject({
      from: z.number().int().positive(),
      to: z.number().int().positive(),
      of: z.number().int().positive(),
    })
    .optional(),
  entries: z.array(SharedConversationEntrySchema).max(SHARE_ENTRY_MAX),
});
export type SharedConversation = z.infer<typeof SharedConversationSchema>;

/** One of the caller's shares, with its link; null when its sealed token cannot be read. */
export const ConversationShareSummarySchema = z.strictObject({
  id: Id,
  title: z.string().max(200),
  shareUrl: z.string().url().nullable(),
  expiresAt: IsoDate.nullable(),
  revokedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type ConversationShareSummary = z.infer<typeof ConversationShareSummarySchema>;

/** Days a new link stays open; null never expires. The default is 30 days. */
export const SHARE_EXPIRY_DAYS = [1, 7, 30, 365] as const;
export const SHARE_DEFAULT_EXPIRY_DAYS = 30;

/** 32 random bytes as base64url. */
const CONVERSATION_SHARE_TOKEN_LENGTH = 43;

export const SHARED_CONVERSATION_PATH_PREFIX = "/api/v1/shares/conversations/";

/** `<web origin>/s/<title slug>-<token>`; the token is the last 43 characters. */
export function conversationShareUrl(webOrigin: string, title: string, token: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return new URL(`/s/${slug ? `${slug}-` : ""}${token}`, webOrigin).href;
}

/** The token at the end of a share URL path segment, or null when it cannot hold one. */
export function conversationShareTokenFromSlug(segment: string): string | null {
  const token = segment.slice(-CONVERSATION_SHARE_TOKEN_LENGTH);
  return token.length === CONVERSATION_SHARE_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(token)
    ? token
    : null;
}
