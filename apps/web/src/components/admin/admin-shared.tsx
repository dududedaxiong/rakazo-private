import { Trans } from "@lingui/react/macro";
import type { SecurityEventType } from "@rakazo_mickvvw/contracts";

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** Short label for an audit event; unknown types fall back to their raw name. */
export function SecurityEventLabel({ type }: { type: SecurityEventType }) {
  switch (type) {
    case "admin.registration_settings.changed":
      return <Trans>Registration settings changed</Trans>;
    case "admin.invite_code.created":
      return <Trans>Invite codes generated</Trans>;
    case "admin.invite_code.revoked":
      return <Trans>Invite code revoked</Trans>;
    case "admin.user.blacklisted":
      return <Trans>User blacklisted</Trans>;
    case "admin.user.unblacklisted":
      return <Trans>User removed from blacklist</Trans>;
    case "admin.user.soft_deleted":
      return <Trans>User deleted</Trans>;
    case "admin.user.restored":
      return <Trans>User restored</Trans>;
    case "admin.user.hard_deleted":
      return <Trans>User permanently deleted</Trans>;
    case "admin.ip_collective_ban":
      return <Trans>IP collective ban</Trans>;
    case "auth.account.deactivated":
      return <Trans>User disabled</Trans>;
    case "auth.account.reactivated":
      return <Trans>User restored</Trans>;
    default:
      return <>{type}</>;
  }
}
