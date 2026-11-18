import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AccountSecurity,
  BotAvatarSet,
  MyReferralCode,
  UsageSummary,
} from "@rakazo_mickvvw/contracts";
import {
  APP_LOCALE_LABELS,
  accountDisplay,
  displayName,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@rakazo_mickvvw/core";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Label,
  NativeSelect,
  NativeSelectOption,
  OptionSelect,
  SectionHeading,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo_mickvvw/ui-web";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rakazo_mickvvw/ui-web/components/ui/table";
import { Check, Copy } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { AccountAccess, LinkSsoRow } from "../components/AccountAccess";
import { AccountDataSettings } from "../components/AccountDataSettings";
import { AdminAppDownloadSettings } from "../components/admin/AdminAppDownloadSettings";
import { SuccessPop } from "../components/ai/primitives";
import { ComputerDeviceSettings } from "../components/ComputerDeviceSettings";
import { ComputerProviderSettings } from "../components/ComputerProviderSettings";
import {
  ComputersUnavailableHint,
  computersAreUnavailable,
} from "../components/ComputersUnavailableHint";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DesktopUpdateSection } from "../components/DesktopUpdates";
import { PasskeySettings } from "../components/PasskeySettings";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { TrustedLinkSitesSettings } from "../components/TrustedLinkSitesSettings";
import { authClient } from "../lib/auth";
import type { BotsSidebarDensity } from "../lib/bots-sidebar-density-pref";
import { botsSidebarDensityPreference } from "../lib/bots-sidebar-density-pref";
import { composerEnterToSendPreference } from "../lib/composer-enter-to-send-pref";
import { useCopyText } from "../lib/copy-text";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import { localTimezone, sameTimeZone, timezoneOptions } from "../lib/local-timezone";
import { usePasskeysSupported } from "../lib/passkeys";
import { remoteImagesPreference } from "../lib/remote-images-preference";
import { responseStreamingPreference } from "../lib/response-streaming";
import { rpc } from "../lib/rpc";
import { toolActivityPreference } from "../lib/tool-activity-preference";
import type { AppearancePreference } from "../lib/ui-appearance";
import { getUiAppearancePreference, setUiAppearance } from "../lib/ui-appearance";
import type { UiLocale } from "../lib/ui-locale";
import { UI_LOCALES } from "../lib/ui-locale";
import { authErrorText, errorText } from "../lib/user-error";

export type SettingsGeneralProps = {
  email?: string | null;
  name: string;
  onNameSaved?: () => Promise<void>;
  /** The user's saved IANA timezone, or null before one is set. */
  timezone?: string | null;
  onTimezoneChange?: (timezone: string) => Promise<void>;
  /** The icon set new and unpinned bots wear; absent from servers that predate it. */
  botAvatarSet?: BotAvatarSet;
  onBotAvatarSetChange?: (set: BotAvatarSet) => Promise<void>;
  onAccountImported?: () => Promise<void>;
  onImportAgent?: () => void;
  /** Admins set the custom app download links; hidden for everyone else. */
  isAdmin?: boolean;
};

