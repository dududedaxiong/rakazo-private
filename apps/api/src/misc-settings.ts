import type { Actor, MiscSettings } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { getSpaceMiscSettings } from "@rakazo_mickvvw/db";

export async function getMiscSettings(
  deps: { prisma: PrismaClient },
  actor: Actor,
): Promise<MiscSettings> {
  return getSpaceMiscSettings(deps.prisma, actor.spaceId);
}

export async function saveMiscSettings(
  deps: { prisma: PrismaClient },
  actor: Actor,
  input: MiscSettings,
): Promise<MiscSettings> {
  await deps.prisma.spaceMiscConfig.upsert({
    where: { spaceId: actor.spaceId },
    create: { spaceId: actor.spaceId, settings: input },
    update: { settings: input },
  });
  return input;
}
