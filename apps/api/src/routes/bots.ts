import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { runContinueJob, SecretStoreUnavailableError } from "@rakazo_mickvvw/adapter-kit";
import {
  archiveBot,
  checkpointAndStopComputer,
  compatibleEndpointPreset,
  decodeBrowserCookieSet,
  defaultVaultItemTitle,
  encodeBrowserCookieSet,
  findConnectedModelCredential,
  forgetBotSecret,
  forgetPageShareSecrets,
  hasActiveComputerControl,
  importBrowserCookies,
  isSecretAlreadySaved,
  listVaultItems,
  newVaultItemName,
  normalizeSecretDestination,
  pageUrlOrigin,
  parseModelSecret,
  probeMediaModel,
  relabelVaultItem,
  revealBotSecret,
  SPACE_VAULT_NOT_IN_USE,
  stopCancelledGroupRuns,
  storeBotSecret,
  toComputerRef,
  validateBotModelChange,
} from "@rakazo_mickvvw/adapters";
import type {
  Actor,
  Bot,
  BotModelEntry,
  BotPromptPreset,
  BotSecretDestination,
  BotSecretMetadata,
  SettingsScope,
  VaultImportCookiesInput,
  VaultPutInput,
} from "@rakazo_mickvvw/contracts";
import {
  BotSecretAuth,
  parseBotModelList,
  parseBotPromptPresets,
  primaryBotModel,
  resolveBotAvatarSet,
  resolveTargetLanguage,
} from "@rakazo_mickvvw/contracts";
import {
  ACTIVE_RUN_STATUSES,
  COMPUTER_USING_RUNS,
  displayName,
  mergeBotModelPools,
  splitBotModelPools,
} from "@rakazo_mickvvw/core";
import {
  BotSectionNameConflictError,
  botProfileLabelsChanged,
  ComputerLimitError,
  commitBotUpdate,
  expireComputerExecutionLeases,
  InstructionConflictError,
  IsolationError,
  isRecordNotFound,
  Prisma,
  recordComputerRunEnd,
  recordSecurityEvent,
  restoreBotUnderComputerQuota,
  SpaceDeletionInProgressError,
  settingsTarget,
  THREAD_LOCK_TRANSACTION_OPTIONS,
} from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import type { AgentImportServices } from "../agent-import.js";
import { agentImportSetupState, createImportedBot, previewAgentImport } from "../agent-import.js";
import { deleteAgentSecret, listAgentSecrets, putAgentSecret } from "../agent-secrets.js";
import { botEmailAddress, botEmailAddresses, claimBotEmailAddress } from "../bot-email-address.js";
import { changedBotSettings } from "../bot-setting-analytics.js";
import { createBotFromTemplate, listBotTemplates } from "../bot-templates.js";
import { requireIdentityConfirmation } from "../identity-confirmation.js";
import { mayUsePrivateEndpoint } from "../mcp-servers.js";
import { managedAppCatalog } from "../onboarding.js";
import type { RouterDeps } from "../router.js";
import { loadMessagePage } from "../thread-message-pages.js";
import {
  keepMessageTranslation,
  TranslationFailedError,
  TranslationModelNotConfiguredError,
} from "../translate.js";
import type { RouterContext } from "./context.js";
import { computerContext, modelSetup, THREAD_MESSAGE_PAGE_SIZE } from "./shared.js";

/** Surface a Space deletion race as a retryable conflict instead of a generic failure. */
function mapSpaceLifecycleError(error: unknown): unknown {
  if (error instanceof SpaceDeletionInProgressError) {
    return new ORPCError("CONFLICT", { message: error.message });
  }
  if (error instanceof ComputerLimitError) {
    return new ORPCError("BAD_REQUEST", { message: error.message });
  }
  return error;
}

const BOT_SECRET_INPUT_ERRORS = [
  "Invalid credential destination",
  "Invalid credential length",
  "Credential cannot be used with this authentication method",
  "Remove the existing credential before changing its destination",
  "Credential limit reached",
  "Invalid card",
  "Invalid contact",
  SPACE_VAULT_NOT_IN_USE,
];

/** A credential the user typed that cannot be stored, as a bad request. Never echoes the value. */
export function mapBotSecretInputError(error: unknown): unknown {
  if (
    error instanceof Error &&
    BOT_SECRET_INPUT_ERRORS.some((prefix) => error.message.startsWith(prefix))
  ) {
    return new ORPCError("BAD_REQUEST", { message: error.message });
  }
  return error;
}

/** Map credential validation failures to a bad request without echoing the submitted value. */
function mapBotSecretStoreError(error: unknown): unknown {
  if (error instanceof ORPCError) return error;
  const mapped = mapBotSecretInputError(error);
  if (mapped !== error) return mapped;
  // Login decoding failures: a JSON parse message can quote the submitted value, so never forward it.
  if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
    return new ORPCError("BAD_REQUEST", {
      message: "A website login needs a label and a value for every field",
    });
  }
  return error;
}

function vaultScope(actor: Actor, vault?: SettingsScope) {
  return { userId: actor.userId, spaceId: actor.spaceId, vault };
}

/**
 * A vault save can be the answer to a run parked on request_secret: resolve any pending
 * secret ask the saved credential satisfies, so the run resumes instead of waiting for a
 * card the person already answered by saving. Never fails the save itself: the credential
 * is stored either way, and a stuck ask is a nuisance, not a failed save.
 */
