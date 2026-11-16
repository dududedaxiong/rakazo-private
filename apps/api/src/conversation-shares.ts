import { createHash, randomBytes } from "node:crypto";
import type { SecretStore } from "@rakazo/adapter-kit";
import { forgetPageShareSecrets } from "@rakazo/adapters";
import type { Actor, ConversationShareSummary, SharedConversation } from "@rakazo/contracts";
import {
  conversationShareTokenFromSlug,
  conversationShareUrl,
  SHARE_DEFAULT_EXPIRY_DAYS,
  SharedConversationSchema,
} from "@rakazo/contracts";
import { buildSharedConversation } from "@rakazo/core";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { IsolationError, runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { loadAllMessages } from "./thread-message-pages.js";
import { resolveThreadTarget } from "./thread-target.js";

const CONVERSATION_SHARE_SECRET_KIND = "conversation_share";
const SHARE_MESSAGE_PAGE_SIZE = 500;

type ShareDeps = {
  prisma: PrismaClient;
  secrets: SecretStore;
  webOrigin: string;
};

const shareSelect = {
  id: true,
  title: true,
  secretId: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.ConversationShareSelect;

type ShareRow = Prisma.ConversationShareGetPayload<{ select: typeof shareSelect }>;

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Everything but the link. */
function shareSummaryBase(row: ShareRow): Omit<ConversationShareSummary, "shareUrl"> {
  return {
    id: row.id,
    title: row.title,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The link for a row whose token is already in hand (creation). */
function shareSummary(webOrigin: string, row: ShareRow, token: string): ConversationShareSummary {
  return {
    ...shareSummaryBase(row),
    shareUrl: conversationShareUrl(webOrigin, row.title, token),
  };
}

/**
 * The link for a stored row, by unsealing its token. Null when the token
 * cannot be read: the share still exists, its link just cannot be copied.
 */
async function shareSummaryFor(deps: ShareDeps, row: ShareRow): Promise<ConversationShareSummary> {
  if (!row.secretId) return { ...shareSummaryBase(row), shareUrl: null };
  try {
    const secret = await deps.prisma.secret.findUnique({
      where: { id: row.secretId },
      select: { id: true, ciphertext: true },
    });
    if (!secret) return { ...shareSummaryBase(row), shareUrl: null };
    const token = await deps.secrets.load(secret.ciphertext, { recordId: secret.id });
    return shareSummary(deps.webOrigin, row, token);
  } catch (error) {
    getLogger().error("conversation share token load", error);
    return { ...shareSummaryBase(row), shareUrl: null };
  }
}

export async function createConversationShare(
  deps: ShareDeps,
  actor: Actor,
  input: { botId?: string; groupId?: string; expiresInDays?: 1 | 7 | 30 | 365 | null },
  signal: AbortSignal,
): Promise<ConversationShareSummary> {
  const target = await resolveThreadTarget(deps.prisma, actor, input);
  const title = target.kind === "bot" ? target.bot.name : target.groupName;
  const messages = await loadAllMessages(deps.prisma, target.threadId, SHARE_MESSAGE_PAGE_SIZE);
  const snapshot = buildSharedConversation({
    title,
    botName: title,
    messages,
    totalMessages: messages.length,
    createdAt: new Date(),
  });
  const days =
    input.expiresInDays === null ? null : (input.expiresInDays ?? SHARE_DEFAULT_EXPIRY_DAYS);
  const expiresAt = days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString("base64url");
  const stored = await deps.secrets.put(token, {
    operationId: `conversation-share:${target.threadId}`,
    traceId: `conversation-share:${target.threadId}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal,
  });
  try {
    const row = await deps.prisma.$transaction(async (tx) => {
      // Rolling back drops the secret with the failed create.
      await tx.secret.create({
        data: {
          id: stored.id,
          userId: actor.userId,
          spaceId: actor.spaceId,
          kind: CONVERSATION_SHARE_SECRET_KIND,
          ciphertext: stored.ciphertext,
        },
      });
      return tx.conversationShare.create({
        data: {
          threadId: target.threadId,
          title,
          snapshot,
          tokenHash: hashShareToken(token),
          secretId: stored.id,
          expiresAt,
        },
        select: shareSelect,
      });
    });
    return shareSummary(deps.webOrigin, row, token);
  } catch (error) {
    // The row did not take the token; drop the sealed copy so it never opens a link.
    await forgetPageShareSecrets(deps.secrets, [stored]);
    throw error;
  }
}

export async function listConversationShares(
  deps: ShareDeps,
  actor: Actor,
  input: { botId?: string; groupId?: string },
): Promise<{ items: ConversationShareSummary[] }> {
  const target = await resolveThreadTarget(deps.prisma, actor, input);
  const rows = await deps.prisma.conversationShare.findMany({
    where: { threadId: target.threadId },
    orderBy: { createdAt: "desc" },
    select: shareSelect,
  });
  return { items: await Promise.all(rows.map((row) => shareSummaryFor(deps, row))) };
}

async function requireShare(
  prisma: PrismaClient,
  actor: Actor,
  shareId: string,
): Promise<ShareRow & { threadId: string }> {
  const row = await prisma.conversationShare.findUnique({
    where: { id: shareId },
    select: { ...shareSelect, threadId: true },
  });
  if (!row) throw new IsolationError();
  const thread = await prisma.thread.findUnique({
    where: { id: row.threadId },
    select: { botId: true, groupId: true },
  });
  if (!thread || (!thread.botId && !thread.groupId)) throw new IsolationError();
  // Ownership runs through the thread: a share id alone opens nothing.
  await resolveThreadTarget(prisma, actor, {
    botId: thread.botId ?? undefined,
    groupId: thread.groupId ?? undefined,
  });
  return row;
}

export async function revokeConversationShare(
  deps: ShareDeps,
  actor: Actor,
  shareId: string,
): Promise<ConversationShareSummary> {
  const row = await requireShare(deps.prisma, actor, shareId);
  const updated = await deps.prisma.conversationShare.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
    select: shareSelect,
  });
  return shareSummaryFor(deps, updated);
}

export async function restoreConversationShare(
  deps: ShareDeps,
  actor: Actor,
  shareId: string,
): Promise<ConversationShareSummary> {
  const row = await requireShare(deps.prisma, actor, shareId);
  const updated = await deps.prisma.conversationShare.update({
    where: { id: row.id },
    data: { revokedAt: null },
    select: shareSelect,
  });
  return shareSummaryFor(deps, updated);
}

/** The redacted snapshot behind a link, or null for any token that does not open one. */
export async function readSharedConversation(
  prisma: PrismaClient,
  token: string,
): Promise<SharedConversation | null> {
  if (conversationShareTokenFromSlug(token) !== token) return null;
  const row = await runAsSystem("conversation share link", () =>
    prisma.conversationShare.findUnique({
      where: { tokenHash: hashShareToken(token) },
      select: { snapshot: true, expiresAt: true, revokedAt: true, secretId: true },
    }),
  );
  // A link lives only while its sealed token does, whatever removed the token.
  if (!row || row.revokedAt || !row.secretId) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  const parsed = SharedConversationSchema.safeParse(row.snapshot);
  return parsed.success ? parsed.data : null;
}
