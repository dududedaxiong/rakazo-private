import { Trans, useLingui } from "@lingui/react/macro";
import type { ConversationShareSummary } from "@rakazo/contracts";
import {
  parseCustomShareExpiryDays,
  SHARE_EXPIRY_DAYS,
  SHARE_EXPIRY_DAYS_MAX,
  SHARE_EXPIRY_DAYS_MIN,
} from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useCopyText,
} from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../lib/query.js";
import { shareLinkQrDataUrl } from "../lib/share-link-qr.js";

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "";
  return new Date(expiresAt).toISOString().slice(0, 10);
}

function shareState(item: ConversationShareSummary): "revoked" | "expired" | "live" {
  if (item.revokedAt) return "revoked";
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) return "expired";
  return "live";
}

export function ShareConversationDialog({
  botId,
  groupId,
  open,
  onOpenChange,
}: {
  botId?: string;
  groupId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [customDays, setCustomDays] = useState("");
  const [customSelected, setCustomSelected] = useState(false);
  const [copied, copy] = useCopyText();
  const input = botId ? { botId } : { groupId: groupId! };
  const list = useQuery({
    ...queries.shares.list.queryOptions({ input }),
    enabled: open,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: queries.shares.list.key({ input }) });
  const create = useMutation({
    mutationFn: (days: number | null) =>
      queries.shares.create.call({ ...input, expiresInDays: days }),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (shareId: string) => queries.shares.revoke.call({ shareId }),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (shareId: string) => queries.shares.restore.call({ shareId }),
    onSuccess: invalidate,
  });
  const items = list.data?.items ?? [];
  const newest = create.data;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!newest?.shareUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void shareLinkQrDataUrl(newest.shareUrl).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [newest?.shareUrl]);
  const customDaysParsed = parseCustomShareExpiryDays(customDays);
  const createDisabled = create.isPending || (customSelected && customDaysParsed === null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Share conversation</Trans>
          </DialogTitle>
        </DialogHeader>
        <p className="text-body text-muted-foreground">
          <Trans>
            The link opens a read-only replay without signing in. Secrets and local paths are
            removed before sharing.
          </Trans>
        </p>
        <div className="space-y-2">
          <span className="text-label">
            <Trans>Link expires in</Trans>
          </span>
          <div className="flex flex-wrap gap-2">
            {SHARE_EXPIRY_DAYS.map((days) => (
              <Button
                key={days}
                type="button"
                variant={expiresInDays === days && !customSelected ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setExpiresInDays(days);
                  setCustomSelected(false);
                }}
              >
                {days === 1
                  ? t`1 day`
                  : days === 7
                    ? t`7 days`
                    : days === 30
                      ? t`30 days`
                      : t`1 year`}
              </Button>
            ))}
            <Button
              type="button"
              variant={expiresInDays === null && !customSelected ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setExpiresInDays(null);
                setCustomSelected(false);
              }}
            >
              <Trans>Never</Trans>
            </Button>
            <Button
              type="button"
              variant={customSelected ? "default" : "outline"}
              size="sm"
              onClick={() => setCustomSelected(true)}
            >
              <Trans>Custom</Trans>
            </Button>
          </div>
          {customSelected ? (
            <input
              type="number"
              min={SHARE_EXPIRY_DAYS_MIN}
              max={SHARE_EXPIRY_DAYS_MAX}
              inputMode="numeric"
              value={customDays}
              onChange={(event) => setCustomDays(event.target.value)}
              placeholder={t`Days`}
              aria-label={t`Custom expiry in days`}
              className="h-9 w-24 rounded-md border border-border bg-card px-3 text-body"
            />
          ) : null}
          <Button
            type="button"
            onClick={() => create.mutate(customSelected ? customDaysParsed : expiresInDays)}
            disabled={createDisabled}
            className="w-full"
          >
            <Link2 />
            <Trans>Create link</Trans>
          </Button>
          {create.isError ? (
            <p className="text-body text-destructive">
              <Trans>Could not create the link. Try again.</Trans>
            </p>
          ) : null}
        </div>
        {newest?.shareUrl ? (
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-body">{newest.shareUrl}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void copy(newest.shareUrl!)}
              aria-label={t`Copy link`}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : null}
        {newest?.shareUrl && qrDataUrl ? (
          <img src={qrDataUrl} alt="" className="h-48 w-48 rounded-lg" />
        ) : null}
        <div className="min-w-0 space-y-2">
          {items.map((item) => {
            const state = shareState(item);
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium">{item.title}</div>
                  <div className="text-label text-muted-foreground">
                    {state === "revoked" ? (
                      <Trans>Revoked</Trans>
                    ) : state === "expired" ? (
                      <Trans>Expired</Trans>
                    ) : item.expiresAt ? (
                      <Trans>Expires {expiryLabel(item.expiresAt)}</Trans>
                    ) : (
                      <Trans>Never expires</Trans>
                    )}
                    {` · ${new Date(item.createdAt).toISOString().slice(0, 10)}`}
                  </div>
                </div>
                {item.shareUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void copy(item.shareUrl!)}
                    aria-label={t`Copy link`}
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                ) : null}
                {state === "revoked" || state === "expired" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(item.id)}
                  >
                    <RotateCcw />
                    <Trans>Restore</Trans>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(item.id)}
                  >
                    <Trans>Revoke</Trans>
                  </Button>
                )}
              </div>
            );
          })}
          {list.isPending ? (
            <p className="text-body text-muted-foreground">
              <Trans>Loading…</Trans>
            </p>
          ) : null}
          {!list.isPending && items.length === 0 ? (
            <p className="text-body text-muted-foreground">
              <Trans>No links yet.</Trans>
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
