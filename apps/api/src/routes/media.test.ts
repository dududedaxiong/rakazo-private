import type * as Adapters from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediaRoutes } from "./media.js";

vi.mock("@rakazo/adapters", async (original) => {
  const actual = await original<typeof Adapters>();
  return {
    ...actual,
    resolveBotMediaGenerationProvider: vi.fn(),
    generateMediaFromTool: vi.fn(),
    mediaDelivery: vi.fn(() => ({
      attach: vi.fn(),
      publish: vi.fn(),
      onSettled: undefined,
    })),
    scheduleMediaPoll: vi.fn(async () => undefined),
  };
});

const mockedAdapters = vi.mocked(await import("@rakazo/adapters"));

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: {
  context: { actor: Actor; signal?: AbortSignal };
  input: unknown;
}) => Promise<unknown>;

const bot = (overrides: Record<string, unknown> = {}) => ({
  id: "bot-1",
  spaceId: "space-1",
  name: "Chief",
  imageModels: [{ provider: "test-provider", model: "image-model" }],
  videoModels: null,
  imagePromptPresets: null,
  activeImagePromptPreset: null,
  videoPromptPresets: null,
  activeVideoPromptPreset: null,
  ...overrides,
});

const jobResult = (overrides: Record<string, unknown> = {}) => ({
  provider: "bot-media",
  artifactId: "artifact-1",
  modelId: "image-model",
  presetName: "水彩",
  supplementaryPrompt: "不要出现文字",
  ...overrides,
});

function setup(prismaOverrides: Record<string, unknown> = {}) {
  const handler = (fn: (args: { context: { actor: Actor }; input: unknown }) => unknown) => fn;
  const authed = {
    media: Object.fromEntries(
      ["getSupplementaryPrompt", "setSupplementaryPrompt", "regenerate"].map((name) => [
        name,
        { handler },
      ]),
    ),
  };
  const externalEffectUpdate = vi.fn(
    async (_args: { where: { id: string }; data: { result: unknown } }) => ({}),
  );
  const prisma = {
    artifact: {
      findFirst: vi.fn(async () => ({ id: "artifact-1", botId: "bot-1", runId: "run-1" })),
    },
    externalEffect: {
      findFirst: vi.fn(async () => ({
        id: "job-1",
        request: { tool: "generate_image", prompt: "画一只猫", executionId: "exec-1" },
        result: jobResult(),
      })),
      update: externalEffectUpdate,
    },
    run: {
      findUnique: vi.fn(async () => ({ threadId: "thread-1" })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "run-2",
        ...args.data,
      })),
    },
    thread: {
      findUnique: vi.fn(async () => ({
        id: "thread-1",
        groupId: null,
        historyCompactionGeneration: 3,
      })),
    },
    task: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "task-2",
        ...args.data,
      })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        task: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
            id: "task-2",
            ...args.data,
          })),
        },
        run: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
            id: "run-2",
            ...args.data,
          })),
        },
      }),
    ),
    ...prismaOverrides,
  };
  const getBot = vi.fn(async () => bot());
  const ctx = {
    deps: {
      prisma,
      secrets: {},
      billing: undefined,
      env: {},
      events: { notify: vi.fn(async () => undefined) },
      artifacts: {},
      jobs: {},
      mediaGeneration: undefined,
    },
    repos: { getBot },
    codexCatalog: {},
    authed,
  };
  return { routes: mediaRoutes(ctx as never), ctx, prisma, externalEffectUpdate };
}

