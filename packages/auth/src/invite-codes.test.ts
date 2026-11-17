import type { PrismaClient } from "@rakazo_mickvvw/db";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_INVITE_CODE_MAX_LENGTH,
  CUSTOM_INVITE_CODE_MIN_LENGTH,
  checkInviteCode,
  generateInviteCode,
  holdInviteCode,
  INVITE_CODE_LENGTH,
  issueReferralCode,
  linkInviteCodeRedemption,
  normalizeCustomInviteCode,
  normalizeInviteCode,
} from "./invite-codes.js";

interface CodeRow {
  id: string;
  code: string;
  createdById: string;
  expiresAt: Date | null;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
  isReferral: boolean;
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
      findFirst: async ({ where }: { where: { createdById: string; isReferral: boolean } }) =>
        store.codes.find(
          (row) => row.createdById === where.createdById && row.isReferral === where.isReferral,
        ) ?? null,
      create: async ({ data }: { data: Omit<CodeRow, "id" | "usedCount" | "revokedAt"> }) => {
        // The code column is unique; a duplicate insert fails like the real database.
        if (store.codes.some((row) => row.code === data.code)) throw { code: "P2002" };
        const row: CodeRow = {
          ...data,
          id: `code-${store.codes.length + 1}`,
          usedCount: 0,
          revokedAt: null,
        };
        store.codes.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; usedCount: number };
        data: { usedCount: number; revokedAt?: Date };
      }) => {
        const row = store.codes.find(
          (candidate) => candidate.id === where.id && candidate.usedCount === where.usedCount,
        );
        if (!row) return { count: 0 };
        row.usedCount = data.usedCount;
        if (data.revokedAt) row.revokedAt = data.revokedAt;
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
  createdById: "admin-1",
  expiresAt: null,
  maxUses: 1,
  usedCount: 0,
  revokedAt: null,
  isReferral: false,
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

  it("accepts custom codes from the invite alphabet only", () => {
    expect(normalizeCustomInviteCode("  summer27 ")).toBe("SUMMER27");
    expect(normalizeCustomInviteCode("TEAM")).toBe("TEAM");
    expect(normalizeCustomInviteCode("A".repeat(CUSTOM_INVITE_CODE_MAX_LENGTH))).toHaveLength(
      CUSTOM_INVITE_CODE_MAX_LENGTH,
    );
    expect(normalizeCustomInviteCode("ABC")).toBeNull();
    expect(normalizeCustomInviteCode("A".repeat(CUSTOM_INVITE_CODE_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeCustomInviteCode("WELCOME1")).toBeNull();
    expect(normalizeCustomInviteCode("HELLO")).toBeNull();
    expect(normalizeCustomInviteCode("BAD-CODE")).toBeNull();
    expect(normalizeCustomInviteCode("")).toBeNull();
    expect(normalizeCustomInviteCode(undefined)).toBeNull();
    expect(CUSTOM_INVITE_CODE_MIN_LENGTH).toBe(4);
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

  it("refuses a referral code while the referral switch is off", async () => {
    const { prisma } = fakePrisma([{ ...validCode(), isReferral: true }]);
    expect(await checkInviteCode(prisma, "abcdefghjklm", { referralCodeEnabled: false })).toBe(
      "referral_disabled",
    );
    expect(
      await holdInviteCode(
        prisma,
        { code: "abcdefghjklm", email: "a@example.com", ip: null },
        { referralCodeEnabled: false },
      ),
    ).toBe("referral_disabled");
    // An admin-made code is unaffected by the referral switch.
    const admin = fakePrisma([validCode()]);
    expect(
      await checkInviteCode(admin.prisma, "abcdefghjklm", { referralCodeEnabled: false }),
    ).toBe("valid");
  });

  it("revokes a referral code on its last use and keeps the redemptions", async () => {
    const { prisma, store } = fakePrisma([{ ...validCode(), isReferral: true, maxUses: 2 }]);
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "a@example.com", ip: null }),
    ).toBe("held");
    expect(store.codes[0]?.revokedAt).toBeNull();
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "b@example.com", ip: null }),
    ).toBe("held");
    expect(store.codes[0]?.usedCount).toBe(2);
    expect(store.codes[0]?.revokedAt).not.toBeNull();
    expect(await checkInviteCode(prisma, "abcdefghjklm")).toBe("revoked");
    expect(store.redemptions).toHaveLength(2);
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "c@example.com", ip: null }),
    ).toBe("revoked");
  });

  it("leaves an admin-made code exhausted, not revoked", async () => {
    const { prisma, store } = fakePrisma([validCode()]);
    expect(
      await holdInviteCode(prisma, { code: "ABCDEFGHJKLM", email: "a@example.com", ip: null }),
    ).toBe("held");
    expect(store.codes[0]?.revokedAt).toBeNull();
    expect(await checkInviteCode(prisma, "abcdefghjklm")).toBe("exhausted");
  });

  it("issues one personal code per account, at the configured uses", async () => {
    const { prisma, store } = fakePrisma([]);
    const settings = { referralCodeEnabled: true, referralCodeMaxUses: 25 };
    const issued = await issueReferralCode(prisma, "user-1", settings);
    expect(issued).not.toBeNull();
    expect(issued?.createdById).toBe("user-1");
    expect(issued?.maxUses).toBe(25);
    expect(issued?.expiresAt).toBeNull();
    expect(issued?.isReferral).toBe(true);
    expect(issued?.code).toHaveLength(INVITE_CODE_LENGTH);
    expect(issued?.code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    // A second issue returns the same code instead of creating another.
    expect(await issueReferralCode(prisma, "user-1", settings)).toEqual(issued);
    expect(store.codes).toHaveLength(1);
  });

  it("issues nothing while the referral switch is off", async () => {
    const { prisma, store } = fakePrisma([]);
    expect(
      await issueReferralCode(prisma, "user-1", {
        referralCodeEnabled: false,
        referralCodeMaxUses: 10,
      }),
    ).toBeNull();
    expect(store.codes).toHaveLength(0);
  });
});
