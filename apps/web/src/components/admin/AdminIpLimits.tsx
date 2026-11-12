import { Trans, useLingui } from "@lingui/react/macro";
import type { RegistrationSettings } from "@rakazo/contracts";
import {
  Badge,
  Button,
  Field,
  FieldLabel,
  Input,
  SectionHeading,
  Spinner,
  Switch,
  toast,
} from "@rakazo/ui-web";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { formatDateTime } from "./admin-shared";

const PAGE_SIZE = 50;

export function AdminIpLimitsPanel() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const settings = useQuery(queries.admin.registrationSettings.get.queryOptions());
  const [formKey, setFormKey] = useState(0);
  const stats = useInfiniteQuery(
    queries.admin.ipStats.list.infiniteOptions({
      input: (cursor: string | null) => ({
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => (page.length === PAGE_SIZE ? (page.at(-1)?.ip ?? null) : null),
      placeholderData: (previous) => previous,
    }),
  );
  const items = (stats.data?.pages ?? []).flat();

  if (settings.isPending || stats.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (settings.isError || !settings.data)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(settings.error, t`Couldn't load IP limits`)}
        <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );

  return (
    <div className="space-y-8">
      <RulesForm
        key={formKey}
        initial={settings.data}
        onSaved={() => setFormKey((key) => key + 1)}
      />
      <section>
        <SectionHeading>{t`Registrations by IP`}</SectionHeading>
        {stats.isError && items.length === 0 ? (
          <div role="alert" className="mt-3 flex items-center gap-3 text-body text-destructive">
            {errorText(stats.error, t`Couldn't load IP stats`)}
            <Button variant="outline" size="sm" onClick={() => void stats.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="mt-3 text-body-sm text-muted-foreground">
            <Trans>No registrations recorded yet</Trans>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {items.map((stat) => (
              <li key={stat.ip} className="flex items-center gap-3 px-4 py-3 text-body-sm">
                <span className="min-w-0 flex-1 truncate font-mono">{stat.ip}</span>
                <span className="shrink-0 text-muted-foreground">
                  <Trans>Today: {stat.todayCount}</Trans>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  <Trans>Total: {stat.totalCount}</Trans>
                </span>
                <span className="hidden shrink-0 text-muted-foreground sm:block">
                  {formatDateTime(stat.lastRegisteredAt, i18n.locale)}
                </span>
                {stat.status === "limited" ? (
                  <Badge variant="destructive">
                    <Trans>Limited</Trans>
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <Trans>Normal</Trans>
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        {stats.hasNextPage ? (
          <Button
            className="mt-3"
            variant="outline"
            disabled={stats.isFetchingNextPage}
            onClick={() => void stats.fetchNextPage()}
          >
            {stats.isFetchingNextPage ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function RulesForm({ initial, onSaved }: { initial: RegistrationSettings; onSaved: () => void }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(String(initial.ipRegistrationLimit));
  const [threshold, setThreshold] = useState(String(initial.ipRegistrationHourlyThreshold));
  const [collectiveBan, setCollectiveBan] = useState(initial.ipCollectiveBanEnabled);
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsedLimit = Number(limit);
    const parsedThreshold = Number(threshold);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 0) return;
    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 0) return;
    setBusy(true);
    try {
      await rpc.admin.registrationSettings.update({
        ipRegistrationLimit: parsedLimit,
        ipRegistrationHourlyThreshold: parsedThreshold,
        ipCollectiveBanEnabled: collectiveBan,
      });
      await queryClient.invalidateQueries({
        queryKey: queries.admin.registrationSettings.get.key(),
      });
      onSaved();
    } catch (error) {
      toast.error(errorText(error, t`Could not save IP limits`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <SectionHeading>{t`Limits`}</SectionHeading>
      <p className="text-body-sm text-muted-foreground">
        <Trans>New registrations are limited right away; existing accounts are unaffected.</Trans>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="ip-limit">
            <Trans>Registrations per IP</Trans>
          </FieldLabel>
          <Input
            id="ip-limit"
            type="number"
            min={0}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ip-threshold">
            <Trans>Registrations per IP per hour</Trans>
          </FieldLabel>
          <Input
            id="ip-threshold"
            type="number"
            min={0}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium">
            <Trans>Collective ban on excess</Trans>
          </div>
          <p className="text-body-sm text-muted-foreground">
            <Trans>
              When on, an IP that passes the hourly threshold has all its accounts disabled at once.
            </Trans>
          </p>
        </div>
        <Switch
          checked={collectiveBan}
          onCheckedChange={setCollectiveBan}
          aria-label={t`Collective ban on excess`}
        />
      </div>
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? <Trans>Saving…</Trans> : <Trans>Save limits</Trans>}
      </Button>
    </section>
  );
}
