import { describe, expect, it, vi } from "vitest";
import {
  createPromptTemplate,
  listPromptTemplates,
  PromptTemplateNameConflictError,
  removePromptTemplate,
  restoreDefaultPromptTemplates,
  updatePromptTemplate,
  upsertPromptTemplate,
} from "./prompt-templates.js";
import { IsolationError } from "./scope.js";

type Row = {
  id: string;
  userId: string;
  name: string;
  content: string;
  isBuiltIn: boolean;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function fixture() {
  const rows: Row[] = [];
  const user = { promptTemplatesSeededAt: null as Date | null };
  const bots: Array<{ id: string; instructions: string; promptTemplateId: string | null }> = [];
  let seq = 0;
  const nextId = () => `tpl-${++seq}`;
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      updateMany: vi.fn(async () => {
        user.promptTemplatesSeededAt = new Date();
        return { count: 1 };
      }),
    },
    promptTemplate: {
      findMany: vi.fn(async () => [...rows]),
      findFirst: vi.fn(
        async ({ where }: { where: { userId: string; name: string; id?: { not: string } } }) =>
          rows.find(
            (row) =>
              row.userId === where.userId &&
              row.name === where.name &&
              (!where.id || row.id !== where.id.not),
          ) ?? null,
      ),
      create: vi.fn(
        async ({ data }: { data: { userId: string; name: string; content: string } }) => {
          const row: Row = {
            id: nextId(),
            ...data,
            isBuiltIn: false,
            sourceUrl: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rows.push(row);
          return row;
        },
      ),
      createMany: vi.fn(
        async ({
          data,
        }: {
          data: Array<{ userId: string; name: string; content: string; isBuiltIn: boolean }>;
        }) => {
          for (const item of data) {
            if (rows.some((row) => row.userId === item.userId && row.name === item.name)) continue;
            rows.push({
              id: nextId(),
              ...item,
              sourceUrl: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          return { count: data.length };
        },
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; userId: string }; data: Partial<Row> }) => {
          const row = rows.find(
            (candidate) => candidate.id === where.id && candidate.userId === where.userId,
          );
          if (!row) return { count: 0 };
          Object.assign(row, data, { updatedAt: new Date() });
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("not found");
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const index = rows.findIndex(
          (candidate) => candidate.id === where.id && candidate.userId === where.userId,
        );
        if (index === -1) return { count: 0 };
        rows.splice(index, 1);
        return { count: 1 };
      }),
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { userId_name: { userId: string; name: string } };
          update: Partial<Row>;
          create: {
            userId: string;
            name: string;
            content: string;
            sourceUrl: string | null;
            isBuiltIn?: boolean;
          };
        }) => {
          const row = rows.find(
            (candidate) =>
              candidate.userId === where.userId_name.userId &&
              candidate.name === where.userId_name.name,
          );
          if (row) {
            Object.assign(row, update, { updatedAt: new Date() });
            return row;
          }
          const created: Row = {
            id: nextId(),
            ...create,
            isBuiltIn: create.isBuiltIn ?? false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rows.push(created);
          return created;
        },
      ),
    },
    bot: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { promptTemplateId: string };
          data: { promptTemplateId: string | null };
        }) => {
          let count = 0;
          for (const bot of bots) {
            if (bot.promptTemplateId === where.promptTemplateId) {
              Object.assign(bot, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { rows, user, bots, prisma };
}

describe("prompt templates", () => {
  it("seeds the four built-ins in order on first access, and never reseeds a deleted one", async () => {
    const { prisma, user } = fixture();
    const listed = await listPromptTemplates(prisma as never, "user-1");
    expect(listed.map((template) => template.name)).toEqual([
      "默认助手",
      "翻译助手",
      "写作助手",
      "代码助手",
    ]);
    expect(listed.every((template) => template.isBuiltIn)).toBe(true);
    expect(user.promptTemplatesSeededAt).not.toBeNull();

    await removePromptTemplate(prisma as never, "user-1", listed[0]!.id);
    const again = await listPromptTemplates(prisma as never, "user-1");
    expect(again.map((template) => template.name)).toEqual(["翻译助手", "写作助手", "代码助手"]);
  });

  it("brings a deleted built-in back on restore, without touching the others", async () => {
    const { prisma } = fixture();
    const listed = await listPromptTemplates(prisma as never, "user-1");
    const custom = await createPromptTemplate(prisma as never, "user-1", {
      name: "我的助手",
      content: "Do it my way.",
    });
    await removePromptTemplate(prisma as never, "user-1", listed[0]!.id);
    const restored = await restoreDefaultPromptTemplates(prisma as never, "user-1");
    expect(restored.map((template) => template.name)).toContain("默认助手");
    expect(restored.find((template) => template.id === custom.id)?.content).toBe("Do it my way.");
  });

  it("rejects a duplicate name on create and on rename", async () => {
    const { prisma } = fixture();
    await createPromptTemplate(prisma as never, "user-1", { name: "A", content: "Do A." });
    await expect(
      createPromptTemplate(prisma as never, "user-1", { name: "A", content: "Do A again." }),
    ).rejects.toThrow(PromptTemplateNameConflictError);
    const b = await createPromptTemplate(prisma as never, "user-1", {
      name: "B",
      content: "Do B.",
    });
    await expect(
      updatePromptTemplate(prisma as never, "user-1", { templateId: b.id, name: "A" }),
    ).rejects.toThrow(PromptTemplateNameConflictError);
  });

  it("updates content, and refuses a template of another account", async () => {
    const { prisma } = fixture();
    const created = await createPromptTemplate(prisma as never, "user-1", {
      name: "A",
      content: "Do A.",
    });
    const updated = await updatePromptTemplate(prisma as never, "user-1", {
      templateId: created.id,
      content: "Do A better.",
    });
    expect(updated.content).toBe("Do A better.");
    await expect(
      updatePromptTemplate(prisma as never, "user-2", {
        templateId: created.id,
        content: "Nope.",
      }),
    ).rejects.toThrow(IsolationError);
  });

  it("removing a template clears the bot link but keeps the bot's instructions", async () => {
    const { prisma, bots } = fixture();
    const created = await createPromptTemplate(prisma as never, "user-1", {
      name: "A",
      content: "Do A.",
    });
    bots.push({ id: "bot-1", instructions: "Do A.", promptTemplateId: created.id });
    await removePromptTemplate(prisma as never, "user-1", created.id);
    expect(bots[0]).toEqual({ id: "bot-1", instructions: "Do A.", promptTemplateId: null });
  });

  it("upserts by name and keeps the row id, so bots stay linked", async () => {
    const { prisma } = fixture();
    const first = await upsertPromptTemplate(prisma as never, "user-1", {
      name: "A",
      content: "Do A.",
    });
    const second = await upsertPromptTemplate(prisma as never, "user-1", {
      name: "A",
      content: "Do A better.",
      sourceUrl: "https://example.test/a.txt",
    });
    expect(second.id).toBe(first.id);
    expect(second.content).toBe("Do A better.");
    expect(second.sourceUrl).toBe("https://example.test/a.txt");
    const listed = await listPromptTemplates(prisma as never, "user-1");
    expect(listed.filter((template) => template.name === "A")).toHaveLength(1);
  });
});
