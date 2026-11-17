import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  SectionHeading,
  Spinner,
  toast,
  useCopyText,
} from "@rakazo_mickvvw/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { shareLinkQrDataUrl } from "../../lib/share-link-qr";
import { errorCode, errorText } from "../../lib/user-error";
import { SuperKeyGate, useSuperKeyGate } from "./AdminSuperKeyGate";
import { TotpCodeInput } from "./AdminTotpCodeInput";

export function AdminTwoFactorPanel() {
  return (
    <SuperKeyGate>
      <TwoFactorSettings />
    </SuperKeyGate>
  );
}

function TwoFactorSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const status = useQuery(queries.admin.twoFactor.status.queryOptions());
  if (status.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (status.isError || !status.data)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(status.error, t`Couldn't load two-factor status`)}
        <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  return <TwoFactorBody status={status.data} />;
}

function TwoFactorBody({
  status,
}: {
  status: { enabled: boolean; verified: boolean; recoveryCodesRemaining: number };
}) {
  const { enabled, verified } = status;
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const { onForbidden } = useSuperKeyGate();
  const [enrollment, setEnrollment] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const [copied, copy] = useCopyText();

  useEffect(() => {
    if (!enrollment) {
      setQrDataUrl(null);
      return;
    }
    let live = true;
    void shareLinkQrDataUrl(enrollment.otpauthUri)
      .then((dataUrl) => {
        if (live) setQrDataUrl(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enrollment]);

  async function refreshStatus() {
    await queryClient.invalidateQueries({
      queryKey: queries.admin.twoFactor.status.key(),
    });
  }

  async function startEnrollment() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await rpc.admin.twoFactor.enrollStart();
      setEnrollment(result);
      setRecoveryCodes(null);
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Could not start setup`));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await rpc.admin.twoFactor.enrollConfirm({ code: value });
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setCode("");
      await refreshStatus();
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Code is incorrect`));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function disable(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      await rpc.admin.twoFactor.disable({ code: value });
      setDisableOpen(false);
      setDisableCode("");
      await refreshStatus();
      toast(t`Two-factor authentication turned off`);
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Code is incorrect`));
      setDisableCode("");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await rpc.admin.twoFactor.reset();
      setResetArmed(false);
      setEnrollment(null);
      setRecoveryCodes(null);
      await refreshStatus();
      toast(t`Two-factor authentication reset — set it up again`);
    } catch (error) {
      if (errorCode(error) === "FORBIDDEN") onForbidden(error);
      toast.error(errorText(error, t`Could not reset two-factor authentication`));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="space-y-6">
        <SectionHeading>{t`Recovery codes`}</SectionHeading>
        <p className="text-body-sm text-muted-foreground">
          <Trans>
            Save these somewhere safe. Each code works once, and they are only shown this one time.
          </Trans>
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-body-sm">
          {recoveryCodes.map((recoveryCode) => (
            <div key={recoveryCode} className="rounded-lg border border-border px-3 py-2">
              {recoveryCode}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void copy(recoveryCodes.join("\n"))}>
            {copied ? <Trans>Copied</Trans> : <Trans>Copy all</Trans>}
          </Button>
          <Button
            onClick={() => {
              setRecoveryCodes(null);
              void refreshStatus();
            }}
          >
            <Trans>I saved them</Trans>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeading>{t`Two-factor authentication`}</SectionHeading>
        <dl className="space-y-2 text-body-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              <Trans>Status</Trans>
            </dt>
            <dd>{enabled ? <Trans>On</Trans> : <Trans>Off</Trans>}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              <Trans>This session</Trans>
            </dt>
            <dd>{verified ? <Trans>Verified</Trans> : <Trans>Not verified</Trans>}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              <Trans>Recovery codes left</Trans>
            </dt>
            <dd>{status.recoveryCodesRemaining}</dd>
          </div>
        </dl>

        {!enabled ? (
          enrollment ? (
            <div className="space-y-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t`QR code for your authenticator app`}
                  className="size-48 rounded-xl border border-border bg-white p-2"
                />
              ) : (
                <div className="grid size-48 place-items-center">
                  <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
                </div>
              )}
              <Field>
                <FieldLabel htmlFor="admin-totp-secret">
                  <Trans>Or enter this secret by hand</Trans>
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="admin-totp-secret"
                    readOnly
                    value={enrollment.secret}
                    className="font-mono"
                  />
                  <Button variant="outline" size="sm" onClick={() => void copy(enrollment.secret)}>
                    {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
                  </Button>
                </div>
              </Field>
              <TotpCodeInput
                value={code}
                onChange={setCode}
                onComplete={(value) => void confirmEnrollment(value)}
                disabled={busy}
              />
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEnrollment(null)}>
                <Trans>Cancel setup</Trans>
              </Button>
            </div>
          ) : (
            <Button disabled={busy} onClick={() => void startEnrollment()}>
              {busy ? <Trans>Starting…</Trans> : <Trans>Set up two-factor authentication</Trans>}
            </Button>
          )
        ) : (
          <div className="space-y-4">
            {disableOpen ? (
              <div className="space-y-3">
                <p className="text-body-sm text-muted-foreground">
                  <Trans>Enter a code from your authenticator to turn it off.</Trans>
                </p>
                <TotpCodeInput
                  value={disableCode}
                  onChange={setDisableCode}
                  onComplete={(value) => void disable(value)}
                  disabled={busy}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDisableOpen(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => setDisableOpen(true)}>
                <Trans>Turn off</Trans>
              </Button>
            )}
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => void reset()}
              >
                {resetArmed ? (
                  <Trans>Confirm reset</Trans>
                ) : (
                  <Trans>Lost both authenticator and recovery codes</Trans>
                )}
              </Button>
              {resetArmed ? (
                <p className="mt-1 text-body-sm text-muted-foreground">
                  <Trans>Two-factor authentication is removed and you set it up again.</Trans>
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <ChangeSuperKeySection />
    </div>
  );
}

function ChangeSuperKeySection() {
  const { t } = useLingui();
  const { onForbidden } = useSuperKeyGate();
  const [currentKey, setCurrentKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change() {
    if (busy) return;
    setError(null);
    if (newKey.length < 8) {
      setError(t`The new super key must be at least 8 characters`);
      return;
    }
    setBusy(true);
    try {
      await rpc.admin.superKey.change({ currentKey, newKey });
      setCurrentKey("");
      setNewKey("");
      toast(t`Super key changed`);
    } catch (caught) {
      if (errorCode(caught) === "FORBIDDEN") onForbidden(caught);
      setError(errorText(caught, t`Could not change the super key`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <SectionHeading>{t`Change super key`}</SectionHeading>
      <form
        className="max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        <Field>
          <FieldLabel htmlFor="admin-super-key-current">
            <Trans>Current super key</Trans>
          </FieldLabel>
          <Input
            id="admin-super-key-current"
            type="password"
            autoComplete="current-password"
            value={currentKey}
            disabled={busy}
            onChange={(event) => setCurrentKey(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="admin-super-key-new">
            <Trans>New super key</Trans>
          </FieldLabel>
          <Input
            id="admin-super-key-new"
            type="password"
            autoComplete="new-password"
            value={newKey}
            disabled={busy}
            onChange={(event) => setNewKey(event.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !currentKey || !newKey}>
          {busy ? <Trans>Saving…</Trans> : <Trans>Change super key</Trans>}
        </Button>
      </form>
    </section>
  );
}
