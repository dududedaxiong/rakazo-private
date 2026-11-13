// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  favoriteMessageId,
  isCachedFavorite,
  loadFavorites,
  removeFavoriteItem,
  resetFavoritesCache,
  toggleFavorite,
  translationFavoriteId,
  useMessageFavorite,
} from "./favorites";

const favorite = {
  id: "fav-1",
  botId: "bot-1",
  messageId: "message-1",
  snippet: "Hello there",
  text: "Hello there",
  createdAt: "2026-11-13T00:00:00.000Z",
};

function mockRpc(list: unknown[] = []) {
  return {
    favorites: {
      list: vi.fn(async () => list),
      add: vi.fn(async (input: { botId: string; messageId: string; snippet: string }) => ({
        ...favorite,
        ...input,
      })),
      remove: vi.fn(async () => ({ ok: true as const })),
    },
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetFavoritesCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shares one list fetch across readers", async () => {
  const rpc = mockRpc([favorite]);
  const first = loadFavorites(rpc as never, "bot-1");
  const second = loadFavorites(rpc as never, "bot-1");
  await expect(first).resolves.toEqual([favorite]);
  await expect(second).resolves.toEqual([favorite]);
  expect(rpc.favorites.list).toHaveBeenCalledTimes(1);
  expect(rpc.favorites.list).toHaveBeenCalledWith({ botId: "bot-1" });
});

it("toggles a favorite on and off through the server", async () => {
  const rpc = mockRpc([]);
  await loadFavorites(rpc as never, "bot-1");
  await expect(
    toggleFavorite(rpc as never, {
      botId: "bot-1",
      messageId: "message-1",
      snippet: "Hello there",
      text: "Hello there",
    }),
  ).resolves.toBe(true);
  expect(isCachedFavorite("bot-1", "message-1")).toBe(true);
  expect(rpc.favorites.add).toHaveBeenCalledWith({
    botId: "bot-1",
    messageId: "message-1",
    snippet: "Hello there",
    text: "Hello there",
  });
  await expect(
    toggleFavorite(rpc as never, {
      botId: "bot-1",
      messageId: "message-1",
      snippet: "Hello there",
      text: "Hello there",
    }),
  ).resolves.toBe(false);
  expect(isCachedFavorite("bot-1", "message-1")).toBe(false);
  expect(rpc.favorites.remove).toHaveBeenCalledWith({ botId: "bot-1", messageId: "message-1" });
});

it("rolls a failed add back out of the list", async () => {
  const rpc = mockRpc([]);
  rpc.favorites.add = vi.fn(async () => {
    throw new Error("offline");
  });
  await loadFavorites(rpc as never, "bot-1");
  await expect(
    toggleFavorite(rpc as never, {
      botId: "bot-1",
      messageId: "message-1",
      snippet: "Hello there",
      text: "Hello there",
    }),
  ).rejects.toThrow("offline");
  expect(isCachedFavorite("bot-1", "message-1")).toBe(false);
});

it("rolls a failed remove back into the list", async () => {
  const rpc = mockRpc([favorite]);
  rpc.favorites.remove = vi.fn(async () => {
    throw new Error("offline");
  });
  await loadFavorites(rpc as never, "bot-1");
  await expect(removeFavoriteItem(rpc as never, favorite)).rejects.toThrow("offline");
  expect(isCachedFavorite("bot-1", "message-1")).toBe(true);
});

it("keeps a translation favorite distinct from its message", () => {
  expect(translationFavoriteId("message-1")).toBe("message-1:translation");
  expect(favoriteMessageId("message-1:translation")).toBe("message-1");
  expect(favoriteMessageId("message-1")).toBe("message-1");
});

describe("useMessageFavorite", () => {
  function FavoriteButton({ rpc }: { rpc: ReturnType<typeof mockRpc> }) {
    const favoriteState = useMessageFavorite({
      rpc: rpc as never,
      botId: "bot-1",
      messageId: "message-1",
      snippet: "Hello there",
      text: "Hello there",
    });
    return (
      <button type="button" onClick={() => void favoriteState.toggle()}>
        {favoriteState.favorited ? "Favorited" : "Favorite"}
      </button>
    );
  }

  it("shows the saved state and toggles it", async () => {
    const rpc = mockRpc([favorite]);
    act(() => root.render(<FavoriteButton rpc={rpc} />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const button = () => container.querySelector("button")!;
    expect(button().textContent).toBe("Favorited");
    await act(async () => {
      button().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(button().textContent).toBe("Favorite");
    expect(rpc.favorites.remove).toHaveBeenCalledTimes(1);
  });

  it("rolls back in place when the server call fails", async () => {
    const rpc = mockRpc([]);
    rpc.favorites.add = vi.fn(async () => {
      throw new Error("offline");
    });
    act(() => root.render(<FavoriteButton rpc={rpc} />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const button = () => container.querySelector("button")!;
    expect(button().textContent).toBe("Favorite");
    await act(async () => {
      button().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(button().textContent).toBe("Favorite");
    expect(rpc.favorites.add).toHaveBeenCalledTimes(1);
  });
});
