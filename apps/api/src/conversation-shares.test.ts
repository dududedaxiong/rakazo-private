import { createHash } from "node:crypto";
import type { Actor, SharedConversation } from "@rakazo_mickvvw/contracts";
import { IsolationError } from "@rakazo_mickvvw/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConversationShare,
  deleteConversationShare,
  listConversationShares,
  readSharedConversation,
  restoreConversationShare,
  revokeConversationShare,
} from "./conversation-shares.js";
import { loadAllMessages } from "./thread-message-pages.js";
import { resolveThreadTarget } from "./thread-target.js";

vi.mock("./thread-target.js", () => ({ resolveThreadTarget: vi.fn() }));
vi.mock("./thread-message-pages.js", () => ({ loadAllMessages: vi.fn() }));

const actor = { spaceId: "space-1", userId: "user-1" } as Actor;
const token43 = "a".repeat(43);
const now = new Date("2026-11-16T14:02:11+08:00");

function messages() {
  return [
    {
      id: "m_1",
      threadId: "thread-1",
      seq: 1,
      role: "user",
      blocks: [{ kind: "text", text: "my key is sk-proj-abcdefghij1234567890" }],
      createdAt: now.toISOString(),
    },
    {
      id: "m_2",
      threadId: "thread-1",
      seq: 2,
      role: "bot",
      blocks: [{ kind: "text", text: "Here is the plan" }],
      createdAt: new Date(now.getTime() + 60_000).toISOString(),
    },
  ];
}

function snapshot(): SharedConversation {
  return {
    v: 2,
    kind: "conversation",
    schema: 1,
    title: "Helper",
    start: now.toISOString(),
    created: now.toISOString(),
    entries: [{ type: "user", t: 0, text: "hi" }],
  };
}

