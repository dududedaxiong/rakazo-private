import { Trans } from "@lingui/react/macro";
import { Disclosure } from "@rakazo_mickvvw/ui-web";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * The collapsible wrapper around one ordered pool list: collapsed it is a
 * single title row; expanded, add, reorder, remove and locate work as
 * before. An empty list starts open so the add entry shows; a non-empty
 * list starts closed to save room. The open state is local only and never
 * persisted; a caller may drive it with `open` and `onOpenChange`, for
 * example to unfold onto a located row. The main pool titles itself
 * "Main models (N)"; the backup pool keeps "Fallback models (N)".
 *
 * The open state is always defined here: Base UI locks a Collapsible into
 * controlled or uncontrolled mode on its first render, so an `open` that
 * starts `undefined` and later becomes `true` would be ignored.
 */
export function FallbackDisclosure({
  count,
  pool = "backup",
  defaultOpen,
  open,
  onOpenChange,
  className,
  children,
}: {
  count: number;
  /** Which pool this list is; the title follows it. */
  pool?: "main" | "backup";
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? count === 0);
  const effectiveOpen = open ?? internalOpen;
  return (
    <Disclosure
      data-testid="fallback-disclosure"
      open={effectiveOpen}
      onOpenChange={(next) => {
        setInternalOpen(next);
        onOpenChange?.(next);
      }}
      className={className}
      summary={
        <span className="text-body text-foreground">
          {pool === "main" ? (
            <Trans>Main models ({count})</Trans>
          ) : (
            <Trans>Fallback models ({count})</Trans>
          )}
        </span>
      }
    >
      {children}
    </Disclosure>
  );
}
