import type { PrismaClient } from "@rakazo_mickvvw/db";
import { describe, expect, it } from "vitest";
import {
  checkInviteCode,
  generateInviteCode,
  holdInviteCode,
  INVITE_CODE_LENGTH,
  linkInviteCodeRedemption,
  normalizeInviteCode,
} from "./invite-codes.js";

interface CodeRow {
  id: string;
  code: string;
  expiresAt: Date | null;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
}

interface RedemptionRow {
  codeId: string;
  email: string;
  userId: string | null;
  ip: string | null;
}

/** In-memory stand-in for the invite-code delegates, with transactional hold semantics. */
function fakePrisma(codes: CodeRow[] = []) {
  const redemptions: RedemptionRow[] = [];
  const store = {
    codes,
    redemptions,
    inviteCode: {
      findUnique: async ({ where }: { where: { code: string } }) =>
        store.codes.find((row) => row.code === where.code) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; usedCount: number };
        data: { usedCount: number };
      }) => {
        const row = store.codes.find(
          (candidate) => candidate.id === where.id && candidate.usedCount === where.usedCount,
        );
        if (!row) return { count: 0 };
        row.usedCount = data.usedCount;
        return { count: 1 };
      },
    },
    inviteCodeRedemption: {
      findUnique: async ({
        where,
      }: {
        where: { codeId_email: { codeId: string; email: string } };
      }) =>
        store.redemptions.find(
          (row) =>
            row.codeId === where.codeId_email.codeId && row.email === where.codeId_email.email,
        ) ?? null,
      create: async ({
        data,
      }: {
        data: Omit<RedemptionRow, "userId"> & { userId?: string | null };
      }) => {
        const row: RedemptionRow = { userId: null, ...data };
        store.redemptions.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { email: string; userId: null };
        data: { userId: string };
      }) => {
        let count = 0;
        for (const row of store.redemptions) {
          if (row.email === where.email && row.userId === null) {
            row.userId = data.userId;
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  const prisma = {
    ...store,
    $transaction: async <T>(fn: (tx: typeof store) => Promise<T>): Promise<T> => fn(store),
  } as unknown as PrismaClient;
  return { prisma, store };
}

const validCode = (): CodeRow => ({
  id: "code-1",
  code: "ABCDEFGHJKLM",
  expiresAt: null,
  maxUses: 1,
  usedCount: 0,
  revokedAt: null,
});

describe("invite codes", () => {
  it("generates readable codes of the configured length", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    expect(generateInviteCode()).not.toBe(code);
  });

  it("matches codes case-insensitively", () => {
    expect(normalizeInviteCode("  abcdefghjklm ")).toBe("ABCDEFGHJKLM");
    expect(normalizeInviteCode(undefined)).toBe("");
  });

  it("rejects unknown, expired, revoked, and exhausted codes", async () => {
    const { prisma } = fakePrisma([
      validCode(),
      {
        ...validCode(),
        id: "code-2",
        code: "EXPIREDCODE1",
        expiresAt: new Date(Date.now() - 1000),
      },
      { ...validCode(), id: "code-3", code: "REVOKEDCODE1", revokedAt: new Date() },
      { ...validCode(), id: "code-4", code: "EXHAUSTEDC01", usedCount: 1 },
    ]);
    expect(await checkInviteCode(prisma, "nope")).toBe("not_found");
    expect(await checkInviteCode(prisma, "expiredcode1")).toBe("expired");
    expect(await checkInviteCode(prisma, "revokedcode1")).toBe("revoked");
    expect(await checkInviteCode(prisma, "exhaustedc01")).toBe("exhausted");
    expect(await checkInviteCode(prisma, "abcdefghjklm")).toBe("valid");
  });

  it("holds one use per email and lets the same email retry", async () => {
    const { prisma, store } = fakePrisma([validCode()]);
    const input = { code: "abcdefghjklm", email: "Ada@example.com", ip: "203.0.113.7" };
    expect(await holdInviteCode(prisma, input)).toBe("held");
    expect(store.codes[0]?.usedCount).toBe(1);
    // Same email, same code: a failed signup retries without burning another use.
    expect(await holdInviteCode(prisma, input)).toBe("held");
    expect(store.codes[0]?.usedCount).toBe(1);
    expect(store.redemptions).toHaveLength(1);
    // Another email cannot take the spent use.
    expect(await holdInviteCode(prisma, { ...input, email: "mallory@example.com" })).toBe(
      "exhausted",
    );
  });

  it("lets a multi-use code be held by several emails up to its cap", async () => {
    const { prisma, store } = fakePrisma([{ ...validCode(), maxUses: 2 }]);
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "a@example.com", ip: null }),
    ).toBe("held");
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "b@example.com", ip: null }),
    ).toBe("held");
    expect(store.codes[0]?.usedCount).toBe(2);
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "c@example.com", ip: null }),
    ).toBe("exhausted");
  });

  it("links the held redemption to the account once it exists", async () => {
    const { prisma, store } = fakePrisma([validCode()]);
    await holdInviteCode(prisma, {
      code: "ABCDEFGHJKLM",
      email: "ada@example.com",
      ip: "203.0.113.7",
    });
    await linkInviteCodeRedemption(prisma, "Ada@example.com", "user-1");
    expect(store.redemptions[0]?.userId).toBe("user-1");
    // A second link is a no-op once the redemption has its account.
    await linkInviteCodeRedemption(prisma, "ada@example.com", "user-2");
    expect(store.redemptions[0]?.userId).toBe("user-1");
  });
});
