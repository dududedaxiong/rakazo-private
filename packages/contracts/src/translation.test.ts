import { describe, expect, it } from "vitest";
import { UpdateBotInput } from "./domain.js";
import {
  resolveTargetLanguage,
  TRANSLATION_SOURCE_LANGUAGE_LABELS,
  TRANSLATION_TARGET_LANGUAGE_LABELS,
  TranslateInputSchema,
  TranslateOutputSchema,
  TranslationSourceLanguageSchema,
  TranslationTargetLanguageSchema,
} from "./translation.js";

const BOT_ID = "bot-1";

describe("translation languages", () => {
  it("labels auto differently for source and target", () => {
    expect(TRANSLATION_SOURCE_LANGUAGE_LABELS.auto).toBe("自动检测");
    expect(TRANSLATION_TARGET_LANGUAGE_LABELS.auto).toBe("自动（跟随系统语言）");
    expect(TRANSLATION_TARGET_LANGUAGE_LABELS.fr).toBe("法语");
    expect(TRANSLATION_SOURCE_LANGUAGE_LABELS.ko).toBe("韩语");
  });

  it("accepts the source and target language codes", () => {
    expect(TranslationSourceLanguageSchema.parse("auto")).toBe("auto");
    expect(TranslationSourceLanguageSchema.safeParse("fr").success).toBe(false);
    expect(TranslationTargetLanguageSchema.parse("fr")).toBe("fr");
    expect(TranslationTargetLanguageSchema.safeParse("xx").success).toBe(false);
  });

  it("resolves auto from the system language, falling back to Chinese", () => {
    expect(resolveTargetLanguage("fr")).toBe("fr");
    expect(resolveTargetLanguage("auto", "zh-CN")).toBe("zh");
    expect(resolveTargetLanguage("auto", "en-US")).toBe("en");
    expect(resolveTargetLanguage("auto", "pt-BR")).toBe("pt");
    expect(resolveTargetLanguage("auto", "xx-YY")).toBe("zh");
    expect(resolveTargetLanguage("auto")).toBe("zh");
    expect(resolveTargetLanguage("xx")).toBe("zh");
  });
});

describe("TranslateInputSchema", () => {
  it("accepts a translation request", () => {
    expect(
      TranslateInputSchema.parse({
        botId: BOT_ID,
        text: "hello",
        sourceLanguage: "auto",
        targetLanguage: "zh",
      }),
    ).toEqual({ botId: BOT_ID, text: "hello", sourceLanguage: "auto", targetLanguage: "zh" });
  });

  it("rejects empty or oversized text", () => {
    const base = { botId: BOT_ID, sourceLanguage: "auto", targetLanguage: "zh" };
    expect(TranslateInputSchema.safeParse({ ...base, text: "" }).success).toBe(false);
    expect(TranslateInputSchema.safeParse({ ...base, text: "x".repeat(8001) }).success).toBe(false);
    expect(TranslateInputSchema.safeParse({ ...base, text: "x".repeat(8000) }).success).toBe(true);
  });

  it("parses a translation result", () => {
    expect(
      TranslateOutputSchema.parse({
        translatedText: "你好",
        sourceLanguage: "en",
        targetLanguage: "zh",
        modelId: "model-1",
      }),
    ).toEqual({
      translatedText: "你好",
      sourceLanguage: "en",
      targetLanguage: "zh",
      modelId: "model-1",
    });
  });
});

describe("UpdateBotInput translation settings", () => {
  it("accepts a paired translation model", () => {
    const parsed = UpdateBotInput.parse({
      botId: BOT_ID,
      translationModelProvider: "openai",
      translationModelId: "gpt-5",
      translationSourceLanguage: "auto",
      translationTargetLanguage: "zh",
      autoTranslate: true,
    });
    expect(parsed.translationModelProvider).toBe("openai");
    expect(parsed.autoTranslate).toBe(true);
  });

  it("accepts clearing the translation model as a pair", () => {
    const parsed = UpdateBotInput.parse({
      botId: BOT_ID,
      translationModelProvider: null,
      translationModelId: null,
    });
    expect(parsed.translationModelProvider).toBeNull();
    expect(parsed.translationModelId).toBeNull();
  });

  it("rejects a half-set translation model pair", () => {
    expect(UpdateBotInput.safeParse({ botId: BOT_ID, translationModelId: "gpt-5" }).success).toBe(
      false,
    );
    expect(
      UpdateBotInput.safeParse({ botId: BOT_ID, translationModelProvider: "openai" }).success,
    ).toBe(false);
    expect(
      UpdateBotInput.safeParse({
        botId: BOT_ID,
        translationModelProvider: "openai",
        translationModelId: null,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown source language", () => {
    expect(
      UpdateBotInput.safeParse({ botId: BOT_ID, translationSourceLanguage: "fr" }).success,
    ).toBe(false);
  });
});
