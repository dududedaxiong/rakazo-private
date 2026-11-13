import { describe, expect, it } from "vitest";
import {
  AddFavoriteInputSchema,
  favoriteMessageId,
  favoriteSnippet,
  isTranslationFavorite,
  ListFavoritesInputSchema,
  MessageFavoriteSchema,
  SyncFavoritesInputSchema,
  translationFavoriteId,
} from "./favorites.js";

describe("favorite ids", () => {
  it("gives a translation its own id so it never toggles the original", () => {
    expect(translationFavoriteId("msg-1")).toBe("msg-1:translation");
    expect(isTranslationFavorite("msg-1:translation")).toBe(true);
    expect(isTranslationFavorite("msg-1")).toBe(false);
  });

  it("jumps a translation favorite back to the message it translates", () => {
    expect(favoriteMessageId("msg-1:translation")).toBe("msg-1");
    expect(favoriteMessageId("msg-1")).toBe("msg-1");
  });

  it("snippets the first 64 characters of the favorited text", () => {
    expect(favoriteSnippet("  hello   world  ")).toBe("hello world");
    expect(favoriteSnippet("a".repeat(100))).toBe(`${"a".repeat(64)}…`);
  });
});

describe("favorite schemas", () => {
  const favorite = {
    id: "fav-1",
    botId: "bot-1",
    messageId: "msg-1",
    snippet: "hello",
    text: "hello world",
    createdAt: "2026-11-13T03:00:00.000Z",
  };

  it("accepts a stored favorite with or without its full text", () => {
    expect(MessageFavoriteSchema.parse(favorite)).toEqual(favorite);
    expect(MessageFavoriteSchema.parse({ ...favorite, text: null }).text).toBeNull();
  });

  it("lists with or without a bot filter", () => {
    expect(ListFavoritesInputSchema.parse({})).toEqual({});
    expect(ListFavoritesInputSchema.parse({ botId: "bot-1" })).toEqual({ botId: "bot-1" });
  });

  it("refuses an empty message id when adding", () => {
    expect(() =>
      AddFavoriteInputSchema.parse({ botId: "bot-1", messageId: "", snippet: "x" }),
    ).toThrow();
  });

  it("caps a sync batch at 500 favorites", () => {
    const one = { messageId: "msg-1", snippet: "x" };
    expect(
      SyncFavoritesInputSchema.parse({
        botId: "bot-1",
        favorites: Array.from({ length: 500 }, () => one),
      }).favorites,
    ).toHaveLength(500);
    expect(() =>
      SyncFavoritesInputSchema.parse({
        botId: "bot-1",
        favorites: Array.from({ length: 501 }, () => one),
      }),
    ).toThrow();
  });
});
