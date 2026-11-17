import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Field, FieldLabel, Input, Spinner } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorCode, errorText } from "../../lib/user-error";

type SuperKeyGateValue = {
  /**
   * Call when a gated call comes back FORBIDDEN: the grant may have expired, so
   * re-check it; the gate reappears on its own when the grant is really gone.
   */
  onForbidden: (error: unknown) => void;
};

const SuperKeyGateContext = createContext<SuperKeyGateValue | null>(null);

export function useSuperKeyGate(): SuperKeyGateValue {
  const value = useContext(SuperKeyGateContext);
  if (!value) throw new Error("useSuperKeyGate must be used inside SuperKeyGate");
  return value;
}

/**
 * Gate for the email and two-factor settings pages: the page only renders once
 * this session holds a live super-key grant (15 minutes). Without any key
 * configured anywhere, the gate cannot open and says so instead of asking.
 */
export function SuperKeyGate({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const status = useQuery(queries.admin.superKey.status.queryOptions());
  const onForbidden = useCallback(
    (error: unknown) => {
      if (errorCode(error) === "FORBIDDEN")
        void queryClient.invalidateQueries({
          queryKey: queries.admin.superKey.status.key(),
        });
    },
    [queries, queryClient],
  );
  if (status.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (status.isError || !status.data)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(status.error, t`Couldn't check the super key`)}
        <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  if (!status.data.configured)
    return (
      <p role="alert" className="rounded-xl border border-border px-4 py-3 text-body-sm">
        <Trans>
          No super key is configured, so this page cannot be opened. Ask whoever deploys the server
          to configure one.
        </Trans>
      </p>
    );
  if (!status.data.granted) return <SuperKeyVerifyForm />;
  return (
    <SuperKeyGateContext.Provider value={{ onForbidden }}>{children}</SuperKeyGateContext.Provider>
  );
}

function SuperKeyVerifyForm() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    if (busy || !key) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.admin.superKey.verify({ key });
      setKey("");
      await queryClient.invalidateQueries({
        queryKey: queries.admin.superKey.status.key(),
      });
    } catch (caught) {
      setError(errorText(caught, t`Super key is incorrect`));
      setKey("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="max-w-sm space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <div className="space-y-1">
        <h2 className="font-medium">
          <Trans>Super key required</Trans>
        </h2>
        <p className="text-body-sm text-muted-foreground">
          <Trans>This page stays open for 15 minutes after verification.</Trans>
        </p>
      </div>
      <Field>
        <FieldLabel htmlFor="admin-super-key">
          <Trans>Super key</Trans>
        </FieldLabel>
        <Input
          id="admin-super-key"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={key}
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !key}>
        {busy ? <Trans>Verifying…</Trans> : <Trans>Verify</Trans>}
      </Button>
    </form>
  );
}
