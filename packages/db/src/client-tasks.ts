import type { RealtimeFanout } from "@rakazo_mickvvw/adapter-kit";
import type { Prisma, PrismaClient } from "./client.js";
import { ChangeLatch } from "./event-stream.js";

/** A presence row older than this is a dead subscribe stream, not a live phone. */
export const CLIENT_TASK_PRESENCE_TTL_MS = 60_000;
/** How often a live `clientTasks/subscribe` stream refreshes its presence row. */
export const CLIENT_TASK_PRESENCE_REFRESH_MS = 20_000;
/** Without a fanout signal, re-read pending rows this often so a missed publish still lands. */
const POLL_ONLY_CATCH_UP_MS = 1_000;
/** With a fanout signal, a periodic re-read covers a missed publish. */
const PUSH_CATCH_UP_MS = 30_000;

/** Signal-only topic: the payload carries just the task id, never page content. */
export function clientTaskTopic(userId: string): string {
  return `client-task:${userId}`;
}

/** Signal-only topic a completion wakes: the payload carries just the task id. */
export function clientTaskResultTopic(taskId: string): string {
  return `client-task-result:${taskId}`;
}

/** A pending fetch the phone has not picked up yet. */
export interface PendingClientTask {
  id: string;
  url: string;
  kind: string;
  expiresAt: Date;
}

/** The phone's `clientTasks/subscribe` connection is still alive. */
export async function isClientPresent(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const presence = await prisma.clientPresence.findUnique({
    where: { userId },
    select: { expiresAt: true },
  });
  return Boolean(presence && presence.expiresAt > now);
}

/** Records (or refreshes) the phone's live subscribe connection. */
export async function touchClientPresence(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<void> {
  await prisma.clientPresence.upsert({
    where: { userId },
    create: {
      userId,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + CLIENT_TASK_PRESENCE_TTL_MS),
    },
    update: {
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + CLIENT_TASK_PRESENCE_TTL_MS),
    },
  });
}

/** Forgets the phone's subscribe connection, e.g. when its stream closes. */
export async function removeClientPresence(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.clientPresence.deleteMany({ where: { userId } });
}

/** The user's pending, unexpired tasks, oldest first. */
export async function pendingClientTasks(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<PendingClientTask[]> {
  const tasks = await prisma.clientTask.findMany({
    where: { userId, status: "pending", expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, kind: true, expiresAt: true },
  });
  return tasks;
}

/**
 * Yields each of the user's pending tasks once, as they are dispatched: an
 * initial re-read of the durable rows, then a fanout signal wakes the next
 * re-read, with a periodic re-read covering a missed publish. Modelled on
 * `followThreadEvents`; without a fanout it degrades to polling the rows.
 */
export async function* followClientTasks(
  prisma: PrismaClient,
  userId: string,
  realtime?: RealtimeFanout,
  signal?: AbortSignal,
): AsyncGenerator<PendingClientTask> {
  const seen = new Set<string>();
  const latch = new ChangeLatch();
  let subscribed = false;
  const unsubscribe = realtime
    ? await realtime
        .subscribe(clientTaskTopic(userId), () => latch.notify())
        .then((unsubscribe) => {
          subscribed = true;
          return unsubscribe;
        })
        .catch(() => async () => {})
    : async () => {};
  const catchUpMs = subscribed ? PUSH_CATCH_UP_MS : POLL_ONLY_CATCH_UP_MS;
  try {
    while (!signal?.aborted) {
      const observedGeneration = latch.generation;
      for (const task of await pendingClientTasks(prisma, userId)) {
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        yield task;
      }
      if (signal?.aborted) break;
      await latch.waitForChange(observedGeneration, catchUpMs, signal);
    }
  } finally {
    await unsubscribe();
  }
}

export type ClientTaskCompletionStatus = "completed" | "failed" | "declined";

/**
 * Marks a pending task with the phone's verdict. Completing a row that is no
 * longer pending is a silent no-op, so a late result never overwrites the
 * dispatcher's timeout. Only the task's owner may complete it. On completion
 * a signal (just the task id) wakes whoever is awaiting the result.
 */
export async function completeClientTask(
  prisma: PrismaClient,
  taskId: string,
  userId: string,
  status: ClientTaskCompletionStatus,
  result?: Record<string, unknown> | null,
  realtime?: RealtimeFanout,
): Promise<{ completed: boolean }> {
  const updated = await prisma.clientTask.updateMany({
    where: { id: taskId, userId, status: "pending" },
    data: {
      status,
      result: (result ?? null) as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
  if (updated.count !== 1) return { completed: false };
  await realtime?.publish(clientTaskResultTopic(taskId), taskId).catch(() => undefined);
  return { completed: true };
}
