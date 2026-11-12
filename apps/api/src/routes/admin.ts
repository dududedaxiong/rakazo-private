import { ORPCError } from "@orpc/server";
import { DEFAULT_REGISTRATION_SETTINGS, generateInviteCode } from "@rakazo/auth";
import type {
  AdminUser,
  AdminUserStatus,
  InviteCode,
  InviteCodeStatus,
  IpRegistrationStat,
  RegistrationSettings,
} from "@rakazo/contracts";
import { parseAllowlist, signupsOpen } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { deleteAccountContent } from "../account-deletion.js";
import type { AccountStatusDeps } from "../account-status.js";
import { endDeactivatedAccess, setAccountActive } from "../account-status.js";
import { requireAdmin } from "../admins.js";
import type { RouterContext } from "./context.js";

type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
  blacklistedAt: Date | null;
  deletedAt: Date | null;
  signupRecord: { ip: string | null } | null;
};

function userStatus(row: UserRow): AdminUserStatus {
  if (row.deletedAt) return "deleted";
  if (row.blacklistedAt) return "blacklisted";
  if (row.deactivatedAt) return "disabled";
  return "active";
}

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
    registrationIp: row.signupRecord?.ip ?? null,
    status: userStatus(row),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    blacklistedAt: row.blacklistedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function inviteCodeStatus(
  row: { revokedAt: Date | null; expiresAt: Date | null; usedCount: number; maxUses: number },
  now = new Date(),
): InviteCodeStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt <= now) return "expired";
  if (row.usedCount >= row.maxUses) return "exhausted";
  return "active";
}

function toInviteCode(row: {
  id: string;
  code: string;
  createdById: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
}): InviteCode {
  return {
    id: row.id,
    code: row.code,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    status: inviteCodeStatus(row),
  };
}

type SettingsRow = {
  signupsEnabled: boolean;
  inviteCodeEnabled: boolean;
  signupAllowlist: string;
  ipRegistrationLimit: number;
  ipRegistrationHourlyThreshold: number;
  ipCollectiveBanEnabled: boolean;
} | null;

function toRegistrationSettings(
  row: SettingsRow,
  masterSwitchEnabled: boolean,
): RegistrationSettings {
  const settings = row ?? {
    signupsEnabled: true,
    inviteCodeEnabled: DEFAULT_REGISTRATION_SETTINGS.inviteCodeEnabled,
    signupAllowlist: DEFAULT_REGISTRATION_SETTINGS.signupAllowlist,
    ipRegistrationLimit: DEFAULT_REGISTRATION_SETTINGS.ipRegistrationLimit,
    ipRegistrationHourlyThreshold: DEFAULT_REGISTRATION_SETTINGS.ipRegistrationHourlyThreshold,
    ipCollectiveBanEnabled: DEFAULT_REGISTRATION_SETTINGS.ipCollectiveBanEnabled,
  };
  return {
    signupsEnabled: masterSwitchEnabled && settings.signupsEnabled,
    masterSwitchEnabled,
    emailSignupEnabled: settings.signupsEnabled,
    inviteCodeEnabled: settings.inviteCodeEnabled,
    signupAllowlist: parseAllowlist(settings.signupAllowlist),
    ipRegistrationLimit: settings.ipRegistrationLimit,
    ipRegistrationHourlyThreshold: settings.ipRegistrationHourlyThreshold,
    ipCollectiveBanEnabled: settings.ipCollectiveBanEnabled,
  };
}

