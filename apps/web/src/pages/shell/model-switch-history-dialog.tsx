import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelSwitchAttempt } from "@rakazo/contracts";
import { displayName } from "@rakazo/core";
import { Dialog, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ModelLocateKind, ModelLocateTarget } from "../../lib/model-locate";

/** The provider of the attempt that finally produced the message, if known. */
export function finalModelProvider(
  attempts: readonly ModelSwitchAttempt[],
  finalModel: string,
): string | undefined {
  return (
    attempts.find((attempt) => attempt.outcome === "succeeded" && attempt.model === finalModel)
      ?.provider ??
    attempts.find((attempt) => attempt.outcome === "succeeded")?.provider ??
    attempts.at(-1)?.provider
  );
}

/** The switch timeline for one message: each failed attempt (model, provider,
 * expandable error), the switch to the next model, and the model that
 * finished. A model name opens the bot's model list at that model when the
 * caller can locate it; without a locator the names are plain text.
 */
export function ModelSwitchHistoryDialog({
  open,
  onOpenChange,
  attempts,
  finalModel,
  kind,
  botId,
  onLocateModel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attempts: readonly ModelSwitchAttempt[];
  finalModel: string;
  kind: ModelLocateKind;
  botId: string;
  onLocateModel?: (target: ModelLocateTarget) => void;
}) {
  const { t } = useLingui();
  const [expandedError, setExpandedError] = useState<number | null>(null);
  /** The short failure label for a timeline row; the detail holds the full text. */
  const switchErrorLabel = (errorCode: string | undefined): string => {
    switch (errorCode) {
      case "rate_limit":
        return t`429 rate limit`;
      case "connection":
      case "connect":
      case "network":
        return t`Connection error`;
      case "timeout":
        return t`Timed out`;
      case "unsupported":
        return t`Not supported`;
      case "auth":
      case "unauthorized":
        return t`Authorization failed`;
      case "quota":
        return t`Quota exceeded`;
      default:
        return errorCode ? errorCode.replaceAll("_", " ") : t`Failed`;
    }
  };
  if (!open || attempts.length === 0) return null;
  const locate = (attempt: ModelSwitchAttempt) => {
    if (!onLocateModel) return;
    onOpenChange(false);
    onLocateModel({ kind, botId, model: attempt.model, provider: attempt.provider });
  };
  const modelName = (attempt: ModelSwitchAttempt, done = false) =>
    onLocateModel ? (
      <button
        type="button"
        onClick={() => locate(attempt)}
        className={
          done
            ? "font-semibold text-success underline decoration-dotted underline-offset-2"
            : "font-semibold text-link underline decoration-dotted underline-offset-2"
        }
      >
        {displayName(attempt.model, t`Model`)}
      </button>
    ) : (
      <span className={done ? "font-semibold text-success" : "font-semibold"}>
        {displayName(attempt.model, t`Model`)}
      </span>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="model-switch-history" size="md" className="gap-0 p-0">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <DialogTitle className="text-body-lg font-semibold">
            <Trans>Switch history</Trans>
          </DialogTitle>
        </div>
        <ol className="max-h-[70vh] space-y-1 overflow-y-auto px-5 py-4">
          {attempts.map((attempt, index) => {
            const next = attempts[index + 1];
            const provider = attempt.provider ? (
              <span className="text-muted-foreground"> · {attempt.provider}</span>
            ) : null;
            return (
              <li key={`${attempt.model}:${attempt.at}:${index}`}>
                {attempt.outcome === "succeeded" ? (
                  <div className="flex items-baseline gap-2 py-1 text-body text-success">
                    <span aria-hidden="true">✓</span>
                    <span>
                      <Trans>Finished, current model</Trans> {modelName(attempt, true)}
                      {provider}
                    </span>
                  </div>
                ) : (
                  <div className="py-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-body">
                      <span
                        aria-hidden="true"
                        className={
                          attempt.outcome === "skipped"
                            ? "text-muted-foreground"
                            : "text-destructive"
                        }
                      >
                        ●
                      </span>
                      {modelName(attempt)}
                      {provider}
                      {attempt.outcome === "skipped" ? (
                        <span className="text-muted-foreground">
                          <Trans>Skipped</Trans>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-expanded={expandedError === index}
                          onClick={() => setExpandedError(expandedError === index ? null : index)}
                          className="text-destructive underline decoration-dotted underline-offset-2"
                        >
                          {switchErrorLabel(attempt.errorCode)}{" "}
                          <ChevronDown
                            className={`inline size-4 transition-transform ${expandedError === index ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}
                    </div>
                    {attempt.outcome === "failed" && expandedError === index ? (
                      <p className="mt-1.5 rounded-lg bg-muted px-3 py-2 text-body-sm text-muted-foreground wrap-anywhere">
                        {attempt.errorMessage ?? switchErrorLabel(attempt.errorCode)}
                      </p>
                    ) : null}
                  </div>
                )}
                {attempt.outcome !== "succeeded" && next ? (
                  <p className="py-1 ps-6 text-body-sm text-link">
                    {t`Switch to ${displayName(next.model, t`Model`)}${next.provider ? ` · ${next.provider}` : ""}`}
                  </p>
                ) : null}
              </li>
            );
          })}
          {attempts.every((attempt) => attempt.outcome !== "succeeded") ? (
            <li>
              <div className="flex items-baseline gap-2 py-1 text-body text-success">
                <span aria-hidden="true">✓</span>
                <span>
                  <Trans>Finished, current model</Trans>{" "}
                  <span className="font-semibold">{displayName(finalModel, t`Model`)}</span>
                </span>
              </div>
            </li>
          ) : null}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "Current model: X · provider ›" row under a reply or a translation:
 * tapping it opens the switch timeline. The dialog lives here so every
 * caller gets the same entry and the same timeline.
 */
export function ModelSwitchHistoryEntry({
  attempts,
  finalModel,
  kind,
  botId,
  onLocateModel,
}: {
  attempts: readonly ModelSwitchAttempt[];
  finalModel: string;
  kind: ModelLocateKind;
  botId: string | undefined;
  onLocateModel?: (target: ModelLocateTarget) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const provider = finalModelProvider(attempts, finalModel);
  return (
    <>
      <button
        type="button"
        data-testid="model-switch-history-entry"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-left text-body-sm text-muted-foreground hover:text-foreground"
      >
        <span>
          {t`Current model`}:{" "}
          <span className="font-semibold text-foreground">
            {displayName(finalModel, t`Model`)}
            {provider ? ` · ${provider}` : ""}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </button>
      <ModelSwitchHistoryDialog
        open={open}
        onOpenChange={setOpen}
        attempts={attempts}
        finalModel={finalModel}
        kind={kind}
        botId={botId ?? ""}
        onLocateModel={botId && onLocateModel ? onLocateModel : undefined}
      />
    </>
  );
}

/**
 * The tappable "当前模型:" line for a reply that carries only the trailing
 * mark, no switch timeline: it locates the model in the bot's model list
 * directly, the way the app's mark bar does, instead of opening a history
 * that does not exist.
 */
export function ModelSwitchMarkButton({
  model,
  presetName,
  kind,
  botId,
  onLocateModel,
}: {
  model: string;
  presetName?: string;
  kind: ModelLocateKind;
  botId: string | undefined;
  onLocateModel?: (target: ModelLocateTarget) => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      data-testid="model-switch-mark-entry"
      onClick={() => botId && onLocateModel?.({ kind, botId, model })}
      className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-left text-body-sm text-muted-foreground hover:text-foreground"
    >
      <span>
        {t`Current model`}:{" "}
        <span className="font-semibold text-foreground">
          {displayName(model, t`Model`)}
          {presetName ? ` · ${presetName}` : ""}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
    </button>
  );
}
