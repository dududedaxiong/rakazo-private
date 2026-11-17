import { timingSafeEqual } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { recordSecurityEvent, runAsSystem } from "@rakazo/db";
import { checkAdminAttemptLimit } from "./admin-security.js";
import type { RouterDeps } from "./router.js";

type SuperKeyDeps = Pick<RouterDeps, "prisma" | "secrets"> & {
  env: Pick<RouterDeps["env"], "adminSuperKey">;
};

/** The Secret row kind for an admin-set super key override. */
export const SUPER_KEY_SECRET_KIND = "admin-super-key";
/** A grant covers the two gated settings pages for this long. */
export const SUPER_KEY_GRANT_TTL_MS = 15 * 60 * 1000;

function secretContext(actor: { userId: string; spaceId: string }, operation: string) {
  return {
    operationId: `admin-super-key:${operation}`,
    traceId: `admin-super-key:${operation}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: new AbortController().signal,
  };
}

function keysEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The admin-set override, when one exists: the newest Secret row of this kind.
 * A corrupt row falls back to the environment key rather than locking everyone out.
 */
async function loadDbSuperKey(deps: SuperKeyDeps): Promise<string | null> {
  const row = await runAsSystem("read the admin-set super key", () =>
    deps.prisma.secret.findFirst({
      where: { kind: SUPER_KEY_SECRET_KIND },
      orderBy: { createdAt: "desc" },
      select: { id: true, ciphertext: true },
    }),
  );
  if (!row) return null;
  try {
    return await deps.secrets.load(row.ciphertext, { recordId: row.id });
  } catch {
    return null;
  }
}

/**
 * The key the gate checks: the database override first, the environment value
 * second. Null when neither exists, and then the gate stays shut — there is no
 * code default.
 */
export async function effectiveSuperKey(deps: SuperKeyDeps): Promise<string | null> {
  return (await loadDbSuperKey(deps)) ?? deps.env.adminSuperKey ?? null;
}

export async function superKeyConfigured(deps: SuperKeyDeps): Promise<boolean> {
  return (await effectiveSuperKey(deps)) !== null;
}

export async function superKeyGrantStatus(
  deps: SuperKeyDeps,
  input: { userId: string; sessionId: string },
): Promise<{ granted: boolean; expiresAt: string | null; configured: boolean }> {
  const [grant, configured] = await Promise.all([
    runAsSystem("read the super-key grant", () =>
      deps.prisma.adminSuperKeyGrant.findUnique({ where: { sessionId: input.sessionId } }),
    ),
    superKeyConfigured(deps),
  ]);
  const live =
    grant && grant.userId === input.userId && grant.expiresAt > new Date() ? grant : null;
  return { granted: Boolean(live), expiresAt: live?.expiresAt.toISOString() ?? null, configured };
}

/** Throws unless this session holds a live grant. */
export async function requireSuperKeyGrant(
  deps: SuperKeyDeps,
  input: { userId: string; sessionId: string },
): Promise<void> {
  const { granted } = await superKeyGrantStatus(deps, input);
  if (!granted) throw new ORPCError("FORBIDDEN", { message: "Verify the super key first" });
}

/**
 * Checks a candidate key and, when it matches, grants this session the two gated
 * pages until the grant expires.
 */
export async function verifySuperKey(
  deps: SuperKeyDeps,
  input: { userId: string; sessionId: string; key: string },
): Promise<{ expiresAt: string }> {
  const expected = await effectiveSuperKey(deps);
  if (!expected) {
    await recordSecurityEvent({
      type: "admin.super_key.failed",
      userId: input.userId,
      metadata: { reason: "unconfigured" },
    });
    throw new ORPCError("FORBIDDEN", { message: "No super key is configured" });
  }
  await checkAdminAttemptLimit(deps.prisma, {
    userId: input.userId,
    failureType: "admin.super_key.failed",
  });
  if (!keysEqual(input.key, expected)) {
    await recordSecurityEvent({
      type: "admin.super_key.failed",
      userId: input.userId,
      metadata: { reason: "mismatch" },
    });
    throw new ORPCError("FORBIDDEN", { message: "Super key is incorrect" });
  }
  const expiresAt = new Date(Date.now() + SUPER_KEY_GRANT_TTL_MS);
  await runAsSystem("grant super-key access", () =>
    deps.prisma.adminSuperKeyGrant.upsert({
      where: { sessionId: input.sessionId },
      create: { userId: input.userId, sessionId: input.sessionId, expiresAt },
      update: { userId: input.userId, expiresAt },
    }),
  );
  await recordSecurityEvent({
    type: "admin.super_key.verified",
    userId: input.userId,
    metadata: { scope: "settings" },
  });
  return { expiresAt: expiresAt.toISOString() };
}

/**
 * Replaces the super key with an admin-set override, effective immediately. The
 * caller must already hold a grant, and the current key is checked again here,
 * so a stolen grant alone cannot lock the admins out. The previous override rows
 * are removed; if the new row is ever deleted, the gate falls back to the
 * environment key.
 */
export async function changeSuperKey(
  deps: SuperKeyDeps,
  input: { userId: string; spaceId: string; sessionId: string; currentKey: string; newKey: string },
): Promise<void> {
  await requireSuperKeyGrant(deps, input);
  const expected = await effectiveSuperKey(deps);
  if (!expected || !keysEqual(input.currentKey, expected)) {
    await recordSecurityEvent({
      type: "admin.super_key.failed",
      userId: input.userId,
      metadata: { reason: "mismatch" },
    });
    throw new ORPCError("FORBIDDEN", { message: "Current super key is incorrect" });
  }
  if (keysEqual(input.newKey, expected)) {
    throw new ORPCError("BAD_REQUEST", { message: "The new super key must be different" });
  }
  const stored = await deps.secrets.put(input.newKey, secretContext(input, "change"));
  const previous = await runAsSystem("read the previous super key rows", () =>
    deps.prisma.secret.findMany({
      where: { kind: SUPER_KEY_SECRET_KIND },
      select: { id: true, ciphertext: true },
    }),
  );
  await runAsSystem("store the new super key", () =>
    deps.prisma.$transaction(async (tx) => {
      await tx.secret.create({
        data: {
          id: stored.id,
          userId: input.userId,
          spaceId: null,
          kind: SUPER_KEY_SECRET_KIND,
          ciphertext: stored.ciphertext,
        },
      });
      await tx.secret.deleteMany({
        where: { kind: SUPER_KEY_SECRET_KIND, id: { not: stored.id } },
      });
    }),
  );
  for (const row of previous) {
    await deps.secrets.delete(row.ciphertext, row.id).catch(() => undefined);
  }
}
