import { useLingui } from "@lingui/react/macro";
import type { BotModelEntry } from "@rakazo/contracts";
import { displayName, modelOptionKey } from "@rakazo/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { CachedModelStatus } from "../../lib/model-status";
import { readModelStatus } from "../../lib/model-status";

/**
 * A dropdown listing a bot's configured models for one role, with the primary
 * checked. The trigger is the caller's content (a model name in a title or a
 * mark); selecting a model calls onSelect, which moves it to the front of the
 * bot's list. The models come from the bot, so there is nothing to load.
 * Each row also shows the model's last known health from the test chain,
 * read when the menu opens; a model never probed shows none.
 */
export function ModelSwitchMenu({
  label,
  models,
  currentKey,
  applyingKey,
  onSelect,
  children,
}: {
  label: string;
  models: readonly BotModelEntry[];
  currentKey: string;
  applyingKey: string | null;
  onSelect: (entry: BotModelEntry) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, CachedModelStatus | null>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!open) return;
    setStatuses(
      new Map(
        models.map((entry) => {
          const key = modelOptionKey(entry.provider, entry.model);
          return [key, readModelStatus(key)] as const;
        }),
      ),
    );
  }, [open, models]);
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
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {models.map((entry) => {
          const key = modelOptionKey(entry.provider, entry.model);
          const isCurrent = key === currentKey;
          return (
            <DropdownMenuItem
              key={key}
              disabled={applyingKey !== null}
              onClick={() => onSelect(entry)}
            >
              {isCurrent ? (
                <Check className="size-4" />
              ) : (
                <span className="size-4" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {displayName(entry.model, entry.model)}
              </span>
              <ModelStatusBadge status={statuses.get(key) ?? null} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A model's last known health: a colored dot and a one-word label. */
export function ModelStatusBadge({ status }: { status: CachedModelStatus | null }) {
  const { t } = useLingui();
  if (!status) return null;
  const dot =
    status.state === "ok"
      ? "bg-success"
      : status.state === "slow"
        ? "bg-warning"
        : "bg-destructive";
  const label =
    status.state === "ok" ? t`Normal` : status.state === "slow" ? t`Slow` : t`Unavailable`;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
