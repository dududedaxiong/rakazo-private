import { Trans, useLingui } from "@lingui/react/macro";
import type { TranslateOutput } from "@rakazo/contracts";
import { Button, CopyTextFallback, toast, useCopyText } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { favoriteSnippet, translationFavoriteId, useMessageFavorite } from "../../lib/favorites";
import type { createSpaceRpc } from "../../lib/rpc";
import type { BotTranslationSettings } from "../../lib/translation";
import {
  hasTranslationModel,
  resolveTranslationTargetLanguage,
  translateBotMessage,
  translationLanguageLabel,
} from "../../lib/translation";
import { errorText } from "../../lib/user-error";

type TranslationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: TranslateOutput }
  | { status: "error"; message: string };

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
  rpc,
  isLastMessage = false,
  speakText,
  speaking = false,
  speakDisabled = false,
}: {
  messageId: string;
  text: string;
  botId: string | undefined;
  settings: BotTranslationSettings | undefined;
  rpc: ReturnType<typeof createSpaceRpc>;
  /** Only the newest reply auto-translates; opening history must not re-fire every message. */
  isLastMessage?: boolean;
  /** Reads arbitrary text in the bot's voice; absent when voice is not ready. */
  speakText?: (text: string) => void;
  /** This message is being read aloud right now. */
  speaking?: boolean;
  /** A call holds the speaker, so a new read waits until it ends. */
  speakDisabled?: boolean;
}): { actions: ReactNode; panel: ReactNode } {
  const { t } = useLingui();
  const [state, setState] = useState<TranslationState>({ status: "idle" });
  const [collapsed, setCollapsed] = useState(false);
  const attemptedAutoRef = useRef(false);
  const [copied, copy, copyFailed, resetCopy, copyFailedText] = useCopyText();
  /** The bot's switch for the read-aloud, share, and favorite actions; on by default. */
  const showActions = settings?.showTranslationActions ?? true;
  const translatedText = state.status === "done" ? state.result.translatedText : "";
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

  const translate = useCallback(async () => {
    if (!botId) return;
    if (state.status === "done" && collapsed) {
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
    try {
      const result = await translateBotMessage(rpc, {
        botId,
        text,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: resolveTranslationTargetLanguage(settings),
      });
      setState({ status: "done", result });
    } catch (err) {
      setState({ status: "error", message: errorText(err, t`Translation failed`) });
    }
  }, [botId, collapsed, rpc, settings, state.status, t, text]);

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
    const text = state.result.translatedText;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy(text);
  }, [copy, state]);

  if (!expanded) return { actions, panel: null };

  const targetLanguage = resolveTranslationTargetLanguage(
    settings ?? { translationTargetLanguage: null },
  );
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
            {state.result.usedFallback
              ? t`Translated with ${state.result.modelId} (backup) · ${translationLanguageLabel(state.result.sourceLanguage)} to ${translationLanguageLabel(targetLanguage)}`
              : t`Translated with ${state.result.modelId} · ${translationLanguageLabel(state.result.sourceLanguage)} to ${translationLanguageLabel(targetLanguage)}`}
          </p>
          <p className="mt-1.5 text-body whitespace-pre-wrap text-foreground" dir="auto">
            {state.result.translatedText}
          </p>
          <div className="mt-2 flex gap-4">
            <button
              type="button"
              onClick={() => void copy(state.result.translatedText)}
              className="text-body text-link"
              aria-label={t`Copy translation`}
            >
              {copied ? <Trans>Copied</Trans> : <Trans>Copy translation</Trans>}
            </button>
            {showActions && speakText ? (
              <button
                type="button"
                onClick={() => speakText(state.result.translatedText)}
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
