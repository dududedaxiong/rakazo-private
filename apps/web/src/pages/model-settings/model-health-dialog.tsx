import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelHealthReport, ModelHealthState } from "@rakazo_mickvvw/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rakazo_mickvvw/ui-web";

const HEALTH_STATE_CLASS: Record<ModelHealthState, string> = {
  ok: "text-success",
  empty: "text-muted-foreground",
  limited: "text-warning",
  auth: "text-destructive",
  notfound: "text-destructive",
  badreq: "text-destructive",
  servererr: "text-destructive",
  timeout: "text-warning",
  neterr: "text-destructive",
};

function HealthStateBadge({ state }: { state: ModelHealthState }) {
  return (
    <span className={`shrink-0 text-body-sm font-medium ${HEALTH_STATE_CLASS[state]}`}>
      {state === "ok" ? (
        <Trans>Usable</Trans>
      ) : state === "empty" ? (
        <Trans>Empty reply</Trans>
      ) : state === "limited" ? (
        <Trans>Rate limited</Trans>
      ) : state === "auth" ? (
        <Trans>No permission</Trans>
      ) : state === "notfound" ? (
        <Trans>Not found</Trans>
      ) : state === "timeout" ? (
        <Trans>Timed out</Trans>
      ) : (
        <Trans>Failed</Trans>
      )}
    </span>
  );
}

/**
 * One connection's health result: how many models answered, then every model
 * with its state and, for failures, the upstream's own reason. "Keep only
 * usable models" is off when there is nothing to drop, nothing usable, or
 * the run stopped at the cap and untested models would be lost with it.
 */
export function ModelHealthDialog({
  result,
  keeping,
  onClose,
  onKeepUsable,
}: {
  result: ModelHealthReport;
  keeping: boolean;
  onClose: () => void;
  onKeepUsable: () => void;
}) {
  const { t } = useLingui();
  const label = result.label;
  const total = result.total;
  const usable = result.ok.length;
  const canKeep = !result.truncated && usable > 0 && usable < result.total;
  const groups: Array<[string, number]> = [
    [t`Rate limited`, result.summary.limited],
    [t`No permission`, result.summary.auth],
    [t`Not found`, result.summary.notfound],
    [t`Failed`, result.summary.badreq + result.summary.servererr + result.summary.neterr],
    [t`Timed out`, result.summary.timeout],
    [t`Empty reply`, result.summary.empty],
  ];
  const failures = groups
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="model-health-dialog"
        size="md"
        showCloseButton={false}
        className="bg-card"
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="break-words">{t`Test results · ${label}`}</DialogTitle>
        </DialogHeader>
        <div className="px-6">
          <p className="text-body text-foreground">{t`${usable} of ${total} models work`}</p>
          {failures ? <p className="mt-1 text-body-sm text-muted-foreground">{failures}</p> : null}
          {result.truncated ? (
            <p className="mt-1 text-body-sm text-muted-foreground">
              <Trans>Only the first 50 models were tested.</Trans>
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {result.results.length === 0 ? (
            <p className="py-2 text-body text-muted-foreground">
              <Trans>No models to test</Trans>
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {result.results.map((row) => (
                <li key={row.model} className="py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-all text-body text-foreground">{row.model}</span>
                    <HealthStateBadge state={row.state} />
                  </div>
                  {row.state !== "ok" ? (
                    <p className="mt-0.5 break-words text-body-sm leading-[1.5] text-muted-foreground">
                      {row.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="px-6 pb-6">
          <Button type="button" variant="ghost" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
          <Button type="button" disabled={!canKeep || keeping} onClick={onKeepUsable}>
            {keeping ? <Trans>Keeping…</Trans> : <Trans>Keep only usable models</Trans>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