export function GeneralSettingsPanels({
  email,
  name,
  onNameSaved,
  timezone = null,
  onTimezoneChange,
  botAvatarSet,
  onBotAvatarSetChange,
  onAccountImported,
  onImportAgent,
  isAdmin = false,
}: SettingsGeneralProps) {
  const { t } = useLingui();
  const account = accountDisplay({ name, email }, t`You`);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [namePending, setNamePending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameId = useId();

  async function saveName() {
    const nextName = nameDraft.trim();
    if (namePending || !nextName || nextName.length > 80) return;
    if (!displayName(nextName, "")) {
      setNameError(t`Could not update name`);
      return;
    }
    // Nothing to save, so close without a request that could only fail.
    if (nextName === (account.label === email ? "" : displayName(name, ""))) {
      setNameError(null);
      setEditingName(false);
      return;
    }
    setNamePending(true);
    setNameError(null);
    try {
      const result = await authClient.updateUser({ name: nextName });
      if (result.error) {
        setNameError(authErrorText(result.error, t`Could not update name`));
        return;
      }
      setEditingName(false);
      void Promise.resolve()
        .then(() => onNameSaved?.())
        .catch(() => undefined);
    } catch {
      setNameError(t`Could not update name`);
    } finally {
      setNamePending(false);
    }
  }

  const [accountSecurity, setAccountSecurity] = useState<AccountSecurity | null>(null);
  const [locale, setLocale] = useState<UiLocale>(() => getActiveUiLocale());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const sidebarDensity = botsSidebarDensityPreference.use();
  const sidebarDensityLabelId = useId();
  const botStyleLabelId = useId();
  const [botStyleError, setBotStyleError] = useState<string | null>(null);
  const streamReplies = responseStreamingPreference.use();
  const streamRepliesId = useId();
  const showToolActivity = toolActivityPreference.use();
  const showToolActivityId = useId();
  const enterToSend = composerEnterToSendPreference.use();
  const enterToSendId = useId();
  const loadRemoteImages = remoteImagesPreference.use();
  const loadRemoteImagesId = useId();
  const timezoneId = useId();
  const showPassword = Boolean(
    accountSecurity?.hasPassword && accountSecurity.passwordChangeEnabled !== false,
  );
  const passkeysSupported = usePasskeysSupported();
  const canLinkSso = Boolean(accountSecurity?.sso && !accountSecurity.ssoLinked);
  const [timezonePending, setTimezonePending] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const deviceTimezone = localTimezone();

  function chooseLocale(next: UiLocale) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(activated);
    });
  }

  async function chooseTimezone(next: string) {
    if (!onTimezoneChange || timezonePending || next === timezone) return;
    setTimezonePending(true);
    setTimezoneError(null);
    try {
      await onTimezoneChange(next);
    } catch {
      setTimezoneError(t`Couldn't update your timezone`);
    } finally {
      setTimezonePending(false);
    }
  }

  return (
    <div className="space-y-8">
      <SettingsGroup title={<Trans>Account</Trans>} data-testid="account-card">
        {editingName ? (
          <form
            className="space-y-3 px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (!namePending) setEditingName(false);
              }
            }}
          >
            <Field>
              <FieldLabel htmlFor={nameId}>
                <Trans>Name</Trans>
              </FieldLabel>
              <Input
                id={nameId}
                autoComplete="name"
                autoFocus
                maxLength={80}
                value={nameDraft}
                disabled={namePending}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setNameError(null);
                }}
              />
            </Field>
            {nameError ? (
              <p role="alert" className="text-body-sm text-destructive">
                {nameError}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={namePending || !nameDraft.trim()}>
                <Trans>Save</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={namePending}
                onClick={() => setEditingName(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </form>
        ) : (
          <SettingsRow
            label={
              <>
                <p className="break-words">{account.label}</p>
                {email && account.label !== email ? (
                  <p className="mt-0.5 break-words text-body-sm text-muted-foreground">{email}</p>
                ) : null}
              </>
            }
            control={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNameDraft(account.label === email ? "" : displayName(name, ""));
                  setNameError(null);
                  setEditingName(true);
                }}
              >
                <Trans>Edit</Trans>
              </Button>
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={<Trans>Preferences</Trans>}>
        <SettingsRow
          label={<Trans>Appearance</Trans>}
          control={
            <AppearancePicker
              value={appearance}
              onChange={(next) => {
                setAppearance(next);
                setUiAppearance(next);
              }}
            />
          }
        />
        {botAvatarSet && onBotAvatarSetChange ? (
          <SettingsRow
            label={
              <span id={botStyleLabelId}>
                <Trans>Bot style</Trans>
              </span>
            }
            control={
              <div className="space-y-1">
                <ToggleGroup
                  aria-labelledby={botStyleLabelId}
                  data-testid="bot-style-select"
                  value={[botAvatarSet]}
                  onValueChange={([next]) => {
                    if (!next || next === botAvatarSet) return;
                    setBotStyleError(null);
                    onBotAvatarSetChange(next as BotAvatarSet).catch(() =>
                      setBotStyleError(t`Couldn't update bot style`),
                    );
                  }}
                  spacing={1}
                  className="grid min-w-0 grid-cols-2 rounded-lg bg-muted p-1"
                >
                  <ToggleGroupItem
                    value="organic"
                    className="text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm"
                  >
                    <Trans>Original</Trans>
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="rakazo"
                    className="text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm"
                  >
                    <Trans>Rakazo mickvvw</Trans>
                  </ToggleGroupItem>
                </ToggleGroup>
                {botStyleError ? (
                  <p role="alert" className="text-body-sm text-destructive">
                    {botStyleError}
                  </p>
                ) : null}
              </div>
            }
          />
        ) : null}
        <SettingsRow
          label={
            <span id={sidebarDensityLabelId}>
              <Trans>Sidebar density</Trans>
            </span>
          }
          control={
            <ToggleGroup
              aria-labelledby={sidebarDensityLabelId}
              data-testid="bots-sidebar-density-select"
              value={[sidebarDensity]}
              onValueChange={([next]) => {
                if (next) botsSidebarDensityPreference.set(next as BotsSidebarDensity);
              }}
              spacing={1}
              className="grid min-w-0 grid-cols-2 rounded-lg bg-muted p-1"
            >
              <ToggleGroupItem
                value="comfortable"
                data-testid="bots-sidebar-density-comfortable"
                className="text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                <Trans>Comfortable</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="compact"
                data-testid="bots-sidebar-density-compact"
                className="text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                <Trans>Compact</Trans>
              </ToggleGroupItem>
            </ToggleGroup>
          }
        />
        <SettingsRow
          label={<Trans>Language</Trans>}
          control={<UiLocalePicker value={locale} onChange={chooseLocale} />}
        />
        {onTimezoneChange ? (
          <div data-testid="timezone-settings">
            <SettingsRow
              label={
                <span id={timezoneId}>
                  <Trans>Timezone</Trans>
                </span>
              }
              control={
                <NativeSelect
                  aria-labelledby={timezoneId}
                  data-testid="timezone-select"
                  value={timezone ?? deviceTimezone}
                  disabled={timezonePending}
                  onChange={(event) => void chooseTimezone(event.target.value)}
                  className="w-56 max-w-full"
                >
                  {timezoneOptions(timezone ?? deviceTimezone).map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone.replaceAll("_", " ")}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              }
            >
              {!timezone || !sameTimeZone(timezone, deviceTimezone) ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto max-w-full py-1.5 text-left whitespace-normal"
                    disabled={timezonePending}
                    data-testid="timezone-use-device"
                    onClick={() => void chooseTimezone(deviceTimezone)}
                  >
                    <Trans comment="Switches the saved timezone to this device's, e.g. 'Use Pacific/Auckland'">
                      Use {deviceTimezone.replaceAll("_", " ")}
                    </Trans>
                  </Button>
                </div>
              ) : null}
              {timezoneError ? (
                <p role="alert" className="mt-2 text-right text-body-sm text-destructive">
                  {timezoneError}
                </p>
              ) : null}
            </SettingsRow>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={<Trans>Chat</Trans>}>
        <SettingsRow
          label={
            <Label htmlFor={enterToSendId} className="text-body font-normal text-foreground">
              <Trans>Send with Enter</Trans>
            </Label>
          }
          control={
            <Switch
              id={enterToSendId}
              data-testid="composer-enter-to-send-toggle"
              checked={enterToSend}
              onCheckedChange={(checked) => composerEnterToSendPreference.set(checked)}
            />
          }
        />
        <SettingsRow
          label={
            <Label htmlFor={streamRepliesId} className="text-body font-normal text-foreground">
              <Trans>Stream replies</Trans>
            </Label>
          }
          control={
            <Switch
              id={streamRepliesId}
              data-testid="response-streaming-toggle"
              checked={streamReplies}
              onCheckedChange={(checked) => responseStreamingPreference.set(checked)}
            />
          }
        />
        <SettingsRow
          label={
            <Label htmlFor={showToolActivityId} className="text-body font-normal text-foreground">
              <Trans>Show tool activity</Trans>
            </Label>
          }
          control={
            <Switch
              id={showToolActivityId}
              data-testid="tool-activity-toggle"
              checked={showToolActivity}
              onCheckedChange={(checked) => toolActivityPreference.set(checked)}
            />
          }
        />
        <SettingsRow
          label={
            <Label htmlFor={loadRemoteImagesId} className="text-body font-normal text-foreground">
              <Trans>Load web images automatically</Trans>
            </Label>
          }
          control={
            <Switch
              id={loadRemoteImagesId}
              data-testid="remote-images-toggle"
              checked={loadRemoteImages}
              onCheckedChange={(checked) => remoteImagesPreference.set(checked)}
            />
          }
        />
      </SettingsGroup>

      <TrustedLinkSitesSettings />
      <ComputerDeviceSettings />

      {showPassword || passkeysSupported || canLinkSso ? (
        <SettingsGroup title={<Trans>Security</Trans>}>
          {showPassword ? <ChangePasswordRow email={email} /> : null}
          {canLinkSso ? <LinkSsoRow /> : null}
          <PasskeySettings />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={<Trans>Data</Trans>} data-testid="account-data">
        <AccountDataSettings onImported={onAccountImported} onImportAgent={onImportAgent} />
        <AccountAccess onSecurity={setAccountSecurity} />
      </SettingsGroup>

      {isAdmin ? (
        <SettingsGroup title={<Trans>App download</Trans>} data-testid="app-download-settings">
          <AdminAppDownloadSettings />
        </SettingsGroup>
      ) : null}
    </div>
  );
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Same compact form as the App usage page: 89,400 renders as 8.9万. */
function compactTokenCount(value: number): string {
  if (value >= 10_000) {
    const wan = value / 10_000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  return new Intl.NumberFormat("en-US").format(value);
}

function UsageSummaryCard({
  title,
  tokens,
  runs,
  inputTokens,
  outputTokens,
  number,
  testId,
}: {
  title: ReactNode;
  tokens: number | null | undefined;
  runs: number;
  inputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
  number: (value: number | null | undefined) => string;
  testId: string;
}) {
  const { t } = useLingui();
  return (
    <div data-testid={testId} className="rounded-2xl border border-border px-4 py-3.5">
      <div className="text-body-sm text-muted-foreground">{title}</div>
      <div className="mt-1 text-heading2 font-extrabold tabular-nums text-foreground">
        {number(tokens)}{" "}
        <span className="text-body-sm font-semibold text-muted-foreground">
          <Trans>tokens</Trans>
        </span>
      </div>
      <div className="mt-1 text-body-sm text-muted-foreground">
        <span className="block">{t`${number(runs)} requests`}</span>
        <span className="block">{t`Input ${number(inputTokens)} · Output ${number(outputTokens)}`}</span>
      </div>
    </div>
  );
}

export function UsageSettingsPanel({
  usage,
  usageDays,
  onUsageDaysChange,
  onUsageReset,
  panelRef,
}: {
  usage?: UsageSummary | null;
  usageDays?: number | undefined;
  onUsageDaysChange?: (days: number | undefined) => void;
  /** Refetches the summary after a successful reset. */
  onUsageReset?: () => void;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t, i18n } = useLingui();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function resetUsage() {
    setResetBusy(true);
    setResetError(null);
    try {
      await rpc.usage.reset();
      setResetOpen(false);
      onUsageReset?.();
    } catch (err) {
      setResetError(errorText(err, t`Could not reset usage`));
    } finally {
      setResetBusy(false);
    }
  }
  const count = new Intl.NumberFormat(i18n.locale);
  const usd = new Intl.NumberFormat(i18n.locale, {
    style: "currency",
    currency: "USD",
  });
  const number = (value: number | null | undefined) => (value == null ? "—" : count.format(value));
  const cost = (value: number | null | undefined) =>
    value == null ? "—" : value > 0 && value < 0.01 ? `<${usd.format(0.01)}` : usd.format(value);
  const models = usage?.models ?? [];
  const bots = usage?.bots ?? [];
  const daily = usage?.daily ?? [];
  const rangeValue = usageDays === undefined ? "all" : String(usageDays);
  const dailyByDate = new Map(daily.map((day) => [day.date, day]));
  const todayKey = localDateKey(new Date());
  const todayDay = dailyByDate.get(todayKey);
  const todayTokens =
    todayDay == null
      ? null
      : (todayDay.totalTokens ?? (todayDay.inputTokens ?? 0) + (todayDay.outputTokens ?? 0));
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = localDateKey(date);
    const day = dailyByDate.get(key);
    const tokens =
      day == null ? 0 : (day.totalTokens ?? (day.inputTokens ?? 0) + (day.outputTokens ?? 0));
    return {
      key,
      label: index === 6 ? t`Today` : `${date.getMonth() + 1}/${date.getDate()}`,
      tokens,
      isToday: index === 6,
    };
  });
  const trendMax = Math.max(1, ...trend.map((day) => day.tokens));
  const summaryTotalTokens = usage?.totalTokens ?? 0;
  return (
    <div ref={panelRef} tabIndex={-1} data-testid="usage-settings" className="outline-none">
      {onUsageDaysChange ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup
            value={[rangeValue]}
            onValueChange={([next]) => {
              if (next === "all") onUsageDaysChange(undefined);
              else if (next === "1" || next === "7" || next === "30")
                onUsageDaysChange(Number(next));
            }}
            aria-label={t`Usage range`}
          >
            <ToggleGroupItem value="1" aria-label={t`Last day`}>
              <Trans>1 day</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="7" aria-label={t`Last 7 days`}>
              <Trans>7 days</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="30" aria-label={t`Last 30 days`}>
              <Trans>30 days</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="all" aria-label={t`All time`}>
              <Trans>All time</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="destructive"
            data-testid="usage-reset"
            onClick={() => {
              setResetError(null);
              setResetOpen(true);
            }}
          >
            <Trans>Reset usage</Trans>
          </Button>
        </div>
      ) : null}
      {resetOpen ? (
        <ConfirmDialog
          open={resetOpen}
          onCancel={() => setResetOpen(false)}
          title={<Trans>Reset usage?</Trans>}
          description={
            <Trans>
              This clears your usage in this space — runs, tokens, cost, and per-model and per-bot
              records. This cannot be undone.
            </Trans>
          }
          confirmLabel={<Trans>Reset</Trans>}
          onConfirm={() => void resetUsage()}
          busy={resetBusy}
          error={resetError}
        />
      ) : null}
      {usage ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <UsageSummaryCard
              title={<Trans>Today's usage</Trans>}
              tokens={todayTokens}
              runs={todayDay?.modelCalls ?? 0}
              inputTokens={todayDay?.inputTokens}
              outputTokens={todayDay?.outputTokens}
              number={number}
              testId="usage-summary-today"
            />
            <UsageSummaryCard
              title={<Trans>Total usage</Trans>}
              tokens={usage.totalTokens}
              runs={usage.runs}
              inputTokens={usage.inputTokens}
              outputTokens={usage.outputTokens}
              number={number}
              testId="usage-summary-total"
            />
          </div>
          <div className="mt-5 flex items-baseline justify-between">
            <h3 className="text-body font-semibold text-foreground">
              <Trans>Last 7 days</Trans>
            </h3>
            <span className="text-label text-muted-foreground">
              <Trans>tokens</Trans>
            </span>
          </div>
          <div
            className="mt-2 rounded-2xl border border-border px-4 py-3"
            data-testid="usage-trend"
          >
            {trend.some((day) => day.tokens > 0) ? (
              <div className="flex h-28 items-end gap-2">
                {trend.map((day) => (
                  <div
                    key={day.key}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                  >
                    <span className="text-[10px] leading-3 tabular-nums text-muted-foreground">
                      {compactTokenCount(day.tokens)}
                    </span>
                    <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                      <div
                        className={
                          day.isToday
                            ? "w-full max-w-[30px] rounded-md bg-primary"
                            : "w-full max-w-[30px] rounded-md bg-muted-foreground"
                        }
                        style={{
                          height: `${Math.max(day.tokens > 0 ? 6 : 2, (day.tokens / trendMax) * 100)}%`,
                        }}
                      />
                    </div>
                    <span
                      className={
                        day.isToday
                          ? "text-[11px] leading-4 font-bold text-primary"
                          : "text-[11px] leading-4 text-muted-foreground"
                      }
                    >
                      {day.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-3 text-center text-body-sm text-muted-foreground">
                <Trans>No usage yet</Trans>
              </p>
            )}
          </div>
          <div className="mt-5 flex items-baseline justify-between">
            <h3 className="text-body font-semibold text-foreground">
              <Trans>By model</Trans>
            </h3>
          </div>
        </>
      ) : null}
      {usage ? (
        models.length > 0 ? (
          <div className="mt-2 space-y-2.5" data-testid="usage-models">
            {models.map((row) => {
              const total = row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
              const share = summaryTotalTokens > 0 ? total / summaryTotalTokens : null;
              return (
                <div
                  key={`${row.provider}:${row.model}`}
                  className="rounded-2xl border border-border px-4 py-3.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{row.model}</div>
                      <div className="text-label text-muted-foreground">{row.provider}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-heading3 font-bold tabular-nums text-foreground">
                        {number(total)}
                      </div>
                      <div className="text-label text-muted-foreground">
                        <Trans>tokens</Trans> · {t`${number(row.modelCalls)} calls`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${share === null ? 0 : Math.round(share * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-body-sm">
                    <span className="text-muted-foreground">
                      {t`Input ${number(row.inputTokens)} · Output ${number(row.outputTokens)}`}
                    </span>
                    {share === null ? null : (
                      <span className="shrink-0 font-semibold text-foreground">
                        {t`${Math.round(share * 100)}% of total`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 py-3 text-center text-body-sm text-muted-foreground">
            <Trans>No usage yet</Trans>
          </p>
        )
      ) : null}
      {bots.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border px-2">
          <Table className="text-body">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground">
                  <Trans>Bot</Trans>
                </TableHead>
                <TableHead className="text-right text-muted-foreground">
                  <Trans>Calls</Trans>
                </TableHead>
                <TableHead className="text-right text-muted-foreground">
                  <Trans>Tokens</Trans>
                </TableHead>
                <TableHead className="text-right text-muted-foreground">
                  <Trans>Cost</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((row) => (
                <TableRow key={row.botId || "unknown"} className="hover:bg-transparent">
                  <TableCell>
                    <div className="text-foreground">{row.botName ?? t`Deleted bot`}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.modelCalls)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.totalTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{cost(row.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

/** The caller's own personal referral code; null while the referral switch is off. */
export function ReferralCodeSettingsPanel() {
  const { t } = useLingui();
  const [copied, copy] = useCopyText();
  const [code, setCode] = useState<MyReferralCode | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    rpc.referral.code().then(
      (next) => {
        if (cancelled) return;
        setCode(next);
        setLoaded(true);
      },
      (err) => {
        if (cancelled) return;
        setLoadError(errorText(err, t`Could not load invite code`));
      },
    );
    return () => {
      cancelled = true;
    };
    // The reload counter is the only intended trigger; `t` is the locale-bound translator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadCount]);

  const used = code?.usedCount ?? 0;
  const max = code?.maxUses ?? 0;
  const exhausted = code?.status === "exhausted" || code?.status === "revoked";
  return (
    <div
      data-testid="referral-code-settings"
      className="mt-4 rounded-xl border border-border px-4 py-4"
    >
      <SectionHeading variant="heading">
        <Trans>My invite code</Trans>
      </SectionHeading>
      {loadError ? (
        <div className="mt-3">
          <p className="text-body-sm text-destructive">{loadError}</p>
          <Button variant="outline" className="mt-2" onClick={() => setReloadCount((n) => n + 1)}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : !loaded ? null : !code ? (
        <p className="mt-3 text-body-sm text-muted-foreground">
          <Trans>Referral codes are not available.</Trans>
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="font-mono text-heading3 tracking-widest text-foreground">
            {code.code}
          </code>
          <Button variant="outline" onClick={() => void copy(code.code)}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? <Trans>Copied</Trans> : <Trans>Copy code</Trans>}
          </Button>
          {exhausted ? (
            <span className="text-body-sm font-medium text-destructive">
              <Trans>Used up</Trans>
            </span>
          ) : (
            <span className="text-body-sm tabular-nums text-muted-foreground">
              <Trans>
                {used} of {max} uses
              </Trans>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ComputerSettingsPanel({
  sandboxProvider,
  onSandboxProviderChange,
  onRecoveryDismissed,
  canConfigureComputers = false,
  computerSettingsEnabled = false,
}: {
  sandboxProvider?: string | null;
  onSandboxProviderChange?: (sandboxProvider: string) => void;
  onRecoveryDismissed?: () => void;
  canConfigureComputers?: boolean;
  computerSettingsEnabled?: boolean;
}) {
  // Once shown, the hint stays mounted so a successful check can show its confirmation.
  const unavailable = computersAreUnavailable(sandboxProvider);
  const [hintShown, setHintShown] = useState(unavailable);
  if (unavailable && !hintShown) setHintShown(true);
  return (
    <div
      data-testid="computers-setup-settings"
      className="rounded-xl border border-border px-4 py-4"
    >
      <SectionHeading variant="heading">
        <Trans>Computers</Trans>
      </SectionHeading>
      {hintShown ? (
        <ComputersUnavailableHint
          className="mt-3 text-body-sm leading-relaxed text-muted-foreground"
          sandboxProvider={sandboxProvider}
          onRecovered={onSandboxProviderChange}
          onRecoveryDismissed={onRecoveryDismissed}
        />
      ) : null}
      {/* The server decides what an account may change, including removing keys it saved. */}
      {computerSettingsEnabled && (canConfigureComputers || sandboxProvider) ? (
        <ComputerProviderSettings
          scope={canConfigureComputers ? "deployment" : "account"}
          onProviderChange={onSandboxProviderChange}
        />
      ) : null}
    </div>
  );
}

export function UpdatesSettingsPanel() {
  return (
    <div className="space-y-5">
      <DesktopUpdateSection />
    </div>
  );
}

function ChangePasswordRow({ email }: { email?: string | null }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    if (pending) return;
    if (newPassword !== confirmation) {
      setError(t`Passwords do not match`);
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(authErrorText(result.error, t`Could not change password`));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setOpen(false);
      setSaved(true);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setError(null);
  }

  return (
    <SettingsRow
      label={<Trans>Password</Trans>}
      control={
        open ? null : (
          <>
            {saved ? <SuccessPop label={t`Password updated`} /> : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSaved(false);
                setOpen(true);
              }}
            >
              <Trans>Change password</Trans>
            </Button>
          </>
        )
      }
    >
      {open ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void changePassword();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="grid gap-3">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={email ?? ""}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <SettingsPasswordInput
              label={t`Current password`}
              autoComplete="current-password"
              autoFocus
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <SettingsPasswordInput
              label={t`New password`}
              autoComplete="new-password"
              value={newPassword}
              onChange={setNewPassword}
            />
            <SettingsPasswordInput
              label={t`Confirm password`}
              autoComplete="new-password"
              value={confirmation}
              onChange={setConfirmation}
            />
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={pending || !currentPassword || !newPassword}>
              {pending ? <Trans>Changing…</Trans> : <Trans>Save</Trans>}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsRow>
  );
}

function SettingsPasswordInput({
  label,
  autoComplete,
  autoFocus,
  value,
  onChange,
}: {
  label: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        minLength={autoComplete === "new-password" ? MIN_PASSWORD_LENGTH : undefined}
        maxLength={MAX_PASSWORD_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function AppearancePicker({
  value,
  onChange,
}: {
  value: AppearancePreference;
  onChange: (next: AppearancePreference) => void;
}) {
  const { t } = useLingui();
  const options: { value: AppearancePreference; label: string }[] = [
    { value: "system", label: t`System` },
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
  ];

  return (
    <ToggleGroup
      aria-label={t`Appearance`}
      data-testid="ui-appearance-select"
      value={[value]}
      onValueChange={([next]) => {
        if (next) onChange(next as AppearancePreference);
      }}
      spacing={1}
      className="grid min-w-0 grid-cols-3 rounded-lg bg-muted p-1"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          data-testid={`ui-appearance-${option.value}`}
          className="text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function UiLocalePicker({
  value,
  onChange,
}: {
  value: UiLocale;
  onChange: (locale: UiLocale) => void;
}) {
  const { t } = useLingui();
  return (
    <OptionSelect
      className="w-56 max-w-full"
      data-testid="ui-locale-select"
      aria-label={t`Language`}
      options={UI_LOCALES.map((code) => ({
        value: code,
        label: APP_LOCALE_LABELS[code],
      }))}
      value={value}
      onValueChange={onChange}
    />
  );
}
