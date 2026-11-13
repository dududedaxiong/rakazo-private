import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type * as Db from "@rakazo/db";
import { IsolationError, PromptTemplateNameConflictError } from "@rakazo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { promptTemplatesRoutes } from "./prompt-templates.js";

vi.mock("@rakazo/db", async (original) => {
  const actual = await original<typeof Db>();
  return {
    ...actual,
    commitBotUpdate: vi.fn(async () => ({ id: "bot-1", name: "Chief", description: "" })),
    listPromptTemplates: vi.fn(async () => []),
    createPromptTemplate: vi.fn(),
    updatePromptTemplate: vi.fn(),
    removePromptTemplate: vi.fn(async () => undefined),
    restoreDefaultPromptTemplates: vi.fn(async () => []),
    upsertPromptTemplate: vi.fn(),
  };
});

const mockedDb = vi.mocked(await import("@rakazo/db"));

vi.mock("@rakazo/adapters", async (original) => {
  const actual = await original<typeof import("@rakazo/adapters")>();
  return { ...actual, createSafeRemoteFetch: vi.fn() };
});

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: { context: { actor: Actor }; input: unknown }) => Promise<unknown>;

const template = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  name: "翻译助手",
  content: "Translate.",
  isBuiltIn: true,
  sourceUrl: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
  ...overrides,
});

const bot = (overrides: Record<string, unknown> = {}) => ({
  id: "bot-1",
  spaceId: "space-1",
  name: "Chief",
  title: "",
  description: "",
  instructions: "Translate.",
  instructionHistory: [],
  promptTemplateId: "tpl-1" as string | null,
  color: "blue",
  avatarSet: "organic",
  notifyOnFinish: false,
  pinned: false,
  sectionId: null,
  archivedAt: null,
  unread: false,
  parentBotId: null,
  memoryScope: null,
  threadId: "thread-1",
  preview: "",
  status: "idle",
  runErrorId: null,
  computerMode: "team",
  imagePromptPresets: [] as { name: string; prompt: string }[],
  videoPromptPresets: [] as { name: string; prompt: string }[],
  activeImagePromptPreset: null as string | null,
  activeVideoPromptPreset: null as string | null,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
  incomingCall: null,
  ...overrides,
});

/** The oRPC procedures, unwrapped so a test can call the handler directly. */
function setup() {
  const handler = (fn: (args: { context: { actor: Actor }; input: unknown }) => unknown) => fn;
  const authed = {
    promptTemplates: Object.fromEntries(
      [
        "list",
        "create",
        "update",
        "remove",
        "apply",
        "applyPreset",
        "saveCurrentAsTemplate",
        "restoreDefaults",
        "fetchFromUrl",
        "confirmImport",
      ].map((name) => [name, { handler }]),
    ),
  };
  const getBot = vi.fn(async () => ({ ...bot(), thread: { id: "thread-1" } }));
  const listBots = vi.fn(async () => [bot()]);
  const ctx = {
    deps: {
      prisma: { promptTemplate: { findFirst: vi.fn(async () => template()) } },
      events: { notify: vi.fn(async () => undefined) },
    },
    repos: { getBot, listBots },
    authed,
  };
  return { routes: promptTemplatesRoutes(ctx as never), ctx };
}

