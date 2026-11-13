import type { TranslationSourceLanguage, TranslationTargetLanguage } from "@rakazo/contracts";
import {
  resolveTargetLanguage as resolveContractTargetLanguage,
  TRANSLATION_SOURCE_LANGUAGE_CODES,
  TRANSLATION_SOURCE_LANGUAGE_LABELS,
  TRANSLATION_TARGET_LANGUAGE_CODES,
  TRANSLATION_TARGET_LANGUAGE_LABELS,
} from "@rakazo/contracts";
import { rpc } from "./api";
import { deviceLanguage } from "./i18n";

/** Re-exported contract codes, so settings rows iterate one source of truth. */
export const TRANSLATION_SOURCE_LANGUAGES = TRANSLATION_SOURCE_LANGUAGE_CODES;
export type { TranslationSourceLanguage };

export const TRANSLATION_TARGET_LANGUAGES = TRANSLATION_TARGET_LANGUAGE_CODES;
export type { TranslationTargetLanguage };

/** The source-language label the settings row shows. */
export function translationSourceLabel(code: string): string {
  return TRANSLATION_SOURCE_LANGUAGE_LABELS[code as TranslationSourceLanguage] ?? code;
}

/** The target-language label the settings picker shows. */
export function translationTargetLabel(code: string): string {
  return TRANSLATION_TARGET_LANGUAGE_LABELS[code as TranslationTargetLanguage] ?? code;
}

/** The short target label the direction row shows ("自动检测 → 自动"). */
export function translationTargetShortLabel(code: string): string {
  if (code === "auto") return "自动";
  return TRANSLATION_TARGET_LANGUAGE_LABELS[code as TranslationTargetLanguage] ?? code;
}

function isSourceLanguage(code: string): code is TranslationSourceLanguage {
  return (TRANSLATION_SOURCE_LANGUAGES as readonly string[]).includes(code);
}

export function isTranslationSourceLanguage(code: string): code is TranslationSourceLanguage {
  return isSourceLanguage(code);
}

function isTargetLanguage(code: string): code is TranslationTargetLanguage {
  return (TRANSLATION_TARGET_LANGUAGES as readonly string[]).includes(code);
}

export function isTranslationTargetLanguage(code: string): code is TranslationTargetLanguage {
  return isTargetLanguage(code);
}

export type BotTranslationSettings = {
  modelProvider: string | null;
  modelId: string | null;
  sourceLanguage: TranslationSourceLanguage;
  /** "auto" follows the system language; the server stores null for unset. */
  targetLanguage: TranslationTargetLanguage;
  autoTranslate: boolean;
  /** Show read-aloud, share, and favorite actions on a translation. */
  showTranslationActions: boolean;
};

export const DEFAULT_BOT_TRANSLATION_SETTINGS: BotTranslationSettings = {
  modelProvider: null,
  modelId: null,
  sourceLanguage: "auto",
  targetLanguage: "auto",
  autoTranslate: false,
  showTranslationActions: true,
};

/**
 * Reads a bot's translation settings, defaulting an unset source to "auto",
 * an unset target to "auto" (follow the system language), auto-translate
 * to off, and the translation actions to shown.
 */
export function translationSettingsFromBot(
  bot:
    | {
        translationModelProvider?: string | null;
        translationModelId?: string | null;
        translationSourceLanguage?: string;
        translationTargetLanguage?: string | null;
        autoTranslate?: boolean;
        showTranslationActions?: boolean;
      }
    | null
    | undefined,
): BotTranslationSettings {
  const sourceLanguage =
    bot?.translationSourceLanguage && isSourceLanguage(bot.translationSourceLanguage)
      ? bot.translationSourceLanguage
      : "auto";
  const targetLanguage =
    bot?.translationTargetLanguage && isTargetLanguage(bot.translationTargetLanguage)
      ? bot.translationTargetLanguage
      : "auto";
  return {
    modelProvider: bot?.translationModelProvider ?? null,
    modelId: bot?.translationModelId ?? null,
    sourceLanguage,
    targetLanguage,
    autoTranslate: bot?.autoTranslate ?? false,
    showTranslationActions: bot?.showTranslationActions ?? true,
  };
}

/** Whether this bot has a translation model picked. */
export function hasTranslationModel(settings: BotTranslationSettings): boolean {
  return Boolean(settings.modelProvider && settings.modelId);
}

/**
 * Resolves the target "auto" to a concrete language from the phone's system
 * locale ("zh-CN" -> "zh"); an unsupported locale falls back to Chinese.
 * A concrete target passes through unchanged.
 */
export function resolveTargetLanguage(
  target: string,
  deviceTag: string | null,
): TranslationTargetLanguage {
  const resolved = resolveContractTargetLanguage(target, deviceTag ?? undefined);
  return isTargetLanguage(resolved) ? resolved : "zh";
}

export type BotTranslationResult = {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  modelId: string;
};

/**
 * Translates one message through rpc.bots.translate, resolving an "auto"
 * target from the system language first; an "auto" source goes to the
 * server as-is for the model to detect. Pass `deviceTag` in tests to skip
 * reading the device locale.
 */
export async function translateBotMessage(
  botId: string,
  text: string,
  settings: BotTranslationSettings,
  deviceTag?: string | null,
): Promise<BotTranslationResult> {
  const targetLanguage = resolveTargetLanguage(
    settings.targetLanguage,
    deviceTag ?? (await deviceLanguage()),
  );
  return rpc("bots/translate", {
    botId,
    text,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage,
  });
}
