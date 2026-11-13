import { createRouterClient } from "@orpc/server";
import type * as Db from "@rakazo/db";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { AccountStatusDeps } from "../account-status.js";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

vi.mock("@rakazo/db", async (original) => ({
  ...(await original<typeof Db>()),
  cancelDeactivatedAccountRuns: vi.fn(async () => 0),
  leaveInvitedSpaces: vi.fn(async () => []),
}));

vi.mock("../account-deletion.js", () => ({
  deleteAccountContent: vi.fn(async () => undefined),
  deleteOrganization: vi.fn(async () => undefined),
  finishStalledOrganizationDeletions: vi.fn(async () => undefined),
}));

type FakeUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
  blacklistedAt: Date | null;
  deletedAt: Date | null;
  ip: string | null;
};

type FakeCode = {
  id: string;
  code: string;
  createdById: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
};

function userRow(user: FakeUser) {
  return { ...user, signupRecord: { ip: user.ip } };
}

const fieldMatches = (value: unknown, condition: unknown): boolean => {
  if (condition === null) return value === null;
  if (condition === undefined) return true;
  if (typeof condition !== "object") return value === condition;
  const cond = condition as Record<string, unknown>;
  if ("not" in cond) return !fieldMatches(value, cond.not);
  if ("in" in cond) return (cond.in as unknown[]).includes(value);
  if ("contains" in cond) {
    const text = String(value ?? "");
    const needle = String(cond.contains);
    return cond.mode === "insensitive"
      ? text.toLowerCase().includes(needle.toLowerCase())
      : text.includes(needle);
  }
  if ("lt" in cond) return (value as Date) < (cond.lt as Date);
  if ("gte" in cond) return (value as Date) >= (cond.gte as Date);
  return false;
};

const whereMatches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR")
      return (condition as Record<string, unknown>[]).some((part) => whereMatches(row, part));
    if (key === "AND")
      return (condition as Record<string, unknown>[]).every((part) => whereMatches(row, part));
    return fieldMatches(row[key], condition);
  });

