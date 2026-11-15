import { useLingui } from "@lingui/react/macro";
import type { KeyHealth } from "../../lib/key-health";

/** One connection's last key check: its state and when it ran. */
export function KeyHealthLine({ health, checking }: { health?: KeyHealth; checking?: boolean }) {
  const { t } = useLingui();
  if (checking) {
    return (
      <span className="block truncate text-body-sm text-muted-foreground">{t`Checking…`}</span>
    );
  }
  if (!health) {
    return (
      <span className="block truncate text-body-sm text-muted-foreground">{t`Not checked`}</span>
    );
  }
  const time = new Date(health.checkedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const label =
    health.status === "ok"
      ? t`Normal`
      : health.status === "invalid_key"
        ? t`Invalid key`
        : health.status === "unreachable"
          ? t`Unreachable`
          : health.status === "timeout"
            ? t`Timed out`
            : t`Check not supported`;
  const tone =
    health.status === "invalid_key"
      ? "text-destructive"
      : health.status === "unreachable" || health.status === "timeout"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <span className={`block truncate text-body-sm ${tone}`}>
      {label} · {time}
    </span>
  );
}
