import type { Actor } from "@rakazo_mickvvw/contracts";
import type * as Db from "@rakazo_mickvvw/db";
import { IsolationError } from "@rakazo_mickvvw/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { favoritesRoutes } from "./favorites.js";

vi.mock("@rakazo_mickvvw/db", async (original) => {
  const actual = await original<typeof Db>();
  return {
    ...actual,
    listFavorites: vi.fn(async () => []),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(async () => undefined),
    syncFavorites: vi.fn(async () => []),
  };
});

const mockedDb = vi.mocked(await import("@rakazo_mickvvw/db"));

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: { context: { actor: Actor }; input: unknown }) => Promise<unknown>;

const favorite = (overrides: Record<string, unknown> = {}) => ({
  id: "fav-1",
  botId: "bot-1",
  messageId: "msg-1",
  snippet: "hello",
  text: "hello world",
  createdAt: "2026-11-13T03:00:00.000Z",
  ...overrides,
});

/** The oRPC procedures, unwrapped so a test can call the handler directly. */
function setup() {
  const handler = (fn: (args: { context: { actor: Actor }; input: unknown }) => unknown) => fn;
  const authed = {
    favorites: Object.fromEntries(
      ["list", "add", "remove", "sync"].map((name) => [name, { handler }]),
    ),
  };
  const getBot = vi.fn(async () => ({ id: "bot-1", spaceId: "space-1" }));
  const ctx = {
    deps: { prisma: {} },
    repos: { getBot },
    authed,
  };
  return { routes: favoritesRoutes(ctx as never), ctx };
}

describe("favorites routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the caller's favorites", async () => {
    const { routes } = setup();
    mockedDb.listFavorites.mockResolvedValueOnce([favorite()]);
    const listed = await (routes.favorites.list as unknown as Handler)({
      context: { actor },
      input: {},
    });
    expect(listed).toEqual([favorite()]);
    expect(mockedDb.listFavorites).toHaveBeenCalledWith(expect.anything(), actor, undefined);
  });

  it("listing one bot's favorites checks the bot belongs to the caller first", async () => {
    const { routes, ctx } = setup();
    mockedDb.listFavorites.mockResolvedValueOnce([favorite()]);
    const listed = await (routes.favorites.list as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1" },
    });
    expect(listed).toEqual([favorite()]);
    expect(ctx.repos.getBot).toHaveBeenCalledWith(actor, "bot-1");
    expect(mockedDb.listFavorites).toHaveBeenCalledWith(expect.anything(), actor, "bot-1");
  });

  it("listing a bot the caller does not own fails", async () => {
    const { routes, ctx } = setup();
    ctx.repos.getBot.mockRejectedValueOnce(new IsolationError());
    await expect(
      (routes.favorites.list as unknown as Handler)({
        context: { actor },
        input: { botId: "bot-9" },
      }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(mockedDb.listFavorites).not.toHaveBeenCalled();
  });

  it("adding a favorite checks the bot belongs to the caller first", async () => {
    const { routes, ctx } = setup();
    mockedDb.addFavorite.mockResolvedValueOnce(favorite());
    const added = await (routes.favorites.add as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", messageId: "msg-1", snippet: "hello", text: "hello world" },
    });
    expect(added).toEqual(favorite());
    expect(ctx.repos.getBot).toHaveBeenCalledWith(actor, "bot-1");
    expect(mockedDb.addFavorite).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ botId: "bot-1", messageId: "msg-1" }),
    );
  });

  it("adding a favorite for a bot the caller does not own fails", async () => {
    const { routes, ctx } = setup();
    ctx.repos.getBot.mockRejectedValueOnce(new IsolationError());
    await expect(
      (routes.favorites.add as unknown as Handler)({
        context: { actor },
        input: { botId: "bot-9", messageId: "msg-1", snippet: "hello" },
      }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(mockedDb.addFavorite).not.toHaveBeenCalled();
  });

  it("removing a favorite returns ok", async () => {
    const { routes } = setup();
    const removed = await (routes.favorites.remove as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", messageId: "msg-1" },
    });
    expect(removed).toEqual({ ok: true });
    expect(mockedDb.removeFavorite).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ botId: "bot-1", messageId: "msg-1" }),
    );
  });

  it("sync checks the bot, then returns the merged list", async () => {
    const { routes, ctx } = setup();
    mockedDb.syncFavorites.mockResolvedValueOnce([favorite()]);
    const merged = await (routes.favorites.sync as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", favorites: [{ messageId: "msg-1", snippet: "hello" }] },
    });
    expect(merged).toEqual([favorite()]);
    expect(ctx.repos.getBot).toHaveBeenCalledWith(actor, "bot-1");
    expect(mockedDb.syncFavorites).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ botId: "bot-1" }),
    );
  });
});
