import { Trans, useLingui } from "@lingui/react/macro";
import type { BotModelEntry, TranslateOutput } from "@rakazo/contracts";
import { moveBotModelToFront } from "@rakazo/contracts";
import { displayName, modelOptionKey, stripLeadingOpaqueCodeLine } from "@rakazo/core";
import {
  Button,
  CopyTextFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
  useCopyText,
} from "@rakazo/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { favoriteSnippet, translationFavoriteId, useMessageFavorite } from "../../lib/favorites";
import { modelStatusFromProbe, recordModelStatus } from "../../lib/model-status";
import type { createSpaceRpc } from "../../lib/rpc";
import type {
  BotTranslationSettings,
  TranslationSourceLanguage,
  TranslationTargetLanguage,
} from "../../lib/translation";
import {
  DEFAULT_TRANSLATION_SOURCE_LANGUAGE,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  hasTranslationModel,
  resolveTranslationTargetLanguage,
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  translateBotMessage,
  translationLanguageLabel,
} from "../../lib/translation";
import { errorText } from "../../lib/user-error";
import { ModelSwitchMenu } from "./model-switch-menu";

type TranslationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: TranslateOutput }
  | { status: "error"; message: string };

/**
 * The language direction in a translation title: two groups, source and target,
 * with the current language in each checked. Selecting one updates the bot's
 * languages and re-translates the message.
 */
