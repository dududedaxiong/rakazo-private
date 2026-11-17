import type { PrismaClient } from "@rakazo_mickvvw/db";

/**
 * The only header Better Auth reads a client IP from. The API sets it from the socket peer and its
 * trusted proxies and drops any client-supplied copy, so a caller cannot choose its own address.
 */
export const CLIENT_IP_HEADER = "x-rakazo-client-ip";

/**
 * Registration controls read from the deployment settings row. The row is the admin's copy:
 * the server seeds it from the environment once, then the admin backend owns it.
 */
export interface RegistrationSettings {
  inviteCodeEnabled: boolean;
  emailSignupEnabled: boolean;
  signupAllowlist: string;
  ipRegistrationLimit: number;
  ipRegistrationHourlyThreshold: number;
  ipCollectiveBanEnabled: boolean;
}

const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettings = {
  inviteCodeEnabled: false,
  emailSignupEnabled: true,
  signupAllowlist: "",
  ipRegistrationLimit: 5,
  ipRegistrationHourlyThreshold: 10,
  ipCollectiveBanEnabled: false,
};

/**
 * Reads the settings row. Returns null when there is no row yet (first boot, or a test
 * double without the delegate), so the caller falls back to the environment policy.
 */
export async function readSignupSettings(
  prisma: PrismaClient,
): Promise<RegistrationSettings | null> {
  try {
    const row = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
    if (!row) return null;
    // A row written before the new columns existed, or a test double without them,
    // degrades to the defaults instead of closing registration. The stored
    // signupsEnabled column is the admin's email-registration switch.
    return {
      inviteCodeEnabled: row.inviteCodeEnabled ?? false,
      emailSignupEnabled: row.signupsEnabled ?? true,
      signupAllowlist: row.signupAllowlist ?? "",
      ipRegistrationLimit: row.ipRegistrationLimit ?? 5,
      ipRegistrationHourlyThreshold: row.ipRegistrationHourlyThreshold ?? 10,
      ipCollectiveBanEnabled: row.ipCollectiveBanEnabled ?? false,
    };
  } catch {
    return null;
  }
}

export { DEFAULT_REGISTRATION_SETTINGS };

/** Thrown when an address has registered too many accounts. */
export class RegistrationIpLimitError extends Error {
  readonly code = "IP_REGISTRATION_LIMIT";
  constructor() {
    super("Too many registrations from this address");
  }
}

/** The one trusted header the API sets from the socket peer; a caller cannot choose it. */
export function ipFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined> | undefined | null,
): string | null {
  if (!headers) return null;
  const value =
    headers instanceof Headers
      ? headers.get(CLIENT_IP_HEADER)
      : (headers[CLIENT_IP_HEADER] ?? headers[CLIENT_IP_HEADER.toLowerCase()]);
  const ip = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof ip === "string" ? ip.trim() : "";
  return trimmed || null;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Refuses an address that hit the per-IP registration caps. The hourly cap also fires the
 * collective ban when the switch is on: every account that registered from the address in
 * the last hour is handed to the caller to disable, before the refusal. A zero cap is off.
 * Without the signup-records table (a test double, or a client from before the migration)
 * the check cannot run, so signup proceeds.
 */
export async function enforceRegistrationIpLimit(
  prisma: { signupRecord?: Pick<PrismaClient, "signupRecord">["signupRecord"] },
  ip: string | null,
  settings: RegistrationSettings,
  onCollectiveBan?: (ip: string, userIds: string[]) => Promise<void>,
): Promise<void> {
  if (!ip || !prisma.signupRecord) return;
  const since = new Date(Date.now() - HOUR_MS);
  const recent = await prisma.signupRecord.findMany({
    where: { ip, createdAt: { gte: since } },
    select: { userId: true },
  });
  if (
    settings.ipRegistrationHourlyThreshold > 0 &&
    recent.length >= settings.ipRegistrationHourlyThreshold
  ) {
    if (settings.ipCollectiveBanEnabled && onCollectiveBan) {
      await onCollectiveBan(ip, [...new Set(recent.map((record) => record.userId))]);
    }
    throw new RegistrationIpLimitError();
  }
  if (settings.ipRegistrationLimit > 0) {
    const total = await prisma.signupRecord.count({ where: { ip } });
    if (total >= settings.ipRegistrationLimit) throw new RegistrationIpLimitError();
  }
}

/** Writes the one registration record for a new account; a second call is a no-op. */
export async function recordRegistration(
  prisma: { signupRecord?: Pick<PrismaClient, "signupRecord">["signupRecord"] },
  userId: string,
  ip: string | null,
): Promise<void> {
  if (!prisma.signupRecord) return;
  await prisma.signupRecord.upsert({
    where: { userId },
    create: { userId, ip },
    update: {},
  });
}
