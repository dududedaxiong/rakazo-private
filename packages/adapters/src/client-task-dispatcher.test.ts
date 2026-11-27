import type { RealtimeFanout } from "@rakazo_mickvvw/adapter-kit";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { describe, expect, it, vi } from "vitest";
import { ClientTaskDispatcher, ClientTaskFallbackError } from "./client-task-dispatcher.js";
import { InMemoryRealtimeFanout } from "./realtime.js";

interface TaskRow {
  id: string;
  userId: string;
  spaceId: string;
  botId: string;
  runId: string;
  kind: string;
  url: string;
  status: string;
  result?: unknown;
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date | null;
}

const NOW = new Date("2026-11-27T07:00:00.000Z");
const PUBLIC_URL = "https://93.184.216.34/page";

/** In-memory stand-in for the delegates the dispatcher touches. */
function fakePrisma() {
  const tasks: TaskRow[] = [];
  const presences = new Map<string, Date>();
  let preference: boolean | null = true;
  let idSeq = 0;
  const prisma = {
    clientTaskPreference: {
      findUnique: vi.fn(async () =>
        preference === null ? null : { localTrafficEnabled: preference },
      ),
    },
    clientPresence: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const expiresAt = presences.get(where.userId);
        return expiresAt ? { expiresAt } : null;
      }),
    },
    clientTask: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const statuses = (where.status as { in?: string[] } | undefined)?.in;
        const createdAt = (where.createdAt as { gte?: Date } | undefined)?.gte;
        return tasks.filter((task) => {
          if (where.userId !== undefined && task.userId !== where.userId) return false;
          if (statuses !== undefined && !statuses.includes(task.status)) return false;
          if (createdAt !== undefined && !(task.createdAt >= createdAt)) return false;
          return true;
        }).length;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `task-${++idSeq}`,
          ...data,
          createdAt: NOW,
          result: undefined,
          completedAt: null,
        } as unknown as TaskRow;
        tasks.push(row);
        return { id: row.id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = tasks.find((task) => task.id === where.id);
        return row ? { status: row.status, result: row.result ?? null } : null;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const task of tasks) {
            if (where.id !== undefined && task.id !== where.id) continue;
            if (where.status !== undefined && task.status !== where.status) continue;
            Object.assign(task, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
  } as unknown as PrismaClient;
  return {
    prisma,
    tasks,
    presences,
    setPreference: (value: boolean | null) => {
      preference = value;
    },
  };
}

function setup(realtime?: RealtimeFanout) {
  const fake = fakePrisma();
  fake.presences.set("user-1", new Date(NOW.getTime() + 60_000));
  const dispatcher = new ClientTaskDispatcher({
    prisma: fake.prisma,
    realtime,
    now: () => NOW,
  });
  const input = {
    userId: "user-1",
    spaceId: "space-1",
    botId: "bot-1",
    runId: "run-1",
    url: PUBLIC_URL,
  };
  return { ...fake, dispatcher, input };
}

async function expectFallback(promise: Promise<unknown>, reason: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ClientTaskFallbackError);
  expect((caught as ClientTaskFallbackError).name).toBe("ClientTaskFallback");
  expect((caught as ClientTaskFallbackError).reason).toBe(reason);
  expect((caught as Error).message).toContain(reason);
}

