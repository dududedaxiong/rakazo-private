import { Trans, useLingui } from "@lingui/react/macro";
import type { EmailProvider, EmailSettings } from "@rakazo/contracts";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  SectionHeading,
  Spinner,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorCode, errorText } from "../../lib/user-error";
import { SuperKeyGate, useSuperKeyGate } from "./AdminSuperKeyGate";

export function AdminEmailSettingsPanel() {
  return (
    <SuperKeyGate>
      <EmailSettingsForm />
    </SuperKeyGate>
  );
}

function EmailSettingsForm() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const settings = useQuery(queries.admin.emailSettings.get.queryOptions());
  if (settings.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (settings.isError || !settings.data)
    return (
      <EmailSettingsLoadError error={settings.error} onRetry={() => void settings.refetch()} />
    );
  return <SettingsForm key={settings.data.source} initial={settings.data} />;
}

function EmailSettingsLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useLingui();
  const { onForbidden } = useSuperKeyGate();
  const forbidden = errorCode(error) === "FORBIDDEN";
  useEffect(() => {
    if (forbidden) onForbidden(error);
  }, [forbidden, onForbidden, error]);
  if (forbidden) return null;
  return (
    <div role="alert" className="flex items-center gap-3 text-body text-destructive">
      {errorText(error, t`Couldn't load email settings`)}
      <Button variant="outline" size="sm" onClick={onRetry}>
        <Trans>Retry</Trans>
      </Button>
    </div>
  );
}

