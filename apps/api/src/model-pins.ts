import { ORPCError } from "@orpc/server";
import type { CodexLiveCatalog, parseModelSecret } from "@rakazo_mickvvw/adapters";
import {
  findConnectedModelCredential,
  validateConnectedModelChoice,
} from "@rakazo_mickvvw/adapters";
import type { Actor } from "@rakazo_mickvvw/contracts";
import {
  CONFIRM_MODEL_REMOVAL_REASON,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  usableModelId,
} from "@rakazo_mickvvw/contracts";
import { modelRoleTarget, runAsSystem } from "@rakazo_mickvvw/db";
import type { RouterDeps } from "./router.js";

/**
 * The actor's active compatible bot, routine and role pins on `modelId`. Role rows come from the
 * account's models (spaceId null) and from the Spaces that override them.
 */
async function compatibleModelPins(
  deps: RouterDeps,
  actor: Actor,
  modelId: string | { notIn: string[] },
) {
  const provider = OPENAI_COMPATIBLE_PROVIDER_ID;
  const where = { userId: actor.userId, modelId };
  const pin = { spaceId: true, modelId: true } as const;
  const role = {
    modelId: true,
    role: true,
    position: true,
    credentialId: true,
    pool: true,
  } as const;
  // A connection is the account's, so its pins are checked in every Space it is used in.
  const [bots, routines, accountRoles, spaceRoles] = await runAsSystem(
    "model pins across the account's Spaces",
    () =>
      Promise.all([
        deps.prisma.bot.findMany({
          where: { ...where, archivedAt: null, modelProvider: provider },
          select: { ...pin, name: true, id: true },
        }),
        deps.prisma.routine.findMany({
          where: { ...where, modelProvider: provider, bot: { archivedAt: null } },
          select: { ...pin, name: true },
        }),
        deps.prisma.userModelRoleChoice.findMany({ where: { ...where, provider }, select: role }),
        deps.prisma.spaceModelRoleChoice.findMany({
          where: {
            ...where,
            provider,
            spaceMember: { settingOverrides: { some: { setting: "models" } } },
          },
          select: { ...role, spaceId: true },
        }),
      ]),
  );
  return {
    named: [
      ...bots.map((row) => ({ ...row, kind: "bot" as const })),
      ...routines.map((row) => ({ ...row, kind: "routine" as const, id: null as string | null })),
    ],
    backups: [...accountRoles.map((row) => ({ ...row, spaceId: null })), ...spaceRoles],
  };
}

type ModelPinRow = { spaceId: string | null; modelId: string | null; credentialId?: string | null };
type NamedPinRow = ModelPinRow & {
  name: string;
  kind: "bot" | "routine";
  /** The bot to clear on a confirmed save; routines are never cleared, so null. */
  id: string | null;
};
type RolePinRow = ModelPinRow & { role: string; position: number; pool?: string | null };

/** Which pool a stored role row belongs to; the same rule as `rowPool` in model-roles. */
function isBackupPoolRow(row: RolePinRow): boolean {
  if (row.pool === "backup") return true;
  if (row.pool === "main") return false;
  return row.position !== 0;
}

/** The rows a confirmed connection save may drop, in the same transaction as the save. */
export type PrunableModelPin =
  | {
      kind: "role";
      scope: "account" | "space";
      spaceId: string | null;
      role: string;
      pool: "main" | "backup";
      modelId: string;
      credentialId: string | null;
    }
  | { kind: "bot"; botId: string };

/** Refusal naming the bots and routines (plus "备用模型") left on a dropped model. */
function refuseModelPins(
  pins: { named: NamedPinRow[]; backups: ModelPinRow[] },
  dangling: (row: ModelPinRow) => boolean,
) {
  const names = [
    ...pins.named
      .filter(dangling)
      .map((row) => (row.kind === "bot" ? `机器人 ${row.name}` : `例行任务 ${row.name}`)),
    ...(pins.backups.some(dangling) ? ["备用模型"] : []),
  ];
  if (names.length === 0) return;
  throw new ORPCError("BAD_REQUEST", {
    message: `正被${[...new Set(names)].join("、")}使用，请先给${names.length === 1 ? "它" : "它们"}换个模型。`,
  });
}

/** The Chinese name a role pool reads as in the removal confirmation. */
function roleFamilyLabel(role: string): string {
  if (role === "approval") return "审批";
  if (role === "computer") return "电脑操作";
  if (role !== "main") return role;
  return "聊天";
}

/**
 * A save that strands main-pool rows or bot models: the client confirms, then retries with
 * `confirmRemovePins`. The message names only the lines that apply: the occupancies, the
 * last-enabled-model hint, or both.
 */
function confirmModelRemovalError(
  bots: NamedPinRow[],
  mainPoolRows: RolePinRow[],
  removesLastEnabledModel: boolean,
) {
  const labels = [
    ...bots.map((row) => `机器人 ${row.name}`),
    ...mainPoolRows.map((row) => `${roleFamilyLabel(row.role)}主模型`),
  ];
  const parts: string[] = [];
  if (labels.length > 0)
    parts.push(
      `正被${[...new Set(labels)].join("、")}使用。确认保存将移除这些占用，之后请手动重新设定对应模型。`,
    );
  if (removesLastEnabledModel)
    parts.push("这是该提供商最后一个模型，移除后将没有可用模型，请手动补一个。");
  return new ORPCError("CONFLICT", {
    message: parts.join(""),
    data: {
      reason: CONFIRM_MODEL_REMOVAL_REASON,
      occupancies: [
        ...bots.map((row) => ({ kind: "bot" as const, name: row.name })),
        ...mainPoolRows.map((row) => ({
          kind: "role" as const,
          role: row.role,
          pool: "main" as const,
        })),
      ],
      removesLastEnabledModel,
    },
  });
}

