// @vitest-environment jsdom

import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAVORITES_KEY = "rakazo.thread-favorites";
const MIGRATION_KEY = "rakazo.thread-favorites-migrated";
const LOCAL_ONLY_KEY = "rakazo.thread-favorites-local-only";

const store = vi.hoisted(() => ({
  values: {} as Record<string, string | null>,
  getItemAsync: vi.fn(async (key: string) => store.values[key] ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.values[key] = value;
  }),
}));

const server = vi.hoisted(() => ({
  /** botId -> the server's favorites for it, newest first. */
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  failing: new Set<string>(),
  /** botIds the server does not know as bots; their calls fail NOT_FOUND. */
  notFound: new Set<string>(),
}));

function notFoundError(): Error {
  return Object.assign(new Error("not found"), { code: "NOT_FOUND" });
}

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: store.getItemAsync,
  setItemAsync: store.setItemAsync,
}));

vi.mock("./api", () => ({ rpc: mocks.rpc }));

type ServerFavorite = {
  id: string;
  botId: string;
  messageId: string;
  snippet: string;
  text: string | null;
  createdAt: string;
};

function serverFavorite(
  botId: string,
  messageId: string,
  snippet: string,
  text: string | null,
  createdAtMs: number,
): ServerFavorite {
  return {
    id: `id-${messageId}`,
    botId,
    messageId,
    snippet,
    text,
    createdAt: new Date(createdAtMs).toISOString(),
  };
}

function seedServer(botId: string, rows: ServerFavorite[]) {
  server.rows[botId] = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function localStored(): Record<string, Array<Record<string, unknown>>> | null {
  const raw = store.values[FAVORITES_KEY];
  return raw ? (JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>) : null;
}

function favoritesWrites(): Array<[string, string]> {
  return store.setItemAsync.mock.calls.filter(([key]) => key === FAVORITES_KEY) as Array<
    [string, string]
  >;
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (condition()) return;
  }
  throw new Error("timed out waiting for the store to settle");
}

/**
 * The store persists fire-and-forget; a test that mutates it must drain its
 * saves before the next test, or a late save overwrites the next test's
 * stored snapshot.
 */
async function waitForSaves(count: number) {
  await waitFor(() => favoritesWrites().length >= count);
}

