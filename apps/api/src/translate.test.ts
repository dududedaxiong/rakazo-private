import type { AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { Translator } from "./translate.js";
import { createTranslator, TranslationModelNotConfiguredError } from "./translate.js";

const actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@example.com",
  isDeploymentOwner: false,
} satisfies Actor;

type BotConfig = {
  translationModelProvider: string | null;
  translationModelId: string | null;
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
  const resolveConnectedModel = vi.fn(async () => ({ provider: "test-provider", id: "model-1" }));
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
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).resolves.toEqual({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-1",
    });
    expect(resolveConnectedModel).toHaveBeenCalledWith(
      { userId: "user-1", spaceId: "space-1" },
      "test-provider",
      "model-1",
    );
  });

  it("strips a fenced JSON reply", async () => {
    const { translator } = harness({
      runs: [doneRun('```json\n{"detected": "ja", "text": "你好"}\n```')],
    });
    await expect(translator(actor, "bot-1", "こんにちは", "auto", "zh")).resolves.toEqual({
      translatedText: "你好",
      detectedLanguage: "ja",
      modelId: "model-1",
    });
  });

  it("falls back to the whole reply when the model does not answer JSON", async () => {
    const { translator } = harness({ runs: [doneRun("Bonjour le monde")] });
    await expect(translator(actor, "bot-1", "Hello world", "en", "fr")).resolves.toEqual({
      translatedText: "Bonjour le monde",
      detectedLanguage: "en",
      modelId: "model-1",
    });
  });

  it("keeps the requested source when the fallback reply is used with auto detection", async () => {
    const { translator } = harness({ runs: [doneRun("plain text, no JSON")] });
    const result = await translator(actor, "bot-1", "plain text", "auto", "zh");
    expect(result).toEqual({
      translatedText: "plain text, no JSON",
      detectedLanguage: "auto",
      modelId: "model-1",
    });
  });

  it("retries once on an empty result, then succeeds", async () => {
    const { translator, run } = harness({
      runs: [doneRun(""), doneRun('{"detected": "en", "text": "你好"}')],
    });
    await expect(translator(actor, "bot-1", "hello", "auto", "zh")).resolves.toEqual({
      translatedText: "你好",
      detectedLanguage: "en",
      modelId: "model-1",
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
});
