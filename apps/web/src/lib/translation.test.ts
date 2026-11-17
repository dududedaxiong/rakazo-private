import type { Bot } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import {
  botTranslationSettings,
  hasTranslationModel,
  isTranslationSourceLanguage,
  isTranslationTargetLanguage,
  resolveTranslationTargetLanguage,
  translationLanguageLabel,
  translationModelKey,
} from "./translation";

function bot(overrides: Record<string, unknown> = {}): Bot {
  return { id: "bot-1", ...overrides } as unknown as Bot;
}

describe("botTranslationSettings", () => {
  it("fills in the defaults for a bot with no translation fields", () => {
    expect(botTranslationSettings(bot())).toEqual({
      translationModelProvider: null,
      translationModelId: null,
      translationSourceLanguage: "auto",
      translationTargetLanguage: null,
      autoTranslate: false,
      showTranslationActions: true,
    });
  });

  it("keeps a stored model, languages and auto-translate", () => {
    expect(
      botTranslationSettings(
        bot({
          translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
          translationSourceLanguage: "en",
          translationTargetLanguage: "zh",
          autoTranslate: true,
          showTranslationActions: false,
        }),
      ),
    ).toEqual({
      translationModelProvider: "deepseek",
      translationModelId: "deepseek-v4.1-flash",
      translationSourceLanguage: "en",
      translationTargetLanguage: "zh",
      autoTranslate: true,
      showTranslationActions: false,
    });
  });

  it("reads the primary from an ordered list, fallbacks aside", () => {
    expect(
      botTranslationSettings(
        bot({
          translationModels: [
            { provider: "deepseek", model: "deepseek-v4.1-flash" },
            { provider: "openai", model: "gpt-5" },
          ],
        }),
      ),
    ).toMatchObject({
      translationModelProvider: "deepseek",
      translationModelId: "deepseek-v4.1-flash",
    });
  });

  it("falls back to auto and unset for unknown language codes", () => {
    const settings = botTranslationSettings(
      bot({ translationSourceLanguage: "xx", translationTargetLanguage: "yy" }),
    );
    expect(settings.translationSourceLanguage).toBe("auto");
    expect(settings.translationTargetLanguage).toBeNull();
  });
});

describe("translation language guards", () => {
  it("accepts only the source list, auto included", () => {
    expect(isTranslationSourceLanguage("auto")).toBe(true);
    expect(isTranslationSourceLanguage("fr")).toBe(false);
    expect(isTranslationSourceLanguage(null)).toBe(false);
  });

  it("accepts only the target list, auto excluded", () => {
    expect(isTranslationTargetLanguage("fr")).toBe(true);
    expect(isTranslationTargetLanguage("auto")).toBe(false);
    expect(isTranslationTargetLanguage(undefined)).toBe(false);
  });
});

describe("translationLanguageLabel", () => {
  it("uses the contract labels and falls back to the code", () => {
    expect(translationLanguageLabel("auto")).toBe("自动检测");
    expect(translationLanguageLabel("zh")).toBe("中文");
    expect(translationLanguageLabel("en")).toBe("English");
    expect(translationLanguageLabel("xx")).toBe("xx");
  });
});

describe("resolveTranslationTargetLanguage", () => {
  it("defaults an unset target to Chinese", () => {
    expect(resolveTranslationTargetLanguage({ translationTargetLanguage: null })).toBe("zh");
    expect(resolveTranslationTargetLanguage({ translationTargetLanguage: "ja" })).toBe("ja");
  });
});

describe("translation model", () => {
  it("needs a provider and an id together", () => {
    expect(
      hasTranslationModel({ translationModelProvider: "deepseek", translationModelId: null }),
    ).toBe(false);
    expect(
      hasTranslationModel({
        translationModelProvider: "deepseek",
        translationModelId: "deepseek-v4.1-flash",
      }),
    ).toBe(true);
  });

  it("encodes a set model as a picker key and an unset one as empty", () => {
    expect(
      translationModelKey({
        translationModelProvider: "deepseek",
        translationModelId: "deepseek-v4.1-flash",
        translationSourceLanguage: "auto",
        translationTargetLanguage: null,
        autoTranslate: false,
        showTranslationActions: true,
      }),
    ).toBe("deepseek::deepseek-v4.1-flash");
    expect(
      translationModelKey({
        translationModelProvider: null,
        translationModelId: null,
        translationSourceLanguage: "auto",
        translationTargetLanguage: null,
        autoTranslate: false,
        showTranslationActions: true,
      }),
    ).toBe("");
  });
});
