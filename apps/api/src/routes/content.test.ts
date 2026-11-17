import { createRouterClient } from "@orpc/server";
import type * as Db from "@rakazo_mickvvw/db";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { describe, expect, it, vi } from "vitest";
import type { AccountStatusDeps } from "../account-status.js";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

vi.mock("@rakazo_mickvvw/db", async (original) => ({
  ...(await original<typeof Db>()),
  cancelDeactivatedAccountRuns: vi.fn(async () => 0),
  leaveInvitedSpaces: vi.fn(async () => []),
}));

vi.mock("../account-deletion.js", () => ({
  deleteAccountContent: vi.fn(async () => undefined),
  deleteOrganization: vi.fn(async () => undefined),
  finishStalledOrganizationDeletions: vi.fn(async () => undefined),
}));

type FakeCode = {
  id: string;
  code: string;
  createdById: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
  isReferral: boolean;
};

const fieldMatches = (value: unknown, condition: unknown): boolean => {
  if (condition === null) return value === null;
  if (condition === undefined) return true;
  if (typeof condition !== "object") return value === condition;
  return false;
};

const whereMatches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, condition]) => fieldMatches(row[key], condition));

function contentDeps() {
  const codes: FakeCode[] = [];
  let settings: Record<string, unknown> | null = null;
  const prisma = {
    deploymentSettings: {
      findUnique: vi.fn(async () => settings),
    },
    inviteCode: {
      findFirst: vi.fn(
        async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
          codes.find((row) => whereMatches(row as unknown as Record<string, unknown>, where)) ??
          null,
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<FakeCode, "id" | "createdAt" | "usedCount" | "revokedAt">;
        }) => {
          // The code column is unique; a duplicate insert fails like the real database.
          if (codes.some((row) => row.code === data.code)) throw { code: "P2002" };
          const row: FakeCode = {
            ...data,
            id: `code-${codes.length + 1}`,
            createdAt: new Date(),
            usedCount: 0,
            revokedAt: null,
            isReferral: data.isReferral ?? false,
          };
          codes.push(row);
          return row;
        },
      ),
    },
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
    dataDir: "/tmp/rakazo-referral-test",
    jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
  } as unknown as RouterDeps;
  const userActor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "alice@rakazo.test",
    isDeploymentOwner: false,
  };
  const user = createRouterClient(createRouter(deps), { context: { actor: userActor } as never });
  const setSettings = (next: Record<string, unknown> | null) => {
    settings = next;
  };
  const seedCode = (data: Partial<FakeCode> & { code: string; createdById: string }) => {
    const row: FakeCode = {
      id: `code-${codes.length + 1}`,
      createdAt: new Date(),
      expiresAt: null,
      maxUses: 10,
      usedCount: 0,
      revokedAt: null,
      isReferral: true,
      ...data,
    };
    codes.push(row);
    return row;
  };
  return { deps, codes, user, setSettings, seedCode };
}

describe("referral.code", () => {
  it("creates a referral code on first read and returns the same one again", async () => {
    const { user, codes } = contentDeps();
    const first = await user.referral.code();
    expect(first).toMatchObject({ usedCount: 0, maxUses: 10, status: "active" });
    expect(first?.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
    expect(codes).toHaveLength(1);
    const second = await user.referral.code();
    expect(second).toEqual(first);
    expect(codes).toHaveLength(1);
  });

  it("returns an existing code without creating another", async () => {
    const { user, codes, seedCode } = contentDeps();
    const seeded = seedCode({ code: "ABCDEFGHJKMN", createdById: "user-1", usedCount: 3 });
    const found = await user.referral.code();
    expect(found).toEqual({
      code: seeded.code,
      usedCount: 3,
      maxUses: 10,
      status: "active",
    });
    expect(codes).toHaveLength(1);
  });

  it("returns null while the referral switch is off and creates nothing", async () => {
    const { user, codes, setSettings } = contentDeps();
    setSettings({ referralCodeEnabled: false, referralCodeMaxUses: 10 });
    await expect(user.referral.code()).resolves.toBeNull();
    expect(codes).toHaveLength(0);
  });

  it("never returns another account's code", async () => {
    const { user, codes, seedCode } = contentDeps();
    const others = seedCode({ code: "ZXCVBNMASDFG", createdById: "user-2" });
    const mine = await user.referral.code();
    expect(mine?.code).not.toBe(others.code);
    expect(codes.filter((row) => row.createdById === "user-1")).toHaveLength(1);
    expect(mine?.code).toBe(codes.find((row) => row.createdById === "user-1")?.code);
  });

  it("reports an exhausted code instead of replacing it", async () => {
    const { user, seedCode } = contentDeps();
    seedCode({ code: "USEDUPCDE234", createdById: "user-1", usedCount: 10, maxUses: 10 });
    await expect(user.referral.code()).resolves.toEqual({
      code: "USEDUPCDE234",
      usedCount: 10,
      maxUses: 10,
      status: "exhausted",
    });
  });
});