describe("conversation shares", () => {
  const conversationShareCreate = vi.fn();
  const conversationShareFindMany = vi.fn();
  const conversationShareFindUnique = vi.fn();
  const conversationShareUpdate = vi.fn();
  const conversationShareDelete = vi.fn();
  const secretCreate = vi.fn();
  const secretFindUnique = vi.fn();
  const secretDeleteMany = vi.fn();
  const threadFindUnique = vi.fn();
  let capturedToken = "";
  const secretsPut = vi.fn(async (plaintext: string) => {
    capturedToken = plaintext;
    return { id: "secret-1", ref: "sealed", ciphertext: "sealed" };
  });
  const secretsLoad = vi.fn(async () => capturedToken);
  const secretsDelete = vi.fn(async () => undefined);
  const fakePrisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        secret: {
          create: secretCreate,
          findUnique: secretFindUnique,
          deleteMany: secretDeleteMany,
        },
        conversationShare: { create: conversationShareCreate, delete: conversationShareDelete },
      }),
    ),
    conversationShare: {
      create: conversationShareCreate,
      findMany: conversationShareFindMany,
      findUnique: conversationShareFindUnique,
      update: conversationShareUpdate,
    },
    secret: { create: secretCreate, findUnique: secretFindUnique },
    thread: { findUnique: threadFindUnique },
  };
  const deps = {
    prisma: fakePrisma,
    secrets: { put: secretsPut, load: secretsLoad, delete: secretsDelete },
    webOrigin: "https://web.example",
  } as unknown as Parameters<typeof createConversationShare>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    capturedToken = token43;
    vi.mocked(resolveThreadTarget).mockImplementation(async (_prisma, _actor, input) => {
      if (input.botId === "bot-9") throw new IsolationError();
      return {
        kind: "bot",
        botId: "bot-1",
        threadId: "thread-1",
        bot: { name: "Helper" },
      } as unknown as Awaited<ReturnType<typeof resolveThreadTarget>>;
    });
    vi.mocked(loadAllMessages).mockResolvedValue(messages() as never);
    secretFindUnique.mockResolvedValue({ id: "secret-1", ciphertext: "sealed" });
    threadFindUnique.mockResolvedValue({ botId: "bot-1", groupId: null });
  });

  it("creates a share from a redacted snapshot and seals its token", async () => {
    conversationShareCreate.mockResolvedValue({
      id: "share-1",
      title: "Helper",
      secretId: "secret-1",
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdAt: now,
    });
    const summary = await createConversationShare(
      deps,
      actor,
      { botId: "bot-1" },
      new AbortController().signal,
    );
    expect(summary.id).toBe("share-1");
    expect(summary.shareUrl).toMatch(/^https:\/\/web\.example\/s\/helper-[A-Za-z0-9_-]{43}$/);
    expect(capturedToken).toHaveLength(43);
    const created = conversationShareCreate.mock.calls[0]![0].data;
    expect(created.tokenHash).toBe(createHash("sha256").update(capturedToken).digest("hex"));
    expect(created.snapshot.entries[0].text).toBe("my key is [Redacted]");
    expect(secretCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "secret-1", kind: "conversation_share" }),
    });
  });

  it("creates a never-expiring share when asked", async () => {
    conversationShareCreate.mockResolvedValue({
      id: "share-2",
      title: "Helper",
      secretId: "secret-1",
      expiresAt: null,
      revokedAt: null,
      createdAt: now,
    });
    await createConversationShare(
      deps,
      actor,
      { botId: "bot-1", expiresInDays: null },
      new AbortController().signal,
    );
    expect(conversationShareCreate.mock.calls[0]![0].data.expiresAt).toBeNull();
  });

  it("creates a share expiring in a custom number of days", async () => {
    conversationShareCreate.mockResolvedValue({
      id: "share-3",
      title: "Helper",
      secretId: "secret-1",
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdAt: now,
    });
    const before = Date.now();
    await createConversationShare(
      deps,
      actor,
      { botId: "bot-1", expiresInDays: 90 },
      new AbortController().signal,
    );
    const after = Date.now();
    const created = conversationShareCreate.mock.calls[0]![0].data;
    const day = 24 * 60 * 60 * 1000;
    expect(created.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 90 * day);
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(after + 90 * day);
  });

  it("lists a thread's shares with their links", async () => {
    conversationShareFindMany.mockResolvedValue([
      {
        id: "share-1",
        title: "Helper",
        secretId: "secret-1",
        expiresAt: null,
        revokedAt: null,
        createdAt: now,
      },
    ]);
    const { items } = await listConversationShares(deps, actor, { botId: "bot-1" });
    expect(items).toHaveLength(1);
    expect(items[0]!.shareUrl).toMatch(/^https:\/\/web\.example\/s\/helper-/);
  });

  it("revokes and restores the same link", async () => {
    conversationShareFindUnique.mockResolvedValue({
      id: "share-1",
      title: "Helper",
      threadId: "thread-1",
      secretId: "secret-1",
      expiresAt: null,
      revokedAt: null,
      createdAt: now,
    });
    conversationShareUpdate.mockResolvedValueOnce({
      id: "share-1",
      title: "Helper",
      secretId: "secret-1",
      expiresAt: null,
      revokedAt: now,
      createdAt: now,
    });
    const revoked = await revokeConversationShare(deps, actor, "share-1");
    expect(revoked.revokedAt).toBe(now.toISOString());
    expect(conversationShareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
    );
    conversationShareUpdate.mockResolvedValueOnce({
      id: "share-1",
      title: "Helper",
      secretId: "secret-1",
      expiresAt: null,
      revokedAt: null,
      createdAt: now,
    });
    const restored = await restoreConversationShare(deps, actor, "share-1");
    expect(restored.revokedAt).toBeNull();
    expect(restored.shareUrl).toBe(revoked.shareUrl);
  });

  it("deletes a revoked share, its secret row, and its sealed token", async () => {
    conversationShareFindUnique.mockResolvedValue({
      id: "share-1",
      title: "Helper",
      threadId: "thread-1",
      secretId: "secret-1",
      expiresAt: null,
      revokedAt: now,
      createdAt: now,
    });
    expect(await deleteConversationShare(deps, actor, "share-1")).toEqual({ ok: true });
    expect(conversationShareDelete).toHaveBeenCalledWith({ where: { id: "share-1" } });
    expect(secretDeleteMany).toHaveBeenCalledWith({ where: { id: "secret-1" } });
    expect(secretsDelete).toHaveBeenCalledWith(
      "sealed",
      expect.objectContaining({ recordId: "secret-1" }),
    );
  });

  it("refuses a share whose thread belongs to someone else", async () => {
    conversationShareFindUnique.mockResolvedValue({
      id: "share-9",
      title: "Other",
      threadId: "thread-9",
      secretId: "secret-9",
      expiresAt: null,
      revokedAt: null,
      createdAt: now,
    });
    threadFindUnique.mockResolvedValue({ botId: "bot-9", groupId: null });
    await expect(revokeConversationShare(deps, actor, "share-9")).rejects.toThrow();
    await expect(deleteConversationShare(deps, actor, "share-9")).rejects.toThrow();
    expect(conversationShareDelete).not.toHaveBeenCalled();
  });

  it("reads a live share by token and refuses the rest", async () => {
    conversationShareFindUnique.mockResolvedValue({
      snapshot: snapshot(),
      expiresAt: null,
      revokedAt: null,
      secretId: "secret-1",
    });
    expect(await readSharedConversation(deps.prisma, token43)).toEqual(snapshot());
    expect(await readSharedConversation(deps.prisma, "short")).toBeNull();

    conversationShareFindUnique.mockResolvedValue({
      snapshot: snapshot(),
      expiresAt: null,
      revokedAt: now,
      secretId: "secret-1",
    });
    expect(await readSharedConversation(deps.prisma, token43)).toBeNull();

    conversationShareFindUnique.mockResolvedValue({
      snapshot: snapshot(),
      expiresAt: new Date(now.getTime() - 1000),
      revokedAt: null,
      secretId: "secret-1",
    });
    expect(await readSharedConversation(deps.prisma, token43)).toBeNull();

    conversationShareFindUnique.mockResolvedValue({
      snapshot: snapshot(),
      expiresAt: null,
      revokedAt: null,
      secretId: null,
    });
    expect(await readSharedConversation(deps.prisma, token43)).toBeNull();
  });
});
