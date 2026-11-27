import type { RealtimeFanout } from "@rakazo_mickvvw/adapter-kit";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  CLIENT_TASK_PRESENCE_TTL_MS,
  completeClientTask,
  followClientTasks,
  isClientPresent,
  pendingClientTasks,
  removeClientPresence,
  touchClientPresence,
} from "./client-tasks.js";

interface TaskRow {
  id: string;
  userId: string;
  status: string;
  url: string;
  kind: string;
  expiresAt: Date;
  createdAt: Date;
  result?: unknown;
  completedAt?: Date | null;
}

/** Minimal in-memory fanout; the real one lives in adapters, which db cannot import. */
class TestFanout implements RealtimeFanout {
  private readonly subscribers = new Map<string, Set<(payload: string) => void>>();

  describe() {
    return {
      id: "test",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { distributed: false, push: true },
    };
  }

  async publish(topic: string, payload: string): Promise<void> {
    for (const subscriber of [...(this.subscribers.get(topic) ?? [])]) subscriber(payload);
  }

  async subscribe(
    topic: string,
    onMessage: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    const subscribers = this.subscribers.get(topic) ?? new Set<(payload: string) => void>();
    subscribers.add(onMessage);
    this.subscribers.set(topic, subscribers);
    return async () => {
      subscribers.delete(onMessage);
    };
  }

  async close(): Promise<void> {
    this.subscribers.clear();
  }
}

