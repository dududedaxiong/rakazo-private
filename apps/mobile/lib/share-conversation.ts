import type { ConversationShareSummary } from "@rakazo/contracts";

export type ConversationShareState = "revoked" | "expired" | "live";

/** A link's state: revoked by its owner, past its expiry, or open. */
export function conversationShareState(item: ConversationShareSummary): ConversationShareState {
  if (item.revokedAt) return "revoked";
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) return "expired";
  return "live";
}

/** An expiry date as YYYY-MM-DD, or "" when the link never expires. */
export function conversationShareExpiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "";
  return new Date(expiresAt).toISOString().slice(0, 10);
}
