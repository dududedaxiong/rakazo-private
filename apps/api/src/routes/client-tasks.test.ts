import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo_mickvvw/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";
import { clientTasksRoutes } from "./client-tasks.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@rakazo.test",
  isDeploymentOwner: true,
};

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: {
  context: { actor: Actor; signal?: AbortSignal };
  input: unknown;
}) => Promise<unknown> | AsyncGenerator<unknown>;

function fakePrisma() {
  const tasks = new Map<string, Record<string, unknown>>();
  const presences = new Map<string, Record<string, unknown>>();
  const published: { topic: string; payload: string }[] = [];
  const prisma = {
    clientTask: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...tasks.values()]
          .filter((task) => {
            if (where.userId !== undefined && task.userId !== where.userId) return false;
            if (where.status !== undefined && task.status !== where.status) return false;
            const expiresAt = (where.expiresAt as { gt?: Date } | undefined)?.gt;
            if (expiresAt !== undefined && !((task.expiresAt as Date) > expiresAt)) return false;
            return true;
          })
          .map((task) => ({
            id: task.id,
            url: task.url,
            kind: task.kind,
            expiresAt: task.expiresAt,
          })),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const task of tasks.values()) {
            if (where.id !== undefined && task.id !== where.id) continue;
            if (where.userId !== undefined && task.userId !== where.userId) continue;
            if (where.status !== undefined && task.status !== where.status) continue;
            Object.assign(task, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
    clientPresence: {
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
        }) => {
          presences.set(where.userId, { ...create });
          return presences.get(where.userId);
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => ({
        count: presences.delete(where.userId) ? 1 : 0,
      })),
    },
    clientTaskPreference: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const row = { ...create, ...update, userId: where.userId };
          return row;
        },
      ),
    },
  };
  const realtime = {
    describe: () => ({
      id: "test",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { distributed: false, push: true },
    }),
    publish: vi.fn(async (topic: string, payload: string) => {
      published.push({ topic, payload });
    }),
    subscribe: vi.fn(async () => async () => {}),
    close: vi.fn(async () => {}),
  };
  return { prisma, tasks, presences, realtime, published };
}

/** The oRPC procedures, unwrapped so a test can call the handler directly. */
function setup() {
  const handler = (fn: (args: { context: { actor: Actor }; input: unknown }) => unknown) => fn;
  const authed = {
    clientTasks: Object.fromEntries(
      ["subscribe", "complete", "setPreference"].map((name) => [name, { handler }]),
    ),
  };
  const fake = fakePrisma();
  const ctx = {
    deps: { prisma: fake.prisma, realtime: fake.realtime },
    authed,
  };
  return { routes: clientTasksRoutes(ctx as never), ctx, ...fake };
}

describe("clientTasks routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribe streams the user's pending tasks and tracks presence while open", async () => {
    const { routes, prisma, tasks, presences } = setup();
    tasks.set("task-1", {
      id: "task-1",
      userId: "user-1",
      status: "pending",
      url: "https://example.com/",
      kind: "fetch",
      expiresAt: new Date(Date.now() + 30_000),
    });
    const controller = new AbortController();
    const stream = (await (routes.clientTasks.subscribe as unknown as Handler)({
      context: { actor, signal: controller.signal },
      input: {},
    })) as AsyncGenerator<Record<string, unknown>>;
    const first = await stream.next();
    expect(first.value).toEqual({
      type: "client.task.requested",
      taskId: "task-1",
      url: "https://example.com/",
      kind: "fetch",
      expiresAt: expect.any(String),
    });
    expect(presences.has("user-1")).toBe(true);
    controller.abort();
    await stream.return(undefined);
    expect(presences.has("user-1")).toBe(false);
    expect(prisma.clientPresence.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("complete marks the owner's pending task and wakes its result topic", async () => {
    const { routes, tasks, published } = setup();
    tasks.set("task-1", {
      id: "task-1",
      userId: "user-1",
      status: "pending",
      url: "https://example.com/",
      kind: "fetch",
      expiresAt: new Date(Date.now() + 30_000),
    });
    const result = { url: "https://example.com/", title: "Example", text: "hi", truncated: false };
    const completed = await (routes.clientTasks.complete as unknown as Handler)({
      context: { actor },
      input: { taskId: "task-1", status: "completed", result },
    });
    expect(completed).toEqual({ ok: true });
    expect(tasks.get("task-1")!.status).toBe("completed");
    expect(tasks.get("task-1")!.result).toEqual(result);
    expect(published).toEqual([{ topic: "client-task-result:task-1", payload: "task-1" }]);
  });

  it("complete from another user is a silent no-op", async () => {
    const { routes, tasks, published } = setup();
    tasks.set("task-1", {
      id: "task-1",
      userId: "user-1",
      status: "pending",
      url: "https://example.com/",
      kind: "fetch",
      expiresAt: new Date(Date.now() + 30_000),
    });
    const other: Actor = { ...actor, userId: "user-2" };
    const completed = await (routes.clientTasks.complete as unknown as Handler)({
      context: { actor: other },
      input: { taskId: "task-1", status: "completed" },
    });
    expect(completed).toEqual({ ok: true });
    expect(tasks.get("task-1")!.status).toBe("pending");
    expect(published).toEqual([]);
  });

  it("complete of a non-pending task is a silent no-op", async () => {
    const { routes, tasks, published } = setup();
    tasks.set("task-1", {
      id: "task-1",
      userId: "user-1",
      status: "expired",
      url: "https://example.com/",
      kind: "fetch",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const completed = await (routes.clientTasks.complete as unknown as Handler)({
      context: { actor },
      input: { taskId: "task-1", status: "completed" },
    });
    expect(completed).toEqual({ ok: true });
    expect(tasks.get("task-1")!.status).toBe("expired");
    expect(published).toEqual([]);
  });

  it("setPreference upserts the caller's switch", async () => {
    const { routes, prisma } = setup();
    const saved = await (routes.clientTasks.setPreference as unknown as Handler)({
      context: { actor },
      input: { enabled: true },
    });
    expect(saved).toEqual({ ok: true, localTrafficEnabled: true });
    expect(prisma.clientTaskPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", localTrafficEnabled: true },
      update: { localTrafficEnabled: true },
    });
  });

  it("requires a signed-in user", async () => {
    const client = createRouterClient(createRouter({} as unknown as RouterDeps), {
      context: { actor: null },
    });
    await expect(
      client.clientTasks.complete({ taskId: "task-1", status: "completed" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.clientTasks.setPreference({ enabled: true })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(client.clientTasks.subscribe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
