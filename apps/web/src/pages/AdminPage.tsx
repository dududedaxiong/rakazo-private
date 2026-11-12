import { Trans, useLingui } from "@lingui/react/macro";
import { buttonVariants } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link, Navigate, NavLink, Outlet } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { useSpaceQueries } from "../lib/query";
import { WindowChrome } from "./WindowChrome";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-body-sm ${
    isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
  }`;

export function AdminPage() {
  const { t } = useLingui();
  const me = useQuery(useSpaceQueries().me.queryOptions());
  if (me.isPending) return <PageLoading />;
  if (!me.data?.isAdmin) return <Navigate to="/app" replace />;
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          to="/app"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={t`Back`}
        >
          <ChevronLeft />
        </Link>
        <h1 className="flex-1 font-medium">
          <Trans>Admin</Trans>
        </h1>
        <span className="text-body-sm text-muted-foreground">{me.data.email}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t`Admin sections`}
          className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r px-2 py-4"
        >
          <NavLink to="/admin" end className={linkClass}>
            <Trans>Overview</Trans>
          </NavLink>
          <NavLink to="/admin/settings" className={linkClass}>
            <Trans>Registration settings</Trans>
          </NavLink>
          <NavLink to="/admin/users" className={linkClass}>
            <Trans>Users</Trans>
          </NavLink>
          <NavLink to="/admin/invite-codes" className={linkClass}>
            <Trans>Invite codes</Trans>
          </NavLink>
          <NavLink to="/admin/ip" className={linkClass}>
            <Trans>IP limits</Trans>
          </NavLink>
          <NavLink to="/admin/audit" className={linkClass}>
            <Trans>Audit log</Trans>
          </NavLink>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