function SettingsForm({ initial }: { initial: EmailSettings }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const { onForbidden } = useSuperKeyGate();
  const [provider, setProvider] = useState<EmailProvider>(initial.provider);
  const [from, setFrom] = useState(initial.from);
  const [replyTo, setReplyTo] = useState(initial.replyTo ?? "");
  const [apiKey, setApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState(initial.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(initial.smtpPort?.toString() ?? "");
  const [smtpUser, setSmtpUser] = useState(initial.smtpUser ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const providers: { value: EmailProvider; label: string }[] = [
    { value: "resend", label: "Resend" },
    { value: "selfhost", label: t`Self-hosted email (no API key)` },
    { value: "smtp", label: "SMTP" },
    { value: "none", label: t`None` },
  ];

  const dirty =
    provider !== initial.provider ||
    from !== initial.from ||
    replyTo !== (initial.replyTo ?? "") ||
    apiKey !== "" ||
    smtpHost !== (initial.smtpHost ?? "") ||
    smtpPort !== (initial.smtpPort?.toString() ?? "") ||
    smtpUser !== (initial.smtpUser ?? "") ||
    smtpPassword !== "";

  async function save() {
    if (busy || !dirty) return;
    setFormError(null);
    if (provider !== "none" && !from.trim()) {
      setFormError(t`Enter a sender address`);
      return;
    }
    if ((provider === "smtp" || provider === "selfhost") && !smtpHost.trim()) {
      setFormError(t`Enter a server address`);
      return;
    }
    const port = smtpPort.trim() ? Number(smtpPort) : null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setFormError(t`Enter a port between 1 and 65535`);
      return;
    }
    setBusy(true);
    try {
      await rpc.admin.emailSettings.update({
        ...(provider !== initial.provider ? { provider } : {}),
        ...(from !== initial.from ? { from: from.trim() } : {}),
        ...(replyTo !== (initial.replyTo ?? "")
          ? { replyTo: replyTo.trim() ? replyTo.trim() : null }
          : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(smtpHost !== (initial.smtpHost ?? "")
          ? { smtpHost: smtpHost.trim() ? smtpHost.trim() : null }
          : {}),
        ...(smtpPort !== (initial.smtpPort?.toString() ?? "") ? { smtpPort: port } : {}),
        ...(smtpUser !== (initial.smtpUser ?? "")
          ? { smtpUser: smtpUser.trim() ? smtpUser.trim() : null }
          : {}),
        ...(smtpPassword ? { smtpPassword } : {}),
      });
      setApiKey("");
      setSmtpPassword("");
      await queryClient.invalidateQueries({
        queryKey: queries.admin.emailSettings.get.key(),
      });
      toast(t`Email settings saved`);
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Could not save email settings`));
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    if (testing) return;
    setTesting(true);
    try {
      await rpc.admin.emailSettings.test();
      toast(t`Test email sent`);
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Could not send the test email`));
    } finally {
      setTesting(false);
    }
  }

  async function clear() {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setBusy(true);
    try {
      await rpc.admin.emailSettings.clear();
      setApiKey("");
      setSmtpPassword("");
      setClearArmed(false);
      await queryClient.invalidateQueries({
        queryKey: queries.admin.emailSettings.get.key(),
      });
      toast(t`Page settings cleared`);
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Could not clear email settings`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <SectionHeading>{t`Email settings`}</SectionHeading>
        <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-body-sm text-muted-foreground">
          {initial.source === "database" ? (
            <Trans>Page settings</Trans>
          ) : initial.source === "environment" ? (
            <Trans>Environment variables</Trans>
          ) : (
            <Trans>Not configured</Trans>
          )}
        </span>
      </div>

      <section className="space-y-4">
        <Field>
          <FieldLabel htmlFor="admin-email-provider">
            <Trans>Provider</Trans>
          </FieldLabel>
          <NativeSelect
            id="admin-email-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as EmailProvider)}
          >
            {providers.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        {provider === "resend" ? (
          <Field>
            <FieldLabel htmlFor="admin-email-api-key">
              <Trans>API key</Trans>
            </FieldLabel>
            <Input
              id="admin-email-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={
                initial.apiKeyConfigured
                  ? t`Configured — leave empty to keep it`
                  : t`Not configured`
              }
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Field>
        ) : null}

        {provider === "smtp" || provider === "selfhost" ? (
          <>
            <p className="text-body-sm text-muted-foreground">
              <Trans>
                No API key needed — just the server address and port. Leave the account and password
                empty when the server has no authentication.
              </Trans>
            </p>
            <Field>
              <FieldLabel htmlFor="admin-email-smtp-host">
                <Trans>Server address</Trans>
              </FieldLabel>
              <Input
                id="admin-email-smtp-host"
                value={smtpHost}
                autoComplete="off"
                onChange={(event) => setSmtpHost(event.target.value)}
                placeholder="smtp.example.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="admin-email-smtp-port">
                  <Trans>Port</Trans>
                </FieldLabel>
                <Input
                  id="admin-email-smtp-port"
                  inputMode="numeric"
                  value={smtpPort}
                  onChange={(event) => setSmtpPort(event.target.value)}
                  placeholder="587"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-email-smtp-user">
                  <Trans>Account</Trans>
                </FieldLabel>
                <Input
                  id="admin-email-smtp-user"
                  value={smtpUser}
                  autoComplete="off"
                  onChange={(event) => setSmtpUser(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="admin-email-smtp-password">
                <Trans>Password</Trans>
              </FieldLabel>
              <Input
                id="admin-email-smtp-password"
                type="password"
                autoComplete="off"
                value={smtpPassword}
                placeholder={
                  initial.smtpPasswordConfigured
                    ? t`Configured — leave empty to keep it`
                    : t`Not configured`
                }
                onChange={(event) => setSmtpPassword(event.target.value)}
              />
            </Field>
          </>
        ) : null}

        <Field>
          <FieldLabel htmlFor="admin-email-from">
            <Trans>Sender address</Trans>
          </FieldLabel>
          <Input
            id="admin-email-from"
            type="email"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="noreply@example.com"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="admin-email-reply-to">
            <Trans>Reply-to address</Trans>
          </FieldLabel>
          <Input
            id="admin-email-reply-to"
            type="email"
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
            placeholder="support@example.com"
          />
        </Field>
      </section>

      {formError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? <Trans>Saving…</Trans> : <Trans>Save settings</Trans>}
        </Button>
        <Button variant="outline" disabled={busy || testing} onClick={() => void testSend()}>
          {testing ? <Trans>Sending…</Trans> : <Trans>Send a test email</Trans>}
        </Button>
      </div>

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => void clear()}
        >
          {clearArmed ? <Trans>Confirm clear</Trans> : <Trans>Clear page settings</Trans>}
        </Button>
        {clearArmed ? (
          <p className="mt-1 text-body-sm text-muted-foreground">
            <Trans>Saved settings are removed and the environment values apply again.</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
