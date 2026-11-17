import { randomInt } from "node:crypto";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { isUniqueViolation } from "@rakazo_mickvvw/db";

/** Invite codes use an unambiguous alphabet: no 0/O, 1/I, or L to misread. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 12;

/** Custom codes are shorter than generated ones but stay readable and hard to mistype. */
export const CUSTOM_INVITE_CODE_MIN_LENGTH = 4;
export const CUSTOM_INVITE_CODE_MAX_LENGTH = 32;

/** A random code an admin can read out over the phone. */
export function generateInviteCode(length = INVITE_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/** Codes are stored uppercase; a typed code matches in any case. */
export function normalizeInviteCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

/**
 * Normalizes a custom code an admin typed in; null when it is not
 * CUSTOM_INVITE_CODE_MIN_LENGTH–CUSTOM_INVITE_CODE_MAX_LENGTH characters from the
 * invite alphabet. Custom codes keep the same alphabet as generated ones so they
 * stay readable over the phone and match case-insensitively.
 */
export function normalizeCustomInviteCode(raw: unknown): string | null {
  const code = normalizeInviteCode(raw);
  if (code.length < CUSTOM_INVITE_CODE_MIN_LENGTH || code.length > CUSTOM_INVITE_CODE_MAX_LENGTH)
    return null;
  if ([...code].some((char) => !INVITE_CODE_ALPHABET.includes(char))) return null;
  return code;
}

export type InviteCodeProblem =
  | "not_found"
  | "expired"
  | "revoked"
  | "exhausted"
  | "referral_disabled";

/** A referral code is only usable while the referral switch is on. */
function referralDisabled(row: { isReferral: boolean }, referralCodeEnabled?: boolean): boolean {
  return row.isReferral && referralCodeEnabled === false;
}

/** Read-only check: whether the code could still be held. */
export async function checkInviteCode(
  prisma: Pick<PrismaClient, "inviteCode">,
  raw: string,
  opts?: { referralCodeEnabled?: boolean },
): Promise<"valid" | InviteCodeProblem> {
  const code = normalizeInviteCode(raw);
  if (!code) return "not_found";
  const row = await prisma.inviteCode.findUnique({ where: { code } });
  if (!row) return "not_found";
  if (referralDisabled(row, opts?.referralCodeEnabled)) return "referral_disabled";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt <= new Date()) return "expired";
  if (row.usedCount >= row.maxUses) return "exhausted";
  return "valid";
}

/**
 * Holds one use of the code for this email, atomically. A signup that fails after the hold
 * (a wrong one-time code, a weak password) retries with the same email without burning the
 * code, while another email cannot take the held use. Returns "held" on success.
 */
export async function holdInviteCode(
  prisma: PrismaClient,
  input: { code: string; email: string; ip: string | null },
  opts?: { referralCodeEnabled?: boolean },
): Promise<"held" | InviteCodeProblem> {
  const code = normalizeInviteCode(input.code);
  const email = input.email.trim().toLowerCase();
  if (!code || !email) return "not_found";
  return prisma.$transaction(async (tx) => {
    const row = await tx.inviteCode.findUnique({ where: { code } });
    if (!row) return "not_found" as const;
    if (referralDisabled(row, opts?.referralCodeEnabled)) return "referral_disabled" as const;
    if (row.revokedAt) return "revoked" as const;
    if (row.expiresAt && row.expiresAt <= new Date()) return "expired" as const;
    const held = await tx.inviteCodeRedemption.findUnique({
      where: { codeId_email: { codeId: row.id, email } },
    });
    if (held) return "held" as const;
    if (row.usedCount >= row.maxUses) return "exhausted" as const;
    // A referral code revokes itself the moment its last use is held, in the same
    // guarded update that spends the use: the guard pins usedCount to the value
    // this read saw, so the precomputed "last use" is exact when the write lands.
    // Admin-made codes keep the old behavior and stay "exhausted" instead.
    const exhausts = row.isReferral && row.usedCount + 1 >= row.maxUses;
    const claimed = await tx.inviteCode.updateMany({
      where: { id: row.id, usedCount: row.usedCount },
      data: {
        usedCount: row.usedCount + 1,
        ...(exhausts ? { revokedAt: new Date() } : {}),
      },
    });
    // Another signup took the last use between the read and the write.
    if (claimed.count !== 1) return "exhausted" as const;
    await tx.inviteCodeRedemption.create({
      data: { codeId: row.id, email, ip: input.ip },
    });
    return "held" as const;
  });
}

/** The referral settings that decide whether a personal code is issued and for how many uses. */
export interface ReferralCodeSettings {
  referralCodeEnabled: boolean;
  referralCodeMaxUses: number;
}

/**
 * Issues the account's one personal referral code, or returns the one it already has.
 * Returns null while the referral switch is off. The code never expires and is never
 * reissued: once it is used up it stays used up. A failed create is retried once, so a
 * concurrent issue or a random-code collision does not leave the account without one.
 */
export async function issueReferralCode(
  prisma: Pick<PrismaClient, "inviteCode">,
  userId: string,
  settings: ReferralCodeSettings,
) {
  if (!settings.referralCodeEnabled) return null;
  const existing = await prisma.inviteCode.findFirst({
    where: { createdById: userId, isReferral: true },
  });
  if (existing) return existing;
  try {
    return await prisma.inviteCode.create({
      data: {
        code: generateInviteCode(),
        createdById: userId,
        expiresAt: null,
        maxUses: settings.referralCodeMaxUses,
        isReferral: true,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.inviteCode.findFirst({
      where: { createdById: userId, isReferral: true },
    });
    if (raced) return raced;
    return prisma.inviteCode.create({
      data: {
        code: generateInviteCode(),
        createdById: userId,
        expiresAt: null,
        maxUses: settings.referralCodeMaxUses,
        isReferral: true,
      },
    });
  }
}

/** Fills the account id on the redemption held for this email, once the account exists. */
export async function linkInviteCodeRedemption(
  prisma: {
    inviteCodeRedemption?: Pick<PrismaClient, "inviteCodeRedemption">["inviteCodeRedemption"];
  },
  email: string,
  userId: string,
): Promise<void> {
  if (!prisma.inviteCodeRedemption) return;
  await prisma.inviteCodeRedemption.updateMany({
    where: { email: email.trim().toLowerCase(), userId: null },
    data: { userId },
  });
}
