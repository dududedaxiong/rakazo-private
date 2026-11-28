import type { SettingsScope } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { lockSpaceSettings, settingsTarget } from "./space-settings.js";
import { withTransactionRetry } from "./transaction-retry.js";

type Scope = { userId: string; spaceId: string };
/** Which copy of a member's computer persona a call acts on: the account's or the Space's override. */
export type ComputerPersonaTarget = Scope & { scope: SettingsScope };
type PersonaClient = Pick<
  PrismaClient,
  "spaceComputerPersona" | "userComputerPersona" | "spaceSettingOverride" | "promptTemplate"
>;
type PersonaRow = { promptTemplateId: string };
type PersonaOwner = { userId: string; spaceId?: string };
/** The columns both copies share; the Space's rows are also keyed by its id. */
type PersonaTable = {
  findFirst(args: {
    where: PersonaOwner;
    select: { promptTemplateId: true };
  }): Promise<PersonaRow | null>;
  deleteMany(args: { where: PersonaOwner }): Promise<unknown>;
  create(args: { data: PersonaRow & PersonaOwner }): Promise<unknown>;
};

/** Thrown when the template a persona names is missing or belongs to someone else. */
export class ComputerPersonaTemplateNotFoundError extends Error {
  constructor() {
    super("Prompt template not found");
    this.name = "ComputerPersonaTemplateNotFoundError";
  }
}

function personaTable(prisma: PersonaClient, target: ComputerPersonaTarget) {
  return target.scope === "space"
    ? {
        table: prisma.spaceComputerPersona as unknown as PersonaTable,
        owner: { userId: target.userId, spaceId: target.spaceId },
      }
    : {
        table: prisma.userComputerPersona as unknown as PersonaTable,
        owner: { userId: target.userId },
      };
}

/**
 * The copy of the member's computer persona a call acts on: the one `requested` names, else the
 * Space's own when it overrides it, else the account's.
 */
export async function computerPersonaTarget(
  prisma: Pick<PrismaClient, "spaceSettingOverride">,
  scope: Scope,
  requested?: SettingsScope,
): Promise<ComputerPersonaTarget> {
  return {
    userId: scope.userId,
    spaceId: scope.spaceId,
    scope: await settingsTarget(prisma, scope, "computerPersona", requested),
  };
}

/** The member's computer persona as it applies in the Space, or in `requested`. */
export async function appliedComputerPersona(
  prisma: PersonaClient,
  scope: Scope,
  requested?: SettingsScope,
): Promise<{ promptTemplateId: string | null; scope: SettingsScope }> {
  const target = await computerPersonaTarget(prisma, scope, requested);
  const { table, owner } = personaTable(prisma, target);
  const row = await table.findFirst({ where: owner, select: { promptTemplateId: true } });
  return { promptTemplateId: row?.promptTemplateId ?? null, scope: target.scope };
}

/**
 * The persona's template text as it applies in the Space. Null when unset, when the template
 * is gone (its row cascades away, so this is only a race window), or when the template belongs
 * to someone else or is empty.
 */
export async function resolvedComputerPersona(
  prisma: PersonaClient,
  scope: Scope,
  requested?: SettingsScope,
): Promise<{ promptTemplateId: string; content: string } | null> {
  const { promptTemplateId } = await appliedComputerPersona(prisma, scope, requested);
  if (!promptTemplateId) return null;
  const template = await prisma.promptTemplate.findUnique({
    where: { id: promptTemplateId },
    select: { userId: true, content: true },
  });
  if (!template || template.userId !== scope.userId || !template.content.trim()) return null;
  return { promptTemplateId, content: template.content };
}

/**
 * Saves the member's computer persona to the copy `target.scope` names, or, when it names none,
 * to the copy that applies in the Space at the moment of the save. Null clears it.
 */
export async function setComputerPersona(
  prisma: PrismaClient,
  target: Scope & { scope?: SettingsScope },
  promptTemplateId: string | null,
): Promise<{ promptTemplateId: string | null; scope: SettingsScope }> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockSpaceSettings(tx, target);
        const resolved = await computerPersonaTarget(
          tx,
          { userId: target.userId, spaceId: target.spaceId },
          target.scope,
        );
        if (promptTemplateId) {
          const template = await tx.promptTemplate.findUnique({
            where: { id: promptTemplateId },
            select: { userId: true },
          });
          if (!template || template.userId !== target.userId)
            throw new ComputerPersonaTemplateNotFoundError();
        }
        const { table, owner } = personaTable(tx, resolved);
        await table.deleteMany({ where: owner });
        if (promptTemplateId) {
          await table.create({ data: { ...owner, promptTemplateId } });
        }
        return { promptTemplateId, scope: resolved.scope };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ),
  );
}
