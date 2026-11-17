import { ORPCError } from "@orpc/server";
import { EncryptedSecretStore } from "@rakazo_mickvvw/adapters";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { installSecurityEventStore } from "@rakazo_mickvvw/db";
import * as OTPAuth from "otpauth";
import { afterEach, describe, expect, it } from "vitest";
import {
  confirmTotpEnrollment,
  disableTotp,
  requireAdminTotp,
  resetTotp,
  startTotpEnrollment,
  totpStatus,
  verifyTotpForSession,
} from "./admin-totp.js";

type Row = Record<string, unknown>;

function fieldMatches(value: unknown, condition: unknown): boolean {
  // A row created without a nullable field reads back as NULL, like the database.
  if (condition === null || condition === undefined) return value === null || value === undefined;
  if (typeof condition !== "object" || condition instanceof Date) return value === condition;
  const cond = condition as Record<string, unknown>;
  if ("not" in cond) return !fieldMatches(value, cond.not);
  if ("in" in cond) return (cond.in as unknown[]).includes(value);
  if ("gte" in cond) return (value as Date) >= (cond.gte as Date);
  if ("lt" in cond) return (value as Date) < (cond.lt as Date);
  return false;
}

const whereMatches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, condition]) => fieldMatches(row[key], condition));

function table(rows: Row[]) {
  let sequence = 0;
  const stamp = (row: Row): Row => {
    sequence += 1;
    return {
      ...row,
      id: (row.id as string | undefined) ?? `row-${sequence}`,
      createdAt: new Date(Date.now() + sequence),
      updatedAt: new Date(Date.now() + sequence),
    };
  };
  return {
    findFirst: async ({ where }: { where?: Row }) => {
      const found = rows
        .filter((row) => whereMatches(row, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return found[0] ?? null;
    },
    findUnique: async ({ where }: { where?: Row }) =>
      rows.find((row) => whereMatches(row, where)) ?? null,
    findMany: async ({ where }: { where?: Row }) => rows.filter((row) => whereMatches(row, where)),
    count: async ({ where }: { where?: Row }) =>
      rows.filter((row) => whereMatches(row, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = stamp(data);
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: { data: Row[] }) => {
      for (const entry of data) rows.push(stamp(entry));
      return { count: data.length };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((entry) => whereMatches(entry, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      const matched = rows.filter((row) => whereMatches(row, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
    deleteMany: async ({ where }: { where?: Row }) => {
      const before = rows.length;
      rows.splice(0, rows.length, ...rows.filter((row) => !whereMatches(row, where)));
      return { count: before - rows.length };
    },
  };
}

function fixture() {
  const users: Row[] = [
    {
      id: "admin-1",
      email: "admin@example.com",
      emailVerified: true,
      deactivatedAt: null,
      blacklistedAt: null,
      deletedAt: null,
    },
  ];
  const secrets: Row[] = [];
  const recoveryCodes: Row[] = [];
  const sessions: Row[] = [{ id: "session-1", userId: "admin-1", totpVerifiedAt: null }];
  const securityEvents: Row[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) =>
        users.find((row) => row.id === where.id) ?? null,
    },
    secret: table(secrets),
    adminTotpRecoveryCode: table(recoveryCodes),
    session: table(sessions),
    securityEvent: {
      ...table(securityEvents),
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
    env: { adminEmails: ["admin@example.com"] },
  };
  const actor = { userId: "admin-1", spaceId: "space-1" };
  return { deps, actor, sessions, securityEvents };
}

afterEach(() => installSecurityEventStore(undefined));

function currentCode(secret: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate();
}

async function enable(
  deps: ReturnType<typeof fixture>["deps"],
  actor: { userId: string; spaceId: string },
) {
  const enrolled = await startTotpEnrollment(deps, actor);
  const confirmed = await confirmTotpEnrollment(deps, actor, currentCode(enrolled.secret));
  return { secret: enrolled.secret, recoveryCodes: confirmed.recoveryCodes };
}

describe("admin TOTP", () => {
  it("enrolls, confirms, and verifies a code for the session", async () => {
    const { deps, actor } = fixture();
    await expect(
      totpStatus(deps, { userId: actor.userId, sessionId: "session-1" }),
    ).resolves.toEqual({
      enabled: false,
      verified: false,
      recoveryCodesRemaining: 0,
    });
    const enrolled = await startTotpEnrollment(deps, actor);
    expect(enrolled.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolled.secret).toMatch(/^[A-Z2-7]{32}$/);
    const confirmed = await confirmTotpEnrollment(deps, actor, currentCode(enrolled.secret));
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(new Set(confirmed.recoveryCodes).size).toBe(10);
    await expect(
      verifyTotpForSession(deps, {
        ...actor,
        sessionId: "session-1",
        code: currentCode(enrolled.secret),
      }),
    ).resolves.toEqual({ verified: true });
    await expect(
      totpStatus(deps, { userId: actor.userId, sessionId: "session-1" }),
    ).resolves.toEqual({
      enabled: true,
      verified: true,
      recoveryCodesRemaining: 10,
    });
  });

  it("refuses a code from two steps away and a wrong code", async () => {
    const { deps, actor } = fixture();
    const { secret } = await enable(deps, actor);
    const far = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    }).generate({ timestamp: Date.now() + 2 * 30 * 1000 });
    await expect(
      verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code: far }),
    ).rejects.toBeInstanceOf(ORPCError);
    await expect(
      verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code: "000000" }),
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("spends a recovery code once, then refuses it", async () => {
    const { deps, actor } = fixture();
    const { recoveryCodes } = await enable(deps, actor);
    const code = recoveryCodes[0]!;
    await expect(
      verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code }),
    ).resolves.toEqual({ verified: true });
    await expect(
      totpStatus(deps, { userId: actor.userId, sessionId: "session-1" }),
    ).resolves.toEqual(
      expect.objectContaining({ enabled: true, verified: true, recoveryCodesRemaining: 9 }),
    );
    await expect(
      verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code }),
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("refuses verification before enrollment", async () => {
    const { deps, actor } = fixture();
    await expect(
      verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code: "123456" }),
    ).rejects.toThrow("Two-factor is not enabled");
  });

  it("gates the admin surface only once TOTP is enabled", async () => {
    const { deps, actor } = fixture();
    await expect(requireAdminTotp(deps, actor.userId, "session-1")).resolves.toBeUndefined();
    const { secret } = await enable(deps, actor);
    await expect(requireAdminTotp(deps, actor.userId, "session-1")).rejects.toThrow(
      "Verify your authenticator code first",
    );
    await verifyTotpForSession(deps, {
      ...actor,
      sessionId: "session-1",
      code: currentCode(secret),
    });
    await expect(requireAdminTotp(deps, actor.userId, "session-1")).resolves.toBeUndefined();
  });

  it("limits repeated wrong codes", async () => {
    const { deps, actor } = fixture();
    await enable(deps, actor);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code: "000000" }),
      ).rejects.toThrow("Code is incorrect");
    }
    await expect(
      verifyTotpForSession(deps, { ...actor, sessionId: "session-1", code: "000000" }),
    ).rejects.toThrow("Too many failed attempts");
  });

  it("disables with a live code but not with a recovery code", async () => {
    const { deps, actor } = fixture();
    const { secret, recoveryCodes } = await enable(deps, actor);
    await expect(disableTotp(deps, actor, recoveryCodes[0]!)).rejects.toThrow("Code is incorrect");
    await disableTotp(deps, actor, currentCode(secret));
    await expect(
      totpStatus(deps, { userId: actor.userId, sessionId: "session-1" }),
    ).resolves.toEqual({
      enabled: false,
      verified: false,
      recoveryCodesRemaining: 0,
    });
    await expect(disableTotp(deps, actor, currentCode(secret))).rejects.toThrow(
      "Two-factor is not enabled",
    );
  });

  it("resets the secret so enrollment starts over", async () => {
    const { deps, actor } = fixture();
    await enable(deps, actor);
    await resetTotp(deps, actor);
    await expect(
      totpStatus(deps, { userId: actor.userId, sessionId: "session-1" }),
    ).resolves.toEqual({
      enabled: false,
      verified: false,
      recoveryCodesRemaining: 0,
    });
  });
});
