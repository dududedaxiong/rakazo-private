import { describe, expect, it, vi } from "vitest";
import { addFavorite, listFavorites, removeFavorite, syncFavorites } from "./favorites.js";

type Row = {
  id: string;
  userId: string;
  spaceId: string;
  botId: string;
  messageId: string;
  snippet: string;
  text: string | null;
  createdAt: Date;
};

const actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@example.com",
  isDeploymentOwner: false,
};

function fixture() {
  const rows: Row[] = [];
  let seq = 0;
  const prisma = {
    messageFavorite: {
      findMany: vi.fn(
        async ({ where }: { where: { userId: string; spaceId: string; botId?: string } }) =>
          rows
            .filter(
              (row) =>
                row.userId === where.userId &&
                row.spaceId === where.spaceId &&
                (!where.botId || row.botId === where.botId),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: {
            userId_spaceId_botId_messageId: {
              userId: string;
              spaceId: string;
              botId: string;
              messageId: string;
            };
          };
          create: Omit<Row, "id" | "createdAt">;
          update: Partial<Pick<Row, "snippet" | "text">>;
        }) => {
          const key = where.userId_spaceId_botId_messageId;
          const at = rows.findIndex(
            (row) =>
              row.userId === key.userId &&
              row.spaceId === key.spaceId &&
              row.botId === key.botId &&
              row.messageId === key.messageId,
          );
          if (at >= 0) {
            const next = { ...rows[at]!, ...update };
            rows[at] = next;
            return next;
          }
          // Each insert gets a strictly later timestamp, like a database
          // clock that never hands out the same millisecond twice; otherwise
          // two adds in one millisecond sort as ties and the newest-first
          // order is left to the sort's stability.
          const row: Row = { id: `fav-${++seq}`, createdAt: new Date(Date.now() + seq), ...create };
          rows.push(row);
          return row;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: Partial<Row> }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i]!;
          if (Object.entries(where).every(([field, value]) => row[field as keyof Row] === value)) {
            rows.splice(i, 1);
          }
        }
        return { count: before - rows.length };
      }),
    },
    $transaction: vi.fn(async (operations: Promise<Row>[]) => Promise.all(operations)),
  };
  return { prisma: prisma as never, rows };
}

describe("favorites", () => {
  it("lists the actor's favorites newest first, optionally for one bot", async () => {
    const { prisma } = fixture();
    await addFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-1", snippet: "one" });
    await addFavorite(prisma, actor, { botId: "bot-2", messageId: "msg-2", snippet: "two" });
    const all = await listFavorites(prisma, actor);
    expect(all.map((item) => item.messageId)).toEqual(["msg-2", "msg-1"]);
    expect(await listFavorites(prisma, actor, "bot-1")).toHaveLength(1);
  });

  it("never shows another user's favorites", async () => {
    const { prisma } = fixture();
    await addFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-1", snippet: "one" });
    const other = {
      userId: "user-2",
      spaceId: "space-1",
      email: "other@example.com",
      isDeploymentOwner: false,
    };
    expect(await listFavorites(prisma, other)).toEqual([]);
  });

  it("adding the same message twice keeps one row", async () => {
    const { prisma, rows } = fixture();
    await addFavorite(prisma, actor, {
      botId: "bot-1",
      messageId: "msg-1",
      snippet: "one",
      text: "full text",
    });
    await addFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-1", snippet: "one" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("full text");
  });

  it("a translation favorite is a separate row from the message itself", async () => {
    const { prisma } = fixture();
    await addFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-1", snippet: "one" });
    await addFavorite(prisma, actor, {
      botId: "bot-1",
      messageId: "msg-1:translation",
      snippet: "translated",
    });
    expect(await listFavorites(prisma, actor, "bot-1")).toHaveLength(2);
  });

  it("removing a favorite that is not saved is a no-op", async () => {
    const { prisma } = fixture();
    await addFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-1", snippet: "one" });
    await removeFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-9" });
    await removeFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-1" });
    expect(await listFavorites(prisma, actor)).toEqual([]);
  });

  it("sync merges a device's locals and returns the bot's full list", async () => {
    const { prisma } = fixture();
    await addFavorite(prisma, actor, { botId: "bot-1", messageId: "msg-web", snippet: "web" });
    const merged = await syncFavorites(prisma, actor, {
      botId: "bot-1",
      favorites: [{ messageId: "msg-mobile", snippet: "mobile", text: "mobile text" }],
    });
    expect(merged.map((item) => item.messageId).sort()).toEqual(["msg-mobile", "msg-web"]);
  });
});
