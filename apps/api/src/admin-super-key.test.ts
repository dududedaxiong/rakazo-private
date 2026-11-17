import { EncryptedSecretStore } from "@rakazo_mickvvw/adapters";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { installSecurityEventStore } from "@rakazo_mickvvw/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  changeSuperKey,
  requireSuperKeyGrant,
  superKeyGrantStatus,
  verifySuperKey,
} from "./admin-super-key.js";

type Row = Record<string, unknown>;

function fieldMatches(value: unknown, condition: unknown): boolean {
  // A row created without a nullable field reads back as NULL, like the database.
  if (condition === null || condition === undefined) return value === null || value === undefined;
  if (typeof condition !== "object" || condition instanceof Date) return value === condition;
  const cond = condition as Record<string, unknown>;
  if ("not" in cond) return !fieldMatches(value, cond.not);
  if ("in" in cond) return (cond.in as unknown[]).includes(value);
  if ("gte" in cond) return (value as Date) >= (cond.gte as Date);
  return false;
}

const whereMatches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, condition]) => fieldMatches(row[key], condition));

function fixture(envKey?: string) {
  const secrets: Row[] = [];
  const grants: Row[] = [];
  const securityEvents: Row[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) =>
        where.id === "admin-1"
          ? {
              id: "admin-1",
              email: "admin@example.com",
              emailVerified: true,
              deactivatedAt: null,
              blacklistedAt: null,
              deletedAt: null,
            }
          : null,
    },
    secret: {
      findFirst: async ({ where }: { where?: Row }) =>
        secrets.filter((row) => whereMatches(row, where)).at(-1) ?? null,
      findMany: async ({ where }: { where?: Row }) =>
        secrets.filter((row) => whereMatches(row, where)),
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, createdAt: new Date() };
        secrets.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where?: Row }) => {
        const before = secrets.length;
        secrets.splice(0, secrets.length, ...secrets.filter((row) => !whereMatches(row, where)));
        return { count: before - secrets.length };
      },
    },
    adminSuperKeyGrant: {
      findUnique: async ({ where }: { where: Row }) =>
        grants.find((row) => row.sessionId === where.sessionId) ?? null,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const existing = grants.find((row) => row.sessionId === where.sessionId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create, createdAt: new Date() };
        grants.push(row);
        return row;
      },
    },
    securityEvent: {
      count: async ({ where }: { where?: Row }) =>
        securityEvents.filter((row) => whereMatches(row, where)).length,
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, id: `event-${securityEvents.length + 1}`, createdAt: new Date() };
        securityEvents.push(row);
        return row;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  installSecurityEventStore(prisma as unknown as Pick<PrismaClient, "securityEvent">);
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    secrets: new EncryptedSecretStore("test-only-encryption-key"),
    env: {
      adminEmails: ["admin@example.com"],
      ...(envKey === undefined ? {} : { adminSuperKey: envKey }),
    },
  };
  return { deps, grants };
}

afterEach(() => installSecurityEventStore(undefined));

const actor = { userId: "admin-1", spaceId: "space-1" };

describe("admin super key", () => {
  it("stays shut when no key is configured anywhere", async () => {
    const { deps } = fixture();
    await expect(
      superKeyGrantStatus(deps, { userId: "admin-1", sessionId: "session-1" }),
    ).resolves.toEqual({ granted: false, expiresAt: null, configured: false });
    await expect(
      verifySuperKey(deps, { userId: "admin-1", sessionId: "session-1", key: "anything" }),
    ).rejects.toThrow("No super key is configured");
  });

  it("grants the session on the environment key and refuses a wrong one", async () => {
    const { deps } = fixture("env-key");
    await expect(
      verifySuperKey(deps, { userId: "admin-1", sessionId: "session-1", key: "wrong" }),
    ).rejects.toThrow("Super key is incorrect");
    const { expiresAt } = await verifySuperKey(deps, {
      userId: "admin-1",
      sessionId: "session-1",
      key: "env-key",
    });
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    await expect(
      superKeyGrantStatus(deps, { userId: "admin-1", sessionId: "session-1" }),
    ).resolves.toEqual({ granted: true, expiresAt, configured: true });
    await requireSuperKeyGrant(deps, { userId: "admin-1", sessionId: "session-1" });
    await expect(
      requireSuperKeyGrant(deps, { userId: "admin-1", sessionId: "other-session" }),
    ).rejects.toThrow("Verify the super key first");
  });

  it("treats an expired grant as no grant", async () => {
    const { deps, grants } = fixture("env-key");
    grants.push({
      userId: "admin-1",
      sessionId: "session-1",
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      superKeyGrantStatus(deps, { userId: "admin-1", sessionId: "session-1" }),
    ).resolves.toEqual({ granted: false, expiresAt: null, configured: true });
  });

  it("limits repeated wrong keys", async () => {
    const { deps } = fixture("env-key");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifySuperKey(deps, { userId: "admin-1", sessionId: "session-1", key: "wrong" }),
      ).rejects.toThrow("Super key is incorrect");
    }
    await expect(
      verifySuperKey(deps, { userId: "admin-1", sessionId: "session-1", key: "wrong" }),
    ).rejects.toThrow("Too many failed attempts");
  });

  it("changes the key, and the database value wins over the environment", async () => {
    const { deps } = fixture("env-key");
    await expect(
      changeSuperKey(deps, {
        ...actor,
        sessionId: "session-1",
        currentKey: "env-key",
        newKey: "db-key",
      }),
    ).rejects.toThrow("Verify the super key first");
    await verifySuperKey(deps, { userId: "admin-1", sessionId: "session-1", key: "env-key" });
    await expect(
      changeSuperKey(deps, {
        ...actor,
        sessionId: "session-1",
        currentKey: "not-the-key",
        newKey: "db-key",
      }),
    ).rejects.toThrow("Current super key is incorrect");
    await changeSuperKey(deps, {
      ...actor,
      sessionId: "session-1",
      currentKey: "env-key",
      newKey: "db-key",
    });
    await expect(
      verifySuperKey(deps, { userId: "admin-1", sessionId: "session-2", key: "env-key" }),
    ).rejects.toThrow("Super key is incorrect");
    await expect(
      verifySuperKey(deps, { userId: "admin-1", sessionId: "session-2", key: "db-key" }),
    ).resolves.toEqual(expect.objectContaining({ expiresAt: expect.any(String) }));
  });
});
