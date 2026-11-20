import type { AgentRunRequest, AgentRuntime } from "@rakazo_mickvvw/adapter-kit";
import type { Actor } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { describe, expect, it, vi } from "vitest";
import type { Translator } from "./translate.js";
import {
  createTranslationProber,
  createTranslator,
  TranslationFailedError,
  TranslationModelNotConfiguredError,
} from "./translate.js";

const actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@example.com",
  isDeploymentOwner: false,
} satisfies Actor;

type BotConfig = {
  translationModels?: { provider: string; model: string }[] | null;
  translationBackupModels?: { provider: string; model: string }[] | null;
  translationModelProvider?: string | null;
  translationModelId?: string | null;
};

function doneRun(text: string) {
  return async function* () {
    yield { type: "done", text };
  };
}

function hangingRun() {
  return async function* (...args: unknown[]) {
    const context = args[1] as { signal: AbortSignal };
    await new Promise<void>((_resolve, reject) => {
      context.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    yield { type: "done", text: "too late" };
  };
}

function harness(options: {
  bot?: BotConfig | null;
  runs: Array<() => AsyncIterable<unknown>>;
  timeoutMs?: number;
}): {
  translator: Translator;
  run: ReturnType<typeof vi.fn>;
  resolveConnectedModel: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn().mockResolvedValue(
    options.bot ?? {
      translationModelProvider: "test-provider",
      translationModelId: "model-1",
    },
  );
  const prisma = { bot: { findFirst } };
  const resolveConnectedModel = vi.fn(async () => ({
    provider: "test-provider",
    id: "model-1",
    connectionLabel: "Test Connection",
  }));
  const run = vi.fn();
  for (const next of options.runs) run.mockImplementationOnce(next);
  const runtime = { run };
  const translator = createTranslator({
    prisma: prisma as unknown as PrismaClient,
    runtime: runtime as unknown as AgentRuntime,
    resolveConnectedModel: resolveConnectedModel as unknown as (
      scope: { userId: string; spaceId: string },
      provider: string,
      modelId: string,
    ) => Promise<AgentRunRequest["model"]>,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return { translator, run, resolveConnectedModel };
}

describe("createTranslator", () => {
  it("rejects when the bot has no translation model picked", async () => {
    const { translator, resolveConnectedModel, run } = harness({
      bot: { translationModelProvider: null, translationModelId: null },
      runs: [doneRun('{"detected": "en", "text": "hi"}')],
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).rejects.toBeInstanceOf(
      TranslationModelNotConfiguredError,
    );
    expect(resolveConnectedModel).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("parses the model JSON reply and reports the detected language", async () => {
    const { translator, resolveConnectedModel } = harness({
      runs: [doneRun('{"detected": "en", "text": "你好"}')],
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).resolves.toMatchObject({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-1",
      usedFallback: false,
    });
    expect(resolveConnectedModel).toHaveBeenCalledWith(
      { userId: "user-1", spaceId: "space-1" },
      "test-provider",
      "model-1",
    );
  });

  it("carries its one attempt, with the connection label, when the first model answers", async () => {
    const { translator } = harness({
      runs: [doneRun('{"detected": "en", "text": "你好"}')],
    });
    const result = await translator(actor, "bot-1", "hello", "auto", "zh");
    expect(result).toMatchObject({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-1",
      usedFallback: false,
      attempts: [{ model: "model-1", provider: "Test Connection", outcome: "succeeded" }],
    });
    expect(result.attempts).toHaveLength(1);
  });

  it("strips a fenced JSON reply", async () => {
    const { translator } = harness({
      runs: [doneRun('```json\n{"detected": "ja", "text": "你好"}\n```')],
    });
    await expect(translator(actor, "bot-1", "こんにちは", "auto", "zh")).resolves.toMatchObject({
      translatedText: "你好",
      detectedLanguage: "ja",
      modelId: "model-1",
      usedFallback: false,
    });
  });

  it("retries once on a chatty non-JSON reply, then fails instead of passing it off as a translation", async () => {
    const chatty =
      "收到，连接没问题。不过有两点需要先确认，否则我给出的信息很可能是过时或者张冠李戴的。";
    const { translator, run } = harness({ runs: [doneRun(chatty), doneRun(chatty)] });
    await expect(
      translator(actor, "bot-1", "我查一下 Hark AI 的最新情况", "auto", "ko"),
    ).rejects.toThrow("Translation did not return JSON");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry returns JSON after a chatty first reply", async () => {
    const { translator, run } = harness({
      runs: [doneRun("收到，我来查一下。"), doneRun('{"detected": "zh", "text": "최신 상황"}')],
    });
    await expect(
      translator(actor, "bot-1", "我查一下 Hark AI 的最新情况", "auto", "ko"),
    ).resolves.toMatchObject({
      translatedText: "최신 상황",
      detectedLanguage: "zh",
      modelId: "model-1",
      usedFallback: false,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("sends the text as quoted data to translate, not as a message to answer", async () => {
    const { translator, run } = harness({
      runs: [doneRun('{"detected": "zh", "text": "최신 상황"}')],
    });
    await translator(actor, "bot-1", "我查一下 Hark AI 的最新情况", "auto", "ko");
    const request = run.mock.calls[0]?.[0] as { prompt: string; instructions: string };
    expect(request.prompt).toContain('"""\n我查一下 Hark AI 的最新情况\n"""');
    expect(request.prompt).toContain("Only translate the quoted text. Do not answer it");
    expect(request.instructions).toContain("Translate the quoted text");
  });

  it("retries once on an empty result, then succeeds", async () => {
    const { translator, run } = harness({
      runs: [doneRun(""), doneRun('{"detected": "en", "text": "你好"}')],
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).resolves.toMatchObject({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-1",
      usedFallback: false,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fails after two empty results", async () => {
    const { translator, run } = harness({ runs: [doneRun(""), doneRun("")] });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).rejects.toThrow(
      "Translation produced no text",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries once on timeout, then fails", async () => {
    const { translator, run } = harness({
      runs: [hangingRun(), hangingRun()],
      timeoutMs: 20,
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uses the fallback when the primary does not resolve, and marks it", async () => {
    const { translator, resolveConnectedModel, run } = harness({
      bot: {
        translationModels: [
          { provider: "test-provider", model: "model-1" },
          { provider: "test-provider", model: "model-2" },
        ],
      },
      runs: [doneRun('{"detected": "en", "text": "你好"}')],
    });
    resolveConnectedModel.mockImplementation(async (_scope, _provider, modelId) => {
      if (modelId === "model-1") throw new Error("not connected");
      return { provider: "test-provider", id: modelId, connectionLabel: "GB中转" };
    });
    const result = await translator(actor, "bot-1", "hello", "auto", "zh");
    expect(result).toMatchObject({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-2",
      usedFallback: true,
      attempts: [
        { model: "model-1", outcome: "skipped", errorMessage: "not connected" },
        { model: "model-2", provider: "GB中转", outcome: "succeeded" },
      ],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback when the primary keeps failing, and marks it", async () => {
    const { translator, resolveConnectedModel, run } = harness({
      bot: {
        translationModels: [
          { provider: "test-provider", model: "model-1" },
          { provider: "test-provider", model: "model-2" },
        ],
      },
      runs: [doneRun(""), doneRun(""), doneRun('{"detected": "en", "text": "你好"}')],
    });
    resolveConnectedModel.mockImplementation(async (_scope, _provider, modelId) => ({
      provider: "test-provider",
      id: modelId,
      connectionLabel: "主站",
    }));
    const result = await translator(actor, "bot-1", "hello", "auto", "zh");
    expect(result).toMatchObject({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-2",
      usedFallback: true,
      attempts: [
        {
          model: "model-1",
          provider: "主站",
          outcome: "failed",
          errorMessage: "Translation produced no text",
        },
        { model: "model-2", provider: "主站", outcome: "succeeded" },
      ],
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("lists every model's failure reason when all fail", async () => {
    const { translator, resolveConnectedModel } = harness({
      bot: {
        translationModels: [
          { provider: "test-provider", model: "model-1" },
          { provider: "test-provider", model: "model-2" },
        ],
      },
      runs: [doneRun(""), doneRun(""), doneRun(""), doneRun("")],
    });
    resolveConnectedModel.mockImplementation(async (_scope, _provider, modelId) => {
      if (modelId === "model-1") throw new Error("not connected");
      return { provider: "test-provider", id: modelId };
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).rejects.toThrow(
      "Translation failed: model-1 (not connected), model-2 (Translation produced no text)",
    );
  });

  it("carries the attempts, tagged by pool, when every pool fails", async () => {
    const { translator, resolveConnectedModel } = harness({
      bot: {
        translationModels: [{ provider: "test-provider", model: "model-1" }],
        translationBackupModels: [{ provider: "test-provider", model: "model-2" }],
      },
      runs: [doneRun(""), doneRun("")],
    });
    resolveConnectedModel.mockImplementation(async (_scope, _provider, modelId) => {
      if (modelId === "model-1") throw new Error("not connected");
      return { provider: "test-provider", id: modelId };
    });
    const failure = await translator(actor, "bot-1", "hello", "auto", "zh").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TranslationFailedError);
    expect((failure as TranslationFailedError).attempts).toMatchObject([
      { model: "model-1", outcome: "skipped", pool: "main", errorMessage: "not connected" },
      {
        model: "model-2",
        outcome: "failed",
        pool: "backup",
        errorMessage: "Translation produced no text",
      },
    ]);
  });

  it("tries the backup pool only after the main pool fails", async () => {
    const { translator, resolveConnectedModel, run } = harness({
      bot: {
        translationModels: [{ provider: "test-provider", model: "model-1" }],
        translationBackupModels: [{ provider: "test-provider", model: "model-2" }],
      },
      runs: [doneRun(""), doneRun(""), doneRun('{"detected": "en", "text": "你好"}')],
    });
    resolveConnectedModel.mockImplementation(async (_scope, _provider, modelId) => ({
      provider: "test-provider",
      id: modelId,
      connectionLabel: "主站",
    }));
    const result = await translator(actor, "bot-1", "hello", "auto", "zh");
    expect(result).toMatchObject({
      translatedText: "你好",
      modelId: "model-2",
      usedFallback: true,
      attempts: [
        {
          model: "model-1",
          provider: "主站",
          outcome: "failed",
          pool: "main",
          errorMessage: "Translation produced no text",
        },
        { model: "model-2", provider: "主站", outcome: "succeeded", pool: "backup" },
      ],
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("reads an old single-model bot as a one-element list", async () => {
    const { translator, resolveConnectedModel } = harness({
      bot: { translationModelProvider: "test-provider", translationModelId: "model-1" },
      runs: [doneRun('{"detected": "en", "text": "你好"}')],
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).resolves.toMatchObject({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-1",
      usedFallback: false,
    });
    expect(resolveConnectedModel).toHaveBeenCalledWith(
      { userId: "user-1", spaceId: "space-1" },
      "test-provider",
      "model-1",
    );
  });
});

function probeHarness(options: {
  runs: Array<() => AsyncIterable<unknown>>;
  resolve?: () => Promise<AgentRunRequest["model"]>;
  timeoutMs?: number;
}) {
  const resolveConnectedModel = vi.fn(
    options.resolve ??
      (async () => ({
        provider: "test-provider",
        id: "model-1",
        connectionLabel: "Test Connection",
      })),
  );
  const run = vi.fn();
  for (const next of options.runs) run.mockImplementationOnce(next);
  const runtime = { run };
  const prober = createTranslationProber({
    prisma: {} as unknown as PrismaClient,
    runtime: runtime as unknown as AgentRuntime,
    resolveConnectedModel: resolveConnectedModel as unknown as (
      scope: { userId: string; spaceId: string },
      provider: string,
      modelId: string,
    ) => Promise<AgentRunRequest["model"]>,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return { prober, run, resolveConnectedModel };
}

describe("createTranslationProber", () => {
  it("probes with the fixed sentence and returns the translated text", async () => {
    const { prober, run } = probeHarness({
      runs: [doneRun('{"detected": "en", "text": "你好"}')],
    });
    const result = await prober(actor, "bot-1", "test-provider", "model-1");
    expect(result.supported).toBe(true);
    expect(result.outcome).toBe("supported");
    expect(result.detail).toBe("你好");
    expect(typeof result.seconds).toBe("number");
    const request = run.mock.calls[0]?.[0] as { prompt: string; model: { id: string } };
    expect(request.prompt).toContain('"""\nHello\n"""');
    expect(request.model.id).toBe("model-1");
  });

  it("reports an unconnected model without running", async () => {
    const { prober, run } = probeHarness({
      runs: [],
      resolve: async () => {
        throw new Error("no credential");
      },
    });
    const result = await prober(actor, "bot-1", "test-provider", "model-1");
    expect(result).toEqual({
      supported: false,
      outcome: "unknown",
      seconds: expect.any(Number),
      detail: "该模型未连接",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a model that answers instead of translating", async () => {
    const { prober, run } = probeHarness({
      runs: [doneRun("Hello there, happy to help!")],
    });
    const result = await prober(actor, "bot-1", "test-provider", "model-1");
    expect(result.supported).toBe(false);
    expect(result.outcome).toBe("unsupported");
    expect(result.detail).toContain("Translation did not return JSON");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports an aborted run as unknown, not unsupported", async () => {
    // An iterable whose first pull rejects, like a run cut off mid-flight.
    const abortRun = () => ({
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          next: () => Promise.reject(new DOMException("Request aborted", "AbortError")),
        };
      },
    });
    const { prober } = probeHarness({ runs: [abortRun] });
    const result = await prober(actor, "bot-1", "test-provider", "model-1");
    expect(result.supported).toBe(false);
    expect(result.outcome).toBe("unknown");
    expect(result.detail).toBe("请求中断");
  });

  it("reports a run that never answers before the probe timeout as unknown", async () => {
    const { prober } = probeHarness({ runs: [hangingRun()], timeoutMs: 100 });
    const result = await prober(actor, "bot-1", "test-provider", "model-1");
    expect(result.supported).toBe(false);
    expect(result.outcome).toBe("unknown");
    expect(result.detail).toMatch(/秒内没有回音/);
  });
});
