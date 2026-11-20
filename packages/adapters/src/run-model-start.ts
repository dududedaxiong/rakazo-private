import type { AgentRunRequest } from "@rakazo_mickvvw/adapter-kit";
import { isModelCredentialRejected } from "@rakazo_mickvvw/adapter-kit";
import type { ModelRoleChoice, ModelRoleSettings } from "@rakazo_mickvvw/contracts";
import { MISSING_MODEL_RUN_ERROR, MODEL_ACCESS_REQUIRED_RUN_ERROR } from "@rakazo_mickvvw/core";
import { memberHasModelAccess } from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { HostedModelCreditsRequiredError } from "./model-credit-observer.js";
import type { DeploymentModelDefaults } from "./model-roles.js";
import { effectiveModelRole } from "./model-roles.js";
import { isRetiredModelCredentialError } from "./pi-oauth.js";
import type { restoreComputerModels } from "./pi-runtime-computer-mode.js";
import {
  isTerminalModelSetupError,
  modelCreditBillingEnabled,
  resolveConnectedModelKey,
  resolveModelKey,
} from "./run-model.js";

/** The run's backup models, loaded once, and the first of them that starts. */
export function runModelBackups(
  deps: ExecutorDeps,
  run: { id: string; userId: string; spaceId: string; modelPinned: boolean },
  defaults: DeploymentModelDefaults,
  scripted: boolean,
  registerSecrets: (values: string[]) => void,
) {
  // The member's "main" role, both pools: the chain walks the whole main
  // pool first, then the backup pool.
  let roleChoices: Promise<ModelRoleSettings> | undefined;
  const role = () =>
    (roleChoices ??= scripted
      ? Promise.resolve({ primary: null, backups: [], mainPool: [], backupPool: [] })
      : effectiveModelRole(deps.prisma, run, "main", defaults).catch((error: unknown) => {
          getLogger().warn("Backup models could not be loaded", { runId: run.id, error });
          return { primary: null, backups: [], mainPool: [], backupPool: [] };
        }));
  const load = () => role().then((role) => role.backupPool);
  // Backups that could not start here are not offered again once the model runs.
  const unavailable = new Set<ModelRoleChoice>();
  // A main model with no connection, or whose provider refused its sign-in, runs on the
  // first main-pool model that starts, then the first backup. A pinned run asked for
  // its model and keeps it.
  const startOnBackup = async (selected?: { provider: string | null | undefined; id: string | null | undefined }) => {
    if (run.modelPinned) return undefined;
    const { mainPool, backupPool } = await role();
    const choices = [
      // The selected model is the main pool's first entry when it comes from
      // the role; a bot override is not in the role at all.
      ...mainPool.filter(
        (choice) => choice.provider !== selected?.provider || choice.modelId !== selected?.id,
      ),
      ...backupPool,
    ];
    for (const choice of choices) {
      try {
        const backup = await resolveConnectedModelKey(
          deps,
          run,
          choice.provider,
          choice.modelId,
          registerSecrets,
          true,
          choice.credentialId,
        );
        getLogger().warn("model.primary_unavailable.backup_used", {
          runId: run.id,
          "model.provider": choice.provider,
          "model.id": choice.modelId,
        });
        return {
          provider: choice.provider,
          id: choice.modelId,
          credential: backup.credential,
          thinkingLevel: (choice.thinkingLevel ??
            null) as AgentRunRequest["model"]["thinkingLevel"],
          resolved: backup.resolved,
        };
      } catch {
        // Resolver errors can carry credential details, so only the outcome is kept.
        unavailable.add(choice);
      }
    }
    return undefined;
  };
  return { load, role, unavailable, startOnBackup };
}

/**
 * The model a run starts on: its selected model, else the first backup that starts. Returns the
 * failure to record on the run when none can start; a credential refusal worth retrying throws.
 */
export async function startRunModel(
  deps: ExecutorDeps,
  run: { userId: string; spaceId: string },
  selected: {
    provider: string | null | undefined;
    id: string | null | undefined;
    credential: Awaited<ReturnType<typeof resolveConnectedModelKey>>["credential"];
    thinkingLevel: AgentRunRequest["model"]["thinkingLevel"];
  },
  pinned: Awaited<ReturnType<typeof restoreComputerModels>>["main"] | undefined,
  backups: ReturnType<typeof runModelBackups>,
  registerSecrets: (values: string[]) => void,
) {
  const modelAccessDenied = async () =>
    (await modelCreditBillingEnabled(deps)) && !(await memberHasModelAccess(deps.prisma, run));
  let start: Awaited<ReturnType<typeof backups.startOnBackup>>;
  let primaryFailure = { message: MISSING_MODEL_RUN_ERROR, accountFailure: true };
  let retryPrimary: unknown;
  if (selected.provider && selected.id) {
    if (await modelAccessDenied()) {
      return { failure: { message: MODEL_ACCESS_REQUIRED_RUN_ERROR, accountFailure: true } };
    }
    try {
      start = {
        provider: selected.provider,
        id: selected.id,
        credential: selected.credential,
        thinkingLevel: selected.thinkingLevel,
        resolved: pinned
          ? {
              ...pinned,
              apiKey: pinned.apiKey,
              callObserver: pinned.callObserver,
              oauth: pinned.oauth?.credential,
              persistOAuth: pinned.oauth?.persist,
              refreshOAuth: pinned.oauth?.refresh,
              retireOAuth: pinned.oauth?.retire,
              redact: [],
            }
          : await resolveModelKey(
              deps,
              run.userId,
              run.spaceId,
              selected.credential,
              selected.provider,
              selected.id,
              registerSecrets,
            ),
      };
    } catch (error) {
      // An incompatible saved model or a dead (already retired) credential is a
      // configuration error: record it on the run rather than retrying setup.
      const terminal = isTerminalModelSetupError(error);
      if (!terminal && !isModelCredentialRejected(error)) throw error;
      primaryFailure = {
        message: error instanceof Error ? error.message : "Connect the provider again.",
        accountFailure:
          error instanceof HostedModelCreditsRequiredError || isRetiredModelCredentialError(error),
      };
      if (!terminal) retryPrimary = error;
    }
  } else if (await modelAccessDenied()) {
    return { failure: { message: MISSING_MODEL_RUN_ERROR, accountFailure: true } };
  }
  start ??= await backups.startOnBackup(selected);
  if (!start) {
    if (retryPrimary) throw retryPrimary;
    return { failure: primaryFailure };
  }
  return { start };
}
