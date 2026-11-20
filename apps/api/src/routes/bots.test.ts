import type * as Adapters from "@rakazo_mickvvw/adapters";
import type { Actor } from "@rakazo_mickvvw/contracts";
import type * as Db from "@rakazo_mickvvw/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { botsRoutes } from "./bots.js";

vi.mock("@rakazo_mickvvw/db", async (original) => {
  const actual = await original<typeof Db>();
  return {
    ...actual,
    commitBotUpdate: vi.fn(async () => undefined),
  };
});

vi.mock("@rakazo_mickvvw/adapters", async (original) => {
  const actual = await original<typeof Adapters>();
  return {
    ...actual,
    validateBotModelChange: vi.fn(async () => ({
      ok: true,
      provider: "provider-a",
      model: "model-a",
      thinkingLevel: null,
    })),
    findConnectedModelCredential: vi.fn(async () => ({ secretId: "sec-1" }) as never),
    probeMediaModel: vi.fn(async () => ({
      supported: true,
      outcome: "supported",
      seconds: 2.3,
      detail: "image",
    })),
  };
});

const mockedDb = vi.mocked(await import("@rakazo_mickvvw/db"));
const mockedAdapters = vi.mocked(await import("@rakazo_mickvvw/adapters"));

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: { context: { actor: Actor }; input: unknown }) => Promise<unknown>;

const bot = (overrides: Record<string, unknown> = {}) => ({
  id: "bot-1",
  spaceId: "space-1",
  name: "Chief",
  modelProvider: "provider-a",
  modelId: "model-a",
  translationModels: null,
  videoModels: null,
  imageModels: null,
  videoPromptPresets: null,
  activeVideoPromptPreset: null,
  imagePromptPresets: null,
  activeImagePromptPreset: null,
  thread: { id: "thread-1" },
  ...overrides,
});

const BOTS_PROCEDURES = [
  "archive",
  "claimEmailAddress",
  "create",
  "createFromTemplate",
  "duplicate",
  "emailAddress",
  "emailAddresses",
  "get",
  "importCreate",
  "importPreview",
  "importSetupState",
  "list",
  "listArchived",
  "remove",
  "reorder",
  "restore",
  "restoreInstructions",
  "rotateWebhookSecret",
  "setComputer",
  "templates",
  "testMediaModel",
  "testTranslationModel",
  "translate",
  "update",
] as const;

const OTHER_PROCEDURES: Record<string, readonly string[]> = {
  groups: [
    "archive",
    "create",
    "duplicate",
    "get",
    "list",
    "listArchived",
    "remove",
    "restore",
    "update",
  ],
  botSections: ["create", "list", "remove", "update"],
  botSecrets: ["list", "put", "remove"],
  agentSecrets: ["list", "put", "remove"],
  vault: ["list", "put", "remove", "reveal"],
};

/** The oRPC procedures, unwrapped so a test can call the handler directly. */
function setup() {
  const handler = (fn: (args: { context: { actor: Actor }; input: unknown }) => unknown) => fn;
  const authed = {
    bots: Object.fromEntries(BOTS_PROCEDURES.map((name) => [name, { handler }])),
    ...Object.fromEntries(
      Object.entries(OTHER_PROCEDURES).map(([section, names]) => [
        section,
        Object.fromEntries(names.map((name) => [name, { handler }])),
      ]),
    ),
  };
  const getBot = vi.fn(async () => bot());
  const listBots = vi.fn(async () => [bot()]);
  const ctx = {
    deps: {
      prisma: { secret: { findFirst: vi.fn(async () => ({ ciphertext: "enc" })) } },
      secrets: {
        load: vi.fn(async () =>
          JSON.stringify({
            kind: "openai_compatible",
            baseUrl: "https://api.example.invalid/v1",
            apiKey: "test-key",
          }),
        ),
      },
      env: { defaultProvider: "hosted", mcpAllowPrivateEndpoint: false },
      billing: undefined,
      events: { notify: vi.fn(async () => undefined) },
      translationProber: vi.fn(async () => ({
        supported: true,
        outcome: "supported",
        seconds: 1.5,
        detail: "你好",
      })),
    },
    repos: { getBot, listBots },
    botModelValidation: () => ({}) as never,
    authed,
  };
  return { routes: botsRoutes(ctx as never), ctx };
}

