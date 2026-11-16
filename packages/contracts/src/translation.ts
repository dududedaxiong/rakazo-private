import * as z from "zod";
import { Id } from "./ids.js";
import { ModelSwitchAttemptSchema } from "./model-switches.js";

/** Languages a message can be translated from; `auto` lets the model detect it. */
export const TRANSLATION_SOURCE_LANGUAGE_CODES = ["auto", "zh", "en", "ja", "ko"] as const;
export type TranslationSourceLanguageCode = (typeof TRANSLATION_SOURCE_LANGUAGE_CODES)[number];

/** Languages a message can be translated to; `auto` follows the system language. */
export const TRANSLATION_TARGET_LANGUAGE_CODES = [
  "auto",
  "zh",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "ar",
] as const;
export type TranslationTargetLanguageCode = (typeof TRANSLATION_TARGET_LANGUAGE_CODES)[number];

export const TRANSLATION_SOURCE_LANGUAGE_LABELS: Record<TranslationSourceLanguageCode, string> = {
  auto: "自动检测",
  zh: "中文",
  en: "English",
  ja: "日语",
  ko: "韩语",
};

export const TRANSLATION_TARGET_LANGUAGE_LABELS: Record<TranslationTargetLanguageCode, string> = {
  auto: "自动（跟随系统语言）",
  zh: "中文",
  en: "English",
  ja: "日语",
  ko: "韩语",
  fr: "法语",
  de: "德语",
  es: "西班牙语",
  pt: "葡萄牙语",
  ru: "俄语",
  ar: "阿拉伯语",
};

export const TranslationSourceLanguageSchema = z.enum(TRANSLATION_SOURCE_LANGUAGE_CODES);
export type TranslationSourceLanguage = z.infer<typeof TranslationSourceLanguageSchema>;

export const TranslationTargetLanguageSchema = z.enum(TRANSLATION_TARGET_LANGUAGE_CODES);
export type TranslationTargetLanguage = z.infer<typeof TranslationTargetLanguageSchema>;

export const TranslateInputSchema = z.object({
  botId: Id,
  text: z.string().min(1).max(8000),
  sourceLanguage: TranslationSourceLanguageSchema,
  targetLanguage: TranslationTargetLanguageSchema,
  /**
   * The message being translated. When present the server keeps the result
   * on the message, so it survives a reload instead of living only in the
   * panel that asked for it.
   */
  messageId: Id.optional(),
});
export type TranslateInput = z.infer<typeof TranslateInputSchema>;

export const TranslateOutputSchema = z.object({
  translatedText: z.string(),
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  modelId: z.string(),
  /** True when the translation came from a fallback model, not the primary. */
  usedFallback: z.boolean(),
  /** Every model tried, in order, when more than the first was needed. */
  attempts: z.array(ModelSwitchAttemptSchema).optional(),
});
export type TranslateOutput = z.infer<typeof TranslateOutputSchema>;

/**
 * A translation kept on a message: the same shape as a translate result,
 * without the request echo. The history loader attaches it, so a reloaded
 * thread shows the translation it already has.
 */
export const SavedMessageTranslationSchema = z.object({
  translatedText: z.string(),
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  modelId: z.string(),
  usedFallback: z.boolean(),
  attempts: z.array(ModelSwitchAttemptSchema).optional(),
});
export type SavedMessageTranslation = z.infer<typeof SavedMessageTranslationSchema>;

/**
 * Resolve a target language code to a concrete language. A concrete code
 * passes through; `auto` takes the system language's primary subtag when it
 * is a supported target, and falls back to Chinese otherwise.
 */
export function resolveTargetLanguage(code: string, systemLanguage?: string): string {
  if (code !== "auto") {
    return (TRANSLATION_TARGET_LANGUAGE_CODES as readonly string[]).includes(code) ? code : "zh";
  }
  const primary = systemLanguage?.split(/[-_]/)[0]?.toLowerCase();
  if (
    primary &&
    primary !== "auto" &&
    (TRANSLATION_TARGET_LANGUAGE_CODES as readonly string[]).includes(primary)
  ) {
    return primary;
  }
  return "zh";
}
