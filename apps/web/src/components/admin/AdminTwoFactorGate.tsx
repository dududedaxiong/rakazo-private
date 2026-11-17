import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Field, FieldLabel, Input, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { TotpCodeInput } from "./AdminTotpCodeInput";

/**
 * Admin entry gate: when TOTP is enabled for this admin and this session has not
 * proved a code yet, the whole admin surface stays behind the code box. A
 * recovery code works here too, so a lost authenticator does not lock the admin
 * out of the reset page that lives behind this gate.
 */
export function AdminTwoFactorGate({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const status = useQuery(queries.admin.twoFactor.status.queryOptions());
  if (status.isPending)
    return (
      <div className="grid h-full place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (status.isError || !status.data)
    return (
      <div className="grid h-full place-items-center px-6">
        <div role="alert" className="flex items-center gap-3 text-body text-destructive">
          {errorText(status.error, t`Couldn't load two-factor status`)}
          <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      </div>
    );
  if (!status.data.enabled || status.data.verified) return <>{children}</>;
  return <TotpVerifyScreen />;
}

function TotpVerifyScreen() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.admin.twoFactor.verify({ code: value });
      setCode("");
      setRecoveryCode("");
      await queryClient.invalidateQueries({
        queryKey: queries.admin.twoFactor.status.key(),
      });
    } catch (caught) {
      setError(errorText(caught, t`Code is incorrect`));
      setCode("");
      setRecoveryCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="font-medium text-heading3">
            <Trans>Two-factor authentication</Trans>
          </h1>
          <p className="text-body-sm text-muted-foreground">
            <Trans>Enter the 6-digit code from your authenticator app.</Trans>
          </p>
        </div>
        {recoveryMode ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void verify(recoveryCode);
            }}
          >
            <Field>
              <FieldLabel htmlFor="admin-recovery-code">
                <Trans>Recovery code</Trans>
              </FieldLabel>
              <Input
                id="admin-recovery-code"
                value={recoveryCode}
                autoComplete="one-time-code"
                autoFocus
                disabled={busy}
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder="XXXX-XXXX"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy || !recoveryCode.trim()}>
              {busy ? <Trans>Verifying…</Trans> : <Trans>Verify</Trans>}
            </Button>
          </form>
        ) : (
          <TotpCodeInput
            value={code}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
            disabled={busy}
          />
        )}
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setError(null);
            setRecoveryMode((mode) => !mode);
          }}
        >
          {recoveryMode ? (
            <Trans>Use authenticator code</Trans>
          ) : (
            <Trans>Use a recovery code</Trans>
          )}
        </Button>
      </div>
    </div>
  );
}
