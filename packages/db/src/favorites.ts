import type { Actor, MessageFavorite } from "@rakazo/contracts";
import type { MessageFavorite as MessageFavoriteRow, PrismaClient } from "./client.js";

export function mapMessageFavorite(row: MessageFavoriteRow): MessageFavorite {
  return {
    id: row.id,
    botId: row.botId,
    messageId: row.messageId,
    snippet: row.snippet,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

type FavoriteItem = { messageId: string; snippet: string; text?: string };

function scope(actor: Actor) {
  return { userId: actor.userId, spaceId: actor.spaceId };
}

/** The actor's favorites, newest first; pass a bot to scope them to one thread. */
export async function listFavorites(
  prisma: PrismaClient,
  actor: Actor,
  botId?: string,
): Promise<MessageFavorite[]> {
  const rows = await prisma.messageFavorite.findMany({
    where: { ...scope(actor), ...(botId ? { botId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapMessageFavorite);
}

/**
 * Saves one favorite, or refreshes the snippet of one already saved. The
 * full text is only replaced when the caller stored it; an older favorite
 * without text never clears a stored one.
 */
export async function addFavorite(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId: string } & FavoriteItem,
): Promise<MessageFavorite> {
  const row = await prisma.messageFavorite.upsert({
    where: {
      userId_spaceId_botId_messageId: {
        ...scope(actor),
        botId: input.botId,
        messageId: input.messageId,
      },
    },
    create: {
      ...scope(actor),
      botId: input.botId,
      messageId: input.messageId,
      snippet: input.snippet,
      text: input.text ?? null,
    },
    update: {
      snippet: input.snippet,
      ...(input.text !== undefined ? { text: input.text } : {}),
    },
  });
  return mapMessageFavorite(row);
}

/** Drops one favorite; removing one that is not saved is a no-op. */
export async function removeFavorite(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId: string; messageId: string },
): Promise<void> {
  await prisma.messageFavorite.deleteMany({
    where: { ...scope(actor), botId: input.botId, messageId: input.messageId },
  });
}

/**
 * Merges a device's local favorites onto the server and returns the bot's
 * full list afterwards, so the device ends up holding the union of every
 * device's favorites. Nothing is deleted here; removals go through
 * `removeFavorite`.
 */
export async function syncFavorites(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId: string; favorites: FavoriteItem[] },
): Promise<MessageFavorite[]> {
  await prisma.$transaction(
    input.favorites.map((item) =>
      prisma.messageFavorite.upsert({
        where: {
          userId_spaceId_botId_messageId: {
            ...scope(actor),
            botId: input.botId,
            messageId: item.messageId,
          },
        },
        create: {
          ...scope(actor),
          botId: input.botId,
          messageId: item.messageId,
          snippet: item.snippet,
          text: item.text ?? null,
        },
        update: {
          snippet: item.snippet,
          ...(item.text !== undefined ? { text: item.text } : {}),
        },
      }),
    ),
  );
  return listFavorites(prisma, actor, input.botId);
}
