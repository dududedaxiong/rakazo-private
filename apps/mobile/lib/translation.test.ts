import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  deviceLanguage: vi.fn(async () => "en-US"),
}));

vi.mock("./api", () => ({ rpc: mocks.rpc }));
vi.mock("./i18n", () => ({ deviceLanguage: mocks.deviceLanguage }));

beforeEach(() => {
  mocks.rpc.mockClear();
  mocks.deviceLanguage.mockClear();
});

import {
  DEFAULT_BOT_TRANSLATION_SETTINGS,
  hasTranslationModel,
  resolveTargetLanguage,
  translateBotMessage,
  translationSettingsFromBot,
  translationSourceLabel,
  translationTargetLabel,
  translationTargetShortLabel,
} from "./translation";

describe("translation languages", () => {
  it("labels source and target languages", () => {
    expect(translationSourceLabel("auto")).toBe("自动检测");
    expect(translationSourceLabel("en")).toBe("English");
    expect(translationSourceLabel("ja")).toBe("日语");
    expect(translationTargetLabel("auto")).toBe("自动（跟随系统语言）");
    expect(translationTargetLabel("fr")).toBe("法语");
    expect(translationTargetShortLabel("auto")).toBe("自动");
    expect(translationTargetShortLabel("zh")).toBe("中文");
  });

  it("resolves an auto target from the system locale, falling back to Chinese", () => {
    expect(resolveTargetLanguage("auto", "zh-CN")).toBe("zh");
    expect(resolveTargetLanguage("auto", "en-US")).toBe("en");
    expect(resolveTargetLanguage("auto", "pt-BR")).toBe("pt");
    expect(resolveTargetLanguage("auto", "ar-EG")).toBe("ar");
    expect(resolveTargetLanguage("auto", "xx-YY")).toBe("zh");
    expect(resolveTargetLanguage("auto", null)).toBe("zh");
    expect(resolveTargetLanguage("ja", "zh-CN")).toBe("ja");
  });

  it("defaults unset bot translation settings", () => {
    expect(translationSettingsFromBot(null)).toEqual(DEFAULT_BOT_TRANSLATION_SETTINGS);
    expect(translationSettingsFromBot({})).toEqual(DEFAULT_BOT_TRANSLATION_SETTINGS);
    expect(
      translationSettingsFromBot({
        translationModels: [{ provider: "openai", model: "gpt-5" }],
        translationSourceLanguage: "en",
        translationTargetLanguage: "ja",
        autoTranslate: true,
        showTranslationActions: false,
      }),
    ).toEqual({
      modelProvider: "openai",
      modelId: "gpt-5",
      sourceLanguage: "en",
      targetLanguage: "ja",
      autoTranslate: true,
      showTranslationActions: false,
    });
    // The primary is the list's first entry; fallbacks do not change it.
    expect(
      translationSettingsFromBot({
        translationModels: [
          { provider: "openai", model: "gpt-5" },
          { provider: "deepseek", model: "deepseek-chat" },
        ],
      }),
    ).toEqual({
      ...DEFAULT_BOT_TRANSLATION_SETTINGS,
      modelProvider: "openai",
      modelId: "gpt-5",
    });
    // An unset target is "auto" on mobile; an unknown code falls back to "auto".
    expect(
      translationSettingsFromBot({
        translationTargetLanguage: null,
        translationSourceLanguage: "xx",
      }),
    ).toEqual({
      ...DEFAULT_BOT_TRANSLATION_SETTINGS,
      sourceLanguage: "auto",
      targetLanguage: "auto",
    });
  });

  it("reports whether a translation model is set", () => {
    expect(hasTranslationModel(DEFAULT_BOT_TRANSLATION_SETTINGS)).toBe(false);
    expect(
      hasTranslationModel({
        ...DEFAULT_BOT_TRANSLATION_SETTINGS,
        modelProvider: "openai",
        modelId: null,
      }),
    ).toBe(false);
    expect(
      hasTranslationModel({
        ...DEFAULT_BOT_TRANSLATION_SETTINGS,
        modelProvider: "openai",
        modelId: "gpt-5",
      }),
    ).toBe(true);
  });
});

describe("translateBotMessage", () => {
  it("resolves an auto target from the device language before calling the RPC", async () => {
    mocks.rpc.mockResolvedValue({
      translatedText: "你好",
      sourceLanguage: "en",
      targetLanguage: "zh",
      modelId: "gpt-5",
    });
    const result = await translateBotMessage("bot-1", "Hello", {
      ...DEFAULT_BOT_TRANSLATION_SETTINGS,
      modelProvider: "openai",
      modelId: "gpt-5",
      sourceLanguage: "auto",
      targetLanguage: "auto",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "bots/translate",
      {
        botId: "bot-1",
        text: "Hello",
        sourceLanguage: "auto",
        targetLanguage: "en",
      },
      { timeoutMs: 60_000 },
    );
    expect(result.translatedText).toBe("你好");
  });

  it("passes an explicit target and a provided device tag through", async () => {
    mocks.rpc.mockResolvedValue({
      translatedText: "Bonjour",
      sourceLanguage: "en",
      targetLanguage: "fr",
      modelId: "gpt-5",
    });
    await translateBotMessage(
      "bot-1",
      "Hello",
      {
        ...DEFAULT_BOT_TRANSLATION_SETTINGS,
        modelProvider: "openai",
        modelId: "gpt-5",
        sourceLanguage: "en",
        targetLanguage: "fr",
      },
      "zh-CN",
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "bots/translate",
      {
        botId: "bot-1",
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "fr",
      },
      { timeoutMs: 60_000 },
    );
    expect(mocks.deviceLanguage).not.toHaveBeenCalled();
  });
});