function adminDeps() {
  const users: FakeUser[] = [
    {
      id: "admin-1",
      name: "Admin",
      email: "admin@rakazo.test",
      emailVerified: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      deactivatedAt: null,
      blacklistedAt: null,
      deletedAt: null,
      ip: null,
    },
    {
      id: "user-1",
      name: "Alice",
      email: "alice@rakazo.test",
      emailVerified: true,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      deactivatedAt: null,
      blacklistedAt: null,
      deletedAt: null,
      ip: "203.0.113.1",
    },
    {
      id: "user-2",
      name: "Bob",
      email: "bob@rakazo.test",
      emailVerified: true,
      createdAt: new Date("2026-01-03T00:00:00Z"),
      deactivatedAt: new Date("2026-01-04T00:00:00Z"),
      blacklistedAt: null,
      deletedAt: null,
      ip: "203.0.113.2",
    },
    {
      id: "user-3",
      name: "Carol",
      email: "carol@rakazo.test",
      emailVerified: true,
      createdAt: new Date(),
      deactivatedAt: null,
      blacklistedAt: null,
      deletedAt: null,
      ip: "203.0.113.3",
    },
  ];
  const codes: FakeCode[] = [];
  let settings: Record<string, unknown> | null = null;
  const records = [
    { ip: "203.0.113.1", createdAt: new Date() },
    { ip: "203.0.113.1", createdAt: new Date() },
    { ip: "203.0.113.2", createdAt: new Date() },
  ];
  const sessionDeleteMany = vi.fn(async () => ({ count: 0 }));
  const events = [
    {
      id: "event-1",
      type: "admin.user.blacklisted",
      userId: "user-1",
      spaceId: null,
      ip: null,
      userAgent: null,
      metadata: {},
      createdAt: new Date(),
    },
    {
      id: "event-2",
      type: "admin.ip_collective_ban",
      userId: null,
      spaceId: null,
      ip: "203.0.113.9",
      userAgent: null,
      metadata: { banned: 2, skipped: 0, failed: 0 },
      createdAt: new Date(),
    },
  ];
  const prisma = {
    user: {
      count: vi.fn(
        async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
          users.filter((row) => whereMatches(row as unknown as Record<string, unknown>, where))
            .length,
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = users.find((row) => row.id === where.id);
        return user ? userRow(user) : null;
      }),
      findMany: vi.fn(
        async ({ where = {}, take }: { where?: Record<string, unknown>; take?: number }) =>
          users
            .filter((row) => whereMatches(row as unknown as Record<string, unknown>, where))
            .sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
            )
            .slice(0, take)
            .map(userRow),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const user of users) {
            if (!whereMatches(user as unknown as Record<string, unknown>, where)) continue;
            Object.assign(user, data);
            count += 1;
          }
          return { count };
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = users.findIndex((row) => row.id === where.id);
        if (index < 0) throw new Error("not found");
        return users.splice(index, 1)[0];
      }),
    },
    deploymentSettings: {
      findUnique: vi.fn(async () => settings),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          // Prisma fills the schema defaults for columns the upsert omits.
          settings = {
            signupsEnabled: true,
            inviteCodeEnabled: false,
            signupAllowlist: "",
            ipRegistrationLimit: 5,
            ipRegistrationHourlyThreshold: 10,
            ipCollectiveBanEnabled: false,
            ...(settings ?? create),
            ...update,
          };
          return settings;
        },
      ),
    },
    inviteCode: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          codes.find((row) => row.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({ where = {}, take }: { where?: Record<string, unknown>; take?: number }) =>
          codes
            .filter((row) => whereMatches(row as unknown as Record<string, unknown>, where))
            .sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
            )
            .slice(0, take),
      ),
      create: vi.fn(
        async ({ data }: { data: Omit<FakeCode, "id" | "usedCount" | "revokedAt"> }) => {
          const row: FakeCode = {
            ...data,
            id: `code-${codes.length + 1}`,
            createdAt: new Date(),
            usedCount: 0,
            revokedAt: null,
          };
          codes.push(row);
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const row of codes) {
            if (!whereMatches(row as unknown as Record<string, unknown>, where)) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
    signupRecord: {
      findMany: vi.fn(async () => records),
    },
    session: { deleteMany: sessionDeleteMany },
    securityEvent: {
      findMany: vi.fn(
        async ({ where = {}, take }: { where?: Record<string, unknown>; take?: number }) =>
          events
            .filter((row) => whereMatches(row as unknown as Record<string, unknown>, where))
            .sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
            )
            .slice(0, take),
      ),
    },
    callPushDevice: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    messagingLinkCode: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    bot: { updateMany: vi.fn(async () => ({ count: 0 })) },
    userDevice: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(prisma)),
  } as unknown as PrismaClient;
  const accountStatus = {
    prisma,
    pushTokens: { remove: vi.fn(async () => undefined) },
    devices: { prisma: { userDevice: { findMany: vi.fn(async () => []) } }, devices: {} },
    events: { notify: vi.fn(async () => undefined) },
    afterDeparture: vi.fn(async () => undefined),
  } as unknown as AccountStatusDeps;
  const deps = {
    prisma,
    accountStatus,
    events: { notify: vi.fn(async () => undefined) },
    env: { adminEmails: ["admin@rakazo.test"] },
    dataDir: "/tmp/rakazo-admin-test",
    jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
  } as unknown as RouterDeps;
  const adminActor = {
    spaceId: "workspace-1",
    userId: "admin-1",
    email: "admin@rakazo.test",
    isDeploymentOwner: true,
  };
  const userActor = { ...adminActor, userId: "user-1", email: "alice@rakazo.test" };
  const admin = createRouterClient(createRouter(deps), { context: { actor: adminActor } as never });
  const user = createRouterClient(createRouter(deps), { context: { actor: userActor } as never });
  const anonymous = createRouterClient(createRouter(deps), { context: {} as never });
  return { deps, users, codes, admin, user, anonymous, sessionDeleteMany };
}

