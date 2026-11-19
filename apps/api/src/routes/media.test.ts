import type * as Adapters from "@rakazo_mickvvw/adapters";
import type { Actor } from "@rakazo_mickvvw/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mediaRoutes } from "./media.js";

vi.mock("@rakazo_mickvvw/adapters", async (original) => {
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

const mockedAdapters = vi.mocked(await import("@rakazo_mickvvw/adapters"));

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
      findFirst: vi.fn(async () => ({
        id: "artifact-1",
        botId: "bot-1",
        runId: "run-1",
        mimeType: "image/png",
      })),
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
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        run: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
            id: "run-2",
            ...args.data,
          })),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        externalEffect: {
          updateMany: vi.fn(async () => ({ count: 1 })),
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
      events: { notify: vi.fn(async () => undefined), append: vi.fn(async () => undefined) },
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

  it("queues a random image re-run with the raw prompt plus the supplementary prompt", async () => {
    const runCreates: Record<string, unknown>[] = [];
    const taskCreates: Record<string, unknown>[] = [];
    const { routes } = setup({
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          task: {
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
              taskCreates.push(args.data);
              return { id: "task-2", ...args.data };
            }),
            updateMany: vi.fn(async () => ({ count: 1 })),
          },
          run: {
            create: vi.fn(async (args: { data: Record<string, unknown> }) => {
              runCreates.push(args.data);
              return { id: "run-2", ...args.data };
            }),
            updateMany: vi.fn(async () => ({ count: 1 })),
          },
          externalEffect: { updateMany: vi.fn(async () => ({ count: 1 })) },
        }),
      ),
    });
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: true, video: false, offline: false },
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
    const call = mockedAdapters.generateMediaFromTool.mock.calls[0]?.[0] as unknown as {
      name: string;
      args: { prompt: string };
      run: { threadId: string; id: string };
      submitOnly: boolean;
      mode: string;
    };
    expect(call.name).toBe("generate_image");
    // The raw prompt first, the extra prompt appended on its own line.
    expect(call.args.prompt).toBe("画一只猫\n不要出现文字");
    expect(call.submitOnly).toBe(true);
    expect(call.mode).toBe("random");
    expect(call.run.threadId).toBe("thread-1");
    expect(call.run.id).not.toBe("run-1");
    // The run and task start working, never completed, until the poll settles them.
    expect(taskCreates[0]?.status).toBe("running");
    expect(runCreates[0]?.status).toBe("running");
    expect(runCreates[0]).not.toHaveProperty("completedAt");
    expect(runCreates[0]).toHaveProperty("startedAt");
    expect(mockedAdapters.scheduleMediaPoll).toHaveBeenCalledWith(expect.anything(), "job-2");
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
      submitOnly: true,
      mode: "random",
    });
    expect(mockedAdapters.scheduleMediaPoll).toHaveBeenCalledWith(expect.anything(), "job-2");
  });

  it("edits an image from the supplementary prompt alone, with the original as reference", async () => {
    const { routes } = setup();
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: true, video: false, offline: false },
      editCapabilities: { images: true, video: false },
    } as never);
    mockedAdapters.generateMediaFromTool.mockResolvedValueOnce({
      jobId: "job-2",
      status: "queued",
    });
    const result = await (routes.media.regenerate as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1", mode: "edit" },
    });
    expect(result).toEqual({ ok: true, status: "queued" });
    expect(mockedAdapters.generateMediaFromTool.mock.calls[0]?.[0]).toMatchObject({
      name: "generate_image",
      args: { prompt: "不要出现文字" },
      submitOnly: true,
      mode: "edit",
      sourceArtifactId: "artifact-1",
    });
  });

  it("refuses an edit when the bot has no edit models", async () => {
    const { routes } = setup();
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: true, video: false, offline: false },
      editCapabilities: { images: false, video: false },
    } as never);
    await expect(
      (routes.media.regenerate as unknown as Handler)({
        context: { actor },
        input: { artifactId: "artifact-1", mode: "edit" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedAdapters.generateMediaFromTool).not.toHaveBeenCalled();
  });

  it("refuses an edit when the supplementary prompt is empty", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.externalEffect.findFirst).mockResolvedValueOnce({
      id: "job-1",
      request: { tool: "generate_image", prompt: "画一只猫", executionId: "exec-1" },
      result: jobResult({ supplementaryPrompt: undefined }),
    } as never);
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: true, video: false, offline: false },
      editCapabilities: { images: true, video: false },
    } as never);
    await expect(
      (routes.media.regenerate as unknown as Handler)({
        context: { actor },
        input: { artifactId: "artifact-1", mode: "edit" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedAdapters.generateMediaFromTool).not.toHaveBeenCalled();
  });

  it("refuses a video edit without an uploaded reference image", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.externalEffect.findFirst).mockResolvedValueOnce({
      id: "job-1",
      request: { tool: "generate_video", prompt: "猫走路", executionId: "exec-1" },
      result: jobResult(),
    } as never);
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: false, video: true, offline: false },
      editCapabilities: { images: false, video: true },
    } as never);
    await expect(
      (routes.media.regenerate as unknown as Handler)({
        context: { actor },
        input: { artifactId: "artifact-1", mode: "edit" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedAdapters.generateMediaFromTool).not.toHaveBeenCalled();
  });

  it("edits a video from the uploaded reference image", async () => {
    const { routes, prisma } = setup();
    vi.mocked(prisma.externalEffect.findFirst).mockResolvedValueOnce({
      id: "job-1",
      request: { tool: "generate_video", prompt: "猫走路", executionId: "exec-1" },
      result: jobResult(),
    } as never);
    vi.mocked(prisma.artifact.findFirst)
      .mockResolvedValueOnce({
        id: "artifact-1",
        botId: "bot-1",
        runId: "run-1",
        mimeType: "video/mp4",
      } as never)
      .mockResolvedValueOnce({
        id: "ref-1",
        botId: "bot-1",
        runId: "run-1",
        mimeType: "image/png",
      } as never);
    mockedAdapters.resolveBotMediaGenerationProvider.mockResolvedValueOnce({
      id: "bot-media",
      capabilities: { images: false, video: true, offline: false },
      editCapabilities: { images: false, video: true },
    } as never);
    mockedAdapters.generateMediaFromTool.mockResolvedValueOnce({
      jobId: "job-2",
      status: "queued",
    });
    const result = await (routes.media.regenerate as unknown as Handler)({
      context: { actor },
      input: { artifactId: "artifact-1", mode: "edit", referenceArtifactId: "ref-1" },
    });
    expect(result).toEqual({ ok: true, status: "queued" });
    expect(mockedAdapters.generateMediaFromTool.mock.calls[0]?.[0]).toMatchObject({
      name: "generate_video",
      args: { prompt: "不要出现文字" },
      submitOnly: true,
      mode: "edit",
      referenceArtifactId: "ref-1",
    });
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
