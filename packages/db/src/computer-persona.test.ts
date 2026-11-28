import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  appliedComputerPersona,
  ComputerPersonaTemplateNotFoundError,
  resolvedComputerPersona,
  setComputerPersona,
} from "./computer-persona.js";

type PersonaRow = { userId: string; spaceId?: string; promptTemplateId: string };

function stubPrisma(
  options: {
    templates?: Record<string, { userId: string; content: string }>;
    overrides?: string[];
    rows?: PersonaRow[];
  } = {},
) {
  const rows = [...(options.rows ?? [])];
  const overrides = new Set(options.overrides ?? []);
  const table = (copy: "account" | "space") => {
    const owns = (row: PersonaRow, where: Partial<PersonaRow>) =>
      (copy === "space") === (row.spaceId !== undefined) &&
      (Object.keys(where) as (keyof PersonaRow)[]).every((key) => row[key] === where[key]);
    return {
      findFirst: vi.fn(
        async ({ where }: { where: Partial<PersonaRow> }) =>
          rows.find((row) => owns(row, where)) ?? null,
      ),
      deleteMany: vi.fn(async ({ where }: { where: Partial<PersonaRow> }) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (owns(rows[index]!, where)) rows.splice(index, 1);
        }
        return { count: before - rows.length };
      }),
      create: vi.fn(async ({ data }: { data: PersonaRow }) => {
        rows.push(data);
        return data;
      }),
    };
  };
  const tx = {
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
    spaceSettingOverride: {
      findUnique: vi.fn(async () => null),
    },
    userComputerPersona: table("account"),
    spaceComputerPersona: table("space"),
    promptTemplate: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const template = options.templates?.[where.id];
        return template ? { userId: template.userId, content: template.content } : null;
      }),
    },
  };
  const prisma = {
    ...tx,
    spaceSettingOverride: {
      findUnique: vi.fn(
        async ({ where }: { where: { spaceId_userId_setting: Record<string, string> } }) =>
          overrides.has(
            `${where.spaceId_userId_setting.spaceId}:${where.spaceId_userId_setting.userId}:${where.spaceId_userId_setting.setting}`,
          )
            ? { setting: where.spaceId_userId_setting.setting }
            : null,
      ),
    },
    $transaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
  };
  return { prisma: prisma as unknown as PrismaClient, rows };
}

const scope = { userId: "user-1", spaceId: "space-1" };

describe("computer persona (in-memory)", () => {
  it("reads the account's persona and the Space's override apart", async () => {
    const { prisma } = stubPrisma({
      overrides: ["space-1:user-1:computerPersona"],
      rows: [
        { userId: "user-1", promptTemplateId: "template-account" },
        { userId: "user-1", spaceId: "space-1", promptTemplateId: "template-space" },
      ],
    });
    await expect(appliedComputerPersona(prisma, scope)).resolves.toEqual({
      promptTemplateId: "template-space",
      scope: "space",
    });
    await expect(appliedComputerPersona(prisma, scope, "account")).resolves.toEqual({
      promptTemplateId: "template-account",
      scope: "account",
    });
    await expect(
      appliedComputerPersona(prisma, { userId: "user-1", spaceId: "space-2" }),
    ).resolves.toEqual({
      promptTemplateId: "template-account",
      scope: "account",
    });
  });

  it("resolves the template text only for the owner's own non-empty template", async () => {
    const { prisma } = stubPrisma({
      templates: {
        "template-one": { userId: "user-1", content: "Speak like an archivist." },
        "template-other": { userId: "user-2", content: "Someone else's persona." },
        "template-empty": { userId: "user-1", content: "   " },
      },
      rows: [{ userId: "user-1", promptTemplateId: "template-one" }],
    });
    await expect(resolvedComputerPersona(prisma, scope)).resolves.toEqual({
      promptTemplateId: "template-one",
      content: "Speak like an archivist.",
    });
    const other = stubPrisma({
      templates: {
        "template-other": { userId: "user-2", content: "Someone else's persona." },
      },
      rows: [{ userId: "user-1", promptTemplateId: "template-other" }],
    });
    await expect(resolvedComputerPersona(other.prisma, scope)).resolves.toBeNull();
    const empty = stubPrisma({
      templates: { "template-empty": { userId: "user-1", content: "   " } },
      rows: [{ userId: "user-1", promptTemplateId: "template-empty" }],
    });
    await expect(resolvedComputerPersona(empty.prisma, scope)).resolves.toBeNull();
    const unset = stubPrisma();
    await expect(resolvedComputerPersona(unset.prisma, scope)).resolves.toBeNull();
  });

  it("saves and clears the persona, and refuses another member's template", async () => {
    const { prisma, rows } = stubPrisma({
      templates: { "template-one": { userId: "user-1", content: "Speak like an archivist." } },
    });
    await expect(setComputerPersona(prisma, scope, "template-one")).resolves.toEqual({
      promptTemplateId: "template-one",
      scope: "account",
    });
    expect(rows).toEqual([{ userId: "user-1", promptTemplateId: "template-one" }]);
    await expect(setComputerPersona(prisma, scope, null)).resolves.toEqual({
      promptTemplateId: null,
      scope: "account",
    });
    expect(rows).toEqual([]);
    await expect(setComputerPersona(prisma, scope, "template-other")).rejects.toBeInstanceOf(
      ComputerPersonaTemplateNotFoundError,
    );
    await expect(setComputerPersona(prisma, scope, "template-missing")).rejects.toBeInstanceOf(
      ComputerPersonaTemplateNotFoundError,
    );
  });
});
