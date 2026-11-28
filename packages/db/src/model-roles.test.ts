import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { appliedModelRole } from "./model-roles.js";

type StoredRow = {
  role: string;
  position: number;
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
  credentialId: string | null;
  pool: string | null;
};

/** In-memory role tables; the Postgres file covers the same read against a real database. */
function stubPrisma(rows: StoredRow[]) {
  const findMany = async ({ where }: { where: { userId?: string; role?: string } }) =>
    rows
      .filter((row) => where.role === undefined || row.role === where.role)
      .sort((a, b) => a.position - b.position);
  return {
    spaceSettingOverride: { findUnique: async () => null },
    userModelRoleChoice: { findMany },
    spaceModelRoleChoice: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

describe("model roles (in-memory)", () => {
  it("round-trips the image role through its two pools in order", async () => {
    const prisma = stubPrisma([
      {
        role: "image",
        position: 0,
        provider: "openai-compatible",
        modelId: "vision-a",
        thinkingLevel: null,
        credentialId: null,
        pool: "main",
      },
      {
        role: "image",
        position: 1,
        provider: "openai-compatible",
        modelId: "vision-b",
        thinkingLevel: "low",
        credentialId: null,
        pool: "backup",
      },
      {
        role: "main",
        position: 0,
        provider: "openai-compatible",
        modelId: "text-only",
        thinkingLevel: null,
        credentialId: null,
        pool: "main",
      },
    ]);
    await expect(
      appliedModelRole(prisma, { userId: "user-1", spaceId: "space-1" }, "image"),
    ).resolves.toEqual({
      primary: { provider: "openai-compatible", modelId: "vision-a" },
      backups: [{ provider: "openai-compatible", modelId: "vision-b", thinkingLevel: "low" }],
      mainPool: [{ provider: "openai-compatible", modelId: "vision-a" }],
      backupPool: [{ provider: "openai-compatible", modelId: "vision-b", thinkingLevel: "low" }],
    });
    await expect(
      appliedModelRole(prisma, { userId: "user-1", spaceId: "space-1" }, "video"),
    ).resolves.toEqual({ primary: null, backups: [], mainPool: [], backupPool: [] });
  });
});