describe("ClientTaskDispatcher.fetchPage", () => {
  it("dispatches a pending task, signals the phone, and returns its result", async () => {
    const realtime = new InMemoryRealtimeFanout();
    const dispatched: string[] = [];
    await realtime.subscribe("client-task:user-1", (payload) => dispatched.push(payload));
    const { dispatcher, input, tasks } = setup(realtime);
    const fetching = dispatcher.fetchPage({ ...input, timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task.status).toBe("pending");
    expect(task.url).toBe("https://93.184.216.34/page");
    expect(task.expiresAt).toEqual(new Date(NOW.getTime() + 5_000));
    expect(dispatched).toEqual([task.id]);
    task.status = "completed";
    task.result = { url: PUBLIC_URL, title: "Example", text: "hello", truncated: false };
    await realtime.publish(`client-task-result:${task.id}`, task.id);
    await expect(fetching).resolves.toEqual({
      url: PUBLIC_URL,
      title: "Example",
      text: "hello",
      truncated: false,
    });
  });

  it("returns the result by polling when there is no fanout", async () => {
    const { dispatcher, input, tasks } = setup(undefined);
    const fetching = dispatcher.fetchPage({ ...input, timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const task = tasks[0]!;
    task.status = "completed";
    task.result = { url: PUBLIC_URL, title: "Example", text: "hello", truncated: true };
    await expect(fetching).resolves.toEqual({
      url: PUBLIC_URL,
      title: "Example",
      text: "hello",
      truncated: true,
    });
  });

  it("throws disabled when the switch is off or never set", async () => {
    const offline = setup(new InMemoryRealtimeFanout());
    offline.setPreference(false);
    await expectFallback(offline.dispatcher.fetchPage(offline.input), "disabled");
    const unset = setup(new InMemoryRealtimeFanout());
    unset.setPreference(null);
    await expectFallback(unset.dispatcher.fetchPage(unset.input), "disabled");
  });

  it("throws offline when presence is stale or missing", async () => {
    const stale = setup(new InMemoryRealtimeFanout());
    stale.presences.set("user-1", new Date(NOW.getTime() - 1_000));
    await expectFallback(stale.dispatcher.fetchPage(stale.input), "offline");
    const missing = setup(new InMemoryRealtimeFanout());
    missing.presences.delete("user-1");
    await expectFallback(missing.dispatcher.fetchPage(missing.input), "offline");
  });

  it("throws ssrf-denied for http, userinfo, private, loopback and metadata URLs", async () => {
    const { dispatcher, input } = setup(new InMemoryRealtimeFanout());
    for (const url of [
      "http://93.184.216.34/page",
      "https://user:pass@93.184.216.34/",
      "https://10.0.0.5/",
      "https://172.16.4.4/",
      "https://192.168.1.1/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/",
      "https://metadata.google.internal/",
      "not-a-url",
    ]) {
      await expectFallback(dispatcher.fetchPage({ ...input, url }), "ssrf-denied");
    }
  });

  it("throws busy while another task is in flight", async () => {
    const { dispatcher, input, tasks } = setup(new InMemoryRealtimeFanout());
    tasks.push({
      id: "task-old",
      userId: "user-1",
      spaceId: "space-1",
      botId: "bot-1",
      runId: "run-0",
      kind: "fetch",
      url: PUBLIC_URL,
      status: "pending",
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30_000),
    });
    await expectFallback(dispatcher.fetchPage(input), "busy");
    expect(tasks).toHaveLength(1);
  });

  it("throws rate-limited after ten dispatches in an hour", async () => {
    const { dispatcher, input, tasks } = setup(new InMemoryRealtimeFanout());
    for (let index = 0; index < 10; index += 1) {
      tasks.push({
        id: `task-${index}`,
        userId: "user-1",
        spaceId: "space-1",
        botId: "bot-1",
        runId: `run-${index}`,
        kind: "fetch",
        url: PUBLIC_URL,
        status: "completed",
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 30_000),
      });
    }
    await expectFallback(dispatcher.fetchPage(input), "rate-limited");
    expect(tasks).toHaveLength(10);
  });

  it("throws timeout and expires the row when the phone never answers", async () => {
    const { dispatcher, input, tasks } = setup(new InMemoryRealtimeFanout());
    await expectFallback(dispatcher.fetchPage({ ...input, timeoutMs: 50 }), "timeout");
    expect(tasks[0]!.status).toBe("expired");
    expect(tasks[0]!.completedAt).toBeInstanceOf(Date);
  });

  it("throws declined when the phone declines", async () => {
    const realtime = new InMemoryRealtimeFanout();
    const { dispatcher, input, tasks } = setup(realtime);
    const fetching = dispatcher.fetchPage({ ...input, timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const task = tasks[0]!;
    task.status = "declined";
    await realtime.publish(`client-task-result:${task.id}`, task.id);
    await expectFallback(fetching, "declined");
  });

  it("throws failed with the phone's error when the fetch fails", async () => {
    const realtime = new InMemoryRealtimeFanout();
    const { dispatcher, input, tasks } = setup(realtime);
    const fetching = dispatcher.fetchPage({ ...input, timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const task = tasks[0]!;
    task.status = "failed";
    task.result = { url: PUBLIC_URL, title: "", text: "", truncated: false, error: "load failed" };
    await realtime.publish(`client-task-result:${task.id}`, task.id);
    let caught: unknown;
    try {
      await fetching;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClientTaskFallbackError);
    expect((caught as ClientTaskFallbackError).reason).toBe("failed");
    expect((caught as Error).message).toContain("load failed");
  });

  it("does not insert a task when the checks refuse the dispatch", async () => {
    const { dispatcher, input, tasks } = setup(new InMemoryRealtimeFanout());
    await expectFallback(
      dispatcher.fetchPage({ ...input, url: "https://10.0.0.5/" }),
      "ssrf-denied",
    );
    expect(tasks).toHaveLength(0);
  });
});
