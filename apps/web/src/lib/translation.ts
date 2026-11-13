import type {
  TranslationTargetLanguage as ContractTranslationTargetLanguage,
  TranslateInput,
  TranslateOutput,
  TranslationSourceLanguage,
} from "@rakazo/contracts";
import {
  TRANSLATION_SOURCE_LANGUAGE_CODES,
  TRANSLATION_SOURCE_LANGUAGE_LABELS,
  TRANSLATION_TARGET_LANGUAGE_CODES,
  TRANSLATION_TARGET_LANGUAGE_LABELS,
} from "@rakazo/contracts";
import { modelOptionKey } from "@rakazo/core";
import type { createSpaceRpc } from "./rpc";

/**
 * Translation settings on a bot. Codes, labels and the RPC shapes come from
 * the shared contract (`packages/contracts/src/translation.ts`); the web
 * target list drops `auto` — the web has no "follow the system language"
 * target, its default is Chinese.
 */
export type { TranslationSourceLanguage };
export type TranslationTargetLanguage = Exclude<ContractTranslationTargetLanguage, "auto">;

export const TRANSLATION_SOURCE_LANGUAGES = TRANSLATION_SOURCE_LANGUAGE_CODES;
export const TRANSLATION_TARGET_LANGUAGES: readonly TranslationTargetLanguage[] =
  TRANSLATION_TARGET_LANGUAGE_CODES.filter(
    (code): code is TranslationTargetLanguage => code !== "auto",
  );
export const DEFAULT_TRANSLATION_SOURCE_LANGUAGE: TranslationSourceLanguage = "auto";
/** A bot with no target set translates into Chinese. */
export const DEFAULT_TRANSLATION_TARGET_LANGUAGE: TranslationTargetLanguage = "zh";

export interface BotTranslationSettings {
  translationModelProvider: string | null;
  translationModelId: string | null;
  translationSourceLanguage: TranslationSourceLanguage;
  translationTargetLanguage: TranslationTargetLanguage | null;
  autoTranslate: boolean;
  showTranslationActions: boolean;
}

const SOURCE_LANGUAGES = new Set<string>(TRANSLATION_SOURCE_LANGUAGES);
const TARGET_LANGUAGES = new Set<string>(TRANSLATION_TARGET_LANGUAGES);

export function isTranslationSourceLanguage(
  value: string | null | undefined,
): value is TranslationSourceLanguage {
  return typeof value === "string" && SOURCE_LANGUAGES.has(value);
}

export function isTranslationTargetLanguage(
  value: string | null | undefined,
): value is TranslationTargetLanguage {
  return typeof value === "string" && TARGET_LANGUAGES.has(value);
}

/** The language name a settings row and a translation header show. */
export function translationLanguageLabel(code: string): string {
  return (
    TRANSLATION_SOURCE_LANGUAGE_LABELS[code as TranslationSourceLanguage] ??
    TRANSLATION_TARGET_LANGUAGE_LABELS[code as ContractTranslationTargetLanguage] ??
    code
  );
}

/**
 * A bot's translation settings, with the web default filled in for an unset target.
 * Accepts a full bot or the partial bot shape the message roster hands out.
 */
export function botTranslationSettings(bot: {
  translationModelProvider?: string | null;
  translationModelId?: string | null;
  translationSourceLanguage?: string;
  translationTargetLanguage?: string | null;
  autoTranslate?: boolean;
  showTranslationActions?: boolean;
}): BotTranslationSettings {
  return {
    translationModelProvider: bot.translationModelProvider ?? null,
    translationModelId: bot.translationModelId ?? null,
    translationSourceLanguage: isTranslationSourceLanguage(bot.translationSourceLanguage)
      ? bot.translationSourceLanguage
      : DEFAULT_TRANSLATION_SOURCE_LANGUAGE,
    translationTargetLanguage: isTranslationTargetLanguage(bot.translationTargetLanguage)
      ? bot.translationTargetLanguage
      : null,
    autoTranslate: bot.autoTranslate ?? false,
    showTranslationActions: bot.showTranslationActions ?? true,
  };
}

/** The target language a translate call uses; unset means Chinese. */
export function resolveTranslationTargetLanguage(
  settings: Pick<BotTranslationSettings, "translationTargetLanguage">,
): TranslationTargetLanguage {
  return settings.translationTargetLanguage ?? DEFAULT_TRANSLATION_TARGET_LANGUAGE;
}

/** A translation model is set only when its provider and id are set together. */
export function hasTranslationModel(
  settings: Pick<BotTranslationSettings, "translationModelProvider" | "translationModelId">,
): boolean {
  return Boolean(settings.translationModelProvider && settings.translationModelId);
}

/** The model picker's key for the bot's translation model, or "" when unset. */
export function translationModelKey(settings: BotTranslationSettings): string {
  return settings.translationModelProvider && settings.translationModelId
    ? modelOptionKey(settings.translationModelProvider, settings.translationModelId)
    : "";
}

/** Calls `rpc.bots.translate` with the bot's stored languages. */
export async function translateBotMessage(
  rpc: ReturnType<typeof createSpaceRpc>,
  input: TranslateInput,
): Promise<TranslateOutput> {
  return rpc.bots.translate(input);
}