/** In-memory stand-in for the three delegates the task channel touches. */
function fakePrisma() {
  const tasks: TaskRow[] = [];
  const presences = new Map<string, { expiresAt: Date; lastSeenAt: Date }>();
  const prisma = {
    clientTask: {
      findMany: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) =>
        tasks
          .filter((task) => {
            if (where.userId !== undefined && task.userId !== where.userId) return false;
            if (where.status !== undefined && task.status !== where.status) return false;
            const expiresAt = (where.expiresAt as { gt?: Date } | undefined)?.gt;
            if (expiresAt !== undefined && !(task.expiresAt > expiresAt)) return false;
            return true;
          })
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((task) =>
            select
              ? Object.fromEntries(
                  Object.entries(select)
                    .filter(([, selected]) => selected)
                    .map(([key]) => [key, task[key as keyof TaskRow]]),
                )
              : task,
          ),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const task of tasks) {
          if (where.id !== undefined && task.id !== where.id) continue;
          if (where.userId !== undefined && task.userId !== where.userId) continue;
          if (where.status !== undefined && task.status !== where.status) continue;
          Object.assign(task, data);
          count += 1;
        }
        return { count };
      },
    },
    clientPresence: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        presences.get(where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: { userId: string; lastSeenAt: Date; expiresAt: Date };
        update: { lastSeenAt: Date; expiresAt: Date };
      }) => {
        const existing = presences.get(where.userId);
        if (existing) Object.assign(existing, update);
        else
          presences.set(where.userId, {
            lastSeenAt: create.lastSeenAt,
            expiresAt: create.expiresAt,
          });
        return presences.get(where.userId);
      },
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        const deleted = presences.delete(where.userId);
        return { count: deleted ? 1 : 0 };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, tasks, presences };
}

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    userId: "user-1",
    status: "pending",
    url: "https://example.com/",
    kind: "fetch",
    expiresAt: new Date(Date.now() + 30_000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("client task presence", () => {
  it("is present only while the row is fresh", async () => {
    const { prisma, presences } = fakePrisma();
    expect(await isClientPresent(prisma, "user-1")).toBe(false);
    presences.set("user-1", {
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 1_000),
    });
    expect(await isClientPresent(prisma, "user-1")).toBe(true);
    presences.set("user-1", {
      lastSeenAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect(await isClientPresent(prisma, "user-1")).toBe(false);
  });

  it("touch refreshes the expiry and remove forgets the row", async () => {
    const { prisma, presences } = fakePrisma();
    const before = Date.now();
    await touchClientPresence(prisma, "user-1");
    const row = presences.get("user-1");
    expect(row).toBeDefined();
    expect(row!.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
      CLIENT_TASK_PRESENCE_TTL_MS - 1_000,
    );
    await removeClientPresence(prisma, "user-1");
    expect(presences.has("user-1")).toBe(false);
  });
});

describe("pendingClientTasks", () => {
  it("lists only the user's pending, unexpired tasks", async () => {
    const { prisma, tasks } = fakePrisma();
    tasks.push(
      task(),
      task({ id: "task-2", status: "completed" }),
      task({ id: "task-3", userId: "user-2" }),
      task({ id: "task-4", expiresAt: new Date(Date.now() - 1_000) }),
    );
    expect(await pendingClientTasks(prisma, "user-1")).toEqual([
      { id: "task-1", url: "https://example.com/", kind: "fetch", expiresAt: tasks[0]!.expiresAt },
    ]);
  });
});

describe("followClientTasks", () => {
  it("yields pending rows, then rows dispatched after a fanout signal", async () => {
    const { prisma, tasks } = fakePrisma();
    const realtime: RealtimeFanout = new TestFanout();
    tasks.push(task());
    const controller = new AbortController();
    const seen: string[] = [];
    const following = (async () => {
      for await (const next of followClientTasks(prisma, "user-1", realtime, controller.signal)) {
        seen.push(next.id);
        if (seen.length === 2) controller.abort();
      }
    })();
    // Give the generator its first re-read, then dispatch a second task.
    await new Promise((resolve) => setTimeout(resolve, 50));
    tasks.push(task({ id: "task-2" }));
    await realtime.publish("client-task:user-1", "task-2");
    await following;
    expect(seen).toEqual(["task-1", "task-2"]);
  });

  it("never yields the same task twice", async () => {
    const { prisma, tasks } = fakePrisma();
    tasks.push(task());
    const controller = new AbortController();
    const seen: string[] = [];
    const following = (async () => {
      for await (const next of followClientTasks(prisma, "user-1", undefined, controller.signal)) {
        seen.push(next.id);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await following;
    expect(seen).toEqual(["task-1"]);
  });
});

describe("completeClientTask", () => {
  it("completes a pending row and wakes the result topic", async () => {
    const { prisma, tasks } = fakePrisma();
    const realtime = new TestFanout();
    const signals: string[] = [];
    await realtime.subscribe("client-task-result:task-1", (payload) => signals.push(payload));
    tasks.push(task());
    const result = { url: "https://example.com/", title: "Example", text: "hi", truncated: false };
    expect(
      await completeClientTask(prisma, "task-1", "user-1", "completed", result, realtime),
    ).toEqual({
      completed: true,
    });
    expect(tasks[0]!.status).toBe("completed");
    expect(tasks[0]!.result).toEqual(result);
    expect(tasks[0]!.completedAt).toBeInstanceOf(Date);
    expect(signals).toEqual(["task-1"]);
  });

  it("ignores a late result for a row that is no longer pending", async () => {
    const { prisma, tasks } = fakePrisma();
    const realtime = new TestFanout();
    const signals: string[] = [];
    await realtime.subscribe("client-task-result:task-1", (payload) => signals.push(payload));
    tasks.push(task({ status: "expired" }));
    expect(
      await completeClientTask(prisma, "task-1", "user-1", "completed", null, realtime),
    ).toEqual({ completed: false });
    expect(tasks[0]!.status).toBe("expired");
    expect(signals).toEqual([]);
  });

  it("ignores a completion from someone other than the task owner", async () => {
    const { prisma, tasks } = fakePrisma();
    tasks.push(task());
    expect(
      await completeClientTask(prisma, "task-1", "user-2", "completed", null, undefined),
    ).toEqual({ completed: false });
    expect(tasks[0]!.status).toBe("pending");
  });

  it("records a decline", async () => {
    const { prisma, tasks } = fakePrisma();
    tasks.push(task());
    expect(
      await completeClientTask(prisma, "task-1", "user-1", "declined", null, undefined),
    ).toEqual({
      completed: true,
    });
    expect(tasks[0]!.status).toBe("declined");
  });
});
