import {
  CLIENT_TASK_PRESENCE_REFRESH_MS,
  completeClientTask,
  followClientTasks,
  removeClientPresence,
  touchClientPresence,
} from "@rakazo_mickvvw/db";
import type { RouterContext } from "./context.js";
import { HEARTBEAT, withHeartbeats } from "./shared.js";

export function clientTasksRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    clientTasks: {
      subscribe: authed.clientTasks.subscribe.handler(async function* ({ context }) {
        const { userId } = context.actor;
        // Presence is the live subscribe connection itself: register on
        // connect, refresh while the stream is open, remove on disconnect.
        // A presence row that goes stale means the phone is gone, so the
        // dispatcher falls back to the server browser instead of waiting.
        await touchClientPresence(deps.prisma, userId);
        const refresh = setInterval(() => {
          if (context.signal?.aborted) return;
          void touchClientPresence(deps.prisma, userId).catch(() => undefined);
        }, CLIENT_TASK_PRESENCE_REFRESH_MS);
        refresh.unref?.();
        try {
          const tasks = withHeartbeats(context, (signal) =>
            followClientTasks(deps.prisma, userId, deps.realtime, signal),
          );
          for await (const next of tasks) {
            if (next === HEARTBEAT) {
              yield { type: "heartbeat" as const };
              continue;
            }
            yield {
              type: "client.task.requested" as const,
              taskId: next.id,
              url: next.url,
              kind: "fetch" as const,
              expiresAt: next.expiresAt.toISOString(),
            };
          }
        } finally {
          clearInterval(refresh);
          await removeClientPresence(deps.prisma, userId);
        }
      }),
      complete: authed.clientTasks.complete.handler(async ({ context, input }) => {
        // A late result for a row that is no longer pending is a silent
        // no-op inside completeClientTask; only the owner may complete it.
        await completeClientTask(
          deps.prisma,
          input.taskId,
          context.actor.userId,
          input.status,
          input.result ?? null,
          deps.realtime,
        );
        return { ok: true as const };
      }),
      setPreference: authed.clientTasks.setPreference.handler(async ({ context, input }) => {
        const preference = await deps.prisma.clientTaskPreference.upsert({
          where: { userId: context.actor.userId },
          create: { userId: context.actor.userId, localTrafficEnabled: input.enabled },
          update: { localTrafficEnabled: input.enabled },
        });
        return { ok: true as const, localTrafficEnabled: preference.localTrafficEnabled };
      }),
    },
  };
}
