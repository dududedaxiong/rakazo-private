import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  appliedComputerPersona,
  ComputerPersonaTemplateNotFoundError,
  resolvedComputerPersona,
  setComputerPersona,
} from "./computer-persona.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("computer persona (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `computer-persona-user-${suffix}`;
  const otherUserId = `computer-persona-other-${suffix}`;
  const organizationId = `computer-persona-organization-${suffix}`;
  const spaceId = `computer-persona-space-${suffix}`;
  const otherSpaceId = `computer-persona-other-space-${suffix}`;
  const account = { userId, spaceId };
  const space = { userId, spaceId, scope: "space" as const };
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const createdAt = new Date();
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: "Computer Persona", email: `${id}@rakazo.test`, emailVerified: false },
      });
    }
    await prisma.organization.create({
      data: { id: organizationId, name: "Computer Persona", slug: organizationId, createdAt },
    });
    for (const id of [userId, otherUserId]) {
      await prisma.member.create({
        data: { id: `${id}-member`, organizationId, userId: id, role: "owner", createdAt },
      });
    }
    for (const id of [spaceId, otherSpaceId]) {
      await prisma.space.create({
        data: { id, organizationId, name: id, createdByUserId: userId },
      });
      await prisma.spaceMember.create({
        data: { id: `${id}-member`, spaceId: id, organizationId, userId, createdAt },
      });
    }
    await prisma.promptTemplate.create({
      data: {
        id: `template-account-${suffix}`,
        userId,
        name: "Account persona",
        content: "Speak like a careful archivist.",
      },
    });
    await prisma.promptTemplate.create({
      data: {
        id: `template-space-${suffix}`,
        userId,
        name: "Space persona",
        content: "Speak like a ship's engineer.",
      },
    });
    await prisma.promptTemplate.create({
      data: {
        id: `template-other-${suffix}`,
        userId: otherUserId,
        name: "Someone else's persona",
        content: "Not yours.",
      },
    });
  });

  beforeEach(async () => {
    await prisma.spaceComputerPersona.deleteMany({ where: { userId } });
    await prisma.userComputerPersona.deleteMany({ where: { userId } });
    await prisma.spaceSettingOverride.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.deleteMany({ where: { id: otherUserId } });
    await close();
  });

  it("round-trips the account persona and resolves its text", async () => {
    await expect(
      setComputerPersona(prisma, account, `template-account-${suffix}`),
    ).resolves.toEqual({ promptTemplateId: `template-account-${suffix}`, scope: "account" });
    await expect(appliedComputerPersona(prisma, account)).resolves.toEqual({
      promptTemplateId: `template-account-${suffix}`,
      scope: "account",
    });
    await expect(resolvedComputerPersona(prisma, account)).resolves.toEqual({
      promptTemplateId: `template-account-${suffix}`,
      content: "Speak like a careful archivist.",
    });
    await expect(setComputerPersona(prisma, account, null)).resolves.toEqual({
      promptTemplateId: null,
      scope: "account",
    });
    await expect(appliedComputerPersona(prisma, account)).resolves.toEqual({
      promptTemplateId: null,
      scope: "account",
    });
    await expect(resolvedComputerPersona(prisma, account)).resolves.toBeNull();
  });

  it("keeps a Space's own persona apart from the account's", async () => {
    await setComputerPersona(prisma, account, `template-account-${suffix}`);
    await setComputerPersona(prisma, space, `template-space-${suffix}`);
    await expect(appliedComputerPersona(prisma, account)).resolves.toEqual({
      promptTemplateId: `template-space-${suffix}`,
      scope: "space",
    });
    await expect(
      appliedComputerPersona(prisma, { userId, spaceId: otherSpaceId }),
    ).resolves.toEqual({
      promptTemplateId: `template-account-${suffix}`,
      scope: "account",
    });
    await expect(resolvedComputerPersona(prisma, account)).resolves.toEqual({
      promptTemplateId: `template-space-${suffix}`,
      content: "Speak like a ship's engineer.",
    });
  });

  it("refuses another member's template", async () => {
    await expect(
      setComputerPersona(prisma, account, `template-other-${suffix}`),
    ).rejects.toBeInstanceOf(ComputerPersonaTemplateNotFoundError);
    await expect(
      setComputerPersona(prisma, account, `template-missing-${suffix}`),
    ).rejects.toBeInstanceOf(ComputerPersonaTemplateNotFoundError);
    await expect(appliedComputerPersona(prisma, account)).resolves.toEqual({
      promptTemplateId: null,
      scope: "account",
    });
  });
});