describe("bots testMediaModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a probe that found an image", async () => {
    const { routes } = setup();
    const result = await (routes.bots.testMediaModel as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", kind: "image", provider: "provider-a", modelId: "model-a" },
    });
    expect(result).toEqual({
      supported: true,
      outcome: "supported",
      seconds: 2.3,
      detail: "image",
    });
    expect(mockedAdapters.probeMediaModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "model-a", kind: "image" }),
      undefined,
      undefined,
      expect.objectContaining({ allowPrivate: false }),
    );
  });

  it("reports a probe that found no video", async () => {
    const { routes } = setup();
    mockedAdapters.probeMediaModel.mockResolvedValueOnce({
      supported: false,
      outcome: "unsupported",
      seconds: 1.1,
      detail: "只回了文字，没有视频",
    });
    const result = await (routes.bots.testMediaModel as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", kind: "video", provider: "provider-a", modelId: "model-a" },
    });
    expect(result).toEqual({
      supported: false,
      outcome: "unsupported",
      seconds: 1.1,
      detail: "只回了文字，没有视频",
    });
  });

  it("passes the preset prompt to the probe", async () => {
    const { routes } = setup();
    const result = await (routes.bots.testMediaModel as unknown as Handler)({
      context: { actor },
      input: {
        botId: "bot-1",
        kind: "image",
        provider: "provider-a",
        modelId: "model-a",
        presetPrompt: "用水彩风格画",
      },
    });
    expect(result).toEqual({
      supported: true,
      outcome: "supported",
      seconds: 2.3,
      detail: "image",
    });
    expect(mockedAdapters.probeMediaModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "model-a", kind: "image", presetPrompt: "用水彩风格画" }),
      undefined,
      undefined,
      expect.objectContaining({ allowPrivate: false }),
    );
  });

  it("refuses a model the validation rejects", async () => {
    const { routes } = setup();
    mockedAdapters.validateBotModelChange.mockResolvedValueOnce({
      ok: false,
      error: "模型未连接",
    });
    await expect(
      (routes.bots.testMediaModel as unknown as Handler)({
        context: { actor },
        input: { botId: "bot-1", kind: "image", provider: "provider-a", modelId: "model-a" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedAdapters.probeMediaModel).not.toHaveBeenCalled();
  });

  it("reports an unconnected model without probing", async () => {
    const { routes } = setup();
    mockedAdapters.findConnectedModelCredential.mockResolvedValueOnce(null as never);
    const result = await (routes.bots.testMediaModel as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", kind: "image", provider: "provider-a", modelId: "model-a" },
    });
    expect(result).toEqual({
      supported: false,
      outcome: "unknown",
      seconds: 0,
      detail: "该模型未连接",
    });
    expect(mockedAdapters.probeMediaModel).not.toHaveBeenCalled();
  });

  it("does not probe a hosted model", async () => {
    const { routes, ctx } = setup();
    ctx.deps.billing = { modelCreditsEnabled: true } as never;
    const result = await (routes.bots.testMediaModel as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", kind: "video", provider: "hosted", modelId: "hosted-model" },
    });
    expect(result).toEqual({
      supported: false,
      outcome: "unknown",
      seconds: 0,
      detail: "托管模型暂不支持这样测试",
    });
    expect(mockedAdapters.probeMediaModel).not.toHaveBeenCalled();
  });
});

describe("bots testTranslationModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes the requested model and returns its verdict", async () => {
    const { routes, ctx } = setup();
    const result = await (routes.bots.testTranslationModel as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", provider: "provider-a", modelId: "model-a" },
    });
    expect(result).toEqual({ supported: true, outcome: "supported", seconds: 1.5, detail: "你好" });
    expect(ctx.deps.translationProber).toHaveBeenCalledWith(
      actor,
      "bot-1",
      "provider-a",
      "model-a",
      undefined,
    );
  });

  it("reports a probe that found no translation", async () => {
    const { routes, ctx } = setup();
    vi.mocked(ctx.deps.translationProber).mockResolvedValueOnce({
      supported: false,
      outcome: "unsupported",
      seconds: 2,
      detail: "只回了原文，没有译文",
    });
    const result = await (routes.bots.testTranslationModel as unknown as Handler)({
      context: { actor },
      input: { botId: "bot-1", provider: "provider-a", modelId: "model-a" },
    });
    expect(result).toEqual({
      supported: false,
      outcome: "unsupported",
      seconds: 2,
      detail: "只回了原文，没有译文",
    });
  });

  it("refuses a model the validation rejects", async () => {
    const { routes, ctx } = setup();
    mockedAdapters.validateBotModelChange.mockResolvedValueOnce({
      ok: false,
      error: "模型未连接",
    });
    await expect(
      (routes.bots.testTranslationModel as unknown as Handler)({
        context: { actor },
        input: { botId: "bot-1", provider: "provider-a", modelId: "model-a" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ctx.deps.translationProber).not.toHaveBeenCalled();
  });
});

describe("bots update with media models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the video and image model lists with presets", async () => {
    const { routes, ctx } = setup();
    ctx.repos.listBots.mockResolvedValueOnce([
      bot({ videoModels: [{ provider: "provider-a", model: "video-a" }] }),
    ]);
    const updated = await (routes.bots.update as unknown as Handler)({
      context: { actor },
      input: {
        botId: "bot-1",
        videoModels: [
          { provider: "provider-a", model: "video-a" },
          { provider: "provider-a", model: "video-b" },
        ],
        imageModels: [{ provider: "provider-a", model: "image-a" }],
        videoPromptPresets: [{ name: "水彩", prompt: "用水彩风格画" }],
        activeVideoPromptPreset: "水彩",
      },
    });
    expect(mockedDb.commitBotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        data: expect.objectContaining({
          // A legacy single list splits: the first model leads the main
          // pool, the rest go to the backup pool.
          videoModels: [{ provider: "provider-a", model: "video-a" }],
          videoBackupModels: [{ provider: "provider-a", model: "video-b" }],
          imageModels: [{ provider: "provider-a", model: "image-a" }],
          imageBackupModels: [],
          videoPromptPresets: [{ name: "水彩", prompt: "用水彩风格画" }],
          activeVideoPromptPreset: "水彩",
        }),
      }),
    );
    expect(updated).toMatchObject({ id: "bot-1" });
  });

  it("treats legacy translation singles as setting the primary", async () => {
    const { routes, ctx } = setup();
    ctx.repos.getBot.mockResolvedValueOnce(
      bot({
        translationModels: [{ provider: "provider-a", model: "old-model" }],
        translationModelProvider: "provider-a",
        translationModelId: "old-model",
      }),
    );
    await (routes.bots.update as unknown as Handler)({
      context: { actor },
      input: {
        botId: "bot-1",
        translationModelProvider: "provider-a",
        translationModelId: "new-model",
      },
    });
    expect(mockedDb.commitBotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        data: expect.objectContaining({
          // The new primary moves to the front; the old primary stays as fallback.
          translationModels: [{ provider: "provider-a", model: "new-model" }],
          translationBackupModels: [{ provider: "provider-a", model: "old-model" }],
          translationModelProvider: "provider-a",
          translationModelId: "new-model",
        }),
      }),
    );
  });
});