describe("admin overview", () => {
  it("returns totals, the seven-day trend, and recent events", async () => {
    const { admin } = adminDeps();
    const overview = await admin.admin.overview.get();
    expect(overview.totalUsers).toBe(4);
    expect(overview.todayNew).toBe(1);
    expect(overview.weekNew).toBe(1);
    expect(overview.disabledCount).toBe(1);
    expect(overview.blacklistedCount).toBe(0);
    expect(overview.collectiveBanCount).toBe(1);
    expect(overview.collectiveBanAccounts).toBe(2);
    expect(overview.dailyNew).toHaveLength(7);
    expect(overview.dailyNew[6]!.count).toBe(1);
    expect(overview.dailyNew.slice(0, 6).every((day) => day.count === 0)).toBe(true);
    expect(overview.recentEvents.map((event) => event.id)).toEqual(["event-2", "event-1"]);
  });

  it("refuses non-admins", async () => {
    const { user } = adminDeps();
    await expect(user.admin.overview.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("admin registration settings", () => {
  it("returns defaults when no settings row exists", async () => {
    const { admin } = adminDeps();
    await expect(admin.admin.registrationSettings.get()).resolves.toEqual({
      signupsEnabled: true,
      masterSwitchEnabled: true,
      emailSignupEnabled: true,
      inviteCodeEnabled: false,
      signupAllowlist: [],
      ipRegistrationLimit: 5,
      ipRegistrationHourlyThreshold: 10,
      ipCollectiveBanEnabled: false,
    });
  });

  it("updates settings and refuses non-admins", async () => {
    const { admin, user } = adminDeps();
    await expect(
      admin.admin.registrationSettings.update({ inviteCodeEnabled: true, ipRegistrationLimit: 3 }),
    ).resolves.toMatchObject({ inviteCodeEnabled: true, ipRegistrationLimit: 3 });
    await expect(admin.admin.registrationSettings.get()).resolves.toMatchObject({
      inviteCodeEnabled: true,
      ipRegistrationLimit: 3,
    });
    await expect(
      user.admin.registrationSettings.update({ inviteCodeEnabled: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("admin app download settings", () => {
  it("updates links and refuses non-admins", async () => {
    const { admin, user } = adminDeps();
    await expect(
      admin.admin.appDownloadSettings.update({ androidUrl: "https://example.com/app.apk" }),
    ).resolves.toEqual({ androidUrl: "https://example.com/app.apk", iosUrl: null });
    await expect(
      admin.admin.appDownloadSettings.update({
        androidUrl: null,
        iosUrl: "https://example.com/app.ipa",
      }),
    ).resolves.toEqual({ androidUrl: null, iosUrl: "https://example.com/app.ipa" });
    await expect(
      user.admin.appDownloadSettings.update({ androidUrl: "https://example.com/x.apk" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("admin invite codes", () => {
  it("creates, lists, and revokes codes", async () => {
    const { admin, codes } = adminDeps();
    const created = await admin.admin.inviteCodes.create({ count: 2 });
    expect(created).toHaveLength(2);
    expect(new Set(created.map((code) => code.code)).size).toBe(2);
    expect(created[0]!.status).toBe("active");
    const listed = await admin.admin.inviteCodes.list({});
    expect(listed.map((code) => code.id)).toEqual(created.map((code) => code.id).reverse());
    const revoked = await admin.admin.inviteCodes.revoke({ id: created[0]!.id });
    expect(revoked.status).toBe("revoked");
    expect(codes[0]!.revokedAt).not.toBeNull();
    await expect(admin.admin.inviteCodes.revoke({ id: created[0]!.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("admin users", () => {
  it("lists with query and status filters", async () => {
    const { admin } = adminDeps();
    const all = await admin.admin.users.list({});
    expect(all.map((row) => row.id)).toEqual(["user-3", "user-2", "user-1", "admin-1"]);
    expect(all[1]!.status).toBe("disabled");
    await expect(admin.admin.users.list({ query: "alice" })).resolves.toEqual([
      expect.objectContaining({ id: "user-1", status: "active" }),
    ]);
    await expect(admin.admin.users.list({ status: "disabled" })).resolves.toEqual([
      expect.objectContaining({ id: "user-2" }),
    ]);
    await expect(admin.admin.users.list({ status: "active" })).resolves.toHaveLength(3);
  });

  it("disables and restores an account and ends its sessions", async () => {
    const { admin, sessionDeleteMany } = adminDeps();
    await expect(admin.admin.users.disable({ id: "user-1" })).resolves.toMatchObject({
      id: "user-1",
      status: "disabled",
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    await expect(admin.admin.users.restore({ id: "user-1" })).resolves.toMatchObject({
      id: "user-1",
      status: "active",
    });
  });

  it("refuses to disable the admin's own account", async () => {
    const { admin } = adminDeps();
    await expect(admin.admin.users.disable({ id: "admin-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("blacklists and unblacklists an account", async () => {
    const { admin, sessionDeleteMany } = adminDeps();
    await expect(admin.admin.users.blacklist({ id: "user-1" })).resolves.toMatchObject({
      id: "user-1",
      status: "blacklisted",
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    await expect(admin.admin.users.unblacklist({ id: "user-1" })).resolves.toMatchObject({
      id: "user-1",
      status: "active",
    });
  });

  it("soft-deletes, restores, and hard-deletes an account", async () => {
    const { admin, users } = adminDeps();
    await expect(admin.admin.users.softDelete({ id: "user-1" })).resolves.toMatchObject({
      id: "user-1",
      status: "deleted",
    });
    await expect(admin.admin.users.restoreDeleted({ id: "user-1" })).resolves.toMatchObject({
      id: "user-1",
      status: "active",
    });
    await expect(admin.admin.users.hardDelete({ id: "user-1" })).resolves.toEqual({ ok: true });
    expect(users.map((row) => row.id)).not.toContain("user-1");
  });

  it("refuses non-admins and anonymous callers", async () => {
    const { user, anonymous } = adminDeps();
    await expect(user.admin.users.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(anonymous.admin.users.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(user.admin.users.get({ id: "user-2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns NOT_FOUND for a missing account", async () => {
    const { admin } = adminDeps();
    await expect(admin.admin.users.get({ id: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("admin IP stats", () => {
  it("aggregates registrations per IP", async () => {
    const { admin } = adminDeps();
    const stats = await admin.admin.ipStats.list({});
    expect(stats).toEqual([
      {
        ip: "203.0.113.1",
        todayCount: 2,
        totalCount: 2,
        lastRegisteredAt: expect.any(String),
        status: "normal",
      },
      {
        ip: "203.0.113.2",
        todayCount: 1,
        totalCount: 1,
        lastRegisteredAt: expect.any(String),
        status: "normal",
      },
    ]);
  });
});