/** Super-admin backend. Every procedure requires an admin; the audit middleware records them. */
export function adminRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const prisma: PrismaClient = deps.prisma;
  const masterSwitchEnabled = signupsOpen(deps.env?.signupsEnabled);
  const directoryProvisioning = deps.env?.directoryProvisioning ?? false;

  const accountStatus = (): AccountStatusDeps => {
    if (!deps.accountStatus)
      throw new ORPCError("INTERNAL_ERROR", { message: "Account status is not configured" });
    return deps.accountStatus;
  };

  const loadUser = async (id: string): Promise<UserRow> => {
    const row = await prisma.user.findUnique({
      where: { id },
      include: { signupRecord: { select: { ip: true } } },
    });
    if (!row) throw new ORPCError("NOT_FOUND");
    return row;
  };

  const forbidSelf = (actorId: string, targetId: string) => {
    if (actorId === targetId)
      throw new ORPCError("FORBIDDEN", { message: "You cannot change your own account" });
  };

  /** Ends a blacklisted or deleted account's sessions. The flag is already set, so a
   * partial failure is logged and the account stays refused at session lookup. */
  const endAccessBestEffort = async (userId: string) => {
    try {
      await endDeactivatedAccess(accountStatus(), userId);
    } catch (error) {
      getLogger().error("admin end access failed", error, { "user.id": userId });
    }
  };

  const setActive = async (actorId: string, id: string, active: boolean) => {
    await requireAdmin(deps, actorId);
    forbidSelf(actorId, id);
    await loadUser(id);
    const result = await setAccountActive(accountStatus(), id, active, directoryProvisioning);
    if (result === "directory")
      throw new ORPCError("FORBIDDEN", {
        message: "This account is managed by the directory",
      });
    return toAdminUser(await loadUser(id));
  };

  return {
    admin: {
      registrationSettings: {
        get: authed.admin.registrationSettings.get.handler(async ({ context }) => {
          await requireAdmin(deps, context.actor.userId);
          const row = await runAsSystem("read the registration settings", () =>
            prisma.deploymentSettings.findUnique({ where: { id: "default" } }),
          );
          return toRegistrationSettings(row, masterSwitchEnabled);
        }),
        update: authed.admin.registrationSettings.update.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          const data: {
            signupsEnabled?: boolean;
            inviteCodeEnabled?: boolean;
            signupAllowlist?: string;
            ipRegistrationLimit?: number;
            ipRegistrationHourlyThreshold?: number;
            ipCollectiveBanEnabled?: boolean;
          } = {};
          if (input.emailSignupEnabled !== undefined)
            data.signupsEnabled = input.emailSignupEnabled;
          if (input.inviteCodeEnabled !== undefined)
            data.inviteCodeEnabled = input.inviteCodeEnabled;
          if (input.signupAllowlist !== undefined)
            data.signupAllowlist = [
              ...new Set(parseAllowlist(input.signupAllowlist.join(","))),
            ].join(",");
          if (input.ipRegistrationLimit !== undefined)
            data.ipRegistrationLimit = input.ipRegistrationLimit;
          if (input.ipRegistrationHourlyThreshold !== undefined)
            data.ipRegistrationHourlyThreshold = input.ipRegistrationHourlyThreshold;
          if (input.ipCollectiveBanEnabled !== undefined)
            data.ipCollectiveBanEnabled = input.ipCollectiveBanEnabled;
          const row = await runAsSystem("update the registration settings", () =>
            prisma.deploymentSettings.upsert({
              where: { id: "default" },
              create: { id: "default", ...data },
              update: data,
            }),
          );
          return toRegistrationSettings(row, masterSwitchEnabled);
        }),
      },
      inviteCodes: {
        list: authed.admin.inviteCodes.list.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          const after = input.cursor
            ? await prisma.inviteCode.findUnique({
                where: { id: input.cursor },
                select: { id: true, createdAt: true },
              })
            : null;
          if (input.cursor && !after) return [];
          // Used count cannot be compared to the cap in the query, so the status
          // filter runs in memory over a bounded window; code lists stay small.
          const rows = await runAsSystem("list the invite codes", () =>
            prisma.inviteCode.findMany({
              where: {
                ...(after
                  ? {
                      OR: [
                        { createdAt: { lt: after.createdAt } },
                        { createdAt: after.createdAt, id: { lt: after.id } },
                      ],
                    }
                  : {}),
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 200,
            }),
          );
          return rows
            .map(toInviteCode)
            .filter((code) => !input.status || code.status === input.status)
            .slice(0, input.limit);
        }),
        create: authed.admin.inviteCodes.create.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          const codes = new Set<string>();
          while (codes.size < input.count) codes.add(generateInviteCode());
          const expiresAt = input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
            : null;
          const rows = await runAsSystem("create invite codes", () =>
            prisma.$transaction(async (tx) => {
              const created = [];
              for (const code of codes) {
                created.push(
                  await tx.inviteCode.create({
                    data: {
                      code,
                      createdById: context.actor.userId,
                      expiresAt,
                      maxUses: input.maxUses,
                    },
                  }),
                );
              }
              return created;
            }),
          );
          return rows.map(toInviteCode);
        }),
        revoke: authed.admin.inviteCodes.revoke.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          const row = await runAsSystem("revoke an invite code", () =>
            prisma.inviteCode.updateMany({
              where: { id: input.id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          );
          if (row.count === 0) throw new ORPCError("NOT_FOUND");
          const revoked = await prisma.inviteCode.findUnique({ where: { id: input.id } });
          if (!revoked) throw new ORPCError("NOT_FOUND");
          return toInviteCode(revoked);
        }),
      },
      users: {
        list: authed.admin.users.list.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          const after = input.cursor
            ? await prisma.user.findUnique({
                where: { id: input.cursor },
                select: { id: true, createdAt: true },
              })
            : null;
          if (input.cursor && !after) return [];
          const query = input.query?.trim();
          const and: Record<string, unknown>[] = [];
          if (query)
            and.push({
              OR: [
                { email: { contains: query, mode: "insensitive" } },
                { name: { contains: query, mode: "insensitive" } },
              ],
            });
          if (input.status === "active")
            and.push({ deactivatedAt: null, blacklistedAt: null, deletedAt: null });
          else if (input.status === "disabled")
            and.push({ deactivatedAt: { not: null }, blacklistedAt: null, deletedAt: null });
          else if (input.status === "blacklisted")
            and.push({ blacklistedAt: { not: null }, deletedAt: null });
          else if (input.status === "deleted") and.push({ deletedAt: { not: null } });
          if (after)
            and.push({
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            });
          const rows = await runAsSystem("list the accounts", () =>
            prisma.user.findMany({
              where: and.length ? { AND: and } : {},
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: input.limit,
              include: { signupRecord: { select: { ip: true } } },
            }),
          );
          return rows.map(toAdminUser);
        }),
        get: authed.admin.users.get.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          return toAdminUser(await runAsSystem("read an account", () => loadUser(input.id)));
        }),
        disable: authed.admin.users.disable.handler(async ({ context, input }) =>
          runAsSystem("disable an account", () => setActive(context.actor.userId, input.id, false)),
        ),
        restore: authed.admin.users.restore.handler(async ({ context, input }) =>
          runAsSystem("restore an account", () => setActive(context.actor.userId, input.id, true)),
        ),
        blacklist: authed.admin.users.blacklist.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          forbidSelf(context.actor.userId, input.id);
          return runAsSystem("blacklist an account", async () => {
            await loadUser(input.id);
            await prisma.user.updateMany({
              where: { id: input.id, blacklistedAt: null },
              data: { blacklistedAt: new Date() },
            });
            await endAccessBestEffort(input.id);
            return toAdminUser(await loadUser(input.id));
          });
        }),
        unblacklist: authed.admin.users.unblacklist.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          return runAsSystem("unblacklist an account", async () => {
            await loadUser(input.id);
            await prisma.user.updateMany({
              where: { id: input.id, blacklistedAt: { not: null } },
              data: { blacklistedAt: null },
            });
            return toAdminUser(await loadUser(input.id));
          });
        }),
        softDelete: authed.admin.users.softDelete.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          forbidSelf(context.actor.userId, input.id);
          return runAsSystem("soft-delete an account", async () => {
            await loadUser(input.id);
            await prisma.user.updateMany({
              where: { id: input.id, deletedAt: null },
              data: { deletedAt: new Date() },
            });
            await endAccessBestEffort(input.id);
            return toAdminUser(await loadUser(input.id));
          });
        }),
        restoreDeleted: authed.admin.users.restoreDeleted.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          return runAsSystem("restore a soft-deleted account", async () => {
            await loadUser(input.id);
            await prisma.user.updateMany({
              where: { id: input.id, deletedAt: { not: null } },
              data: { deletedAt: null },
            });
            return toAdminUser(await loadUser(input.id));
          });
        }),
        hardDelete: authed.admin.users.hardDelete.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          forbidSelf(context.actor.userId, input.id);
          return runAsSystem("hard-delete an account", async () => {
            await loadUser(input.id);
            await endAccessBestEffort(input.id);
            await deleteAccountContent(
              {
                prisma,
                sandbox: deps.sandbox,
                home: deps.home,
                jobs: deps.jobs,
                artifacts: deps.artifacts,
                dataDir: deps.dataDir,
                messagingInstallations: deps.messagingInstallations,
                secrets: deps.secrets,
                events: deps.events,
                billing: deps.billing,
              },
              input.id,
            );
            await prisma.user.delete({ where: { id: input.id } });
            return { ok: true as const };
          });
        }),
      },
      ipStats: {
        list: authed.admin.ipStats.list.handler(async ({ context, input }) => {
          await requireAdmin(deps, context.actor.userId);
          const settings = await runAsSystem("read the registration settings", () =>
            prisma.deploymentSettings.findUnique({ where: { id: "default" } }),
          );
          const limit =
            settings?.ipRegistrationLimit ?? DEFAULT_REGISTRATION_SETTINGS.ipRegistrationLimit;
          const threshold =
            settings?.ipRegistrationHourlyThreshold ??
            DEFAULT_REGISTRATION_SETTINGS.ipRegistrationHourlyThreshold;
          // One row per registration, so one read aggregates every IP in memory.
          const records = await runAsSystem("list the registration IPs", () =>
            prisma.signupRecord.findMany({ select: { ip: true, createdAt: true } }),
          );
          const now = Date.now();
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const byIp = new Map<
            string,
            { totalCount: number; todayCount: number; hourCount: number; last: Date | null }
          >();
          for (const record of records) {
            if (!record.ip) continue;
            const stat = byIp.get(record.ip) ?? {
              totalCount: 0,
              todayCount: 0,
              hourCount: 0,
              last: null,
            };
            stat.totalCount += 1;
            if (record.createdAt >= dayStart) stat.todayCount += 1;
            if (record.createdAt.getTime() >= now - 60 * 60 * 1000) stat.hourCount += 1;
            if (!stat.last || record.createdAt > stat.last) stat.last = record.createdAt;
            byIp.set(record.ip, stat);
          }
          const stats: IpRegistrationStat[] = [...byIp].map(([ip, stat]) => ({
            ip,
            todayCount: stat.todayCount,
            totalCount: stat.totalCount,
            lastRegisteredAt: stat.last?.toISOString() ?? null,
            status:
              (limit > 0 && stat.totalCount >= limit) ||
              (threshold > 0 && stat.hourCount >= threshold)
                ? ("limited" as const)
                : ("normal" as const),
          }));
          stats.sort((a, b) => b.totalCount - a.totalCount || a.ip.localeCompare(b.ip));
          const start = input.cursor ? stats.findIndex((stat) => stat.ip === input.cursor) + 1 : 0;
          return stats.slice(start, start + input.limit);
        }),
      },
    },
  };
}
