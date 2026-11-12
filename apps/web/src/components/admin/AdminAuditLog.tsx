import { Trans, useLingui } from "@lingui/react/macro";
import type { SecurityEventType } from "@rakazo/contracts";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@rakazo/ui-web";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { formatDateTime, SecurityEventLabel } from "./admin-shared";

const PAGE_SIZE = 50;

const typeOptions: Array<SecurityEventType | "all"> = [
  "all",
  "admin.registration_settings.changed",
  "admin.invite_code.created",
  "admin.invite_code.revoked",
  "admin.user.blacklisted",
  "admin.user.unblacklisted",
  "admin.user.soft_deleted",
  "admin.user.restored",
  "admin.user.hard_deleted",
  "admin.ip_collective_ban",
  "auth.account.deactivated",
  "auth.account.reactivated",
];

function TypeLabel({ type }: { type: SecurityEventType | "all" }) {
  if (type === "all") return <Trans>All types</Trans>;
  return <SecurityEventLabel type={type} />;
}

export function AdminAuditLogPanel() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const [type, setType] = useState<SecurityEventType | "all">("all");
  const events = useInfiniteQuery(
    queries.security.events.infiniteOptions({
      input: (cursor: string | null) => ({
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        ...(type !== "all" ? { type } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => (page.length === PAGE_SIZE ? (page.at(-1)?.id ?? null) : null),
      placeholderData: (previous) => previous,
    }),
  );
  const items = (events.data?.pages ?? []).flat();

  if (events.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (events.isError && items.length === 0)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(events.error, t`Couldn't load the audit log`)}
        <Button variant="outline" size="sm" onClick={() => void events.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">
        <Trans>Every admin and system action is recorded here and cannot be changed.</Trans>
      </p>
      <Select value={type} onValueChange={(value) => setType(value as SecurityEventType | "all")}>
        <SelectTrigger className="w-72" aria-label={t`Filter by type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {typeOptions.map((option) => (
            <SelectItem key={option} value={option}>
              <TypeLabel type={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {items.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          <Trans>No audit events yet</Trans>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((event) => (
            <li key={event.id} className="flex items-center gap-3 px-4 py-3 text-body-sm">
              <span className="shrink-0 text-muted-foreground">
                {formatDateTime(event.createdAt, i18n.locale)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <SecurityEventLabel type={event.type} />
              </span>
              <span className="hidden shrink-0 truncate text-muted-foreground sm:block">
                {event.userId ?? <Trans>System</Trans>}
              </span>
              {typeof event.metadata.id === "string" ? (
                <span className="hidden shrink-0 truncate text-muted-foreground md:block">
                  {event.metadata.id}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {events.hasNextPage ? (
        <Button
          variant="outline"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {events.isFetchingNextPage ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
        </Button>
      ) : null}
    </div>
  );
}