/**
 * Refuse only pins that runtime selection cannot serve after this connection save. A
 * routine pin always blocks; a backup-pool row is dropped silently; a main-pool row or a
 * bot model blocks until the client confirms, then joins the returned prune list.
 */
export async function assertNoDanglingModelPins(
  deps: RouterDeps,
  actor: Actor,
  connection: { id: string },
  secret: ReturnType<typeof parseModelSecret>,
  actorDefault: string,
  options?: { confirmRemovePins?: boolean; removesLastEnabledModel?: boolean },
): Promise<PrunableModelPin[]> {
  const stored = secret.kind === "openai_compatible" ? (secret.enabledModelIds ?? []) : [];
  const pins = await compatibleModelPins(deps, actor, { notIn: stored });
  // The connection's own model is the account's, so it stays enabled in every Space.
  const defaultModel = usableModelId(actorDefault);
  const dangling = new Set<ModelPinRow>();
  for (const row of [...pins.named, ...pins.backups] as ModelPinRow[]) {
    if (!row.modelId || row.modelId === defaultModel) continue;
    // A row pinned to a connection runs only there.
    if (row.credentialId) {
      if (row.credentialId === connection.id) dangling.add(row);
      continue;
    }
    // Which connection serves a model is the account's choice, the same in every Space.
    const selected = await findConnectedModelCredential(
      deps.prisma,
      deps.secrets,
      actor,
      OPENAI_COMPATIBLE_PROVIDER_ID,
      row.modelId,
      { replacement: { credentialId: connection.id, secret, defaultModel } },
    );
    if (selected?.id === connection.id || !selected) dangling.add(row);
  }
  // A routine has no member pool to fall back to, so it blocks even a confirmed save.
  refuseModelPins(
    { named: pins.named.filter((row) => row.kind === "routine"), backups: [] },
    (row) => dangling.has(row),
  );
  const confirmed = options?.confirmRemovePins === true;
  const botPins = pins.named.filter((row) => row.kind === "bot" && dangling.has(row));
  const mainPoolRows: RolePinRow[] = [];
  const backupPoolRows: RolePinRow[] = [];
  for (const row of pins.backups) {
    if (!dangling.has(row)) continue;
    (isBackupPoolRow(row) ? backupPoolRows : mainPoolRows).push(row);
  }
  const prunable: PrunableModelPin[] = backupPoolRows
    .filter((row) => row.modelId !== null)
    .map((row) => ({
      kind: "role" as const,
      scope: row.spaceId === null ? ("account" as const) : ("space" as const),
      spaceId: row.spaceId,
      role: row.role,
      pool: "backup" as const,
      modelId: row.modelId as string,
      credentialId: row.credentialId ?? null,
    }));
  if (confirmed) {
    for (const row of mainPoolRows) {
      if (row.modelId === null) continue;
      prunable.push({
        kind: "role",
        scope: row.spaceId === null ? "account" : "space",
        spaceId: row.spaceId,
        role: row.role,
        pool: "main",
        modelId: row.modelId,
        credentialId: row.credentialId ?? null,
      });
    }
    for (const row of botPins) {
      if (row.id !== null) prunable.push({ kind: "bot", botId: row.id });
    }
    return prunable;
  }
  if (botPins.length > 0 || mainPoolRows.length > 0 || options?.removesLastEnabledModel === true) {
    throw confirmModelRemovalError(
      botPins,
      mainPoolRows,
      options?.removesLastEnabledModel ?? false,
    );
  }
  return prunable;
}

/**
 * `models.setDefault` on an openai-compatible connection: a listed secret only accepts an
 * effective id. It changes the connection's own model and never the secret, so the only pins
 * it can strand are pins on an outgoing default that is outside the stored list.
 */
export async function assertCompatibleDefaultChange(
  deps: RouterDeps,
  actor: Actor,
  modelId: string,
  thinking: { enabledModelIds?: string[]; storedEnabledModelIds?: string[] },
) {
  const requested = modelId.trim();
  const enabled = thinking.enabledModelIds ?? [];
  const stored = thinking.storedEnabledModelIds;
  if (stored && !enabled.includes(requested)) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown model for that provider" });
  }
  const outgoing = enabled.find((id) => id !== requested && !stored?.includes(id));
  if (!outgoing) return;
  const [pins, target] = await Promise.all([
    compatibleModelPins(deps, actor, outgoing),
    modelRoleTarget(deps.prisma, actor),
  ]);
  const replacedSpaceId = target.scope === "space" ? actor.spaceId : null;
  // The main model's own row is the choice being replaced, not a pin left behind.
  refuseModelPins(
    {
      ...pins,
      backups: pins.backups.filter(
        (row) => !(row.role === "main" && row.position === 0 && row.spaceId === replacedSpaceId),
      ),
    },
    () => true,
  );
}

/** A routine may only name a model the space has connected. */
export async function assertRoutineModel(
  deps: RouterDeps,
  actor: Actor,
  model: { modelProvider?: string | null; modelId?: string | null },
  codexCatalog: CodexLiveCatalog,
) {
  if (!model.modelProvider || !model.modelId) return;
  const message = await validateConnectedModelChoice(
    deps.prisma,
    deps.secrets,
    actor,
    model.modelProvider,
    model.modelId,
    { codexCatalog },
  );
  if (message) throw new ORPCError("BAD_REQUEST", { message });
}
