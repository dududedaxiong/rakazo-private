import { Trans, useLingui } from "@lingui/react/macro";
import { Button, SectionHeading, Spinner } from "@rakazo_mickvvw/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { formatDate, formatDateTime, SecurityEventLabel } from "./admin-shared";

export function AdminOverviewPanel() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const overview = useQuery(queries.admin.overview.get.queryOptions());
  if (overview.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (overview.isError || !overview.data)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(overview.error, t`Couldn't load the overview`)}
        <Button variant="outline" size="sm" onClick={() => void overview.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  const data = overview.data;
  const maxDay = Math.max(1, ...data.dailyNew.map((day) => day.count));
  const stats = [
    { label: t`Total users`, value: data.totalUsers },
    { label: t`New today`, value: data.todayNew },
    { label: t`New this week`, value: data.weekNew },
    { label: t`Disabled`, value: data.disabledCount },
    { label: t`Blacklisted`, value: data.blacklistedCount },
    {
      label: t`IP collective bans`,
      value: data.collectiveBanCount,
      hint:
        data.collectiveBanAccounts > 0
          ? t`${data.collectiveBanAccounts} accounts affected`
          : undefined,
    },
  ];
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border px-4 py-3">
            <div className="text-body-sm text-muted-foreground">{stat.label}</div>
            <div className="text-heading3">{stat.value}</div>
            {stat.hint ? (
              <div className="text-body-sm text-muted-foreground">{stat.hint}</div>
            ) : null}
          </div>
        ))}
      </div>

      <section>
        <SectionHeading>{t`New registrations, last 7 days`}</SectionHeading>
        <div className="mt-3 flex items-end gap-2 rounded-xl border border-border px-4 pt-4 pb-3">
          {data.dailyNew.map((day) => (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-body-sm text-muted-foreground">{day.count}</span>
              <div
                className="w-full max-w-8 rounded-t bg-primary"
                style={{ height: `${Math.max(4, Math.round((day.count / maxDay) * 96))}px` }}
              />
              <span className="text-body-sm text-muted-foreground">
                {formatDate(`${day.date}T00:00:00Z`, i18n.locale)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading>{t`Recent activity`}</SectionHeading>
        {data.recentEvents.length === 0 ? (
          <p className="mt-3 text-body-sm text-muted-foreground">
            <Trans>No admin activity yet</Trans>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {data.recentEvents.map((event) => (
              <li key={event.id} className="flex items-center gap-3 px-4 py-3 text-body-sm">
                <span className="shrink-0 text-muted-foreground">
                  {formatDateTime(event.createdAt, i18n.locale)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <SecurityEventLabel type={event.type} />
                </span>
                {typeof event.metadata.id === "string" ? (
                  <span className="truncate text-muted-foreground">{event.metadata.id}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