describe("prompt template routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the account's templates", async () => {
    const { routes } = setup();
    mockedDb.listPromptTemplates.mockResolvedValueOnce([template()]);
    const listed = await (routes.promptTemplates.list as unknown as Handler)({
      context: { actor },
      input: undefined,
    });
    expect(listed).toEqual([template()]);
    expect(mockedDb.listPromptTemplates).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("maps a duplicate name to a conflict", async () => {
    const { routes } = setup();
    mockedDb.createPromptTemplate.mockRejectedValueOnce(new PromptTemplateNameConflictError());
    await expect(
      (routes.promptTemplates.create as unknown as Handler)({
        context: { actor },
        input: { name: "翻译助手", content: "Translate." },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("applying a template writes its content and links the bot, then returns the bot", async () => {
    const { routes, ctx } = setup();
    const applied = await (routes.promptTemplates.apply as unknown as Handler)({
      context: { actor },
      input: { templateId: "tpl-1", botId: "bot-1" },
    });
    expect(mockedDb.commitBotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        threadId: "thread-1",
        data: { instructions: "Translate.", promptTemplateId: "tpl-1" },
        reason: "Apply template",
        promptTemplateId: "tpl-1",
      }),
    );
    expect(applied).toMatchObject({ id: "bot-1" });
    expect(ctx.repos.listBots).toHaveBeenCalledWith(actor);
  });

  it("applying a template the account does not own fails", async () => {
    const { routes, ctx } = setup();
    ctx.deps.prisma.promptTemplate.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      (routes.promptTemplates.apply as unknown as Handler)({
        context: { actor },
        input: { templateId: "tpl-9", botId: "bot-1" },
      }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(mockedDb.commitBotUpdate).not.toHaveBeenCalled();
  });

  it("applying the active image preset writes its prompt and clears the template link", async () => {
    const { routes, ctx } = setup();
    ctx.repos.getBot.mockResolvedValueOnce({
      ...bot(),
      promptTemplateId: null,
      imagePromptPresets: [{ name: "Ghibli", prompt: "Ghibli style." }],
      activeImagePromptPreset: "Ghibli",
      thread: { id: "thread-1" },
    });
    const applied = await (routes.promptTemplates.applyPreset as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", kind: "image" },
    });
    expect(mockedDb.commitBotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        threadId: "thread-1",
        data: { instructions: "Ghibli style.", promptTemplateId: null },
        reason: "Apply image preset",
        promptTemplateId: null,
      }),
    );
    expect(applied).toMatchObject({ id: "bot-1" });
  });

  it("applying a preset with none active fails without writing", async () => {
    const { routes, ctx } = setup();
    ctx.repos.getBot.mockResolvedValueOnce({
      ...bot(),
      imagePromptPresets: [],
      activeImagePromptPreset: null,
      thread: { id: "thread-1" },
    });
    await expect(
      (routes.promptTemplates.applyPreset as unknown as Handler)({
        context: { actor },
        input: { botId: "bot-1", kind: "image" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedDb.commitBotUpdate).not.toHaveBeenCalled();
  });

  it("saving an empty persona as a template is refused", async () => {
    const { routes, ctx } = setup();
    ctx.repos.getBot.mockResolvedValueOnce({
      ...bot(),
      instructions: "  ",
      thread: { id: "thread-1" },
    });
    await expect(
      (routes.promptTemplates.saveCurrentAsTemplate as unknown as Handler)({
        context: { actor },
        input: { botId: "bot-1" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedDb.upsertPromptTemplate).not.toHaveBeenCalled();
  });

  it("confirming an import applies the template the bot already uses", async () => {
    const { routes } = setup();
    mockedDb.upsertPromptTemplate.mockResolvedValueOnce(template());
    await (routes.promptTemplates.confirmImport as unknown as Handler)({
      context: { actor },
      input: { templates: [{ name: "翻译助手", content: "Translate." }], botId: "bot-1" },
    });
    expect(mockedDb.commitBotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { instructions: "Translate.", promptTemplateId: "tpl-1" },
      }),
    );
  });

  it("confirming an import leaves the bot alone when it uses another template", async () => {
    const { routes, ctx } = setup();
    mockedDb.upsertPromptTemplate.mockResolvedValueOnce(template({ id: "tpl-2" }));
    ctx.repos.getBot.mockResolvedValueOnce({
      ...bot(),
      promptTemplateId: "tpl-1",
      thread: { id: "thread-1" },
    });
    await (routes.promptTemplates.confirmImport as unknown as Handler)({
      context: { actor },
      input: { templates: [{ name: "翻译助手", content: "Translate." }], botId: "bot-1" },
    });
    expect(mockedDb.commitBotUpdate).not.toHaveBeenCalled();
  });

  it("fetching a subscription refuses plain http", async () => {
    const { routes } = setup();
    await expect(
      (routes.promptTemplates.fetchFromUrl as unknown as Handler)({
        context: { actor },
        input: { url: "http://example.test/a.txt" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fetching a subscription parses the file for preview", async () => {
    const { routes } = setup();
    const { createSafeRemoteFetch } = vi.mocked(await import("@rakazo/adapters"));
    const safeFetch = vi.fn(async () => new Response("Translate everything.", { status: 200 }));
    (safeFetch as unknown as { close: unknown }).close = vi.fn();
    vi.mocked(createSafeRemoteFetch).mockReturnValueOnce(safeFetch as never);
    const fetched = await (routes.promptTemplates.fetchFromUrl as unknown as Handler)({
      context: { actor },
      input: { url: "https://example.test/prompts.txt" },
    });
    expect(fetched).toEqual({
      templates: [{ name: "prompts", content: "Translate everything." }],
    });
    expect(safeFetch).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://example.test/prompts.txt" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fetching a subscription reports a bad file instead of throwing", async () => {
    const { routes } = setup();
    const { createSafeRemoteFetch } = vi.mocked(await import("@rakazo/adapters"));
    const safeFetch = vi.fn(async () => new Response("{nope", { status: 200 }));
    (safeFetch as unknown as { close: unknown }).close = vi.fn();
    vi.mocked(createSafeRemoteFetch).mockReturnValueOnce(safeFetch as never);
    await expect(
      (routes.promptTemplates.fetchFromUrl as unknown as Handler)({
        context: { actor },
        input: { url: "https://example.test/a.txt" },
      }),
    ).rejects.toBeInstanceOf(ORPCError);
  });
});