function LanguageSwitchMenu({
  sourceLanguage,
  targetLanguage,
  applying,
  onSelectSource,
  onSelectTarget,
  children,
}: {
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  applying: boolean;
  onSelectSource: (code: TranslationSourceLanguage) => void;
  onSelectTarget: (code: TranslationTargetLanguage) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="rounded-sm underline decoration-dotted underline-offset-2"
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t`Source language`}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {TRANSLATION_SOURCE_LANGUAGES.map((code) => (
          <DropdownMenuItem key={code} disabled={applying} onClick={() => onSelectSource(code)}>
            {code === sourceLanguage ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4" aria-hidden="true" />
            )}
            <span className="truncate">{translationLanguageLabel(code)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t`Target language`}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {TRANSLATION_TARGET_LANGUAGES.map((code) => (
          <DropdownMenuItem key={code} disabled={applying} onClick={() => onSelectTarget(code)}>
            {code === targetLanguage ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4" aria-hidden="true" />
            )}
            <span className="truncate">{translationLanguageLabel(code)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A bot reply's Translate link and the translation panel under its bubble.
 * `actions` sits inside the bubble next to Speak; `panel` sits under it.
 * The translation is local display state: the original message never changes.
 */
export function useMessageTranslation({
  messageId,
  text,
  botId,
  settings,
  translationModels,
  rpc,
  isLastMessage = false,
  speakText,
  speaking = false,
  speakDisabled = false,
  onBotChanged,
}: {
  messageId: string;
  text: string;
  botId: string | undefined;
  settings: BotTranslationSettings | undefined;
  /** The bot's ordered translation models; the first is primary, rest are fallbacks. */
  translationModels?: readonly BotModelEntry[] | null;
  rpc: ReturnType<typeof createSpaceRpc>;
  /** Only the newest reply auto-translates; opening history must not re-fire every message. */
  isLastMessage?: boolean;
  /** Reads arbitrary text in the bot's voice; absent when voice is not ready. */
  speakText?: (text: string) => void;
  /** This message is being read aloud right now. */
  speaking?: boolean;
  /** A call holds the speaker, so a new read waits until it ends. */
  speakDisabled?: boolean;
  /** After a model or language switch, so the roster follows the updated bot. */
  onBotChanged?: () => Promise<void>;
}): { actions: ReactNode; panel: ReactNode } {
  const { t } = useLingui();
  const [state, setState] = useState<TranslationState>({ status: "idle" });
  const [collapsed, setCollapsed] = useState(false);
  const attemptedAutoRef = useRef(false);
  const [copied, copy, copyFailed, resetCopy, copyFailedText] = useCopyText();
  /** The bot's switch for the read-aloud, share, and favorite actions; on by default. */
  const showActions = settings?.showTranslationActions ?? true;
  /** The model being switched to; the menu stays disabled until it lands. */
  const [applyingModelKey, setApplyingModelKey] = useState<string | null>(null);
  /** A language switch in flight; the menu stays disabled until it lands. */
  const [applyingLanguage, setApplyingLanguage] = useState(false);
  // A model sometimes echoes its own short id as a lone first line; that line
  // is not content, so the displayed (and copied, shared, favorited) text drops it.
  const translatedText =
    state.status === "done" ? stripLeadingOpaqueCodeLine(state.result.translatedText) : "";
  // A translation saves under its own id, so favoriting it never toggles the original.
  const translationFavorite = useMessageFavorite({
    rpc,
    botId,
    messageId: translationFavoriteId(messageId),
    snippet: favoriteSnippet(translatedText),
    text: translatedText,
  });

  useEffect(() => {
    setState({ status: "idle" });
    setCollapsed(false);
    attemptedAutoRef.current = false;
  }, [messageId]);

  const translate = useCallback(
    async (override?: {
      sourceLanguage?: TranslationSourceLanguage;
      targetLanguage?: TranslationTargetLanguage | null;
    }) => {
      if (!botId) return;
      if (state.status === "done" && collapsed && !override) {
        setCollapsed(false);
        return;
      }
      if (!settings || !hasTranslationModel(settings)) {
        toast(t`Choose a translation model in this bot's Advanced settings`);
        return;
      }
      if (!text.trim()) return;
      setCollapsed(false);
      setState({ status: "loading" });
      const started = Date.now();
      // The primary model that ran; a fallback's provider is unknown, so its
      // outcome is not recorded against the primary.
      const primaryKey = modelOptionKey(
        settings.translationModelProvider ?? "",
        settings.translationModelId ?? "",
      );
      try {
        const result = await translateBotMessage(rpc, {
          botId,
          text,
          sourceLanguage: override?.sourceLanguage ?? settings.translationSourceLanguage,
          targetLanguage:
            override?.targetLanguage !== undefined
              ? (override.targetLanguage ?? DEFAULT_TRANSLATION_TARGET_LANGUAGE)
              : resolveTranslationTargetLanguage(settings),
        });
        if (!result.usedFallback) {
          recordModelStatus(
            primaryKey,
            modelStatusFromProbe({ supported: true, seconds: (Date.now() - started) / 1000 }),
          );
        }
        setState({ status: "done", result });
      } catch (err) {
        recordModelStatus(primaryKey, { state: "unavailable", seconds: null });
        setState({ status: "error", message: errorText(err, t`Translation failed`) });
      }
    },
    [botId, collapsed, rpc, settings, state.status, t, text],
  );

  /** Switches the bot's translation model, then re-translates with the new primary. */
  const switchModel = useCallback(
    async (entry: BotModelEntry) => {
      if (!botId || applyingModelKey) return;
      const key = modelOptionKey(entry.provider, entry.model);
      if (
        key ===
        modelOptionKey(settings?.translationModelProvider ?? "", settings?.translationModelId ?? "")
      )
        return;
      setApplyingModelKey(key);
      try {
        await rpc.bots.update({
          botId,
          translationModels: moveBotModelToFront(translationModels, entry),
        });
        await onBotChanged?.();
        await translate();
      } catch (err) {
        toast(errorText(err, t`Could not switch translation model`));
      } finally {
        setApplyingModelKey(null);
      }
    },
    [applyingModelKey, botId, onBotChanged, rpc, settings, t, translate, translationModels],
  );

  /** Switches the bot's translation languages, then re-translates with them. */
  const switchLanguage = useCallback(
    async (next: {
      sourceLanguage?: TranslationSourceLanguage;
      targetLanguage?: TranslationTargetLanguage | null;
    }) => {
      if (!botId || applyingLanguage) return;
      const sourceLanguage = next.sourceLanguage ?? settings?.translationSourceLanguage;
      const targetLanguage =
        next.targetLanguage !== undefined
          ? next.targetLanguage
          : (settings?.translationTargetLanguage ?? null);
      if (
        sourceLanguage === settings?.translationSourceLanguage &&
        targetLanguage === (settings?.translationTargetLanguage ?? null)
      )
        return;
      setApplyingLanguage(true);
      try {
        await rpc.bots.update({
          botId,
          ...(next.sourceLanguage !== undefined
            ? { translationSourceLanguage: next.sourceLanguage }
            : {}),
          ...(next.targetLanguage !== undefined
            ? { translationTargetLanguage: next.targetLanguage }
            : {}),
        });
        await onBotChanged?.();
        await translate({
          sourceLanguage: sourceLanguage ?? DEFAULT_TRANSLATION_SOURCE_LANGUAGE,
          targetLanguage,
        });
      } catch (err) {
        toast(errorText(err, t`Could not switch translation language`));
      } finally {
        setApplyingLanguage(false);
      }
    },
    [applyingLanguage, botId, onBotChanged, rpc, settings, t, translate],
  );

  useEffect(() => {
    if (!isLastMessage || !settings?.autoTranslate || attemptedAutoRef.current) return;
    if (!botId || !text.trim() || !hasTranslationModel(settings)) return;
    attemptedAutoRef.current = true;
    void translate();
  }, [botId, isLastMessage, settings, text, translate]);

  const expanded = state.status !== "idle" && !collapsed;
  const actions = (
    <Button
      variant="text"
      size="xs"
      aria-label={state.status === "loading" ? t`Translating` : t`Translate this reply`}
      disabled={state.status === "loading"}
      onClick={() => void translate()}
      className="font-normal text-link"
    >
      {state.status === "loading" ? <Trans>Translating…</Trans> : <Trans>Translate</Trans>}
    </Button>
  );

  // Share falls back to copying when the browser has no share sheet, and a
  // dismissed sheet copies nothing.
  const shareTranslation = useCallback(async () => {
    if (state.status !== "done") return;
    const text = translatedText;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy(text);
  }, [copy, state.status, translatedText]);

  if (!expanded) return { actions, panel: null };

  const targetLanguage = resolveTranslationTargetLanguage(
    settings ?? { translationTargetLanguage: null },
  );
  const sourceLanguage = settings?.translationSourceLanguage ?? DEFAULT_TRANSLATION_SOURCE_LANGUAGE;
  const doneResult = state.status === "done" ? state.result : null;
  const currentModelKey = modelOptionKey(
    settings?.translationModelProvider ?? "",
    settings?.translationModelId ?? "",
  );
  const modelMenu = doneResult ? (
    <ModelSwitchMenu
      label={t`Translation model`}
      models={translationModels ?? []}
      currentKey={currentModelKey}
      applyingKey={applyingModelKey}
      onSelect={(entry) => void switchModel(entry)}
    >
      {displayName(doneResult.modelId, t`Model`)}
    </ModelSwitchMenu>
  ) : null;
  const languageMenu = doneResult ? (
    <LanguageSwitchMenu
      sourceLanguage={sourceLanguage}
      targetLanguage={targetLanguage}
      applying={applyingLanguage}
      onSelectSource={(code) => void switchLanguage({ sourceLanguage: code })}
      onSelectTarget={(code) => void switchLanguage({ targetLanguage: code })}
    >
      {translationLanguageLabel(doneResult.sourceLanguage)} to{" "}
      {translationLanguageLabel(targetLanguage)}
    </LanguageSwitchMenu>
  ) : null;
  const panel = (
    <div data-testid="message-translation" className="mt-2 w-full rounded-xl bg-link/10 px-4 py-3">
      {state.status === "loading" ? (
        <p className="text-body text-muted-foreground">
          <Trans>Translating…</Trans>
        </p>
      ) : state.status === "error" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-body text-destructive">{state.message}</span>
          <button
            type="button"
            onClick={() => void translate()}
            className="text-body text-link"
            aria-label={t`Retry translation`}
          >
            <Trans>Retry</Trans>
          </button>
        </div>
      ) : (
        <>
          <p className="text-body-sm text-link">
            {state.result.usedFallback ? (
              <Trans>
                Translated with {modelMenu} (backup) · {languageMenu}
              </Trans>
            ) : (
              <Trans>
                Translated with {modelMenu} · {languageMenu}
              </Trans>
            )}
          </p>
          <p className="mt-1.5 text-body whitespace-pre-wrap text-foreground" dir="auto">
            {translatedText}
          </p>
          <div className="mt-2 flex gap-4">
            <button
              type="button"
              onClick={() => void copy(translatedText)}
              className="text-body text-link"
              aria-label={t`Copy translation`}
            >
              {copied ? <Trans>Copied</Trans> : <Trans>Copy translation</Trans>}
            </button>
            {showActions && speakText ? (
              <button
                type="button"
                onClick={() => speakText(translatedText)}
                disabled={speakDisabled && !speaking}
                className="text-body text-link"
                aria-label={speaking ? t`Stop` : t`Speak`}
              >
                {speaking ? <Trans>Stop</Trans> : <Trans>Speak</Trans>}
              </button>
            ) : null}
            {showActions ? (
              <button
                type="button"
                onClick={() => void shareTranslation()}
                className="text-body text-link"
                aria-label={t`Share`}
              >
                <Trans>Share</Trans>
              </button>
            ) : null}
            {showActions ? (
              <button
                type="button"
                onClick={() => void translationFavorite.toggle()}
                disabled={translationFavorite.busy}
                className="text-body text-link"
                aria-label={
                  translationFavorite.favorited ? t`Remove favorite` : t`Favorite translation`
                }
                aria-pressed={translationFavorite.favorited}
              >
                {translationFavorite.favorited ? <Trans>Favorited</Trans> : <Trans>Favorite</Trans>}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="text-body text-link"
              aria-label={t`Collapse translation`}
            >
              <Trans>Collapse</Trans>
            </button>
          </div>
          <CopyTextFallback
            open={copyFailed}
            onOpenChange={resetCopy}
            text={copyFailedText}
            label={t`Copy translation`}
          />
        </>
      )}
    </div>
  );
  return { actions, panel };
}
