import { Trans, useLingui } from "@lingui/react/macro";
import { buttonVariants } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, NavLink, Outlet } from "react-router-dom";
import { AdminTwoFactorGate } from "../components/admin/AdminTwoFactorGate";
import { PageLoading } from "../components/PageLoading";
import { useSpaceQueries } from "../lib/query";
import { WindowChrome } from "./WindowChrome";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-body-sm ${
    isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
  }`;

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <NavLink to="/admin" end className={linkClass} onClick={onNavigate}>
        <Trans>Overview</Trans>
      </NavLink>
      <NavLink to="/admin/settings" className={linkClass} onClick={onNavigate}>
        <Trans>Registration settings</Trans>
      </NavLink>
      <NavLink to="/admin/users" className={linkClass} onClick={onNavigate}>
        <Trans>Users</Trans>
      </NavLink>
      <NavLink to="/admin/invite-codes" className={linkClass} onClick={onNavigate}>
        <Trans>Invite codes</Trans>
      </NavLink>
      <NavLink to="/admin/ip" className={linkClass} onClick={onNavigate}>
        <Trans>IP limits</Trans>
      </NavLink>
      <NavLink to="/admin/audit" className={linkClass} onClick={onNavigate}>
        <Trans>Audit log</Trans>
      </NavLink>
      <NavLink to="/admin/email" className={linkClass} onClick={onNavigate}>
        <Trans>Email settings</Trans>
      </NavLink>
      <NavLink to="/admin/two-factor" className={linkClass} onClick={onNavigate}>
        <Trans>Two-factor authentication</Trans>
      </NavLink>
    </>
  );
}

export function AdminPage() {
  const { t } = useLingui();
  const me = useQuery(useSpaceQueries().me.queryOptions());
  const [navOpen, setNavOpen] = useState(false);
  if (me.isPending) return <PageLoading />;
  if (!me.data?.isAdmin) return <Navigate to="/app" replace />;
  return (
    <AdminTwoFactorGate>
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
          <span className="hidden text-body-sm text-muted-foreground sm:block">
            {me.data.email}
          </span>
          <button
            type="button"
            className={`${buttonVariants({ variant: "ghost", size: "icon" })} md:hidden`}
            aria-label={navOpen ? t`Close navigation` : t`Open navigation`}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span className="md:hidden">{navOpen ? <X /> : <Menu />}</span>
          </button>
        </header>
        {navOpen ? (
          <nav
            aria-label={t`Admin sections`}
            className="flex flex-col gap-1 overflow-y-auto border-b px-2 py-2 md:hidden"
          >
            <AdminNavLinks onNavigate={() => setNavOpen(false)} />
          </nav>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label={t`Admin sections`}
            className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r px-2 py-4 md:flex"
          >
            <AdminNavLinks />
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </AdminTwoFactorGate>
  );
}
