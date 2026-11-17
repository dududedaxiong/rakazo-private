import { createServer } from "node:http";
import type { AdapterContext } from "@rakazo_mickvvw/adapter-kit";
import { MediaGenerationError } from "@rakazo_mickvvw/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBotMediaGenerationProvider } from "./bot-media-generation.js";
import type { ExecutorDeps } from "./executor-deps.js";
import type { BotMediaKindCalls } from "./media-generation-provider.js";
import {
  BotMediaGenerationProvider,
  CHAT_MEDIA_VIDEO_JOB_ID,
  FakeMediaGenerationProvider,
} from "./media-generation-provider.js";
import { generateMediaWithChatModel } from "./pi-openai-compatible-provider.js";
import { resolveConnectedModelKey } from "./run-model.js";
import { fetchSafeWebBytes } from "./web-ssrf.js";

vi.mock("./run-model.js", () => ({ resolveConnectedModelKey: vi.fn() }));
vi.mock("./web-ssrf.js", () => ({ fetchSafeWebBytes: vi.fn() }));

const mockedResolveKey = vi.mocked(resolveConnectedModelKey);
const mockedFetchSafeBytes = vi.mocked(fetchSafeWebBytes);

const deps = {} as unknown as ExecutorDeps;
const scope = { userId: "user", spaceId: "space" };
const context: AdapterContext = {
  spaceId: "space",
  userId: "owner",
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=";
const tinyPng = Buffer.from(tinyPngBase64, "base64");

const noMediaBot = {
  videoModels: null,
  imageModels: null,
  videoPromptPresets: null,
  activeVideoPromptPreset: null,
  imagePromptPresets: null,
  activeImagePromptPreset: null,
};
const imageBot = {
  ...noMediaBot,
  imageModels: [{ provider: "openai_compatible", model: "image-model" }],
};
const videoBot = {
  ...noMediaBot,
  videoModels: [{ provider: "openai_compatible", model: "video-model" }],
};
const bothBot = { ...imageBot, ...videoBot };
const fallbackImageBot = {
  ...noMediaBot,
  imageModels: [
    { provider: "openai_compatible", model: "primary-model" },
    { provider: "openai_compatible", model: "fallback-model" },
  ],
};
const presetImageBot = {
  ...imageBot,
  imagePromptPresets: [{ name: "水彩", prompt: "用水彩风格画" }],
  activeImagePromptPreset: "水彩",
};

function resolveKeyValue(baseUrl: string | undefined) {
  return {
    credential: { id: "cred", secretId: "secret", provider: "openai_compatible" },
    resolved: {
      baseUrl,
      apiKey: "test-key",
      apiProtocol: undefined,
      authMode: undefined,
      headers: undefined,
      allowPrivateEndpoint: true,
    },
  } as unknown as Awaited<ReturnType<typeof resolveConnectedModelKey>>;
}

/** A local chat endpoint answering every completion with the same reply. */
async function withChatServer(
  replyContent: string,
  run: (baseUrl: string, seen: Array<Record<string, unknown>>) => Promise<void>,
) {
  const seen: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        seen.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        // Non-JSON bodies are not chat calls; still answer so the test can fail loudly.
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: replyContent } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    await run(`http://127.0.0.1:${address.port}/v1`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

beforeEach(() => {
  mockedResolveKey.mockReset();
  mockedFetchSafeBytes.mockReset();
});

describe("bot media routing", () => {
  it("returns the global provider unchanged when the bot has no media models", async () => {
    const fallback = new FakeMediaGenerationProvider();
    await expect(
      resolveBotMediaGenerationProvider(deps, scope, noMediaBot, fallback),
    ).resolves.toBe(fallback);
    await expect(
      resolveBotMediaGenerationProvider(deps, scope, noMediaBot, undefined),
    ).resolves.toBeUndefined();
    expect(mockedResolveKey).not.toHaveBeenCalled();
  });

  it("routes image generation to the bot's configured model", async () => {
    await withChatServer(`data:image/png;base64,${tinyPngBase64}`, async (baseUrl, seen) => {
      mockedResolveKey.mockResolvedValue(resolveKeyValue(baseUrl));
      const fallback = new FakeMediaGenerationProvider();
      const provider = await resolveBotMediaGenerationProvider(deps, scope, imageBot, fallback);
      expect(provider?.id).toBe("fake");
      expect(provider?.capabilities).toEqual({ images: true, video: true, offline: true });
      expect(await provider?.generateImage({ prompt: "画一只猫" }, context)).toEqual({
        bytes: tinyPng,
        mimeType: "image/png",
        modelId: "image-model",
      });
      expect(mockedResolveKey).toHaveBeenCalledTimes(1);
      expect(mockedResolveKey).toHaveBeenCalledWith(
        deps,
        scope,
        "openai_compatible",
        "image-model",
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]?.model).toBe("image-model");
      expect(seen[0]?.messages).toEqual([{ role: "user", content: "画一只猫" }]);
      // The kind the bot did not configure still answers from the global provider.
      const queued = await provider?.generateVideo({ prompt: "动起来" }, context);
      expect(queued?.status).toBe("queued");
      expect(seen).toHaveLength(1);
    });
  });

  it("routes video generation to the bot's configured model and completes inline", async () => {
    await withChatServer("data:video/mp4;base64,AAAA", async (baseUrl, seen) => {
      mockedResolveKey.mockResolvedValue(resolveKeyValue(baseUrl));
      const fallback = new FakeMediaGenerationProvider();
      const provider = await resolveBotMediaGenerationProvider(deps, scope, videoBot, fallback);
      const video = await provider?.generateVideo({ prompt: "猫走路" }, context);
      expect(video).toEqual({
        id: CHAT_MEDIA_VIDEO_JOB_ID,
        status: "completed",
        output: {
          bytes: Buffer.from("AAAA", "base64"),
          mimeType: "video/mp4",
          modelId: "video-model",
        },
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.model).toBe("video-model");
      // The image kind the bot did not configure still answers from the global provider.
      expect(await provider?.generateImage({ prompt: "画一只猫" }, context)).toEqual({
        bytes: tinyPng,
        mimeType: "image/png",
      });
      expect(seen).toHaveLength(1);
    });
  });

  it("tries the fallback when the primary no longer resolves", async () => {
    await withChatServer(`data:image/png;base64,${tinyPngBase64}`, async (baseUrl, seen) => {
      mockedResolveKey.mockImplementation(async (_deps, _scope, _provider, modelId) => {
        if (modelId === "primary-model") throw new Error("not connected");
        return resolveKeyValue(baseUrl);
      });
      const fallback = new FakeMediaGenerationProvider();
      const provider = await resolveBotMediaGenerationProvider(
        deps,
        scope,
        fallbackImageBot,
        fallback,
      );
      const media = await provider?.generateImage({ prompt: "画一只猫" }, context);
      expect(media?.modelId).toBe("fallback-model");
      // The unresolved primary stays on the timeline as a skip.
      expect(media?.modelSwitches).toMatchObject({
        finalModel: "fallback-model",
        attempts: [
          { model: "primary-model", outcome: "skipped", errorMessage: "not connected" },
          { model: "fallback-model", outcome: "succeeded" },
        ],
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.model).toBe("fallback-model");
    });
  });

  it("prepends the active prompt preset to the generation prompt", async () => {
    await withChatServer(`data:image/png;base64,${tinyPngBase64}`, async (baseUrl, seen) => {
      mockedResolveKey.mockResolvedValue(resolveKeyValue(baseUrl));
      const fallback = new FakeMediaGenerationProvider();
      const provider = await resolveBotMediaGenerationProvider(
        deps,
        scope,
        presetImageBot,
        fallback,
      );
      await provider?.generateImage({ prompt: "画一只猫" }, context);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.messages).toEqual([{ role: "user", content: "用水彩风格画\n画一只猫" }]);
    });
  });

  it("falls back to the global provider when the configured model no longer resolves", async () => {
    mockedResolveKey.mockRejectedValue(new Error("not connected"));
    const fallback = new FakeMediaGenerationProvider();
    const provider = await resolveBotMediaGenerationProvider(deps, scope, bothBot, fallback);
    expect(provider).toBe(fallback);
    expect(await provider?.generateImage({ prompt: "画一只猫" }, context)).toEqual({
      bytes: tinyPng,
      mimeType: "image/png",
    });
  });

  it("falls back when the resolved model has no chat endpoint", async () => {
    mockedResolveKey.mockResolvedValue(resolveKeyValue(undefined));
    const fallback = new FakeMediaGenerationProvider();
    await expect(resolveBotMediaGenerationProvider(deps, scope, bothBot, fallback)).resolves.toBe(
      fallback,
    );
  });
});

describe("BotMediaGenerationProvider", () => {
  const imageCall = vi.fn(async () => ({ bytes: tinyPng, mimeType: "image/png" as const }));
  const noCalls: BotMediaKindCalls = { calls: [], failures: [] };

  it("keeps the fallback id so its jobs still poll under the provider that saved them", () => {
    const fallback = new FakeMediaGenerationProvider();
    const provider = new BotMediaGenerationProvider(
      { calls: [{ modelId: "image-model", call: imageCall }], failures: [] },
      noCalls,
      fallback,
    );
    expect(provider.id).toBe("fake");
    expect(provider.capabilities).toEqual({ images: true, video: true, offline: true });
  });

  it("throws unsupported when neither kind has a source", async () => {
    const provider = new BotMediaGenerationProvider(noCalls, noCalls, undefined);
    expect(provider.capabilities).toEqual({ images: false, video: false, offline: false });
    await expect(provider.generateImage({ prompt: "x" }, context)).rejects.toBeInstanceOf(
      MediaGenerationError,
    );
    await expect(provider.generateVideo({ prompt: "x" }, context)).rejects.toBeInstanceOf(
      MediaGenerationError,
    );
    await expect(provider.pollVideo("whatever", context)).rejects.toBeInstanceOf(
      MediaGenerationError,
    );
  });

  it("uses the fallback when the primary fails and marks which model produced the result", async () => {
    const primary = vi.fn(async () => {
      throw new MediaGenerationError("provider_failure", "boom");
    });
    const fallbackCall = vi.fn(async () => ({ bytes: tinyPng, mimeType: "image/png" as const }));
    const provider = new BotMediaGenerationProvider(
      {
        calls: [
          { modelId: "primary-model", call: primary },
          { modelId: "fallback-model", call: fallbackCall },
        ],
        failures: [],
      },
      noCalls,
      undefined,
    );
    const media = await provider.generateImage({ prompt: "x" }, context);
    expect(media.modelId).toBe("fallback-model");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallbackCall).toHaveBeenCalledTimes(1);
  });

  it("carries the switch timeline on the finished media, with the failure detail", async () => {
    const primary = vi.fn(async () => {
      throw new Error("429 Too many requests");
    });
    const fallbackCall = vi.fn(async () => ({ bytes: tinyPng, mimeType: "image/png" as const }));
    const provider = new BotMediaGenerationProvider(
      {
        calls: [
          {
            modelId: "primary-model",
            provider: "openai-compatible",
            providerLabel: "主站",
            call: primary,
          },
          {
            modelId: "fallback-model",
            provider: "openai-compatible",
            providerLabel: "GB中转",
            call: fallbackCall,
          },
        ],
        failures: [],
      },
      noCalls,
      undefined,
    );
    const media = await provider.generateImage({ prompt: "x" }, context);
    expect(media.modelSwitches).toMatchObject({
      finalModel: "fallback-model",
      attempts: [
        {
          model: "primary-model",
          provider: "主站",
          outcome: "failed",
          errorCode: "rate_limit",
          errorMessage: "429 Too many requests",
        },
        { model: "fallback-model", provider: "GB中转", outcome: "succeeded" },
      ],
    });
  });

  it("carries no timeline when the first model answers", async () => {
    const only = vi.fn(async () => ({ bytes: tinyPng, mimeType: "image/png" as const }));
    const provider = new BotMediaGenerationProvider(
      { calls: [{ modelId: "only-model", call: only }], failures: [] },
      noCalls,
      undefined,
    );
    const media = await provider.generateImage({ prompt: "x" }, context);
    expect(media.modelId).toBe("only-model");
    expect(media.modelSwitches).toBeUndefined();
  });

  it("notifies each failed model and keeps trying until one succeeds", async () => {
    const primary = vi.fn(async () => {
      throw new MediaGenerationError("authentication");
    });
    const fallbackCall = vi.fn(async () => ({ bytes: tinyPng, mimeType: "image/png" as const }));
    const provider = new BotMediaGenerationProvider(
      {
        calls: [
          { modelId: "primary-model", call: primary },
          { modelId: "fallback-model", call: fallbackCall },
        ],
        failures: [],
      },
      noCalls,
      undefined,
    );
    const onModelFailed = vi.fn();
    provider.onModelFailed = onModelFailed;
    const media = await provider.generateImage({ prompt: "x" }, context);
    expect(media.modelId).toBe("fallback-model");
    expect(fallbackCall).toHaveBeenCalledTimes(1);
    expect(onModelFailed).toHaveBeenCalledTimes(1);
    expect(onModelFailed).toHaveBeenCalledWith({
      modelId: "primary-model",
      reason: "authentication failed",
      errorCode: "authentication",
      errorMessage: "Media generation: authentication",
      nextModelId: "fallback-model",
    });
  });

  it("notifies every failure when all models fail", async () => {
    const fail = (code: "authentication" | "timeout") =>
      vi.fn(async () => {
        throw new MediaGenerationError(code);
      });
    const provider = new BotMediaGenerationProvider(
      {
        calls: [
          { modelId: "primary-model", call: fail("authentication") },
          { modelId: "fallback-model", call: fail("timeout") },
        ],
        failures: [],
      },
      noCalls,
      undefined,
    );
    const onModelFailed = vi.fn();
    provider.onModelFailed = onModelFailed;
    await expect(provider.generateImage({ prompt: "x" }, context)).rejects.toThrow(
      "primary-model (authentication failed), fallback-model (timed out)",
    );
    expect(onModelFailed).toHaveBeenCalledTimes(2);
    expect(onModelFailed).toHaveBeenNthCalledWith(1, {
      modelId: "primary-model",
      reason: "authentication failed",
      errorCode: "authentication",
      errorMessage: "Media generation: authentication",
      nextModelId: "fallback-model",
    });
    expect(onModelFailed).toHaveBeenNthCalledWith(2, {
      modelId: "fallback-model",
      reason: "timed out",
      errorCode: "timeout",
      errorMessage: "Media generation: timeout",
      nextModelId: undefined,
    });
  });

  it("keeps trying when the failure callback itself throws", async () => {
    const primary = vi.fn(async () => {
      throw new MediaGenerationError("provider_failure");
    });
    const fallbackCall = vi.fn(async () => ({ bytes: tinyPng, mimeType: "image/png" as const }));
    const provider = new BotMediaGenerationProvider(
      {
        calls: [
          { modelId: "primary-model", call: primary },
          { modelId: "fallback-model", call: fallbackCall },
        ],
        failures: [],
      },
      noCalls,
      undefined,
    );
    provider.onModelFailed = () => {
      throw new Error("notifier broke");
    };
    const media = await provider.generateImage({ prompt: "x" }, context);
    expect(media.modelId).toBe("fallback-model");
    expect(fallbackCall).toHaveBeenCalledTimes(1);
  });

  it("lists every model's failure reason when all fail", async () => {
    const fail = (code: "authentication" | "timeout") =>
      vi.fn(async () => {
        throw new MediaGenerationError(code);
      });
    const provider = new BotMediaGenerationProvider(
      {
        calls: [
          { modelId: "primary-model", call: fail("authentication") },
          { modelId: "fallback-model", call: fail("timeout") },
        ],
        failures: [],
      },
      noCalls,
      undefined,
    );
    await expect(provider.generateImage({ prompt: "x" }, context)).rejects.toThrow(
      "primary-model (authentication failed), fallback-model (timed out)",
    );
  });

  it("fails a chat video poll instead of asking the fallback about a job it never ran", async () => {
    const fallback = new FakeMediaGenerationProvider();
    const videoCall = vi.fn(async () => ({
      bytes: Buffer.from("AAAA", "base64"),
      mimeType: "video/mp4" as const,
    }));
    const provider = new BotMediaGenerationProvider(
      noCalls,
      { calls: [{ modelId: "video-model", call: videoCall }], failures: [] },
      fallback,
    );
    expect(await provider.pollVideo(CHAT_MEDIA_VIDEO_JOB_ID, context)).toEqual({
      id: CHAT_MEDIA_VIDEO_JOB_ID,
      status: "failed",
    });
    const polled = await provider.pollVideo("fake-video", context);
    expect(polled.status).toBe("completed");
  });
});

describe("chat model media download", () => {
  const baseUrl = "http://127.0.0.1:8000/v1";
  const chatFetch = (content: string): typeof fetch =>
    (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
      })) as typeof fetch;

  it("downloads a returned URL through the safe fetch", async () => {
    mockedFetchSafeBytes.mockResolvedValue({
      url: "https://cdn.example.test/a.png",
      body: new TextEncoder().encode("image-bytes"),
      contentType: "image/png",
    });
    const media = await generateMediaWithChatModel(
      { baseUrl, model: "m", kind: "image", prompt: "画一只猫" },
      chatFetch("https://cdn.example.test/a.png"),
      undefined,
      { allowPrivate: true },
    );
    expect(media).toEqual({
      bytes: new TextEncoder().encode("image-bytes"),
      mimeType: "image/png",
    });
    expect(mockedFetchSafeBytes).toHaveBeenCalledWith(
      "https://cdn.example.test/a.png",
      expect.objectContaining({ maxBytes: 10 * 1024 * 1024 }),
    );
  });

  it("rejects a URL that answers with the wrong kind of content", async () => {
    mockedFetchSafeBytes.mockResolvedValue({
      url: "https://cdn.example.test/a.png",
      body: new TextEncoder().encode("<html>"),
      contentType: "text/html",
    });
    await expect(
      generateMediaWithChatModel(
        { baseUrl, model: "m", kind: "image", prompt: "画一只猫" },
        chatFetch("https://cdn.example.test/a.png"),
        undefined,
        { allowPrivate: true },
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("fails when the download itself fails", async () => {
    mockedFetchSafeBytes.mockRejectedValue(new Error("private host"));
    await expect(
      generateMediaWithChatModel(
        { baseUrl, model: "m", kind: "video", prompt: "生成一段视频" },
        chatFetch("https://cdn.example.test/a.mp4"),
        undefined,
        { allowPrivate: true },
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });
});
