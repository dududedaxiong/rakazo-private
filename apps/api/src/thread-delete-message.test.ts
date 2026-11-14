import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

function fixture({ messageInThread = true } = {}) {
  const actor = {
    userId: "user-1",
    spaceId: "space-1",
    email: "fixture@example.test",
    isDeploymentOwner: false,
  } satisfies Actor;
  const bot = {
    id: "bot-1",
    userId: actor.userId,
    spaceId: actor.spaceId,
    archivedAt: null,
    thread: { id: "thread-1" },
    computer: null,
  };
  const findBot = vi.fn(async ({ where }: { where: { id: string; spaceId: string } }) => {
    return where.id === bot.id && where.spaceId === bot.spaceId ? bot : null;
  });
  const findMessage = vi.fn(async ({ where }: { where: { id: string; threadId: string } }) => {
    return messageInThread && where.id === "message-1" && where.threadId === "thread-1"
      ? { id: "message-1" }
      : null;
  });
  const deleteFavorites = vi.fn(async () => ({ count: 2 }));
  const deleteMessage = vi.fn(async () => ({ id: "message-1" }));
  const prisma = {
    bot: { findFirst: findBot },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    spaceSettingOverride: { findUnique: vi.fn(async () => null) },
    userModelRoleChoice: { findMany: vi.fn(async () => []) },
    deploymentSettings: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
    spaceMember: { count: vi.fn(async () => 1) },
    message: { findFirst: findMessage, delete: deleteMessage },
    messageFavorite: { deleteMany: deleteFavorites },
    event: { findFirst: vi.fn(async () => null) },
    run: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    env: { webOrigin: "http://127.0.0.1", sandboxProvider: "fake", agentRuntime: "scripted" },
  } as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(proc: string, input: unknown, requestActor = actor) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/${proc}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor: requestActor } },
    );
    if (!response) throw new Error("no response");
    return { status: response.status, body: await response.json() };
  }
  return { actor, call, findMessage, deleteFavorites, deleteMessage };
}

describe("threads/deleteMessage", () => {
  it("deletes the message and both of its favorites", async () => {
    const { call, findMessage, deleteFavorites, deleteMessage } = fixture();
    const result = await call("threads/deleteMessage", {
      botId: "bot-1",
      messageId: "message-1",
    });
    expect(result.status).toBe(200);
    expect(result.body.json).toEqual({ ok: true });
    expect(findMessage).toHaveBeenCalledWith({
      where: { id: "message-1", threadId: "thread-1" },
      select: { id: true },
    });
    // Favorites keep the message id as a plain string, so the message favorite
    // and its `:translation` twin are removed explicitly.
    expect(deleteFavorites).toHaveBeenCalledWith({
      where: {
        spaceId: "space-1",
        messageId: { in: ["message-1", "message-1:translation"] },
      },
    });
    expect(deleteMessage).toHaveBeenCalledWith({ where: { id: "message-1" } });
  });

  it("reports a message that is not in the thread as not found", async () => {
    const { call, deleteFavorites, deleteMessage } = fixture({ messageInThread: false });
    const result = await call("threads/deleteMessage", {
      botId: "bot-1",
      messageId: "message-1",
    });
    expect(result.status).toBe(404);
    expect(deleteFavorites).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("keeps space isolation", async () => {
    const { actor, call, findMessage } = fixture();
    const result = await call(
      "threads/deleteMessage",
      { botId: "bot-1", messageId: "message-1" },
      { ...actor, spaceId: "other-space" },
    );
    expect(result.status).toBe(500);
    expect(findMessage).not.toHaveBeenCalled();
  });
});
