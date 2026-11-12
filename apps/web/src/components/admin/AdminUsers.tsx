import { Trans, useLingui } from "@lingui/react/macro";
import type { AdminUser, AdminUserStatus } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  toast,
} from "@rakazo/ui-web";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { formatDateTime } from "./admin-shared";

const PAGE_SIZE = 50;
const statuses: Array<AdminUserStatus | undefined> = [
  undefined,
  "active",
  "disabled",
  "blacklisted",
  "deleted",
];

function StatusFilterLabel({ status }: { status: AdminUserStatus | undefined }) {
  switch (status) {
    case "active":
      return <Trans>Active</Trans>;
    case "disabled":
      return <Trans>Disabled</Trans>;
    case "blacklisted":
      return <Trans>Blacklisted</Trans>;
    case "deleted":
      return <Trans>Deleted</Trans>;
    default:
      return <Trans>All</Trans>;
  }
}

function StatusBadge({ status }: { status: AdminUserStatus }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="secondary">
          <Trans>Active</Trans>
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="outline">
          <Trans>Disabled</Trans>
        </Badge>
      );
    case "blacklisted":
      return (
        <Badge variant="destructive">
          <Trans>Blacklisted</Trans>
        </Badge>
      );
    case "deleted":
      return (
        <Badge variant="outline">
          <Trans>Deleted</Trans>
        </Badge>
      );
  }
}

export function AdminUsersPanel() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const [status, setStatus] = useState<AdminUserStatus | undefined>(undefined);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const users = useInfiniteQuery(
    queries.admin.users.list.infiniteOptions({
      input: (cursor: string | null) => ({
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        ...(query ? { query } : {}),
        ...(status ? { status } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => (page.length === PAGE_SIZE ? (page.at(-1)?.id ?? null) : null),
      placeholderData: (previous) => previous,
    }),
  );
  const items = (users.data?.pages ?? []).flat();

  async function run(key: string, failure: string, call: () => Promise<unknown>) {
    setBusy(key);
    try {
      await call();
      await queryClient.invalidateQueries({ queryKey: queries.admin.users.list.key() });
      return true;
    } catch (error) {
      toast.error(errorText(error, failure));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function act(action: string, call: () => Promise<AdminUser>) {
    await run(action, t`Could not update the user`, async () => {
      const updated = await call();
      setSelected(updated);
    });
  }

  if (users.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (users.isError && items.length === 0)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(users.error, t`Couldn't load users`)}
        <Button variant="outline" size="sm" onClick={() => void users.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t`Search by email or name`}
          className="w-64"
          aria-label={t`Search by email or name`}
        />
        <div className="flex flex-wrap gap-1">
          {statuses.map((option) => (
            <Button
              key={option ?? "all"}
              type="button"
              variant={status === option ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
            >
              <StatusFilterLabel status={option} />
            </Button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          <Trans>No users match</Trans>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((user) => (
            <li
              key={user.id}
              className={`flex items-center gap-3 px-4 py-3 text-body-sm ${
                user.status !== "active" ? "opacity-60" : ""
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelected(user)}
              >
                <div className="truncate font-medium">{user.name}</div>
                <div className="truncate text-muted-foreground">{user.email}</div>
              </button>
              <span className="hidden shrink-0 text-muted-foreground sm:block">
                {formatDateTime(user.createdAt, i18n.locale)}
              </span>
              <span className="hidden shrink-0 text-muted-foreground md:block">
                {user.registrationIp ?? "—"}
              </span>
              <StatusBadge status={user.status} />
              <Button variant="ghost" size="sm" onClick={() => setSelected(user)}>
                <Trans>Details</Trans>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {users.hasNextPage ? (
        <Button
          variant="outline"
          disabled={users.isFetchingNextPage}
          onClick={() => void users.fetchNextPage()}
        >
          {users.isFetchingNextPage ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
        </Button>
      ) : null}

      {selected ? (
        <UserDialog
          user={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onAction={(action, call) => void act(action, call)}
          onHardDeleted={() => setSelected(null)}
          invalidate={() =>
            void queryClient.invalidateQueries({ queryKey: queries.admin.users.list.key() })
          }
        />
      ) : null}
    </div>
  );
}

function UserDialog({
  user,
  busy,
  onClose,
  onAction,
  onHardDeleted,
  invalidate,
}: {
  user: AdminUser;
  busy: string | null;
  onClose: () => void;
  onAction: (action: string, call: () => Promise<AdminUser>) => void;
  onHardDeleted: () => void;
  invalidate: () => void;
}) {
  const { t, i18n } = useLingui();
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);
  const [hardDeleting, setHardDeleting] = useState(false);

  async function hardDelete() {
    setHardDeleting(true);
    try {
      await rpc.admin.users.hardDelete({ id: user.id });
      invalidate();
      onHardDeleted();
    } catch (error) {
      toast.error(errorText(error, t`Could not delete the user`));
    } finally {
      setHardDeleting(false);
      setConfirmHardDelete(false);
    }
  }

  const actionButton = (
    action: string,
    label: string,
    call: () => Promise<AdminUser>,
    variant: "outline" | "destructive" = "outline",
  ) => (
    <Button variant={variant} disabled={busy !== null} onClick={() => onAction(action, call)}>
      {busy === action ? <Trans>Working…</Trans> : label}
    </Button>
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{user.name}</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
            <dt className="text-muted-foreground">
              <Trans>Email</Trans>
            </dt>
            <dd className="truncate">{user.email}</dd>
            <dt className="text-muted-foreground">
              <Trans>Registered</Trans>
            </dt>
            <dd>{formatDateTime(user.createdAt, i18n.locale)}</dd>
            <dt className="text-muted-foreground">
              <Trans>Registration IP</Trans>
            </dt>
            <dd>{user.registrationIp ?? "—"}</dd>
            <dt className="text-muted-foreground">
              <Trans>Status</Trans>
            </dt>
            <dd>
              <StatusBadge status={user.status} />
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {user.status === "active" &&
              actionButton("disable", t`Disable`, () => rpc.admin.users.disable({ id: user.id }))}
            {user.status === "disabled" &&
              actionButton("restore", t`Restore`, () => rpc.admin.users.restore({ id: user.id }))}
            {user.status !== "blacklisted" &&
              user.status !== "deleted" &&
              actionButton(
                "blacklist",
                t`Blacklist`,
                () => rpc.admin.users.blacklist({ id: user.id }),
                "destructive",
              )}
            {user.status === "blacklisted" &&
              actionButton("unblacklist", t`Remove from blacklist`, () =>
                rpc.admin.users.unblacklist({ id: user.id }),
              )}
            {user.status !== "deleted" &&
              actionButton(
                "softDelete",
                t`Delete`,
                () => rpc.admin.users.softDelete({ id: user.id }),
                "destructive",
              )}
            {user.status === "deleted" &&
              actionButton("restoreDeleted", t`Restore deleted`, () =>
                rpc.admin.users.restoreDeleted({ id: user.id }),
              )}
            {user.status === "deleted" && (
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={() => setConfirmHardDelete(true)}
              >
                <Trans>Delete permanently</Trans>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmHardDelete} onOpenChange={setConfirmHardDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete this user permanently?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                This removes the account and everything it created. This cannot be undone.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction disabled={hardDeleting} onClick={() => void hardDelete()}>
              {hardDeleting ? <Trans>Deleting…</Trans> : <Trans>Delete permanently</Trans>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
