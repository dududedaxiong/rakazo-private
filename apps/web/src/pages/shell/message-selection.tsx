import { Trans } from "@lingui/react/macro";
import type { Bot } from "@rakazo_mickvvw/contracts";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo_mickvvw/ui-web";
import { Check, X } from "lucide-react";

export type BatchTranslateResult = {
  messageId: string;
  original: string;
  translated?: string;
  error?: string;
};

/**
 * The bottom bar shown while messages are selected: how many are picked,
 * and the batch actions for them.
 */
export function MessageSelectionBar({
  count,
  busy,
  onExport,
  onTranslate,
  onForward,
  onDelete,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onExport: () => void;
  onTranslate: () => void;
  onForward: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 bg-background px-4 pt-2 pb-4">
      <span className="mr-auto text-body-sm text-muted-foreground">
        <Trans>{count} selected</Trans>
      </span>
      <Button variant="outline" size="sm" disabled={busy} onClick={onExport}>
        <Trans>Export</Trans>
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={onTranslate}>
        <Trans>Translate</Trans>
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={onForward}>
        <Trans>Forward</Trans>
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onDelete}
        className="text-destructive"
      >
        <Trans>Delete</Trans>
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
        <Trans>Cancel</Trans>
      </Button>
    </div>
  );
}

/** A checkbox shown on a message bubble while selecting. */
export function MessageSelectCheckbox({
  selected,
  onToggle,
}: {
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={selected ? "Deselect message" : "Select message"}
      aria-pressed={selected}
      onClick={onToggle}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background"
      }`}
    >
      {selected ? <Check className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

/** Picks the bot a batch forward goes to. */
export function ForwardTargetDialog({
  bots,
  open,
  onOpenChange,
  onSelect,
}: {
  bots: readonly Bot[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (botId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="flex items-center gap-2">
          <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
            <Trans>Forward to</Trans>
          </DialogTitle>
          <DialogClose
            render={
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        </div>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              onClick={() => onSelect(bot.id)}
              className="rounded-lg px-3 py-2 text-start text-body hover:bg-muted"
            >
              {bot.name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The per-message results of a batch translate. */
export function BatchTranslateDialog({
  results,
  open,
  onOpenChange,
}: {
  results: readonly BatchTranslateResult[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <div className="flex items-center gap-2">
          <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
            <Trans>Translations</Trans>
          </DialogTitle>
          <DialogClose
            render={
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        </div>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {results.map((result) => (
            <div key={result.messageId} className="flex flex-col gap-1">
              <p className="text-body-sm text-muted-foreground">{result.original}</p>
              {result.translated ? (
                <p className="text-body">{result.translated}</p>
              ) : (
                <p className="text-body-sm text-destructive">{result.error}</p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
