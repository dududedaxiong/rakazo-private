import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { describeModelError, normalizeRunError } from "@rakazo/core";
import { toast } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useState } from "react";
import type { KeyHealthStatus } from "../../lib/key-health";
import { checkKeyForProvider, toastKeyCheckResult } from "../../lib/key-health";
import type { createSpaceRpc } from "../../lib/rpc";
import { translateRunError } from "../../lib/run-error";

/**
 * A model call failure, in plain language, with the one or two actions that
 * fix it. The summary is the shared run-error wording; the raw error stays
 * behind Details, and only for an unknown failure is it the whole story.
 * `modelPicker` replaces the "Change model" button where the caller already
 * has a model menu (translation); `onRetry` adds a Retry button after the
 * fix actions.
 */
export function ModelErrorActions({
  error,
  onOpenModels,
  onOpenConnections,
  onCheckKey,
  onDismiss,
  onRetry,
  retryAriaLabel,
  modelPicker,
  actionTestId = "model-error-action",
}: {
  error: string;
  onOpenModels?: () => void;
  onOpenConnections?: () => void;
  /** Tests the failed connection's key; the result toasts. */
  onCheckKey?: () => Promise<KeyHealthStatus | undefined>;
  /** Closes the prompt; "Try again later" and "Check network" use it. */
  onDismiss?: () => void;
  onRetry?: () => void;
  /** Accessible name for the Retry button; defaults to "Retry". */
  retryAriaLabel?: string;
  /** A model menu, shown where "Change model" would go. */
  modelPicker?: ReactNode;
  actionTestId?: string;
}) {
  const { t } = useLingui();
  const [checking, setChecking] = useState(false);
  const described = describeModelError(error);
  const normalized = normalizeRunError(error, translateRunError, i18n.locale || "en");
  const checkKey = async () => {
    if (!onCheckKey || checking) return;
    setChecking(true);
    try {
      toastKeyCheckResult(await onCheckKey());
    } finally {
      setChecking(false);
    }
  };
  const modelButton =
    modelPicker ??
    (onOpenModels ? (
      <ErrorAction testId={actionTestId} onClick={onOpenModels}>
        <Trans>Change model</Trans>
      </ErrorAction>
    ) : null);
  const actions: ReactNode[] = [];
  if (described.key === "invalid_key") {
    if (onCheckKey) {
      actions.push(
        <ErrorAction
          key="check"
          testId={actionTestId}
          onClick={() => void checkKey()}
          disabled={checking}
        >
          {checking ? <Trans>Checking key…</Trans> : <Trans>Test this key</Trans>}
        </ErrorAction>,
      );
    }
    if (onOpenConnections) {
      actions.push(
        <ErrorAction key="connections" testId={actionTestId} onClick={onOpenConnections}>
          <Trans>Change provider</Trans>
        </ErrorAction>,
      );
    }
  } else if (described.key === "model_not_found") {
    if (modelButton) actions.push(<span key="model">{modelButton}</span>);
  } else if (described.key === "rate_limited") {
    if (onDismiss) {
      actions.push(
        <ErrorAction key="dismiss" testId={actionTestId} onClick={onDismiss}>
          <Trans>Try again later</Trans>
        </ErrorAction>,
      );
    }
    if (modelButton) actions.push(<span key="model">{modelButton}</span>);
  } else if (described.key === "timeout" || described.key === "connection") {
    if (onDismiss) {
      actions.push(
        <ErrorAction key="dismiss" testId={actionTestId} onClick={onDismiss}>
          <Trans>Check network</Trans>
        </ErrorAction>,
      );
    }
    if (modelButton) actions.push(<span key="model">{modelButton}</span>);
  } else if (described.key === "quota") {
    if (onOpenConnections) {
      actions.push(
        <ErrorAction key="connections" testId={actionTestId} onClick={onOpenConnections}>
          <Trans>Change provider</Trans>
        </ErrorAction>,
      );
    }
  } else if (described.recovery === "connection" && onOpenConnections) {
    actions.push(
      <ErrorAction key="connections" testId={actionTestId} onClick={onOpenConnections}>
        <Trans>Connect a model</Trans>
      </ErrorAction>,
    );
  } else if (described.recovery === "model" && modelButton) {
    actions.push(<span key="model">{modelButton}</span>);
  }
  if (onRetry) {
    actions.push(
      <ErrorAction
        key="retry"
        testId={actionTestId}
        onClick={onRetry}
        ariaLabel={retryAriaLabel ?? t`Retry`}
      >
        <Trans>Retry</Trans>
      </ErrorAction>,
    );
  }
  return (
    <div>
      <span>{normalized.summary}</span>
      {actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{actions}</div>
      ) : null}
      <details key={error} className="mt-1">
        <summary className="w-fit cursor-pointer">{t`Details`}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-label">{normalized.details}</pre>
      </details>
    </div>
  );
}

function ErrorAction({
  testId,
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="font-medium underline underline-offset-2 hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * A failed media generation, as a toast: the plain-language reason plus the
 * one action that fixes it. A toast carries a single action, so the key
 * failure offers the key test and the model failure the model switch.
 */
export function toastModelError(
  error: unknown,
  options: {
    rpc: ReturnType<typeof createSpaceRpc>;
    provider?: string;
    model?: string;
    botId?: string;
    kind?: "image" | "video";
    onLocateModel?: (target: {
      kind: "image" | "video";
      botId: string;
      model: string;
      provider?: string;
    }) => void;
    onOpenModelSettings?: () => void;
    onRetry?: () => void;
  },
): void {
  const raw = error instanceof Error ? error.message : String(error);
  const described = describeModelError(raw);
  const summary = normalizeRunError(raw, translateRunError, i18n.locale || "en").summary;
  const canLocate = Boolean(
    options.botId && options.model && options.onLocateModel && options.kind,
  );
  const locate = () => {
    if (!canLocate) return false;
    options.onLocateModel!({
      kind: options.kind!,
      botId: options.botId!,
      model: options.model!,
      provider: options.provider,
    });
    return true;
  };
  if (described.key === "invalid_key" && options.provider) {
    toast(summary, {
      action: {
        label: i18n._({ id: "Test this key", message: "Test this key" }),
        onClick: () => {
          void checkKeyForProvider(options.rpc, options.provider ?? "").then((status) =>
            toastKeyCheckResult(status),
          );
        },
      },
    });
    return;
  }
  if (described.key === "model_not_found") {
    if (canLocate) {
      toast(summary, {
        action: {
          label: i18n._({ id: "Change model", message: "Change model" }),
          onClick: () => void locate(),
        },
      });
      return;
    }
    toast(summary);
    return;
  }
  if (
    described.key === "rate_limited" ||
    described.key === "timeout" ||
    described.key === "connection"
  ) {
    if (options.onRetry) {
      toast(summary, {
        action: {
          label: i18n._({ id: "Retry", message: "Retry" }),
          onClick: () => void options.onRetry?.(),
        },
      });
      return;
    }
    toast(summary);
    return;
  }
  if (described.key === "quota" && options.onOpenModelSettings) {
    toast(summary, {
      action: {
        label: i18n._({ id: "Change provider", message: "Change provider" }),
        onClick: options.onOpenModelSettings,
      },
    });
    return;
  }
  if (described.key === "unknown") {
    toast(summary, { description: raw });
    return;
  }
  toast(summary);
}
