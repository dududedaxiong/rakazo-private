import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { recordSecurityEvent, runAsSystem } from "@rakazo_mickvvw/db";
import * as OTPAuth from "otpauth";
import { checkAdminAttemptLimit } from "./admin-security.js";
import { requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type TotpDeps = Pick<RouterDeps, "prisma" | "secrets"> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
};

/** The Secret row kind for an admin's active TOTP secret. */
export const TOTP_SECRET_KIND = "admin-totp";
/** The Secret row kind for a TOTP secret awaiting confirmation. */
export const TOTP_PENDING_SECRET_KIND = "admin-totp-pending";
/** TOTP window: the current step plus one step of clock drift either way. */
const TOTP_WINDOW = 1;
/** Recovery codes issued at enrollment. */
const RECOVERY_CODE_COUNT = 10;
/** No ambiguous characters, so a code read aloud still types correctly. */
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_LENGTH = 8;

function secretContext(actor: { userId: string; spaceId: string }, operation: string) {
  return {
    operationId: `admin-totp:${operation}`,
    traceId: `admin-totp:${operation}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: new AbortController().signal,
  };
}

function totpFor(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "Rakazo mickvvw",
    label,
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

async function loadSecret(
  deps: TotpDeps,
  userId: string,
  kind: string,
): Promise<{ id: string; ciphertext: string } | null> {
  return runAsSystem(`read the ${kind} secret`, () =>
    deps.prisma.secret.findFirst({
      where: { userId, spaceId: null, kind },
      orderBy: { createdAt: "desc" },
      select: { id: true, ciphertext: true },
    }),
  );
}

async function openSecret(
  deps: TotpDeps,
  row: { id: string; ciphertext: string },
): Promise<string | null> {
  try {
    return await deps.secrets.load(row.ciphertext, { recordId: row.id });
  } catch {
    return null;
  }
}

export async function totpEnabled(deps: TotpDeps, userId: string): Promise<boolean> {
  return (await loadSecret(deps, userId, TOTP_SECRET_KIND)) !== null;
}

async function sessionVerifiedAt(
  deps: TotpDeps,
  userId: string,
  sessionId: string | undefined,
): Promise<Date | null> {
  if (!sessionId) return null;
  const session = await runAsSystem("read the session TOTP stamp", () =>
    deps.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, totpVerifiedAt: true },
    }),
  );
  if (!session || session.userId !== userId) return null;
  return session.totpVerifiedAt;
}

/**
 * The gate for the whole admin surface: an admin with TOTP enabled must have
 * proved a code (or recovery code) for this session. Admins without TOTP pass.
 */
export async function requireAdminTotp(
  deps: TotpDeps,
  userId: string,
  sessionId: string | undefined,
): Promise<void> {
  await requireAdmin(deps, userId);
  if (!(await totpEnabled(deps, userId))) return;
  if (!(await sessionVerifiedAt(deps, userId, sessionId))) {
    throw new ORPCError("FORBIDDEN", { message: "Verify your authenticator code first" });
  }
}

export async function totpStatus(
  deps: TotpDeps,
  input: { userId: string; sessionId: string | undefined },
): Promise<{ enabled: boolean; verified: boolean; recoveryCodesRemaining: number }> {
  const [enabled, verifiedAt, remaining] = await Promise.all([
    totpEnabled(deps, input.userId),
    sessionVerifiedAt(deps, input.userId, input.sessionId),
    runAsSystem("count unused recovery codes", () =>
      deps.prisma.adminTotpRecoveryCode.count({
        where: { userId: input.userId, usedAt: null },
      }),
    ),
  ]);
  return { enabled, verified: enabled && verifiedAt !== null, recoveryCodesRemaining: remaining };
}

/**
 * Starts enrollment: a fresh secret is sealed as pending and returned as an
 * otpauth URI for the QR code plus the base32 secret for manual entry. Nothing
 * changes until the code is confirmed, so an in-progress enrollment never locks
 * the admin out of the secret that still works.
 */
export async function startTotpEnrollment(
  deps: TotpDeps,
  actor: { userId: string; spaceId: string },
): Promise<{ otpauthUri: string; secret: string }> {
  await requireAdmin(deps, actor.userId);
  const user = await deps.prisma.user.findUnique({
    where: { id: actor.userId },
    select: { email: true },
  });
  if (!user) throw new ORPCError("NOT_FOUND");
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const stored = await deps.secrets.put(secret, secretContext(actor, "enroll"));
  await runAsSystem("store the pending TOTP secret", () =>
    deps.prisma.$transaction(async (tx) => {
      await tx.secret.deleteMany({
        where: { userId: actor.userId, spaceId: null, kind: TOTP_PENDING_SECRET_KIND },
      });
      await tx.secret.create({
        data: {
          id: stored.id,
          userId: actor.userId,
          spaceId: null,
          kind: TOTP_PENDING_SECRET_KIND,
          ciphertext: stored.ciphertext,
        },
      });
    }),
  );
  return { otpauthUri: totpFor(secret, user.email).toString(), secret };
}

function recoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  const chars = [...bytes].map(
    (byte) => RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length],
  );
  const code = chars.join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeCode(code), salt, 32, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function recoveryCodeMatches(code: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(normalizeCode(code), salt, 32, { N: 16384, r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Confirms enrollment with a code from the new authenticator: the pending secret
 * becomes the active one, the old one (if any) is removed, and a fresh set of
 * single-use recovery codes is issued. The codes are returned once, in clear.
 */
export async function confirmTotpEnrollment(
  deps: TotpDeps,
  actor: { userId: string; spaceId: string },
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  await requireAdmin(deps, actor.userId);
  const pending = await loadSecret(deps, actor.userId, TOTP_PENDING_SECRET_KIND);
  if (!pending) throw new ORPCError("BAD_REQUEST", { message: "Start enrollment first" });
  const secret = await openSecret(deps, pending);
  if (!secret) throw new ORPCError("INTERNAL_ERROR", { message: "Stored secret is unreadable" });
  await checkAdminAttemptLimit(deps.prisma, {
    userId: actor.userId,
    failureType: "admin.totp.failed",
  });
  const user = await deps.prisma.user.findUnique({
    where: { id: actor.userId },
    select: { email: true },
  });
  if (!user) throw new ORPCError("NOT_FOUND");
  if (
    totpFor(secret, user.email).validate({ token: normalizeCode(code), window: TOTP_WINDOW }) ===
    null
  ) {
    await recordSecurityEvent({
      type: "admin.totp.failed",
      userId: actor.userId,
      metadata: { reason: "mismatch" },
    });
    throw new ORPCError("FORBIDDEN", { message: "Code is incorrect" });
  }
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => recoveryCode());
  const previous = await runAsSystem("read the previous TOTP secrets", () =>
    deps.prisma.secret.findMany({
      where: { userId: actor.userId, spaceId: null, kind: TOTP_SECRET_KIND },
      select: { id: true, ciphertext: true },
    }),
  );
  await runAsSystem("activate the TOTP secret", () =>
    deps.prisma.$transaction(async (tx) => {
      await tx.secret.update({
        where: { id: pending.id },
        data: { kind: TOTP_SECRET_KIND },
      });
      await tx.secret.deleteMany({
        where: {
          userId: actor.userId,
          spaceId: null,
          kind: TOTP_SECRET_KIND,
          id: { not: pending.id },
        },
      });
      await tx.adminTotpRecoveryCode.deleteMany({ where: { userId: actor.userId } });
      await tx.adminTotpRecoveryCode.createMany({
        data: codes.map((code) => ({ userId: actor.userId, codeHash: hashRecoveryCode(code) })),
      });
    }),
  );
  for (const row of previous) {
    await deps.secrets.delete(row.ciphertext, row.id).catch(() => undefined);
  }
  return { recoveryCodes: codes };
}

async function stampSessionVerified(
  deps: TotpDeps,
  userId: string,
  sessionId: string,
): Promise<void> {
  const updated = await runAsSystem("stamp the session TOTP verification", () =>
    deps.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { totpVerifiedAt: new Date() },
    }),
  );
  if (updated.count === 0) throw new ORPCError("FORBIDDEN", { message: "Session is not active" });
}

async function tryRecoveryCode(deps: TotpDeps, userId: string, code: string): Promise<boolean> {
  const rows = await runAsSystem("read unused recovery codes", () =>
    deps.prisma.adminTotpRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    }),
  );
  const match = rows.find((row) => recoveryCodeMatches(code, row.codeHash));
  if (!match) return false;
  await runAsSystem("spend the recovery code", () =>
    deps.prisma.adminTotpRecoveryCode.updateMany({
      where: { id: match.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  );
  return true;
}

/**
 * Proves a code (or recovery code) for this session, opening the admin surface.
 * A recovery code is single-use: it is spent here and the spend is audited.
 */
export async function verifyTotpForSession(
  deps: TotpDeps,
  input: { userId: string; spaceId: string; sessionId: string; code: string },
): Promise<{ verified: true }> {
  await requireAdmin(deps, input.userId);
  const active = await loadSecret(deps, input.userId, TOTP_SECRET_KIND);
  if (!active) throw new ORPCError("FORBIDDEN", { message: "Two-factor is not enabled" });
  await checkAdminAttemptLimit(deps.prisma, {
    userId: input.userId,
    failureType: "admin.totp.failed",
  });
  const code = normalizeCode(input.code);
  const user = await deps.prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  if (!user) throw new ORPCError("NOT_FOUND");
  const secret = await openSecret(deps, active);
  if (
    secret &&
    totpFor(secret, user.email).validate({ token: code, window: TOTP_WINDOW }) !== null
  ) {
    await stampSessionVerified(deps, input.userId, input.sessionId);
    await recordSecurityEvent({
      type: "admin.totp.verified",
      userId: input.userId,
      metadata: { via: "totp" },
    });
    return { verified: true as const };
  }
  if (await tryRecoveryCode(deps, input.userId, code)) {
    await stampSessionVerified(deps, input.userId, input.sessionId);
    await recordSecurityEvent({
      type: "admin.totp.recovery_used",
      userId: input.userId,
      metadata: { via: "recovery" },
    });
    return { verified: true as const };
  }
  await recordSecurityEvent({
    type: "admin.totp.failed",
    userId: input.userId,
    metadata: { reason: "mismatch" },
  });
  throw new ORPCError("FORBIDDEN", { message: "Code is incorrect" });
}

/**
 * Turns TOTP off. A live code is required: a recovery code alone must not be
 * able to remove the second factor.
 */
export async function disableTotp(
  deps: TotpDeps,
  actor: { userId: string; spaceId: string },
  code: string,
): Promise<void> {
  await requireAdmin(deps, actor.userId);
  const active = await loadSecret(deps, actor.userId, TOTP_SECRET_KIND);
  if (!active) throw new ORPCError("BAD_REQUEST", { message: "Two-factor is not enabled" });
  const user = await deps.prisma.user.findUnique({
    where: { id: actor.userId },
    select: { email: true },
  });
  if (!user) throw new ORPCError("NOT_FOUND");
  const secret = await openSecret(deps, active);
  if (
    !secret ||
    totpFor(secret, user.email).validate({ token: normalizeCode(code), window: TOTP_WINDOW }) ===
      null
  ) {
    await recordSecurityEvent({
      type: "admin.totp.failed",
      userId: actor.userId,
      metadata: { reason: "mismatch" },
    });
    throw new ORPCError("FORBIDDEN", { message: "Code is incorrect" });
  }
  await runAsSystem("remove the TOTP secret", () =>
    deps.prisma.$transaction(async (tx) => {
      await tx.secret.deleteMany({
        where: {
          userId: actor.userId,
          spaceId: null,
          kind: { in: [TOTP_SECRET_KIND, TOTP_PENDING_SECRET_KIND] },
        },
      });
      await tx.adminTotpRecoveryCode.deleteMany({ where: { userId: actor.userId } });
    }),
  );
  await deps.secrets.delete(active.ciphertext, active.id).catch(() => undefined);
}

/**
 * Re-registration after losing both the authenticator and the recovery codes.
 * The caller must already hold a super-key grant; the old secret and codes are
 * removed, and enrollment starts over from the 2FA page.
 */
export async function resetTotp(
  deps: TotpDeps,
  actor: { userId: string; spaceId: string },
): Promise<void> {
  await requireAdmin(deps, actor.userId);
  const rows = await runAsSystem("read the TOTP secrets", () =>
    deps.prisma.secret.findMany({
      where: {
        userId: actor.userId,
        spaceId: null,
        kind: { in: [TOTP_SECRET_KIND, TOTP_PENDING_SECRET_KIND] },
      },
      select: { id: true, ciphertext: true },
    }),
  );
  await runAsSystem("remove the TOTP secrets", () =>
    deps.prisma.$transaction(async (tx) => {
      await tx.secret.deleteMany({
        where: {
          userId: actor.userId,
          spaceId: null,
          kind: { in: [TOTP_SECRET_KIND, TOTP_PENDING_SECRET_KIND] },
        },
      });
      await tx.adminTotpRecoveryCode.deleteMany({ where: { userId: actor.userId } });
    }),
  );
  for (const row of rows) {
    await deps.secrets.delete(row.ciphertext, row.id).catch(() => undefined);
  }
}
