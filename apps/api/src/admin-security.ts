import { ORPCError } from "@orpc/server";
import type { SecurityEventType } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { recordSecurityEvent, runAsSystem } from "@rakazo/db";

/** Failed attempts allowed in one window before the same check starts refusing. */
const ADMIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_ATTEMPT_LIMIT = 5;

/**
 * Counts recent failures of one admin check for one admin. Throws when the window is
 * full, so a wrong code or key cannot be guessed at will. Failures are already
 * audit-logged by the caller, so this only adds the rate-limit hit itself.
 */
export async function checkAdminAttemptLimit(
  prisma: PrismaClient,
  input: { userId: string; failureType: SecurityEventType },
): Promise<void> {
  const since = new Date(Date.now() - ADMIN_ATTEMPT_WINDOW_MS);
  const failures = await runAsSystem(`count recent ${input.failureType} failures`, () =>
    prisma.securityEvent.count({
      where: { type: input.failureType, userId: input.userId, createdAt: { gte: since } },
    }),
  );
  if (failures < ADMIN_ATTEMPT_LIMIT) return;
  await recordSecurityEvent({
    type: "rate_limit.hit",
    userId: input.userId,
    metadata: { kind: input.failureType },
  });
  throw new ORPCError("TOO_MANY_REQUESTS", {
    message: "Too many failed attempts. Try again later.",
  });
}