describe("media getSupplementaryPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the saved prompt, model and preset for the artifact", async () => {
    const { routes } = setup();
    const result = await (routes.media.getSupplementaryPrompt as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1" },
    });
    expect(result).toEqual({
      supplementaryPrompt: "不要出现文字",
      modelId: "image-model",
      presetName: "水彩",
    });
  });

  it("returns an empty prompt when the job saved none", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.externalEffect.findFirst).mockResolvedValueOnce({
      id: "job-1",
      request: { tool: "generate_image", prompt: "画一只猫", executionId: "exec-1" },
      result: { provider: "bot-media", artifactId: "artifact-1" },
    } as never);
    const result = await (routes.media.getSupplementaryPrompt as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1" },
    });
    expect(result).toEqual({ supplementaryPrompt: "" });
  });

  it("refuses an artifact the caller does not own", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.artifact.findFirst).mockResolvedValueOnce(null as never);
    await expect(
      (routes.media.getSupplementaryPrompt as unknown as Handler)({
        context: { actor },
        input: { artifactId: "artifact-1" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("media setSupplementaryPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the prompt onto the job row, keeping the other saved fields", async () => {
    const { routes, externalEffectUpdate } = setup();
    const result = await (routes.media.setSupplementaryPrompt as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1", supplementaryPrompt: "改成夜景" },
    });
    expect(result).toEqual({ ok: true });
    expect(externalEffectUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        result: expect.objectContaining({
          provider: "bot-media",
          artifactId: "artifact-1",
          modelId: "image-model",
          supplementaryPrompt: "改成夜景",
        }),
      },
    });
  });

  it("clears the prompt when given an empty string", async () => {
    const { routes, externalEffectUpdate } = setup();
    await (routes.media.setSupplementaryPrompt as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1", supplementaryPrompt: "" },
    });
    const written = externalEffectUpdate.mock.calls[0]?.[0]?.data.result as Record<string, unknown>;
    expect(written).not.toHaveProperty("supplementaryPrompt");
    expect(written).toHaveProperty("artifactId", "artifact-1");
  });

  it("refuses when no generation job saved the artifact", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.externalEffect.findFirst).mockResolvedValueOnce(null as never);
    await expect(
      (routes.media.setSupplementaryPrompt as unknown as Handler)({
        context: { actor },
        input: { artifactId: "artifact-1", supplementaryPrompt: "改成夜景" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("media regenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replays the raw prompt plus the supplementary prompt and returns the new artifact", async () => {
    const { routes } = setup();
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: true, video: false, offline: false },
    } as never);
    mockedAdapters.generateMediaFromTool.mockResolvedValueOnce({
      status: "completed",
      artifactId: "artifact-2",
      modelId: "image-model",
    });
    const result = await (routes.media.regenerate as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1" },
    });
    expect(result).toEqual({ ok: true, status: "completed", artifactId: "artifact-2" });
    const call = mockedAdapters.generateMediaFromTool.mock.calls[0]?.[0] as unknown as {
      name: string;
      args: { prompt: string };
      run: { threadId: string; id: string };
    };
    expect(call.name).toBe("generate_image");
    // The raw prompt first, the extra prompt appended on its own line.
    expect(call.args.prompt).toBe("画一只猫\n不要出现文字");
    expect(call.run.threadId).toBe("thread-1");
    expect(call.run.id).not.toBe("run-1");
  });

  it("queues a video re-run through the existing poll", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.externalEffect.findFirst).mockResolvedValueOnce({
      id: "job-1",
      request: { tool: "generate_video", prompt: "猫走路", executionId: "exec-1" },
      result: jobResult({ supplementaryPrompt: undefined }),
    } as never);
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: false, video: true, offline: false },
    } as never);
    mockedAdapters.generateMediaFromTool.mockResolvedValueOnce({
      jobId: "job-2",
      status: "queued",
    });
    const result = await (routes.media.regenerate as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1" },
    });
    expect(result).toEqual({ ok: true, status: "queued" });
    expect(mockedAdapters.generateMediaFromTool.mock.calls[0]?.[0]).toMatchObject({
      name: "generate_video",
      args: { prompt: "猫走路" },
    });
    expect(mockedAdapters.scheduleMediaPoll).toHaveBeenCalledWith(expect.anything(), "job-2");
  });

  it("refuses when the bot has no media provider at all", async () => {
    const { routes } = setup();
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce(undefined);
    await expect(
      (routes.media.regenerate as unknown as Handler)({
        context: { actor },
        input: { artifactId: "artifact-1" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedAdapters.generateMediaFromTool).not.toHaveBeenCalled();
  });
});
