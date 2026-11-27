import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { IsolationError, THREAD_LOCK_TRANSACTION_OPTIONS } from "@rakazo_mickvvw/db";
import type { ThreadTarget } from "./thread-target.js";

/**
 * A thread is unread when a message arrived after the last one the user read
 * (`lastReadSeq < nextMessageSeq - 1`). The `threads.unread` column was dropped
 * (migration 20261202120100), so the dot and the "New" divider are derived from
 * the read cursor instead of a stored flag.
 */

/**
 * Marks the thread read up to its latest message. Returns the seq the user had read up
 * to before, or null when nothing new arrived since the last read; the first
 * answer of a visit places the "New" divider. A message landing mid-update makes the
 * conditional write miss, so it retries rather than marking that message read; a chat
 * that stays that busy is read under the thread's row lock instead.
 */
export async function markThreadRead(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
): Promise<number | null> {
  const where = { id: target.threadId, spaceId: actor.spaceId };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const thread = await prisma.thread.findFirst({
      where,
      select: { lastReadSeq: true, nextMessageSeq: true },
    });
    if (!thread) return null;
    const latestSeq = thread.nextMessageSeq - 1;
    if (thread.lastReadSeq >= latestSeq) return null;
    const result = await prisma.thread.updateMany({
      where: { ...where, lastReadSeq: thread.lastReadSeq, nextMessageSeq: thread.nextMessageSeq },
      data: { lastReadSeq: latestSeq },
    });
    if (result.count > 1) throw new IsolationError();
    if (result.count === 1) return dividerSeq(thread, latestSeq);
  }
  // New messages take the same row lock, so none can land between this read and write.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const thread = await tx.thread.findFirst({
      where,
      select: { lastReadSeq: true, nextMessageSeq: true },
    });
    if (!thread) return null;
    const latestSeq = thread.nextMessageSeq - 1;
    if (thread.lastReadSeq >= latestSeq) return null;
    const result = await tx.thread.updateMany({
      where,
      data: { lastReadSeq: latestSeq },
    });
    if (result.count > 1) throw new IsolationError();
    return dividerSeq(thread, latestSeq);
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
}

/** A chat only gets a divider when it had unread messages, so replies seen live never do. */
function dividerSeq(thread: { lastReadSeq: number }, latestSeq: number) {
  return thread.lastReadSeq < latestSeq ? thread.lastReadSeq : null;
}

/**
 * Marks the thread unread from one of its messages: the read cursor moves to just before it,
 * so the next open puts the New divider above that message.
 */
export async function markThreadUnreadFrom(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
  messageId: string,
) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, threadId: target.threadId },
    select: { seq: true },
  });
  if (!message) throw new ORPCError("NOT_FOUND");
  const result = await prisma.thread.updateMany({
    where: { id: target.threadId, spaceId: actor.spaceId },
    data: { lastReadSeq: message.seq - 1 },
  });
  if (result.count > 1) throw new IsolationError();
}

export async function setThreadUnreadState(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
  unread: boolean,
) {
  const thread = await prisma.thread.findFirst({
    where: { id: target.threadId, spaceId: actor.spaceId },
    select: { lastReadSeq: true, nextMessageSeq: true },
  });
  if (!thread) return;
  const latestSeq = thread.nextMessageSeq - 1;
  // Marking unread moves the cursor back before the latest message; marking read
  // moves it to the latest message. A thread already in the desired state is a no-op.
  if (unread) {
    if (thread.lastReadSeq < latestSeq) return;
    if (latestSeq < 0) return;
  } else if (thread.lastReadSeq >= latestSeq) {
    return;
  }
  const targetSeq = unread ? latestSeq - 1 : latestSeq;
  const result = await prisma.thread.updateMany({
    where: {
      id: target.threadId,
      spaceId: actor.spaceId,
      lastReadSeq: thread.lastReadSeq,
      nextMessageSeq: thread.nextMessageSeq,
    },
    data: { lastReadSeq: targetSeq },
  });
  if (result.count > 1) throw new IsolationError();
}
