import type { ConversationShareSummary } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { conversationShareExpiryLabel, conversationShareState } from "./share-conversation";

function summary(overrides: Partial<ConversationShareSummary>): ConversationShareSummary {
  return {
    id: "s_1",
    title: "Chat",
    shareUrl: "https://example.invalid/s/chat-token",
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-11-16T14:00:00.000Z",
    ...overrides,
  };
}

describe("conversationShareState", () => {
  it("is live for an open link", () => {
    expect(conversationShareState(summary({}))).toBe("live");
  });

  it("is revoked once the owner revokes it", () => {
    expect(conversationShareState(summary({ revokedAt: "2026-11-16T15:00:00.000Z" }))).toBe(
      "revoked",
    );
  });

  it("is expired past its expiry", () => {
    expect(conversationShareState(summary({ expiresAt: "2026-11-01T00:00:00.000Z" }))).toBe(
      "expired",
    );
  });
});

describe("conversationShareExpiryLabel", () => {
  it("shows the expiry date, or nothing when the link never expires", () => {
    expect(conversationShareExpiryLabel("2026-12-16T00:00:00.000Z")).toBe("2026-12-16");
    expect(conversationShareExpiryLabel(null)).toBe("");
  });
});
