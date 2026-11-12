import { recordSecurityEvent } from "@rakazo/db";
import type { AccountStatusDeps } from "./account-status.js";
import { setAccountActive } from "./account-status.js";

/**
 * Disables every account that registered from an address that crossed the hourly
 * registration threshold. Directory-owned accounts stay with their provider. The audit
 * row records how many were banned, how many the directory kept, and how many failed.
 */
export async function banRegistrationIpAccounts(
  deps: AccountStatusDeps,
  ip: string,
  userIds: string[],
  directoryProvisioning: boolean,
): Promise<void> {
  let banned = 0;
  let skipped = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      const result = await setAccountActive(deps, userId, false, directoryProvisioning);
      if (result === "directory") skipped += 1;
      else banned += 1;
    } catch {
      failed += 1;
    }
  }
  await recordSecurityEvent({
    type: "admin.ip_collective_ban",
    ip,
    metadata: { banned, skipped, failed },
  });
}
