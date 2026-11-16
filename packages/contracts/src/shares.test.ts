import { describe, expect, it } from "vitest";
import {
  conversationShareTokenFromSlug,
  conversationShareUrl,
  SharedConversationSchema,
} from "./shares.js";

describe("conversationShareUrl", () => {
  it("builds a slugged link whose token is its last 43 characters", () => {
    const token = "a".repeat(43);
    const url = conversationShareUrl("https://web.example", "My Chat!", token);
    expect(url).toBe(`https://web.example/s/my-chat-${token}`);
    expect(conversationShareTokenFromSlug(new URL(url).pathname.split("/").at(-1)!)).toBe(token);
  });

  it("leaves a title of only punctuation unslugged", () => {
    const token = "b".repeat(43);
    expect(conversationShareUrl("https://web.example", "!!!", token)).toBe(
      `https://web.example/s/${token}`,
    );
  });

  it("refuses anything that is not a 43-character token", () => {
    expect(conversationShareTokenFromSlug("short")).toBeNull();
    expect(conversationShareTokenFromSlug("a".repeat(43))).toBe("a".repeat(43));
    expect(conversationShareTokenFromSlug(`my-chat-${"a".repeat(43)}`)).toBe("a".repeat(43));
  });
});

describe("SharedConversationSchema", () => {
  it("accepts a minimal snapshot and refuses a newer version", () => {
    const snapshot = {
      v: 2,
      kind: "conversation",
      schema: 1,
      title: "Chat",
      start: "2026-11-16T06:02:11.000Z",
      created: "2026-11-16T06:02:11.000Z",
      entries: [{ type: "user", t: 0, text: "hi" }],
    };
    expect(SharedConversationSchema.parse(snapshot)).toEqual(snapshot);
    expect(SharedConversationSchema.safeParse({ ...snapshot, v: 3 }).success).toBe(false);
    expect(
      SharedConversationSchema.safeParse({
        ...snapshot,
        entries: [{ type: "user", t: -1, text: "hi" }],
      }).success,
    ).toBe(false);
  });
});
