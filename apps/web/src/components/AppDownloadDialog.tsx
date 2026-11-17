import { Trans, useLingui } from "@lingui/react/macro";
import type { AppDownloadLinks } from "@rakazo_mickvvw/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Spinner } from "@rakazo_mickvvw/ui-web";
import { Smartphone } from "lucide-react";

/**
 * The per-platform download links the admin set in Settings › General.
 * `downloads` is undefined while they load; both links null means unset.
 */
export function AppDownloadDialog({
  open,
  onOpenChange,
  downloads,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  downloads?: AppDownloadLinks | null;
}) {
  const { t } = useLingui();
  const androidUrl = downloads?.androidUrl ?? null;
  const iosUrl = downloads?.iosUrl ?? null;
  const configured = [
    androidUrl ? { label: t`Android`, url: androidUrl } : null,
    iosUrl ? { label: t`iOS`, url: iosUrl } : null,
  ].filter((entry): entry is { label: string; url: string } => entry !== null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Get the mobile app</Trans>
          </DialogTitle>
        </DialogHeader>
        {downloads === undefined ? (
          <div className="grid place-items-center py-6">
            <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
          </div>
        ) : configured.length === 0 ? (
          <p className="text-body text-muted-foreground">
            <Trans>No app downloads are set up yet.</Trans>
          </p>
        ) : (
          <div className="space-y-1">
            {configured.map((entry) => (
              <a
                key={entry.label}
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-body hover:bg-accent"
              >
                <Smartphone className="shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className="block font-medium">{entry.label}</span>
                  <span className="block truncate text-body-sm text-muted-foreground">
                    {entry.url}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
