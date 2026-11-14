import { Trans, useLingui } from "@lingui/react/macro";
import type { BotModelEntry } from "@rakazo/contracts";
import type { StuckRun } from "@rakazo/core";
import { modelOptionKey } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";
import { ModelSwitchMenu } from "./model-switch-menu";

/**
 * The recovery row under a user message whose run has gone quiet: the run
 * produced no reply for over three minutes, so the system offers to stop it
 * or switch model and retry, instead of leaving the message hanging. The
 * model list is every connected model, not just the bot's configured ones, so
 * a bot whose models both failed can still move.
 */
export function StuckRunActions({
  stuck,
  models,
  onCancel,
  onRetry,
}: {
  stuck: StuckRun;
  models: readonly BotModelEntry[];
  onCancel: () => Promise<void>;
  onRetry: (entry: BotModelEntry) => Promise<void>;
}) {
  const { t } = useLingui();
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const currentKey = modelOptionKey(stuck.modelProvider ?? "", stuck.modelId ?? "");
  const busy = cancelling || applyingKey !== null;
  const retry = async (entry: BotModelEntry) => {
    const key = modelOptionKey(entry.provider, entry.model);
    setApplyingKey(key);
    try {
      await onRetry(entry);
    } finally {
      setApplyingKey(null);
    }
  };
  return (
    <div
      data-testid="stuck-run-actions"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground"
    >
      <span>
        <Trans>It seems stuck</Trans>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setCancelling(true);
          try {
            await onCancel();
          } finally {
            setCancelling(false);
          }
        }}
      >
        <Trans>Cancel</Trans>
      </Button>
      {models.length > 0 ? (
        <ModelSwitchMenu
          label={t`Model`}
          models={models}
          currentKey={currentKey}
          applyingKey={applyingKey}
          onSelect={(entry) => void retry(entry)}
        >
          <Trans>Switch model and retry</Trans>
        </ModelSwitchMenu>
      ) : null}
    </div>
  );
}
