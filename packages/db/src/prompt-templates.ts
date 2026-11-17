import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import { BUILTIN_PROMPT_TEMPLATES } from "@rakazo_mickvvw/contracts";
import type { PrismaClient, PromptTemplate as PromptTemplateRow } from "./client.js";
import { IsolationError } from "./scope.js";

export function mapPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    isBuiltIn: row.isBuiltIn,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A name another template of this account already uses. */
export class PromptTemplateNameConflictError extends Error {
  constructor() {
    super("A template with this name already exists");
    this.name = "PromptTemplateNameConflictError";
  }
}

/**
 * Seed the four built-ins the first time this account touches templates. A deleted
 * built-in is not reseeded here; `restoreDefaultPromptTemplates` brings it back.
 */
export async function seedBuiltinPromptTemplates(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { promptTemplatesSeededAt: true },
  });
  if (!user || user.promptTemplatesSeededAt) return;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: userId, promptTemplatesSeededAt: null },
      data: { promptTemplatesSeededAt: new Date() },
    });
    if (claimed.count !== 1) return;
    await tx.promptTemplate.createMany({
      data: BUILTIN_PROMPT_TEMPLATES.map((template) => ({
        userId,
        name: template.name,
        content: template.content,
        isBuiltIn: true,
      })),
      skipDuplicates: true,
    });
  });
}

const builtinOrder = new Map(
  BUILTIN_PROMPT_TEMPLATES.map((template, index) => [template.name, index]),
);

function sortTemplates(rows: PromptTemplateRow[]): PromptTemplateRow[] {
  return [...rows].sort((a, b) => {
    const aRank = a.isBuiltIn ? (builtinOrder.get(a.name) ?? 999) : 1000;
    const bRank = b.isBuiltIn ? (builtinOrder.get(b.name) ?? 999) : 1000;
    if (aRank !== bRank) return aRank - bRank;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export async function listPromptTemplates(
  prisma: PrismaClient,
  userId: string,
): Promise<PromptTemplate[]> {
  await seedBuiltinPromptTemplates(prisma, userId);
  const rows = await prisma.promptTemplate.findMany({ where: { userId } });
  return sortTemplates(rows).map(mapPromptTemplate);
}

async function assertNameFree(
  prisma: PrismaClient,
  userId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = await prisma.promptTemplate.findFirst({
    where: { userId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new PromptTemplateNameConflictError();
}

export async function createPromptTemplate(
  prisma: PrismaClient,
  userId: string,
  input: { name: string; content: string },
): Promise<PromptTemplate> {
  await seedBuiltinPromptTemplates(prisma, userId);
  await assertNameFree(prisma, userId, input.name);
  const row = await prisma.promptTemplate.create({
    data: { userId, name: input.name, content: input.content },
  });
  return mapPromptTemplate(row);
}

export async function updatePromptTemplate(
  prisma: PrismaClient,
  userId: string,
  input: { templateId: string; name?: string; content?: string },
): Promise<PromptTemplate> {
  if (input.name !== undefined) {
    await assertNameFree(prisma, userId, input.name, input.templateId);
  }
  const updated = await prisma.promptTemplate.updateMany({
    where: { id: input.templateId, userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    },
  });
  if (updated.count !== 1) throw new IsolationError();
  const row = await prisma.promptTemplate.findUniqueOrThrow({
    where: { id: input.templateId },
  });
  return mapPromptTemplate(row);
}

export async function removePromptTemplate(
  prisma: PrismaClient,
  userId: string,
  templateId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.promptTemplate.deleteMany({
      where: { id: templateId, userId },
    });
    if (deleted.count !== 1) throw new IsolationError();
    // Bots keep their current instructions; they just stop pointing at the template.
    // Only this account could have linked a bot to this template, so clearing by
    // template id alone touches nothing of anyone else's.
    await tx.bot.updateMany({
      where: { promptTemplateId: templateId },
      data: { promptTemplateId: null },
    });
  });
}

/** Bring back the built-ins this account deleted. Existing templates are untouched. */
export async function restoreDefaultPromptTemplates(
  prisma: PrismaClient,
  userId: string,
): Promise<PromptTemplate[]> {
  await seedBuiltinPromptTemplates(prisma, userId);
  await prisma.promptTemplate.createMany({
    data: BUILTIN_PROMPT_TEMPLATES.map((template) => ({
      userId,
      name: template.name,
      content: template.content,
      isBuiltIn: true,
    })),
    skipDuplicates: true,
  });
  return listPromptTemplates(prisma, userId);
}

/**
 * Insert or update one template by name (imports and restores both go through here).
 * The row keeps its id, so bots pointing at it stay linked. `isBuiltIn` only matters
 * to a backup restore, which is the source of truth for it; imports leave it alone.
 */
export async function upsertPromptTemplate(
  prisma: PrismaClient,
  userId: string,
  input: {
    name: string;
    content: string;
    sourceUrl?: string | null;
    isBuiltIn?: boolean;
  },
): Promise<PromptTemplate> {
  const row = await prisma.promptTemplate.upsert({
    where: { userId_name: { userId, name: input.name } },
    update: {
      content: input.content,
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.isBuiltIn !== undefined ? { isBuiltIn: input.isBuiltIn } : {}),
    },
    create: {
      userId,
      name: input.name,
      content: input.content,
      sourceUrl: input.sourceUrl ?? null,
      isBuiltIn: input.isBuiltIn ?? false,
    },
  });
  return mapPromptTemplate(row);
}

/** Restore the templates a backup carried, by name, after the spaces imported. */
export async function restorePromptTemplates(
  prisma: PrismaClient,
  userId: string,
  templates: Array<{
    name: string;
    content: string;
    isBuiltIn?: boolean;
    sourceUrl?: string | null;
  }>,
): Promise<PromptTemplate[]> {
  const restored: PromptTemplate[] = [];
  for (const template of templates) {
    restored.push(await upsertPromptTemplate(prisma, userId, template));
  }
  return restored;
}
