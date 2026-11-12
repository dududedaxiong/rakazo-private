import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { RegistrationSettings } from "./registration-limits.js";
import {
  DEFAULT_REGISTRATION_SETTINGS,
  enforceRegistrationIpLimit,
  ipFromHeaders,
  RegistrationIpLimitError,
  readSignupSettings,
  recordRegistration,
} from "./registration-limits.js";

const SETTINGS: RegistrationSettings = { ...DEFAULT_REGISTRATION_SETTINGS };

interface SignupRow {
  userId: string;
  ip: string | null;
  createdAt: Date;
}

function fakePrisma(rows: SignupRow[] = [], settings: Record<string, unknown> | null = null) {
  const store = {
    rows,
    settings,
    signupRecord: {
      findMany: async ({ where }: { where: { ip: string | null; createdAt: { gte: Date } } }) =>
        store.rows.filter((row) => row.ip === where.ip && row.createdAt >= where.createdAt.gte),
      count: async ({ where }: { where: { ip: string | null } }) =>
        store.rows.filter((row) => row.ip === where.ip).length,
      upsert: async ({ where, create }: { where: { userId: string }; create: SignupRow }) => {
        const existing = store.rows.find((row) => row.userId === where.userId);
        if (existing) return existing;
        store.rows.push(create);
        return create;
      },
    },
    deploymentSettings: {
      findUnique: async () => store.settings,
    },
  };
  return { prisma: store as unknown as PrismaClient, store };
}

describe("registration limits", () => {
  it("reads the settings row and falls back when there is none", async () => {
    const { prisma } = fakePrisma([], {
      inviteCodeEnabled: true,
      emailSignupEnabled: false,
      signupAllowlist: "@example.com",
      ipRegistrationLimit: 3,
      ipRegistrationHourlyThreshold: 4,
      ipCollectiveBanEnabled: true,
    });
    expect(await readSignupSettings(prisma)).toEqual({
      inviteCodeEnabled: true,
      emailSignupEnabled: false,
      signupAllowlist: "@example.com",
      ipRegistrationLimit: 3,
      ipRegistrationHourlyThreshold: 4,
      ipCollectiveBanEnabled: true,
    });
    const empty = fakePrisma([], null);
    expect(await readSignupSettings(empty.prisma)).toBeNull();
    // A test double without the delegate also falls back, instead of throwing.
    expect(await readSignupSettings({} as never)).toBeNull();
  });

  it("refuses an address at the lifetime cap", async () => {
    const rows: SignupRow[] = Array.from({ length: 5 }, (_, index) => ({
      userId: `user-${index}`,
      ip: "203.0.113.7",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    }));
    const { prisma } = fakePrisma(rows);
    await expect(
      enforceRegistrationIpLimit(prisma, "203.0.113.7", SETTINGS),
    ).rejects.toBeInstanceOf(RegistrationIpLimitError);
    const under = fakePrisma(rows.slice(0, 4));
    await expect(
      enforceRegistrationIpLimit(under.prisma, "203.0.113.7", SETTINGS),
    ).resolves.toBeUndefined();
  });

  it("bans the hour's accounts when the hourly threshold is crossed and the switch is on", async () => {
    const rows: SignupRow[] = Array.from({ length: 10 }, (_, index) => ({
      userId: `user-${index}`,
      ip: "203.0.113.7",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    }));
    const ban = vi.fn(async (ip: string, userIds: string[]) => {
      void ip;
      void userIds;
    });
    const { prisma } = fakePrisma(rows);
    await expect(
      enforceRegistrationIpLimit(
        prisma,
        "203.0.113.7",
        {
          ...SETTINGS,
          ipCollectiveBanEnabled: true,
        },
        ban,
      ),
    ).rejects.toBeInstanceOf(RegistrationIpLimitError);
    expect(ban).toHaveBeenCalledTimes(1);
    expect(ban.mock.calls[0]?.[0]).toBe("203.0.113.7");
    expect(ban.mock.calls[0]?.[1]?.sort()).toEqual(rows.map((row) => row.userId).sort());
  });

  it("still refuses at the hourly threshold when the ban switch is off", async () => {
    const rows: SignupRow[] = Array.from({ length: 10 }, (_, index) => ({
      userId: `user-${index}`,
      ip: "203.0.113.7",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    }));
    const ban = vi.fn(async () => undefined);
    const { prisma } = fakePrisma(rows);
    await expect(
      enforceRegistrationIpLimit(prisma, "203.0.113.7", SETTINGS, ban),
    ).rejects.toBeInstanceOf(RegistrationIpLimitError);
    expect(ban).not.toHaveBeenCalled();
  });

  it("never refuses without an address, and a zero cap is off", async () => {
    const { prisma } = fakePrisma(
      Array.from({ length: 20 }, (_, index) => ({
        userId: `user-${index}`,
        ip: "203.0.113.7",
        createdAt: new Date(),
      })),
    );
    await expect(enforceRegistrationIpLimit(prisma, null, SETTINGS)).resolves.toBeUndefined();
    await expect(
      enforceRegistrationIpLimit(prisma, "203.0.113.7", {
        ...SETTINGS,
        ipRegistrationLimit: 0,
        ipRegistrationHourlyThreshold: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it("records one registration per account and never moves it", async () => {
    const { prisma, store } = fakePrisma([]);
    await recordRegistration(prisma, "user-1", "203.0.113.7");
    await recordRegistration(prisma, "user-1", "198.51.100.9");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toEqual({
      userId: "user-1",
      ip: "203.0.113.7",
    });
  });

  it("reads the client address from the trusted header only", () => {
    expect(ipFromHeaders(new Headers({ "x-rakazo-client-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(ipFromHeaders({ "x-rakazo-client-ip": " 198.51.100.9 " })).toBe("198.51.100.9");
    expect(ipFromHeaders({})).toBeNull();
    expect(ipFromHeaders(undefined)).toBeNull();
  });
});
