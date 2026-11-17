import { Trans, useLingui } from "@lingui/react/macro";
import type { InviteCodeStatus } from "@rakazo_mickvvw/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from "@rakazo_mickvvw/ui-web";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { formatDateTime } from "./admin-shared";

const PAGE_SIZE = 50;
const codeStatuses: Array<InviteCodeStatus | undefined> = [
  undefined,
  "active",
  "expired",
  "revoked",
  "exhausted",
];

function CodeStatusLabel({ status }: { status: InviteCodeStatus | undefined }) {
  switch (status) {
    case "active":
      return <Trans>Active</Trans>;
    case "expired":
      return <Trans>Expired</Trans>;
    case "revoked":
      return <Trans>Revoked</Trans>;
    case "exhausted":
      return <Trans>Used up</Trans>;
    default:
      return <Trans>All</Trans>;
  }
}

function CodeStatusBadge({ status }: { status: InviteCodeStatus }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="secondary">
          <Trans>Active</Trans>
        </Badge>
      );
    case "expired":
    case "exhausted":
      return (
        <Badge variant="outline">
          <CodeStatusLabel status={status} />
        </Badge>
      );
    case "revoked":
      return (
        <Badge variant="destructive">
          <Trans>Revoked</Trans>
        </Badge>
      );
  }
}

export function AdminInviteCodesPanel() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InviteCodeStatus | undefined>(undefined);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const codes = useInfiniteQuery(
    queries.admin.inviteCodes.list.infiniteOptions({
      input: (cursor: string | null) => ({
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        ...(status ? { status } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => (page.length === PAGE_SIZE ? (page.at(-1)?.id ?? null) : null),
      placeholderData: (previous) => previous,
    }),
  );
  const items = (codes.data?.pages ?? []).flat();

  async function revoke(id: string) {
    setBusy(id);
    try {
      await rpc.admin.inviteCodes.revoke({ id });
      await queryClient.invalidateQueries({ queryKey: queries.admin.inviteCodes.list.key() });
    } catch (error) {
      toast.error(errorText(error, t`Could not revoke the code`));
    } finally {
      setBusy(null);
    }
  }

  if (codes.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (codes.isError && items.length === 0)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(codes.error, t`Couldn't load invite codes`)}
        <Button variant="outline" size="sm" onClick={() => void codes.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setGenerateOpen(true)}>
          <Trans>Generate invite codes</Trans>
        </Button>
        <div className="flex flex-wrap gap-1">
          {codeStatuses.map((option) => (
            <Button
              key={option ?? "all"}
              type="button"
              variant={status === option ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
            >
              <CodeStatusLabel status={option} />
            </Button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          <Trans>No invite codes yet</Trans>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((code) => (
            <li key={code.id} className="flex items-center gap-3 px-4 py-3 text-body-sm">
              <code className="shrink-0 font-mono">{code.code}</code>
              <CodeStatusBadge status={code.status} />
              {code.isReferral ? (
                <Badge variant="outline">
                  <Trans>Referral</Trans>
                </Badge>
              ) : null}
              <span className="text-muted-foreground">
                {code.usedCount}/{code.maxUses}
              </span>
              <span className="hidden shrink-0 text-muted-foreground sm:block">
                {formatDateTime(code.createdAt, i18n.locale)}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-muted-foreground md:block">
                {code.expiresAt ? (
                  formatDateTime(code.expiresAt, i18n.locale)
                ) : (
                  <Trans>Never expires</Trans>
                )}
              </span>
              {code.status === "active" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void revoke(code.id)}
                >
                  {busy === code.id ? <Trans>Revoking…</Trans> : <Trans>Revoke</Trans>}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {codes.hasNextPage ? (
        <Button
          variant="outline"
          disabled={codes.isFetchingNextPage}
          onClick={() => void codes.fetchNextPage()}
        >
          {codes.isFetchingNextPage ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
        </Button>
      ) : null}

      {generateOpen ? (
        <GenerateDialog
          onClose={() => setGenerateOpen(false)}
          onGenerated={async () => {
            setGenerateOpen(false);
            await queryClient.invalidateQueries({
              queryKey: queries.admin.inviteCodes.list.key(),
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** Keep in sync with INVITE_CODE_ALPHABET in packages/auth/src/invite-codes.ts. */
const RANDOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RANDOM_CODE_LENGTH = 12;

/** One random code, for the dialog's "Generate random" button. */
function randomInviteCode(): string {
  const values = new Uint32Array(RANDOM_CODE_LENGTH);
  globalThis.crypto.getRandomValues(values);
  let code = "";
  for (const value of values) code += RANDOM_CODE_ALPHABET[value % RANDOM_CODE_ALPHABET.length];
  return code;
}

function GenerateDialog({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  onGenerated: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [count, setCount] = useState("10");
  const [customCodes, setCustomCodes] = useState("");
  const [expiry, setExpiry] = useState("30");
  const [busy, setBusy] = useState(false);

  const custom = customCodes
    .split(/[,，]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  function addRandomCode() {
    const code = randomInviteCode();
    setCustomCodes((current) => {
      const trimmed = current.trim().replace(/[,，\s]+$/, "");
      return trimmed ? `${trimmed}, ${code}` : code;
    });
  }

  async function generate() {
    const amount = custom.length > 0 ? custom.length : Number(count);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) return;
    setBusy(true);
    try {
      await rpc.admin.inviteCodes.create({
        count: custom.length > 0 ? 1 : amount,
        maxUses: 1,
        expiresInDays: expiry === "never" ? null : Number(expiry),
        codes: custom.length > 0 ? custom : undefined,
      });
      toast.success(t`${amount} invite codes generated`);
      await onGenerated();
    } catch (error) {
      toast.error(errorText(error, t`Could not generate invite codes`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Generate invite codes</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="generate-count">
              <Trans>Count</Trans>
            </FieldLabel>
            <Input
              id="generate-count"
              type="number"
              min={1}
              max={100}
              value={count}
              disabled={custom.length > 0}
              onChange={(event) => setCount(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="generate-custom-codes">
              <Trans>Custom codes (optional, comma-separated)</Trans>
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="generate-custom-codes"
                value={customCodes}
                placeholder="SUMMER27, THANKS27"
                onChange={(event) => setCustomCodes(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={addRandomCode}>
                <Trans>Generate random</Trans>
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="generate-expiry">
              <Trans>Valid for</Trans>
            </FieldLabel>
            <Select value={expiry} onValueChange={(value) => setExpiry(value ?? "30")}>
              <SelectTrigger id="generate-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">
                  <Trans>7 days</Trans>
                </SelectItem>
                <SelectItem value="30">
                  <Trans>30 days</Trans>
                </SelectItem>
                <SelectItem value="90">
                  <Trans>90 days</Trans>
                </SelectItem>
                <SelectItem value="never">
                  <Trans>Never expires</Trans>
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <p className="text-body-sm text-muted-foreground">
            <Trans>Each code works once and stops working after use.</Trans>
          </p>
          <Button disabled={busy} onClick={() => void generate()}>
            {busy ? <Trans>Generating…</Trans> : <Trans>Generate</Trans>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