async function resolveSecretAsksForSavedCredential(
  deps: RouterDeps,
  scope: { userId: string; spaceId: string },
  destination: BotSecretDestination,
): Promise<void> {
  let resolved: Array<{ threadId: string; runId: string; seq: number }>;
  try {
    resolved = await deps.events.answerPendingSecretAsksForSavedCredential({
      spaceId: scope.spaceId,
      userId: scope.userId,
      destination,
    });
  } catch (error) {
    getLogger().warn("vault save did not resolve pending secret asks", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return;
  }
  for (const item of resolved) {
    await deps.events.notify(item.threadId, item.seq).catch((error: unknown) => {
      getLogger().error("secret ask resolution realtime notification", error);
    });
    await deps.jobs.enqueue(runContinueJob(item.runId)).catch((error: unknown) => {
      getLogger().error("secret ask resolution run enqueue", error);
    });
  }
}

/**
 * Save a vault item. One without a name is new and gets a free name from its title. One already
 * saved under the name keeps its value when none is given, so its title or note can change alone.
 */
async function saveVaultCredential(
  deps: RouterDeps,
  scope: ReturnType<typeof vaultScope>,
  input: Pick<VaultPutInput, "destination" | "value" | "title" | "note">,
) {
  const { name } = input.destination;
  if (input.value === undefined) {
    if (!name) throw new ORPCError("BAD_REQUEST", { message: "A new item needs its value" });
    try {
      const labels = { title: input.title, note: input.note };
      if (!(await relabelVaultItem(deps.prisma, scope, name, labels))) {
        throw new ORPCError("NOT_FOUND", { message: "Credential not found" });
      }
    } catch (error) {
      throw mapBotSecretStoreError(error);
    }
    return vaultItemDto(deps, scope, name);
  }
  const { value } = input;
  // A pasted page URL is saved under its site. One with a username or password is left
  // as typed, so the origin rule turns it down and the person can fix it.
  const site = pageUrlOrigin(input.destination.origin, { allowUserinfo: false, maxLength: 2048 });
  const destinationFor = (itemName: string): BotSecretDestination => ({
    ...input.destination,
    name: itemName,
    ...(site ? { origin: site } : {}),
  });
  const store = (itemName: string, createOnly: boolean) =>
    storeBotSecret({
      prisma: deps.prisma,
      secretStore: deps.secrets,
      scope,
      destination: destinationFor(itemName),
      plaintext: value,
      title: input.title,
      note: input.note,
      createOnly,
    });
  try {
    if (name) {
      await store(name, false);
      await resolveSecretAsksForSavedCredential(deps, scope, destinationFor(name));
      return vaultItemDto(deps, scope, name);
    }
    // A new item is named from its title. It is only ever created, so another save that took
    // the same name a moment earlier is never replaced; this one takes the next free name.
    const base = input.title || defaultVaultItemTitle(input.destination, value);
    for (let attempt = 0; ; attempt++) {
      const fresh = await newVaultItemName(deps.prisma, scope, base, input.destination.auth.type);
      try {
        await store(fresh, true);
        await resolveSecretAsksForSavedCredential(deps, scope, destinationFor(fresh));
        return vaultItemDto(deps, scope, fresh);
      } catch (error) {
        if (attempt >= 2 || !isSecretAlreadySaved(error)) throw error;
      }
    }
  } catch (error) {
    throw mapBotSecretStoreError(error);
  }
}

async function vaultItemDto(
  deps: RouterDeps,
  scope: ReturnType<typeof vaultScope>,
  name: string,
): Promise<BotSecretMetadata> {
  const [row] = await listVaultItems(deps.prisma, deps.secrets, scope, name);
  if (!row) throw new ORPCError("CONFLICT", { message: "Credential was not saved" });
  return botSecretMetadataDto(row);
}

function botSecretMetadataDto(
  row: Awaited<ReturnType<typeof listVaultItems>>[number],
): BotSecretMetadata {
  // Unreadable or no-longer-storable destinations become auth:null so the owner UI stays remove-only.
  const parsed = BotSecretAuth.safeParse(row.auth);
  let auth: BotSecretMetadata["auth"] = null;
  if (parsed.success) {
    try {
      normalizeSecretDestination({ name: row.name, origin: row.origin, auth: parsed.data });
      auth = parsed.data;
    } catch {
      auth = null;
    }
  }
  return {
    name: row.name,
    origin: row.origin,
    auth,
    title: row.title,
    note: row.note,
    ...(row.preview ? { preview: row.preview } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Import a pasted cookie export into the vault. A re-import of the same site refreshes the
 * item already saved for that origin instead of adding another row. Only import metadata is
 * ever returned; a cookie value never leaves this call.
 */
async function importVaultCookies(
  deps: RouterDeps,
  scope: ReturnType<typeof vaultScope>,
  input: VaultImportCookiesInput,
) {
  const parsed = importBrowserCookies({ content: input.content, origin: input.origin });
  if (!parsed.ok) throw new ORPCError("BAD_REQUEST", { message: parsed.error });
  if (parsed.imported === 0) throw new ORPCError("BAD_REQUEST", { message: "没有导入任何 Cookie" });
  const origin = new URL(input.origin).origin;
  const auth = {
    type: "browser_cookies" as const,
    cookieCount: parsed.imported,
    earliestExpiry: parsed.earliestExpiry,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  };
  let name = input.name;
  if (!name) {
    const rows = await listVaultItems(deps.prisma, deps.secrets, scope);
    const existing = rows.find(
      (row) =>
        row.origin === origin && BotSecretAuth.safeParse(row.auth).data?.type === "browser_cookies",
    );
    name =
      existing?.name ??
      (await newVaultItemName(
        deps.prisma,
        scope,
        input.title || new URL(origin).hostname.replace(/^www\./, ""),
        "browser_cookies",
      ));
  }
  try {
    await storeBotSecret({
      prisma: deps.prisma,
      secretStore: deps.secrets,
      scope,
      destination: { name, origin, auth },
      plaintext: encodeBrowserCookieSet(parsed.cookies),
      title: input.title,
      note: input.note,
    });
  } catch (error) {
    throw mapBotSecretStoreError(error);
  }
  await resolveSecretAsksForSavedCredential(deps, scope, { name, origin, auth });
  return {
    name,
    imported: parsed.imported,
    skipped: parsed.skipped,
    cookieCount: parsed.imported,
    earliestExpiry: parsed.earliestExpiry,
  };
}

/**
 * Clear cookies from every browser profile that may have received them: the user's own
 * computers in any Space, and this Space's shared computer. Only a running computer has a
 * live browser to clear; a stopped one keeps its profile on disk, so its cookies survive
 * this delete until it next boots. Every failure is logged, never surfaced: the delete
 * itself must not fail because a profile could not be reached.
 */
async function clearBrowserCookies(
  deps: RouterDeps,
  actor: Actor,
  cookies: Array<{ name: string; domain: string; path: string }>,
) {
  if (!deps.sandbox?.pageBrowser) {
    getLogger().warn("vault cookie clear skipped: sandbox has no browser");
    return;
  }
  let computers: Array<{
    homeKey: string;
    kind: string;
    providerRef: string | null;
    state: string;
  }>;
  try {
    computers = await deps.prisma.computer.findMany({
      where: { OR: [{ userId: actor.userId }, { spaceId: actor.spaceId }] },
      select: { homeKey: true, kind: true, providerRef: true, state: true },
    });
  } catch (error) {
    getLogger().warn("vault cookie clear skipped: computers could not be listed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return;
  }
  for (const computer of computers) {
    if (!computer.providerRef) continue;
    if (computer.state !== "running") {
      getLogger().warn("vault cookie clear skipped: computer is not running", {
        "computer.homeKey": computer.homeKey,
      });
      continue;
    }
    let ref: ReturnType<typeof toComputerRef>;
    try {
      ref = toComputerRef(computer);
    } catch {
      continue;
    }
    try {
      const result = await deps.sandbox.pageBrowser(
        ref,
        { command: "clear_cookies", cookies },
        computerContext(actor, ref.botId, "vault.remove.clear-cookies"),
      );
      if (!result.ok) {
        getLogger().warn("vault cookie clear failed", {
          "computer.homeKey": computer.homeKey,
        });
      }
    } catch (error) {
      getLogger().warn("vault cookie clear failed", {
        "computer.homeKey": computer.homeKey,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}

/**
 * Delete a vault item, and when it held browser cookies, clear those cookies from the
 * browser profiles too — deleting the row alone leaves the persistent profile signed in.
 * The row is read before it is deleted, so its cookie names are known; only name, domain
 * and path ever go to a browser, never a value.
 */
async function removeVaultCredential(
  deps: RouterDeps,
  actor: Actor,
  scope: ReturnType<typeof vaultScope>,
  name: string,
) {
  const resolved = await settingsTarget(deps.prisma, actor, "credentials", scope.vault);
  const row = await deps.prisma.vaultCredential.findFirst({
    where: {
      userId: actor.userId,
      spaceId: resolved === "space" ? actor.spaceId : null,
      name,
    },
    select: { id: true, ciphertext: true, auth: true },
  });
  let cookies: Array<{ name: string; domain: string; path: string }> | undefined;
  if (row && BotSecretAuth.safeParse(row.auth).data?.type === "browser_cookies") {
    try {
      const plaintext = await deps.secrets.load(row.ciphertext, row.id);
      cookies = decodeBrowserCookieSet(plaintext).map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
      }));
    } catch {
      // The row is still deleted; only the profile clear is lost, and it is logged.
      getLogger().warn("vault cookie clear skipped: stored cookies could not be read", { name });
    }
  }
  await forgetBotSecret(deps.prisma, scope, name);
  if (cookies?.length) await clearBrowserCookies(deps, actor, cookies);
  return { ok: true as const };
}

/** The creation intro's hidden prompt. It names only the tools this bot still has. */
export function botIntroPrompt(input: {
  userName: string;
  spaceName: string | null;
  disabledBuiltinTools: readonly string[];
}): string {
  const canAsk = !input.disabledBuiltinTools.includes("ask_user");
  const canUpdate = !input.disabledBuiltinTools.includes("update_bot");
  const options =
    "two to four short options that fit your name, anything your description or instructions already say, and what you know about them, never a stock list";
  return [
    [
      "You were just created.",
      input.userName ? `${input.userName} made you.` : undefined,
      input.spaceName ? `Their team space is called "${input.spaceName}".` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
    // The greeting goes in the question itself, so the card stands on its own.
    canAsk
      ? `Call ask_user right away, with no text before it. Its question greets them by first name in a few words and asks what they want you for, with ${options}. They can also type their own answer.`
      : `Greet them by first name in a few words and ask in one sentence what they want you for, suggesting ${options}.`,
    "If your profile already makes that clear, say in one line what you will do instead of asking.",
    canUpdate
      ? 'Once you know what you are for, use update_bot to set what is already clear: a one-line description of what you do, your instructions on how you do it, and a short name if yours is still a placeholder like "New Bot". Leave anything vague unset to fill in later as the work becomes clearer, and otherwise keep your name and look.'
      : undefined,
    "Then get started, asking one follow-up only if you cannot start without it.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Creating a bot asks only for a name and a look, so one hidden-prompt turn greets the user and
 * asks what the bot is for. The executor limits the "created" trigger to that question and the
 * bot's own profile, and answering resumes the run as the user's turn.
 */
export async function enqueueBotIntroRun(deps: RouterDeps, actor: Actor, bot: Bot): Promise<void> {
  const threadId = bot.threadId;
  if (!threadId) return;
  // In the scripted test/eval runtime an automatic run would compete with the harness's next
  // queued response.
  if (deps.env.agentRuntime === "scripted") return;
  if ((await modelSetup(deps, actor)).needsModel) return;
  const [user, space] = await Promise.all([
    deps.prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }),
    deps.prisma.space.findUnique({
      where: { id: actor.spaceId },
      select: { name: true, isDefault: true },
    }),
  ]);
  const prompt = botIntroPrompt({
    userName: displayName(user?.name, ""),
    spaceName: space && !space.isDefault ? space.name.trim() || null : null,
    disabledBuiltinTools: bot.disabledBuiltinTools ?? [],
  });
  const run = await deps.prisma.$transaction(async (tx) => {
    // An idempotent create (spawnKey) returns the bot it already made; it gets one intro.
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
    if (await tx.run.findFirst({ where: { botId: bot.id }, select: { id: true } })) return null;
    const task = await tx.task.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId,
        userId: actor.userId,
        prompt,
        status: "queued",
      },
    });
    return tx.run.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId,
        taskId: task.id,
        userId: actor.userId,
        status: "queued",
        trigger: "created",
      },
      select: { id: true },
    });
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (run) await deps.jobs.enqueue(runContinueJob(run.id));
}

export function botsRoutes(ctx: RouterContext) {
  const { deps, repos, botModelValidation, removeBot, agentImportServices, groupRepos, authed } =
    ctx;
  return {
    bots: {
      list: authed.bots.list.handler(async ({ context }) => repos.listBots(context.actor)),
      listArchived: authed.bots.listArchived.handler(async ({ context }) =>
        repos.listBots(context.actor, { archived: true }),
      ),
      get: authed.bots.get.handler(async ({ context, input }) => {
        const found = (await repos.listBots(context.actor)).find((bot) => bot.id === input.botId);
        if (!found) throw new IsolationError();
        return found;
      }),
      create: authed.bots.create.handler(async ({ context, input }) => {
        let bot: Bot;
        try {
          // Older apps always send Original, which would pin every new bot to it.
          const { avatarSet: _ignored, ...request } = input;
          bot = await repos.createBot(context.actor, request);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
        await enqueueBotIntroRun(deps, context.actor, bot).catch((error) => {
          getLogger().error("bot intro run enqueue", error);
        });
        return bot;
      }),
      importPreview: authed.bots.importPreview.handler(async ({ context, input }) =>
        previewAgentImport(agentImportServices as AgentImportServices, context.actor, input),
      ),
      importCreate: authed.bots.importCreate.handler(async ({ context, input }) => {
        let bot: Bot;
        try {
          bot = await createImportedBot(agentImportServices, context.actor, input, context.signal);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
        // An imported bot starts inert: no intro run, paused routines, unapproved servers.
        return bot;
      }),
      importSetupState: authed.bots.importSetupState.handler(async ({ context, input }) =>
        agentImportSetupState(agentImportServices as AgentImportServices, context.actor, input),
      ),
      templates: authed.bots.templates.handler(async ({ context }) =>
        listBotTemplates(agentImportServices, context.actor),
      ),
      createFromTemplate: authed.bots.createFromTemplate.handler(async ({ context, input }) => {
        try {
          // Like an import, the bot starts inert: no intro run, and its routines are paused.
          return await createBotFromTemplate(
            agentImportServices,
            () => managedAppCatalog(deps.connectors, context.actor, "bots.createFromTemplate"),
            context.actor,
            input,
            context.signal,
          );
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
      }),
      duplicate: authed.bots.duplicate.handler(async ({ context, input }) => {
        const source = await repos.getBot(context.actor, input.botId);
        const duplicate = await repos
          .createBot(context.actor, {
            name: duplicateBotName(source.name),
            description: source.description,
            instructions: source.instructions,
            notifyOnFinish: source.notifyOnFinish,
            dailyCheckIns: source.dailyCheckIns,
            color: source.color,
            avatarSet: resolveBotAvatarSet(source.avatarSet),
            avatarSetPinned: source.avatarSetPinned,
            computerMode: source.computer?.scope === "dedicated" ? "dedicated" : "team",
            modelProvider: source.modelProvider,
            modelId: source.modelId,
            thinkingLevel: source.thinkingLevel,
            disabledBuiltinTools: source.disabledBuiltinTools,
            replyMode: source.replyMode,
          })
          .catch((error: unknown) => {
            throw mapSpaceLifecycleError(error);
          });
        const assignments = await deps.prisma.botMcpServer.findMany({
          where: {
            botId: source.id,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (assignments.length) {
          await deps.prisma.botMcpServer.createMany({
            data: assignments.map((assignment) => ({
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
              botId: duplicate.id,
              serverId: assignment.serverId,
              allowAllTools: assignment.allowAllTools,
              allowedTools: assignment.allowedTools as Prisma.InputJsonValue,
            })),
          });
        }
        return duplicate;
      }),
      reorder: authed.bots.reorder.handler(async ({ context, input }) => {
        await repos.reorderBots(context.actor, input.botIds);
        return { ok: true as const };
      }),
      update: authed.bots.update.handler(async ({ context, input }) => {
        const existing = await repos.getBot(context.actor, input.botId);
        if (input.sectionId) {
          const section = await deps.prisma.botSection.findFirst({
            where: {
              id: input.sectionId,
              spaceId: context.actor.spaceId,
            },
            select: { id: true },
          });
          if (!section) throw new IsolationError();
        }
        const modelChange = await validateBotModelChange(botModelValidation(context.actor), {
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          provider:
            input.modelProvider !== undefined ? input.modelProvider : existing.modelProvider,
          model: input.modelId !== undefined ? input.modelId : existing.modelId,
          thinkingLevel: input.thinkingLevel,
          current: { provider: existing.modelProvider, model: existing.modelId },
        });
        if (!modelChange.ok) throw new ORPCError("BAD_REQUEST", { message: modelChange.error });
        // `existing` is the Prisma row, so its JSON columns parse first; the
        // contract lists they become are what validation and writes use.
        // Each family's stored lists split into its two pools; the merged
        // list is what older clients read and what re-checks compare against.
        const existingTranslationPools = splitBotModelPools(
          existing.translationModels,
          existing.translationBackupModels,
        );
        const existingVideoPools = splitBotModelPools(
          existing.videoModels,
          existing.videoBackupModels,
        );
        const existingImagePools = splitBotModelPools(
          existing.imageModels,
          existing.imageBackupModels,
        );
        const existingImageEditPools = splitBotModelPools(
          existing.imageEditModels,
          existing.imageEditBackupModels,
        );
        const existingVideoEditPools = splitBotModelPools(
          existing.videoEditModels,
          existing.videoEditBackupModels,
        );
        const existingTranslationModels = mergeBotModelPools(existingTranslationPools);
        const existingVideoModels = mergeBotModelPools(existingVideoPools);
        const existingImageModels = mergeBotModelPools(existingImagePools);
        const existingImageEditModels = mergeBotModelPools(existingImageEditPools);
        const existingVideoEditModels = mergeBotModelPools(existingVideoEditPools);
        const existingVideoPresets = parseBotPromptPresets(existing.videoPromptPresets);
        const existingImagePresets = parseBotPromptPresets(existing.imagePromptPresets);
        // Every entry of an ordered model list must be a model this user has
        // connected; entries already on the list skip the re-check.
        const validateModelListChange = async (
          next: readonly BotModelEntry[] | null | undefined,
          current: readonly BotModelEntry[] | null | undefined,
          label: string,
        ) => {
          if (next === undefined) return;
          for (const entry of next ?? []) {
            const already = (current ?? []).some(
              (item) => item.provider === entry.provider && item.model === entry.model,
            );
            const change = await validateBotModelChange(botModelValidation(context.actor), {
              userId: context.actor.userId,
              spaceId: context.actor.spaceId,
              provider: entry.provider,
              model: entry.model,
              current: already
                ? { provider: entry.provider, model: entry.model }
                : { provider: null, model: null },
            });
            if (!change.ok)
              throw new ORPCError("BAD_REQUEST", {
                message: `${label} ${entry.model}: ${change.error}`,
              });
          }
        };
        // Older apps still send the single translation model: setting it moves
        // that model to the front of the list (or clears the list when both
        // are null). New clients send the whole list instead.
        const legacyTranslationModels = (): BotModelEntry[] | null | undefined => {
          if (input.translationModels !== undefined) return input.translationModels;
          if (
            input.translationModelProvider === undefined &&
            input.translationModelId === undefined
          )
            return undefined;
          if (!input.translationModelProvider || !input.translationModelId) return [];
          const entry = {
            provider: input.translationModelProvider,
            model: input.translationModelId,
          };
          return [
            entry,
            ...(existingTranslationModels ?? []).filter(
              (item) => item.provider !== entry.provider || item.model !== entry.model,
            ),
          ];
        };
        const effectiveTranslationModels = legacyTranslationModels();
        /**
         * One family's two pools, resolved from the update input. New clients
         * send the pools separately; older ones send the single ordered list
         * (first entry -> main pool, rest -> backup pool). Undefined when the
         * client sent neither shape, so the family is left alone.
         */
        const resolveFamilyPools = (
          main: readonly BotModelEntry[] | null | undefined,
          backup: readonly BotModelEntry[] | null | undefined,
          legacy: readonly BotModelEntry[] | null | undefined,
        ): { mainPool: BotModelEntry[]; backupPool: BotModelEntry[] } | undefined => {
          if (main === undefined && backup === undefined && legacy === undefined) return undefined;
          const mainPool = [...(main !== undefined ? (main ?? []) : (legacy?.slice(0, 1) ?? []))];
          const backupPool = [
            ...(backup !== undefined ? (backup ?? []) : (legacy?.slice(1) ?? [])),
          ];
          // A model cannot sit in both pools; the main pool wins.
          const mainKeys = new Set(mainPool.map((entry) => `${entry.provider}\0${entry.model}`));
          return {
            mainPool,
            backupPool: backupPool.filter(
              (entry) => !mainKeys.has(`${entry.provider}\0${entry.model}`),
            ),
          };
        };
        const translationPools = resolveFamilyPools(
          input.translationMainModels,
          input.translationBackupModels,
          effectiveTranslationModels,
        );
        const videoPools = resolveFamilyPools(
          input.videoMainModels,
          input.videoBackupModels,
          input.videoModels,
        );
        const imagePools = resolveFamilyPools(
          input.imageMainModels,
          input.imageBackupModels,
          input.imageModels,
        );
        const imageEditPools = resolveFamilyPools(
          input.imageEditMainModels,
          input.imageEditBackupModels,
          input.imageEditModels,
        );
        const videoEditPools = resolveFamilyPools(
          input.videoEditMainModels,
          input.videoEditBackupModels,
          input.videoEditModels,
        );
        await validateModelListChange(
          translationPools?.mainPool,
          existingTranslationModels,
          "Translation model",
        );
        await validateModelListChange(
          translationPools?.backupPool,
          existingTranslationModels,
          "Translation model",
        );
        await validateModelListChange(videoPools?.mainPool, existingVideoModels, "Video model");
        await validateModelListChange(videoPools?.backupPool, existingVideoModels, "Video model");
        await validateModelListChange(imagePools?.mainPool, existingImageModels, "Image model");
        await validateModelListChange(imagePools?.backupPool, existingImageModels, "Image model");
        await validateModelListChange(
          imageEditPools?.mainPool,
          existingImageEditModels,
          "Image edit model",
        );
        await validateModelListChange(
          imageEditPools?.backupPool,
          existingImageEditModels,
          "Image edit model",
        );
        await validateModelListChange(
          videoEditPools?.mainPool,
          existingVideoEditModels,
          "Video edit model",
        );
        await validateModelListChange(
          videoEditPools?.backupPool,
          existingVideoEditModels,
          "Video edit model",
        );
        // A named active preset must exist in the presets it names; when the
        // preset list itself changes and the stored active is gone, the first
        // preset takes over (or none, when the list is empty).
        const resolvePresetUpdate = (
          nextPresets: readonly BotPromptPreset[] | null | undefined,
          nextActive: string | null | undefined,
          currentPresets: readonly BotPromptPreset[] | null | undefined,
          currentActive: string | null | undefined,
        ): { presets?: BotPromptPreset[] | null; active?: string | null } => {
          if (nextPresets === undefined && nextActive === undefined) return {};
          const presets = nextPresets !== undefined ? (nextPresets ?? []) : (currentPresets ?? []);
          if (
            nextActive !== undefined &&
            nextActive !== null &&
            !presets.some((preset) => preset.name === nextActive)
          )
            throw new ORPCError("BAD_REQUEST", { message: "Unknown prompt preset" });
          const active = nextActive !== undefined ? nextActive : (currentActive ?? null);
          const retargeted =
            active !== null && !presets.some((preset) => preset.name === active)
              ? (presets[0]?.name ?? null)
              : active;
          return {
            ...(nextPresets !== undefined
              ? { presets: presets.length > 0 ? [...presets] : null }
              : {}),
            active: retargeted,
          };
        };
        const videoPresetUpdate = resolvePresetUpdate(
          input.videoPromptPresets,
          input.activeVideoPromptPreset,
          existingVideoPresets,
          existing.activeVideoPromptPreset,
        );
        const imagePresetUpdate = resolvePresetUpdate(
          input.imagePromptPresets,
          input.activeImagePromptPreset,
          existingImagePresets,
          existing.activeImagePromptPreset,
        );
        const thinkingLevel = input.thinkingLevel;
        if (!existing.thread) throw new IsolationError();
        // Picking a set on one bot pins it unless it is the owner's default, which unpins it.
        const avatarSetPinned =
          input.avatarSet === undefined
            ? undefined
            : await deps.prisma.user
                .findUniqueOrThrow({
                  where: { id: context.actor.userId },
                  select: { botAvatarSet: true },
                })
                .then((user) => input.avatarSet !== resolveBotAvatarSet(user.botAvatarSet));
        await commitBotUpdate({
          prisma: deps.prisma,
          notify: (threadId, seq) => deps.events.notify(threadId, seq),
          spaceId: context.actor.spaceId,
          threadId: existing.thread.id,
          botId: input.botId,
          emitBotUpdated:
            botProfileLabelsChanged(input) ||
            input.expectedSettings !== undefined ||
            input.dailyCheckIns !== undefined ||
            input.replyMode !== undefined,
          expectedInstructions: input.expectedInstructions,
          expectedSettings: input.expectedSettings,
          data: {
            name: input.name,
            description: input.description,
            instructions: input.instructions,
            notifyOnFinish: input.notifyOnFinish,
            color: input.color,
            avatarSet: input.avatarSet,
            avatarSetPinned,
            pinned: input.pinned,
            memoryScope: input.memoryScope,
            sectionId: input.sectionId,
            voiceId: input.voiceId,
            autoSpeak: input.autoSpeak,
            ...(input.modelProvider !== undefined
              ? { modelProvider: input.modelProvider, modelId: input.modelId ?? null }
              : {}),
            ...(translationPools !== undefined
              ? {
                  translationModels:
                    translationPools.mainPool.length > 0
                      ? (translationPools.mainPool as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                  // Always an array, even when empty: it marks the row as
                  // two-pool data, so reads do not split the main list again.
                  translationBackupModels: translationPools.backupPool as Prisma.InputJsonValue,
                  // The old columns mirror the list's first entry, so older
                  // releases keep reading the primary.
                  translationModelProvider:
                    primaryBotModel(mergeBotModelPools(translationPools))?.provider ?? null,
                  translationModelId:
                    primaryBotModel(mergeBotModelPools(translationPools))?.model ?? null,
                }
              : {}),
            ...(videoPools !== undefined
              ? {
                  videoModels:
                    videoPools.mainPool.length > 0
                      ? (videoPools.mainPool as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                  videoBackupModels: videoPools.backupPool as Prisma.InputJsonValue,
                }
              : {}),
            ...(imagePools !== undefined
              ? {
                  imageModels:
                    imagePools.mainPool.length > 0
                      ? (imagePools.mainPool as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                  imageBackupModels: imagePools.backupPool as Prisma.InputJsonValue,
                }
              : {}),
            ...(imageEditPools !== undefined
              ? {
                  imageEditModels:
                    imageEditPools.mainPool.length > 0
                      ? (imageEditPools.mainPool as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                  imageEditBackupModels: imageEditPools.backupPool as Prisma.InputJsonValue,
                }
              : {}),
            ...(videoEditPools !== undefined
              ? {
                  videoEditModels:
                    videoEditPools.mainPool.length > 0
                      ? (videoEditPools.mainPool as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                  videoEditBackupModels: videoEditPools.backupPool as Prisma.InputJsonValue,
                }
              : {}),
            ...(videoPresetUpdate.presets !== undefined
              ? {
                  videoPromptPresets: videoPresetUpdate.presets
                    ? (videoPresetUpdate.presets as Prisma.InputJsonValue)
                    : Prisma.DbNull,
                }
              : {}),
            ...(videoPresetUpdate.active !== undefined
              ? { activeVideoPromptPreset: videoPresetUpdate.active }
              : {}),
            ...(imagePresetUpdate.presets !== undefined
              ? {
                  imagePromptPresets: imagePresetUpdate.presets
                    ? (imagePresetUpdate.presets as Prisma.InputJsonValue)
                    : Prisma.DbNull,
                }
              : {}),
            ...(imagePresetUpdate.active !== undefined
              ? { activeImagePromptPreset: imagePresetUpdate.active }
              : {}),
            // An empty trigger list means the defaults, so it stores as null.
            ...(input.videoTriggerWords !== undefined
              ? {
                  videoTriggerWords: input.videoTriggerWords?.trim()
                    ? input.videoTriggerWords.trim()
                    : null,
                }
              : {}),
            ...(input.imageTriggerWords !== undefined
              ? {
                  imageTriggerWords: input.imageTriggerWords?.trim()
                    ? input.imageTriggerWords.trim()
                    : null,
                }
              : {}),
            ...(input.translationSourceLanguage !== undefined
              ? { translationSourceLanguage: input.translationSourceLanguage }
              : {}),
            ...(input.translationTargetLanguage !== undefined
              ? { translationTargetLanguage: input.translationTargetLanguage }
              : {}),
            ...(input.autoTranslate !== undefined ? { autoTranslate: input.autoTranslate } : {}),
            ...(input.showTranslationActions !== undefined
              ? { showTranslationActions: input.showTranslationActions }
              : {}),
            ...(input.imageSaveDirectory !== undefined
              ? { imageSaveDirectory: input.imageSaveDirectory }
              : {}),
            ...(input.videoSaveDirectory !== undefined
              ? { videoSaveDirectory: input.videoSaveDirectory }
              : {}),
            ...(input.showMediaFavorite !== undefined
              ? { showMediaFavorite: input.showMediaFavorite }
              : {}),
            ...(input.showMediaShare !== undefined ? { showMediaShare: input.showMediaShare } : {}),
            ...(input.showMediaPreview !== undefined
              ? { showMediaPreview: input.showMediaPreview }
              : {}),
            ...(input.showMediaDownload !== undefined
              ? { showMediaDownload: input.showMediaDownload }
              : {}),
            ...(input.thinkingLevel !== undefined ? { thinkingLevel } : {}),
            ...(input.teamChatAmbientEnabled !== undefined
              ? { teamChatAmbientEnabled: input.teamChatAmbientEnabled }
              : {}),
            ...(input.teamChatRules !== undefined ? { teamChatRules: input.teamChatRules } : {}),
            ...(input.crossSpaceCommunication !== undefined
              ? { crossSpaceCommunication: input.crossSpaceCommunication }
              : {}),
            ...(input.dailyCheckIns !== undefined ? { dailyCheckIns: input.dailyCheckIns } : {}),
            ...(input.fleetManagement !== undefined
              ? { fleetManagement: input.fleetManagement }
              : {}),
            ...(input.replyMode !== undefined ? { replyMode: input.replyMode } : {}),
            ...(input.disabledBuiltinTools !== undefined
              ? { disabledBuiltinTools: input.disabledBuiltinTools }
              : {}),
          },
        }).catch((error) => {
          if (input.expectedSettings && isRecordNotFound(error))
            throw new ORPCError("CONFLICT", {
              message: "Settings changed; review the current settings first.",
            });
          if (!(error instanceof InstructionConflictError)) throw error;
          throw new ORPCError("CONFLICT", { message: error.message });
        });
        for (const setting of changedBotSettings(existing, input)) {
          deps.analytics?.capture(context.actor.userId, { name: "bot_setting_changed", setting });
        }
        const bots = await repos.listBots(context.actor);
        const bot = bots.find((b) => b.id === input.botId);
        if (!bot) throw new IsolationError();
        return bot;
      }),
      translate: authed.bots.translate.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        // The client resolves `auto` to a concrete language; an older client
        // may still send it, so fall back to the bot's saved target, then Chinese.
        const targetLanguage =
          input.targetLanguage === "auto"
            ? resolveTargetLanguage(bot.translationTargetLanguage ?? "auto")
            : input.targetLanguage;
        try {
          const result = await deps.translator(
            context.actor,
            input.botId,
            input.text,
            input.sourceLanguage,
            targetLanguage,
            context.signal,
          );
          if (input.messageId) {
            await keepMessageTranslation({
              prisma: deps.prisma,
              actor: context.actor,
              botId: input.botId,
              messageId: input.messageId,
              targetLanguage,
              result,
            });
          }
          return {
            translatedText: result.translatedText,
            sourceLanguage: result.detectedLanguage,
            targetLanguage,
            modelId: result.modelId,
            usedFallback: result.usedFallback,
            ...(result.attempts ? { attempts: result.attempts } : {}),
          };
        } catch (error) {
          if (error instanceof TranslationModelNotConfiguredError) {
            throw new ORPCError("BAD_REQUEST", { message: "先选择翻译模型" });
          }
          if (error instanceof TranslationFailedError) {
            // The attempts ride the error, so the client can show the switch
            // timeline in the error panel instead of losing it.
            throw new ORPCError("INTERNAL", {
              message: error.message,
              data: { attempts: error.attempts },
            });
          }
          throw error;
        }
      }),
      testMediaModel: authed.bots.testMediaModel.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        const primary =
          input.kind === "video"
            ? primaryBotModel(parseBotModelList(bot.videoModels))
            : primaryBotModel(parseBotModelList(bot.imageModels));
        const current = {
          provider: primary?.provider ?? null,
          model: primary?.model ?? null,
        };
        const validated = await validateBotModelChange(botModelValidation(context.actor), {
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          provider: input.provider,
          model: input.modelId,
          current,
        });
        if (!validated.ok) throw new ORPCError("BAD_REQUEST", { message: validated.error });
        const scope = { userId: context.actor.userId, spaceId: context.actor.spaceId };
        // A hosted model has no user credential to probe with; the test only
        // runs against the user's own connections.
        const hostedProvider = deps.billing?.modelCreditsEnabled
          ? deps.env.defaultProvider
          : undefined;
        if (hostedProvider && input.provider === hostedProvider) {
          return {
            supported: false,
            outcome: "unknown",
            seconds: 0,
            detail: "托管模型暂不支持这样测试",
          };
        }
        let credential: Awaited<ReturnType<typeof findConnectedModelCredential>> | null = null;
        try {
          credential = await findConnectedModelCredential(
            deps.prisma,
            deps.secrets,
            scope,
            input.provider,
            input.modelId,
          );
        } catch {
          credential = null;
        }
        if (!credential) {
          return { supported: false, outcome: "unknown", seconds: 0, detail: "该模型未连接" };
        }
        let plaintext: string;
        try {
          const secret = await deps.prisma.secret.findFirst({
            where: { id: credential.secretId, userId: context.actor.userId, spaceId: null },
            select: { ciphertext: true },
          });
          if (!secret)
            return { supported: false, outcome: "unknown", seconds: 0, detail: "该模型未连接" };
          plaintext = await deps.secrets.load(secret.ciphertext, credential.secretId);
        } catch (error) {
          if (error instanceof SecretStoreUnavailableError)
            throw new ORPCError("SERVICE_UNAVAILABLE", { cause: error });
          return {
            supported: false,
            outcome: "unknown",
            seconds: 0,
            detail: "读不到该连接的密钥",
          };
        }
        const parsed = parseModelSecret(plaintext);
        if (parsed.kind !== "openai_compatible") {
          return {
            supported: false,
            outcome: "unknown",
            seconds: 0,
            detail: "该连接不支持这样测试",
          };
        }
        return probeMediaModel(
          {
            baseUrl: parsed.baseUrl,
            apiKey: parsed.apiKey,
            headers: parsed.headers,
            apiProtocol: parsed.apiProtocol,
            authMode: parsed.authMode,
            model: input.modelId,
            kind: input.kind,
            presetPrompt: input.presetPrompt,
          },
          compatibleEndpointPreset(parsed.baseUrl) ? deps.modelConnectionFetch : undefined,
          context.signal,
          { allowPrivate: mayUsePrivateEndpoint(deps) },
        );
      }),
      testTranslationModel: authed.bots.testTranslationModel.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        // Rows the migration has not backfilled yet still carry the single
        // model instead of the two pools.
        const pools = splitBotModelPools(bot.translationModels, bot.translationBackupModels);
        const primary =
          pools.mainPool?.[0] ??
          (bot.translationModelProvider && bot.translationModelId
            ? { provider: bot.translationModelProvider, model: bot.translationModelId }
            : null);
        const current = {
          provider: primary?.provider ?? null,
          model: primary?.model ?? null,
        };
        const validated = await validateBotModelChange(botModelValidation(context.actor), {
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          provider: input.provider,
          model: input.modelId,
          current,
        });
        if (!validated.ok) throw new ORPCError("BAD_REQUEST", { message: validated.error });
        return deps.translationProber(
          context.actor,
          input.botId,
          input.provider,
          input.modelId,
          context.signal,
        );
      }),
      restoreInstructions: authed.bots.restoreInstructions.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.thread) throw new IsolationError();
        try {
          await commitBotUpdate({
            prisma: deps.prisma,
            notify: (threadId, seq) => deps.events.notify(threadId, seq),
            spaceId: context.actor.spaceId,
            threadId: bot.thread.id,
            botId: bot.id,
            data: {},
            emitBotUpdated: true,
            expectedInstructions: input.expectedInstructions,
            instructionRestore: { versionId: input.versionId, undo: input.undo },
          });
        } catch (error) {
          if (!(error instanceof InstructionConflictError)) throw error;
          throw new ORPCError("CONFLICT", { message: error.message });
        }
        return (await repos.listBots(context.actor)).find((bot) => bot.id === input.botId)!;
      }),
      setComputer: authed.bots.setComputer.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.computer) throw new IsolationError();
        const currentMode = bot.computer.scope === "dedicated" ? "dedicated" : "team";
        if (currentMode === input.mode) {
          try {
            return await repos.setBotComputer(context.actor, bot.id, input.mode);
          } catch (error) {
            throw mapSpaceLifecycleError(error);
          }
        }
        const claimed = await deps.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM computers WHERE id = ${bot.computerId} FOR UPDATE`;
          return tx.bot.updateMany({
            where: { id: bot.id, computerSwitching: false, computer: { maintenanceId: null } },
            data: { computerSwitching: true },
          });
        });
        if (claimed.count !== 1) throw new ORPCError("CONFLICT");
        try {
          const active = await deps.prisma.run.findFirst({
            where: {
              botId: bot.id,
              status: { in: [...ACTIVE_RUN_STATUSES] },
              ...COMPUTER_USING_RUNS,
            },
            select: { id: true },
          });
          if (active) {
            throw new ORPCError("BAD_REQUEST", { message: "Stop the bot first" });
          }
          if (bot.computer.controlBotId === bot.id && hasActiveComputerControl(bot.computer)) {
            throw new ORPCError("BAD_REQUEST", { message: "Release the computer first" });
          }
          if (bot.computer.scope === "dedicated" && bot.computer.providerRef) {
            const ctx = computerContext(context.actor, bot.id, "computer.switch");
            const ref = toComputerRef(bot.computer);
            if (bot.computer.state === "running") {
              await checkpointAndStopComputer(deps, bot.computer, ref, ctx);
            }
            await expireComputerExecutionLeases(deps.prisma, {
              computerId: bot.computer.id,
              botId: bot.id,
            });
            await deps.prisma.computer.update({
              where: { id: bot.computer.id },
              data: {
                state: "stopped",
                controlHolder: "none",
                controlLeaseId: null,
                controlUserId: null,
                controlLeaseExpiresAt: null,
                controlBotId: null,
                controlRunId: null,
                executionRunId: null,
                executionBotId: null,
                executionLeaseExpiresAt: null,
              },
            });
            await recordComputerRunEnd(deps.prisma, bot.computer, "stopped");
          }
          const updated = await repos.setBotComputer(context.actor, bot.id, input.mode);
          deps.analytics?.capture(context.actor.userId, {
            name: "bot_setting_changed",
            setting: "computer",
          });
          return updated;
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        } finally {
          await deps.prisma.bot.updateMany({
            where: { id: bot.id },
            data: { computerSwitching: false },
          });
        }
      }),
      archive: authed.bots.archive.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId, { includeArchived: true });
        await archiveBot(
          {
            prisma: deps.prisma,
            sandbox: deps.sandbox,
            home: deps.home,
            jobs: deps.jobs,
            artifacts: deps.artifacts,
            dataDir: deps.dataDir,
          },
          bot,
          computerContext(context.actor, bot.id, "archive"),
        );
        return { ok: true as const };
      }),
      restore: authed.bots.restore.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId, { includeArchived: true });
        if (!bot.archivedAt) return { ok: true as const };
        try {
          if (bot.computer) {
            // The limit is the computer's owner's: a shared Team Computer is the space owner's.
            await restoreBotUnderComputerQuota(deps.prisma, {
              userId: bot.computer.userId,
              botId: bot.id,
              computerId: bot.computer.id,
            });
          } else {
            await deps.prisma.bot.update({ where: { id: bot.id }, data: { archivedAt: null } });
          }
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
        return { ok: true as const };
      }),
      remove: authed.bots.remove.handler(async ({ context, input }) => {
        await removeBot(context.actor, input.botId, { deleteMemories: input.deleteMemories });
        return { ok: true as const };
      }),
      emailAddress: authed.bots.emailAddress.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        // The address and its inbox are the owner's: other members of the Space never see it.
        if (bot.userId !== context.actor.userId) return null;
        return botEmailAddress(deps.prisma, deps.env.inboundEmailDomain, bot.id);
      }),
      emailAddresses: authed.bots.emailAddresses.handler(async ({ context }) =>
        botEmailAddresses(deps.prisma, deps.env.inboundEmailDomain, context.actor),
      ),
      claimEmailAddress: authed.bots.claimEmailAddress.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (bot.userId !== context.actor.userId) throw new ORPCError("FORBIDDEN");
        return claimBotEmailAddress(deps.prisma, deps.env.inboundEmailDomain, bot.id, input.name);
      }),
      rotateWebhookSecret: authed.bots.rotateWebhookSecret.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        // Webhook runs act as the bot's creator, so only the creator can issue its secret.
        if (bot.userId !== context.actor.userId) throw new ORPCError("FORBIDDEN");
        const plaintext = randomBytes(32).toString("base64url");
        const stored = await deps.secrets.put(plaintext, {
          operationId: "bots.rotateWebhookSecret",
          traceId: "bots.rotateWebhookSecret",
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          signal: context.signal ?? new AbortController().signal,
        });
        await deps.prisma.$transaction(async (tx) => {
          const previousSecretId = bot.webhookSecretId;
          await tx.secret.create({
            data: {
              id: stored.id,
              userId: context.actor.userId,
              spaceId: context.actor.spaceId,
              kind: "webhook",
              ciphertext: stored.ciphertext,
            },
          });
          await tx.bot.update({
            where: { id: bot.id },
            data: { webhookSecretId: stored.id },
          });
          if (previousSecretId) {
            await tx.secret.deleteMany({
              where: {
                id: previousSecretId,
                spaceId: context.actor.spaceId,
                userId: context.actor.userId,
                kind: "webhook",
              },
            });
          }
        });
        return {
          secret: plaintext,
          path: `/api/v1/bots/${bot.id}/webhook`,
          webhookConfigured: true as const,
        };
      }),
    },
    groups: {
      create: authed.groups.create.handler(async ({ context, input }) => {
        try {
          return await groupRepos.createGroup(context.actor, input);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
      }),
      list: authed.groups.list.handler(async ({ context }) => groupRepos.listGroups(context.actor)),
      listArchived: authed.groups.listArchived.handler(async ({ context }) =>
        groupRepos.listGroups(context.actor, { archived: true }),
      ),
      get: authed.groups.get.handler(async ({ context, input }) => {
        const group = await groupRepos.getGroup(context.actor, input.groupId);
        return {
          ...groupRepos.mapGroup(group),
          messages: (
            await loadMessagePage(
              deps.prisma,
              group.thread!.id,
              undefined,
              THREAD_MESSAGE_PAGE_SIZE,
              undefined,
              undefined,
              undefined,
              context.actor.userId,
            )
          ).messages,
        };
      }),
      duplicate: authed.groups.duplicate.handler(async ({ context, input }) => {
        const source = await groupRepos.getGroup(context.actor, input.groupId);
        try {
          return await groupRepos.createGroup(context.actor, {
            name: duplicateBotName(source.name),
            botIds: source.members.map((member) => member.bot.id),
          });
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
      }),
      update: authed.groups.update.handler(async ({ context, input }) => {
        if (input.sectionId) {
          const section = await deps.prisma.botSection.findFirst({
            where: {
              id: input.sectionId,
              spaceId: context.actor.spaceId,
            },
            select: { id: true },
          });
          if (!section) throw new IsolationError();
        }
        const updated = await groupRepos.updateGroup(context.actor, input);
        await stopCancelledGroupRuns(deps, context.actor, updated);
        return updated.group;
      }),
      archive: authed.groups.archive.handler(async ({ context, input }) => {
        const archived = await groupRepos.archiveGroup(context.actor, input.groupId);
        await stopCancelledGroupRuns(deps, context.actor, archived);
        return { ok: true as const };
      }),
      restore: authed.groups.restore.handler(async ({ context, input }) => {
        try {
          await groupRepos.restoreGroup(context.actor, input.groupId);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
        return { ok: true as const };
      }),
      remove: authed.groups.remove.handler(async ({ context, input }) => {
        const removed = await groupRepos.removeGroup(context.actor, input.groupId);
        try {
          await stopCancelledGroupRuns(deps, context.actor, removed);
        } finally {
          // The group row is already gone, so a retry could no longer find these.
          const cleanup = await Promise.allSettled(
            removed.artifactStorageKeys.map((storageKey) =>
              deps.artifacts.remove(
                storageKey,
                computerContext(
                  context.actor,
                  removed.contextBotId,
                  `group-remove:${input.groupId}`,
                ),
              ),
            ),
          );
          for (const result of cleanup) {
            if (result.status === "rejected")
              getLogger().error("group artifact cleanup", result.reason);
          }
          await forgetPageShareSecrets(deps.secrets, removed.pageShareSecrets);
        }
        return { ok: true as const };
      }),
    },
    botSections: {
      list: authed.botSections.list.handler(async ({ context }) =>
        repos.listBotSections(context.actor),
      ),
      create: authed.botSections.create.handler(async ({ context, input }) =>
        repos.createBotSection(context.actor, input).catch((error: unknown) => {
          throw mapSpaceLifecycleError(error);
        }),
      ),
      update: authed.botSections.update.handler(async ({ context, input }) => {
        try {
          return await repos.updateBotSection(context.actor, input);
        } catch (error) {
          if (error instanceof BotSectionNameConflictError) {
            throw new ORPCError("CONFLICT", { message: error.message });
          }
          throw error;
        }
      }),
      remove: authed.botSections.remove.handler(async ({ context, input }) =>
        repos.deleteBotSection(context.actor, input),
      ),
    },
    agentSecrets: {
      list: authed.agentSecrets.list.handler(async ({ context }) =>
        listAgentSecrets({ prisma: deps.prisma, secrets: deps.secrets }, context.actor),
      ),
      put: authed.agentSecrets.put.handler(async ({ context, input }) =>
        putAgentSecret({ prisma: deps.prisma, secrets: deps.secrets }, context.actor, input),
      ),
      remove: authed.agentSecrets.remove.handler(async ({ context, input }) =>
        deleteAgentSecret({ prisma: deps.prisma, secrets: deps.secrets }, context.actor, input.id),
      ),
    },
    vault: {
      list: authed.vault.list.handler(async ({ context, input }) => {
        const rows = await listVaultItems(
          deps.prisma,
          deps.secrets,
          vaultScope(context.actor, input?.scope),
        );
        return rows.map(botSecretMetadataDto);
      }),
      put: authed.vault.put.handler(({ context, input }) =>
        saveVaultCredential(deps, vaultScope(context.actor, input.scope), input),
      ),
      importCookies: authed.vault.importCookies.handler(({ context, input }) =>
        importVaultCookies(deps, vaultScope(context.actor, input.scope), input),
      ),
      reveal: authed.vault.reveal.handler(async ({ context, input }) => {
        await requireIdentityConfirmation(deps.auth, context);
        // Resolved here, so the event names the vault that was read even when scope is omitted.
        const scope = await settingsTarget(deps.prisma, context.actor, "credentials", input.scope);
        const revealed = await revealBotSecret({
          prisma: deps.prisma,
          secretStore: deps.secrets,
          scope: vaultScope(context.actor, scope),
          name: input.name,
        });
        if (!revealed) throw new ORPCError("NOT_FOUND", { message: "Credential not found" });
        await recordSecurityEvent({
          type: "credential.revealed",
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          metadata: {
            procedure: "vault.reveal",
            kind: "vault_credential",
            scope,
            name: input.name,
          },
        });
        return revealed;
      }),
      remove: authed.vault.remove.handler(async ({ context, input }) =>
        removeVaultCredential(
          deps,
          context.actor,
          vaultScope(context.actor, input.scope),
          input.name,
        ),
      ),
    },
    botSecrets: {
      list: authed.botSecrets.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        const rows = await listVaultItems(deps.prisma, deps.secrets, vaultScope(context.actor));
        return rows.map(botSecretMetadataDto);
      }),
      put: authed.botSecrets.put.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return saveVaultCredential(deps, vaultScope(context.actor), input);
      }),
      remove: authed.botSecrets.remove.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        // The same row the vault list shows: a cookie item's profile must be cleared too.
        return removeVaultCredential(deps, context.actor, vaultScope(context.actor), input.name);
      }),
    },
  };
}

function duplicateBotName(name: string) {
  const label = displayName(name, "");
  return label ? `${label.slice(0, 75)} copy` : "";
}
