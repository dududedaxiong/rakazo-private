import { randomInt } from "node:crypto";
import type { PrismaClient } from "@rakazo_mickvvw/db";

/** Invite codes use an unambiguous alphabet: no 0/O, 1/I, or L to misread. */
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 12;

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

export type InviteCodeProblem = "not_found" | "expired" | "revoked" | "exhausted";

/** Read-only check: whether the code could still be held. */
export async function checkInviteCode(
  prisma: Pick<PrismaClient, "inviteCode">,
  raw: string,
): Promise<"valid" | InviteCodeProblem> {
  const code = normalizeInviteCode(raw);
  if (!code) return "not_found";
  const row = await prisma.inviteCode.findUnique({ where: { code } });
  if (!row) return "not_found";
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
): Promise<"held" | InviteCodeProblem> {
  const code = normalizeInviteCode(input.code);
  const email = input.email.trim().toLowerCase();
  if (!code || !email) return "not_found";
  return prisma.$transaction(async (tx) => {
    const row = await tx.inviteCode.findUnique({ where: { code } });
    if (!row) return "not_found" as const;
    if (row.revokedAt) return "revoked" as const;
    if (row.expiresAt && row.expiresAt <= new Date()) return "expired" as const;
    const held = await tx.inviteCodeRedemption.findUnique({
      where: { codeId_email: { codeId: row.id, email } },
    });
    if (held) return "held" as const;
    if (row.usedCount >= row.maxUses) return "exhausted" as const;
    const claimed = await tx.inviteCode.updateMany({
      where: { id: row.id, usedCount: row.usedCount },
      data: { usedCount: row.usedCount + 1 },
    });
    // Another signup took the last use between the read and the write.
    if (claimed.count !== 1) return "exhausted" as const;
    await tx.inviteCodeRedemption.create({
      data: { codeId: row.id, email, ip: input.ip },
    });
    return "held" as const;
  });
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
