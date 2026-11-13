import { Trans, useLingui } from "@lingui/react/macro";
import type { TranslateOutput } from "@rakazo/contracts";
import { Button, CopyTextFallback, toast, useCopyText } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
}: {
  messageId: string;
  text: string;
  botId: string | undefined;
  settings: BotTranslationSettings | undefined;
  rpc: ReturnType<typeof createSpaceRpc>;
  /** Only the newest reply auto-translates; opening history must not re-fire every message. */
  isLastMessage?: boolean;
}): { actions: ReactNode; panel: ReactNode } {
  const { t } = useLingui();
  const [state, setState] = useState<TranslationState>({ status: "idle" });
  const [collapsed, setCollapsed] = useState(false);
  const attemptedAutoRef = useRef(false);
  const [copied, copy, copyFailed, resetCopy, copyFailedText] = useCopyText();

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
            {t`Translated with ${state.result.modelId} · ${translationLanguageLabel(state.result.sourceLanguage)} to ${translationLanguageLabel(targetLanguage)}`}
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
