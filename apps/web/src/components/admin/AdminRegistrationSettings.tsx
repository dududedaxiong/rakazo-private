import { Trans, useLingui } from "@lingui/react/macro";
import type { RegistrationSettings } from "@rakazo/contracts";
import {
  Button,
  Field,
  FieldLabel,
  SectionHeading,
  Spinner,
  Switch,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

export function AdminRegistrationSettingsPanel() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const settings = useQuery(queries.admin.registrationSettings.get.queryOptions());
  const [formKey, setFormKey] = useState(0);
  if (settings.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (settings.isError || !settings.data)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(settings.error, t`Couldn't load registration settings`)}
        <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  return (
    <SettingsForm
      key={formKey}
      initial={settings.data}
      onSaved={() => setFormKey((key) => key + 1)}
    />
  );
}

function SettingsForm({
  initial,
  onSaved,
}: {
  initial: RegistrationSettings;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [inviteCodeEnabled, setInviteCodeEnabled] = useState(initial.inviteCodeEnabled);
  const [emailSignupEnabled, setEmailSignupEnabled] = useState(initial.emailSignupEnabled);
  const [allowlistEnabled, setAllowlistEnabled] = useState(initial.signupAllowlist.length > 0);
  const [allowlist, setAllowlist] = useState(initial.signupAllowlist.join("\n"));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const domains = allowlistEnabled
        ? [
            ...new Set(
              allowlist
                .split("\n")
                .map((line) => line.trim().toLowerCase())
                .filter(Boolean),
            ),
          ]
        : [];
      await rpc.admin.registrationSettings.update({
        emailSignupEnabled,
        inviteCodeEnabled,
        signupAllowlist: domains,
      });
      await queryClient.invalidateQueries({
        queryKey: queries.admin.registrationSettings.get.key(),
      });
      onSaved();
    } catch (error) {
      toast.error(errorText(error, t`Could not save settings`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!initial.masterSwitchEnabled ? (
        <p
          role="alert"
          className="rounded-xl border border-border px-4 py-3 text-body-sm text-muted-foreground"
        >
          <Trans>
            The environment master switch is off, so registration stays closed no matter what is set
            here.
          </Trans>
        </p>
      ) : null}
      <section className="space-y-4">
        <SectionHeading>{t`Registration method`}</SectionHeading>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">
              <Trans>Invite code registration</Trans>
            </div>
            <p className="text-body-sm text-muted-foreground">
              <Trans>When on, registration requires a valid invite code.</Trans>
            </p>
          </div>
          <Switch
            checked={inviteCodeEnabled}
            onCheckedChange={setInviteCodeEnabled}
            aria-label={t`Invite code registration`}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">
              <Trans>Email registration</Trans>
            </div>
            <p className="text-body-sm text-muted-foreground">
              <Trans>When off, no new accounts can register by email.</Trans>
            </p>
          </div>
          <Switch
            checked={emailSignupEnabled}
            onCheckedChange={setEmailSignupEnabled}
            aria-label={t`Email registration`}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">
              <Trans>Email domain allowlist</Trans>
            </div>
            <p className="text-body-sm text-muted-foreground">
              <Trans>When on, only emails from the domains below can register.</Trans>
            </p>
          </div>
          <Switch
            checked={allowlistEnabled}
            onCheckedChange={setAllowlistEnabled}
            aria-label={t`Email domain allowlist`}
          />
        </div>
        {allowlistEnabled ? (
          <Field>
            <FieldLabel htmlFor="allowlist">
              <Trans>Allowed email domains, one per line</Trans>
            </FieldLabel>
            <Textarea
              id="allowlist"
              value={allowlist}
              rows={4}
              placeholder={"gmail.com\nqq.com"}
              onChange={(event) => setAllowlist(event.target.value)}
            />
          </Field>
        ) : null}
      </section>
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? <Trans>Saving…</Trans> : <Trans>Save settings</Trans>}
      </Button>
    </div>
  );
}