describe("thread favorites", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    store.values = {};
    server.rows = {};
    server.failing.clear();
    server.notFound.clear();
    store.getItemAsync.mockClear();
    store.setItemAsync.mockClear();
    mocks.rpc.mockClear();
    mocks.rpc.mockImplementation(async (proc: string, body: Record<string, unknown>) => {
      if (server.failing.has(proc)) throw new Error(`${proc} failed`);
      const botId = body.botId as string;
      // The real server answers NOT_FOUND for a key it does not know as a
      // bot, on every per-bot favorites call including list.
      if (server.notFound.has(botId)) throw notFoundError();
      if (proc === "favorites/list") {
        return [...(server.rows[botId] ?? [])];
      }
      if (proc === "favorites/add") {
        const rows = [...(server.rows[botId] ?? [])];
        const at = rows.findIndex((row) => row.messageId === body.messageId);
        const row: ServerFavorite =
          at >= 0
            ? {
                ...(rows[at] as ServerFavorite),
                snippet: body.snippet as string,
                ...(body.text !== undefined ? { text: body.text as string } : {}),
              }
            : serverFavorite(
                botId,
                body.messageId as string,
                body.snippet as string,
                (body.text as string | undefined) ?? null,
                Date.now(),
              );
        if (at >= 0) rows[at] = row;
        else rows.unshift(row);
        server.rows[botId] = rows;
        return row;
      }
      if (proc === "favorites/remove") {
        server.rows[botId] = (server.rows[botId] ?? []).filter(
          (row) => row.messageId !== body.messageId,
        );
        return { ok: true };
      }
      if (proc === "favorites/sync") {
        const rows = [...(server.rows[botId] ?? [])];
        for (const item of body.favorites as Array<{
          messageId: string;
          snippet: string;
          text?: string;
        }>) {
          const at = rows.findIndex((row) => row.messageId === item.messageId);
          if (at >= 0) {
            rows[at] = {
              ...(rows[at] as ServerFavorite),
              snippet: item.snippet,
              ...(item.text !== undefined ? { text: item.text } : {}),
            };
          } else {
            rows.push(
              serverFavorite(botId, item.messageId, item.snippet, item.text ?? null, Date.now()),
            );
          }
        }
        rows.sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string));
        server.rows[botId] = rows;
        return [...rows];
      }
      throw new Error(`unexpected rpc ${proc}`);
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  async function mountFavoritesProbe(threadKey: string) {
    const mod = await import("./thread-favorites");
    let seen = mod.threadFavoritesFor(threadKey);
    function Probe() {
      seen = mod.useThreadFavorites(threadKey);
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(Probe));
    });
    return { mod, seen: () => seen };
  }

  function unmountProbe() {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  }

  it("truncates the snippet to 64 characters and collapses whitespace", async () => {
    const { favoriteSnippet } = await import("./thread-favorites");
    expect(favoriteSnippet("  hello\n\n world  ")).toBe("hello world");
    expect(favoriteSnippet("x".repeat(70))).toBe(`${"x".repeat(64)}…`);
    expect(favoriteSnippet("short")).toBe("short");
  });

  it("keeps a translation favorite distinct from its message's favorite", async () => {
    const {
      favoriteMessageId,
      isThreadFavorite,
      isTranslationFavorite,
      toggleThreadFavorite,
      translationFavoriteId,
    } = await import("./thread-favorites");
    expect(translationFavoriteId("m1")).toBe("m1:translation");
    expect(isTranslationFavorite("m1:translation")).toBe(true);
    expect(isTranslationFavorite("m1")).toBe(false);
    expect(favoriteMessageId({ messageId: "m1:translation", snippet: "t", createdAt: 1 })).toBe(
      "m1",
    );
    expect(favoriteMessageId({ messageId: "m1", snippet: "o", createdAt: 1 })).toBe("m1");
    toggleThreadFavorite("thread", {
      messageId: translationFavoriteId("m1"),
      snippet: "translated",
      text: "translated",
      createdAt: 2,
    });
    expect(isThreadFavorite("thread", "m1:translation")).toBe(true);
    expect(isThreadFavorite("thread", "m1")).toBe(false);
  });

  it("toggles a favorite on and off, newest first, syncing each change", async () => {
    const { isThreadFavorite, threadFavoritesFor, toggleThreadFavorite } = await import(
      "./thread-favorites"
    );
    const first = { messageId: "m1", snippet: "first", createdAt: 1 };
    const second = { messageId: "m2", snippet: "second", createdAt: 2 };
    expect(toggleThreadFavorite("bot-1", first)).toBe(true);
    expect(toggleThreadFavorite("bot-1", second)).toBe(true);
    expect(threadFavoritesFor("bot-1").map((item) => item.messageId)).toEqual(["m2", "m1"]);
    expect(isThreadFavorite("bot-1", "m1")).toBe(true);
    expect(toggleThreadFavorite("bot-1", first)).toBe(false);
    expect(threadFavoritesFor("bot-1").map((item) => item.messageId)).toEqual(["m2"]);
    expect(isThreadFavorite("bot-1", "m1")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("favorites/add", {
      botId: "bot-1",
      messageId: "m1",
      snippet: "first",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("favorites/add", {
      botId: "bot-1",
      messageId: "m2",
      snippet: "second",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("favorites/remove", {
      botId: "bot-1",
      messageId: "m1",
    });
    await waitForSaves(3);
  });

  it("keeps favorites separate per thread", async () => {
    const { threadFavoritesFor, toggleThreadFavorite } = await import("./thread-favorites");
    toggleThreadFavorite("bot-1", { messageId: "m1", snippet: "one", createdAt: 1 });
    toggleThreadFavorite("group-1", { messageId: "m1", snippet: "one", createdAt: 1 });
    expect(threadFavoritesFor("bot-1")).toHaveLength(1);
    expect(threadFavoritesFor("group-1")).toHaveLength(1);
    expect(threadFavoritesFor("bot-2")).toEqual([]);
    expect(threadFavoritesFor(undefined)).toEqual([]);
    await waitForSaves(2);
  });

  it("stores the full text with a favorite", async () => {
    const { threadFavoritesFor, toggleThreadFavorite } = await import("./thread-favorites");
    toggleThreadFavorite("bot-1", {
      messageId: "m1",
      snippet: "one",
      text: "one two three",
      createdAt: 1,
    });
    expect(threadFavoritesFor("bot-1")[0]?.text).toBe("one two three");
    await waitForSaves(1);
    expect(store.setItemAsync).toHaveBeenCalledWith(
      FAVORITES_KEY,
      expect.stringContaining("one two three"),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("favorites/add", {
      botId: "bot-1",
      messageId: "m1",
      snippet: "one",
      text: "one two three",
    });
  });

  it("loads the server list over the local cache", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "bot-1": [{ messageId: "m-old", snippet: "old", createdAt: 1 }],
    });
    store.values[MIGRATION_KEY] = "1";
    seedServer("bot-1", [serverFavorite("bot-1", "m-new", "new", null, 2000)]);
    const { seen } = await mountFavoritesProbe("bot-1");
    await waitFor(() => seen().length > 0);
    expect(seen()).toEqual([{ messageId: "m-new", snippet: "new", createdAt: 2000 }]);
    expect(mocks.rpc).toHaveBeenCalledWith("favorites/list", { botId: "bot-1" });
    // The server's list replaces the cache, so a favorite deleted on the
    // web does not come back from this phone.
    await waitFor(
      () => localStored()?.["bot-1"]?.some((item) => item.messageId === "m-new") ?? false,
    );
    expect(localStored()?.["bot-1"]?.map((item) => item.messageId)).toEqual(["m-new"]);
  });

  it("merges local favorites onto the server once, then trusts the flag", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "bot-1": [{ messageId: "m1", snippet: "one", text: "one two", createdAt: 1000 }],
      "bot-2": [{ messageId: "m2", snippet: "two", createdAt: 1000 }],
    });
    seedServer("bot-1", [serverFavorite("bot-1", "m0", "zero", null, 3000)]);
    const first = await mountFavoritesProbe("bot-1");
    await waitFor(() => first.seen().length === 2);
    // A newly merged row takes the server's fresh timestamp, so it sorts
    // ahead of the older row the server already held.
    expect(first.seen().map((item) => item.messageId)).toEqual(["m1", "m0"]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "favorites/sync",
      expect.objectContaining({ botId: "bot-1" }),
    );
    // Migration covers every bot with local favorites, not just the open one.
    expect(mocks.rpc).toHaveBeenCalledWith(
      "favorites/sync",
      expect.objectContaining({ botId: "bot-2" }),
    );
    await waitFor(() => store.values[MIGRATION_KEY] === "1");
    const syncCalls = mocks.rpc.mock.calls.filter(([proc]) => proc === "favorites/sync").length;

    unmountProbe();
    vi.resetModules();
    const second = await mountFavoritesProbe("bot-1");
    await waitFor(() => second.seen().length === 2);
    expect(second.seen().map((item) => item.messageId)).toEqual(["m1", "m0"]);
    expect(mocks.rpc.mock.calls.filter(([proc]) => proc === "favorites/sync").length).toBe(
      syncCalls,
    );
  });

  it("keeps the local cache visible when the server cannot be reached", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "bot-1": [{ messageId: "m1", snippet: "one", createdAt: 1 }],
    });
    store.values[MIGRATION_KEY] = "1";
    server.failing.add("favorites/list");
    const { seen } = await mountFavoritesProbe("bot-1");
    await waitFor(() => seen().length > 0);
    expect(seen()).toEqual([{ messageId: "m1", snippet: "one", createdAt: 1 }]);
    expect(mocks.rpc).toHaveBeenCalledWith("favorites/list", { botId: "bot-1" });
  });

  it("rolls a failed favorite back, so the phone never shows a ghost favorite", async () => {
    server.failing.add("favorites/add");
    const mod = await import("./thread-favorites");
    expect(
      mod.toggleThreadFavorite("bot-1", { messageId: "m1", snippet: "one", createdAt: 1 }),
    ).toBe(true);
    expect(mod.isThreadFavorite("bot-1", "m1")).toBe(true);
    await waitFor(() => !mod.isThreadFavorite("bot-1", "m1"));
    expect(mod.threadFavoritesFor("bot-1")).toEqual([]);
  });

  it("rolls a failed unfavorite back, keeping the favorite in place", async () => {
    const mod = await import("./thread-favorites");
    mod.toggleThreadFavorite("bot-1", {
      messageId: "m1",
      snippet: "one",
      text: "one two",
      createdAt: 1,
    });
    mod.toggleThreadFavorite("bot-1", { messageId: "m2", snippet: "two", createdAt: 2 });
    await waitFor(
      () => mocks.rpc.mock.calls.filter(([proc]) => proc === "favorites/add").length >= 2,
    );
    server.failing.add("favorites/remove");
    expect(
      mod.toggleThreadFavorite("bot-1", { messageId: "m1", snippet: "one", createdAt: 1 }),
    ).toBe(false);
    expect(mod.isThreadFavorite("bot-1", "m1")).toBe(false);
    await waitFor(() => mod.isThreadFavorite("bot-1", "m1"));
    expect(mod.threadFavoritesFor("bot-1").map((item) => item.messageId)).toEqual(["m2", "m1"]);
    expect(mod.threadFavoritesFor("bot-1")[1]).toEqual({
      messageId: "m1",
      snippet: "one",
      text: "one two",
      createdAt: 1,
    });
  });

  it("rolls a failed removal back", async () => {
    const mod = await import("./thread-favorites");
    mod.toggleThreadFavorite("bot-1", { messageId: "m1", snippet: "one", createdAt: 1 });
    await waitFor(
      () => mocks.rpc.mock.calls.filter(([proc]) => proc === "favorites/add").length >= 1,
    );
    server.failing.add("favorites/remove");
    mod.removeThreadFavorite("bot-1", "m1");
    expect(mod.isThreadFavorite("bot-1", "m1")).toBe(false);
    await waitFor(() => mod.isThreadFavorite("bot-1", "m1"));
    expect(mod.threadFavoritesFor("bot-1")).toEqual([
      { messageId: "m1", snippet: "one", createdAt: 1 },
    ]);
  });

  it("loads stored favorites and drops a cleared conversation's, on the server too", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "bot-1": [{ messageId: "m1", snippet: "one", createdAt: 1 }],
      "bot-2": [{ messageId: "m2", snippet: "two", createdAt: 2 }],
    });
    store.values[MIGRATION_KEY] = "1";
    seedServer("bot-1", [serverFavorite("bot-1", "m1", "one", null, 1000)]);
    seedServer("bot-2", [serverFavorite("bot-2", "m2", "two", null, 2000)]);
    const { seen } = await mountFavoritesProbe("bot-1");
    await waitFor(() => seen().length > 0);
    expect(seen().map((item) => item.messageId)).toEqual(["m1"]);
    const { notifyConversationCleared } = await import("./conversation-cleared");
    const callsBefore = favoritesWrites().length;
    act(() => {
      notifyConversationCleared("bot-1");
    });
    expect(seen()).toEqual([]);
    await waitFor(() => favoritesWrites().length > callsBefore);
    expect(store.setItemAsync).toHaveBeenCalledWith(
      FAVORITES_KEY,
      expect.not.stringContaining("m1"),
    );
    await waitFor(() =>
      mocks.rpc.mock.calls.some(
        ([proc, body]) =>
          proc === "favorites/remove" &&
          (body as { botId: string; messageId: string }).botId === "bot-1" &&
          (body as { botId: string; messageId: string }).messageId === "m1",
      ),
    );
    expect(server.rows["bot-1"]).toEqual([]);
    expect(server.rows["bot-2"]).toHaveLength(1);
  });

  it("retries a failed migration on the next launch instead of dropping local favorites", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "bot-1": [{ messageId: "m1", snippet: "one", createdAt: 1000 }],
    });
    server.failing.add("favorites/sync");
    const first = await mountFavoritesProbe("bot-1");
    await waitFor(() => first.seen().length > 0);
    expect(first.seen()).toEqual([{ messageId: "m1", snippet: "one", createdAt: 1000 }]);
    expect(store.values[MIGRATION_KEY]).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "favorites/sync",
      expect.objectContaining({ botId: "bot-1" }),
    );

    server.failing.clear();
    unmountProbe();
    vi.resetModules();
    const second = await mountFavoritesProbe("bot-1");
    await waitFor(() => second.seen().length > 0);
    // The merged row takes the server's fresh timestamp; the favorite itself survives.
    expect(second.seen().map((item) => item.messageId)).toEqual(["m1"]);
    expect(second.seen()[0]?.snippet).toBe("one");
    await waitFor(() => store.values[MIGRATION_KEY] === "1");
    expect(server.rows["bot-1"]?.map((row) => row.messageId)).toEqual(["m1"]);
  });

  it("keeps a group thread's favorites local while the rest still migrates", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "bot-1": [{ messageId: "m1", snippet: "one", createdAt: 1000 }],
      "group-1": [{ messageId: "g1", snippet: "group one", createdAt: 1000 }],
    });
    server.notFound.add("group-1");
    const { seen } = await mountFavoritesProbe("bot-1");
    await waitFor(() => seen().length > 0);
    expect(seen().map((item) => item.messageId)).toEqual(["m1"]);
    // The migration skips the unknown key instead of failing on it, so the
    // flag is still set and the bot's favorites are merged.
    await waitFor(() => store.values[MIGRATION_KEY] === "1");
    expect(server.rows["bot-1"]?.map((row) => row.messageId)).toEqual(["m1"]);
    expect(server.rows["group-1"]).toBeUndefined();
    // The group thread's own favorites are untouched by the migration.
    const mod = await import("./thread-favorites");
    expect(mod.threadFavoritesFor("group-1")).toEqual([
      { messageId: "g1", snippet: "group one", createdAt: 1000 },
    ]);
  });

  it("a favorite in a group thread stays local instead of rolling back", async () => {
    store.values[MIGRATION_KEY] = "1";
    server.notFound.add("group-1");
    const mod = await import("./thread-favorites");
    expect(
      mod.toggleThreadFavorite("group-1", { messageId: "g1", snippet: "group one", createdAt: 1 }),
    ).toBe(true);
    expect(mod.isThreadFavorite("group-1", "g1")).toBe(true);
    await waitFor(() => mocks.rpc.mock.calls.some(([proc]) => proc === "favorites/add"));
    // The server refuses the key, so the favorite stays local-only; it is
    // not rolled back, and removing it later is local too.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mod.isThreadFavorite("group-1", "g1")).toBe(true);
    expect(
      mod.toggleThreadFavorite("group-1", { messageId: "g1", snippet: "group one", createdAt: 1 }),
    ).toBe(false);
    expect(mod.isThreadFavorite("group-1", "g1")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mod.isThreadFavorite("group-1", "g1")).toBe(false);
  });

  it("a group thread's empty server list never wipes its local favorites, across launches", async () => {
    store.values[FAVORITES_KEY] = JSON.stringify({
      "group-1": [{ messageId: "g1", snippet: "group one", createdAt: 1000 }],
    });
    store.values[MIGRATION_KEY] = "1";
    server.notFound.add("group-1");
    const first = await mountFavoritesProbe("group-1");
    await waitFor(() => first.seen().length > 0);
    expect(first.seen()).toEqual([{ messageId: "g1", snippet: "group one", createdAt: 1000 }]);
    // The empty server list must not replace the local cache for this key.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(first.seen()).toEqual([{ messageId: "g1", snippet: "group one", createdAt: 1000 }]);
    await waitFor(() => (store.values[LOCAL_ONLY_KEY] ?? "").includes("group-1"));

    // A relaunch remembers the key is local-only without another server round trip.
    const listCallsBefore = mocks.rpc.mock.calls.filter(
      ([proc]) => proc === "favorites/list",
    ).length;
    unmountProbe();
    vi.resetModules();
    const second = await mountFavoritesProbe("group-1");
    await waitFor(() => second.seen().length > 0);
    expect(second.seen()).toEqual([{ messageId: "g1", snippet: "group one", createdAt: 1000 }]);
    expect(mocks.rpc.mock.calls.filter(([proc]) => proc === "favorites/list").length).toBe(
      listCallsBefore,
    );
  });
});
