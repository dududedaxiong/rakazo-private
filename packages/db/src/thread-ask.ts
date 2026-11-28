import type { RealtimeFanout } from "@rakazo_mickvvw/adapter-kit";
import type {
  BotSecretDestination,
  LoginFieldInput,
  MessageBlock,
  OneTimeCodeTarget,
} from "@rakazo_mickvvw/contracts";
import {
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_SECRET_VALUE_MAX_LENGTH,
  BotSecretAuth,
  encodeLoginSecret,
  loginAnswerValue,
  MessageBlock as MessageBlockSchema,
  normalizeOneTimeCode,
} from "@rakazo_mickvvw/contracts";
import {
  ACTIVE_RUN_STATUSES,
  callIdFromClientNonce,
  instructionUpdateDiff,
  isApprovalAskBlock,
  isConversationalRun,
  isSecretAskBlock,
  messageReaction,
  resolveAskChoice,
  SITE_SENDING_TOOLS,
} from "@rakazo_mickvvw/core";
import { urlSite } from "@rakazo_mickvvw/core/egress";
import { approvalEffectKey } from "@rakazo_mickvvw/core/node/approval-effect-key";
import { saveApprovalRule, storedBatchActions } from "./approval-settings.js";
import type { Prisma, PrismaClient } from "./client.js";
import { expireComputerExecutionLeases } from "./computers.js";
import { contentEncryptionOf } from "./content-encryption.js";
import { notifyCommittedEvent, notifyRealtime } from "./event-stream.js";
import type { FinalizeRunResult } from "./events.js";
import { appendEventInTransaction, transientRunEventsWhere } from "./events.js";
import { createThreadMessageInTransaction, loadMessageAuthor } from "./messages.js";
import { deleteRunSecretsInTransaction } from "./run-secrets.js";
import { RUN_TURN_CHECKPOINT_KIND } from "./run-turn-checkpoint.js";
import { recordSecurityEvent } from "./security-events.js";
import { settingsTarget } from "./space-settings.js";
import { createPendingSteeringRun } from "./thread-steering.js";
import { THREAD_LOCK_TRANSACTION_OPTIONS } from "./transaction-retry.js";

export const STRATEGIC_INITIATIVE_NONCE_PREFIX = "strategic-initiative";

/** A one-time answer longer than a saved value may be. Nothing is stored or echoed. */
export class AnswerTooLongError extends Error {
  constructor() {
    super("This answer is too long.");
    this.name = "AnswerTooLongError";
  }
}

export interface PauseRunForInput {
  spaceId: string;
  threadId: string;
  botId: string;
  runId: string;
  attemptId: string;
  leaseOwner: string;
  leaseFence: number;
  blocks: MessageBlock[];
  /**
   * Unredacted choice actions for resume. Persisted only on the run checkpoint
   * (not in message blocks) so clients still see redacted labels.
   */
  offeredActions?: Array<{ id: string; label: string }>;
}

const CHOICE_ASK_CHECKPOINT_KIND = "choice_ask_v1";

function choiceAskCheckpoint(actions: Array<{ id: string; label: string }>): string {
  return JSON.stringify({ kind: CHOICE_ASK_CHECKPOINT_KIND, actions });
}

function resumeChoiceLabel(
  selected: { id: string; label: string },
  checkpoint: string | null | undefined,
): string {
  if (!checkpoint) return selected.label;
  try {
    const parsed = JSON.parse(checkpoint) as {
      kind?: string;
      actions?: Array<{ id?: unknown; label?: unknown }>;
    };
    if (parsed.kind !== CHOICE_ASK_CHECKPOINT_KIND || !Array.isArray(parsed.actions)) {
      return selected.label;
    }
    const offered = parsed.actions.find((action) => action.id === selected.id);
    return typeof offered?.label === "string" && offered.label.length > 0
      ? offered.label
      : selected.label;
  } catch {
    return selected.label;
  }
}

/**
 * A conversational run's request and earlier answers stay in thread history, so its resumed
 * attempt gets just the answer. A background run's prompt never reaches the thread, so it keeps
 * its instructions and every earlier answer; otherwise the resumed attempt forgets them.
 */
function resumePrompt(
  run: { trigger: string; task?: { prompt: string } | null },
  question: string,
  answer: string,
): string {
  if (isConversationalRun(run.trigger)) return answer;
  return [run.task?.prompt.trim(), `${question.trim()}\nAnswer: ${answer}`]
    .filter(Boolean)
    .join("\n\n");
}

export interface AnswerRunInput {
  spaceId: string;
  threadId: string;
  runId: string;
  messageId: string;
  answeredByUserId: string;
  answer: string;
  /** Identifies a spoken answer as part of a live voice call. */
  clientNonce?: string;
  /** A login card's answer, one per requested field. */
  fields?: LoginFieldInput[];
  /** A login card's answer from apps that predate `fields`; `answer` carries its password. */
  username?: string;
  /** Only for a login card: false uses the login for this run only instead of saving it. */
  remember?: false;
  /** Turns down a pending secret request; only the run's user can, and nothing is stored. */
  dismiss?: boolean;
}

/** What request_secret returns to the bot once the user dismissed its card. */
const DISMISSED_SECRET_RESULT = { ok: false, dismissed: true } as const;
const DISMISSED_SECRET_PROMPT = "The user dismissed this request.";

export interface RunSecretWriter {
  withPrepared?<T>(
    prisma: PrismaClient,
    input: AnswerRunInput,
    commit: (writer: RunSecretWriter) => Promise<T>,
  ): Promise<T>;
  store(input: {
    botId: string;
    credential?: BotSecretDestination;
    /** The site a code card was shown for. */
    oneTimeCode?: OneTimeCodeTarget;
    /** False for a login card answered with "Save to Vault" off. */
    remember: boolean;
    runId: string;
    userId: string;
    spaceId: string;
    plaintext: string;
    tx: Prisma.TransactionClient;
  }): Promise<void>;
}

async function findPendingAsk(
  tx: Prisma.TransactionClient,
  input: { threadId: string; runId: string },
) {
  const messages = await tx.message.findMany({
    where: {
      threadId: input.threadId,
      runId: input.runId,
      role: "bot",
    },
    orderBy: { seq: "desc" },
    take: 50,
    select: { id: true, blocks: true },
  });
  for (const message of messages) {
    const parsed = MessageBlockSchema.array().safeParse(message.blocks);
    if (!parsed.success) continue;
    const pendingAsk = parsed.data.find(
      (block) => block.kind === "ask" && block.status !== "answered",
    );
    if (pendingAsk?.kind === "ask") return { messageId: message.id, pendingAsk };
  }
  return null;
}

async function commitAnswerRunInput(
  tx: Prisma.TransactionClient,
  input: AnswerRunInput,
  runSecretWriter?: RunSecretWriter,
): Promise<{
  threadId: string;
  seq: number;
  approval?: { decision: string; effectKind: string };
} | null> {
  // Thread row first, then run rows — the same order as clearThread and finalizeRun, so a
  // concurrent clear cannot deadlock against this transaction.
  await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
  const run = await tx.run.findFirst({
    where: {
      id: input.runId,
      spaceId: input.spaceId,
      threadId: input.threadId,
      status: "waiting_input",
    },
    select: {
      botId: true,
      userId: true,
      checkpoint: true,
      trigger: true,
      clientNonce: true,
      task: { select: { prompt: true } },
    },
  });
  // An answer resumes the run with its user's credentials and rules, so in a shared space only
  // that user answers its cards; anyone else's message starts a run of their own.
  if (!run || run.userId !== input.answeredByUserId) return null;
  const message = await tx.message.findFirst({
    where: {
      id: input.messageId,
      threadId: input.threadId,
      runId: input.runId,
      role: "bot",
    },
  });
  const parsed = MessageBlockSchema.array().safeParse(message?.blocks);
  if (!message || !parsed.success) return null;
  const pendingAsk = parsed.data.find(
    (block) => block.kind === "ask" && block.status !== "answered",
  );
  if (pendingAsk?.kind !== "ask") return null;
  const approvalAsk = isApprovalAskBlock(pendingAsk);
  const secretAsk = isSecretAskBlock(pendingAsk);
  const choiceAsk = !approvalAsk && !secretAsk && Boolean(pendingAsk.actions?.length);
  const selectedChoice = choiceAsk ? resolveAskChoice(input.answer, pendingAsk.actions) : undefined;
  const dismissed = Boolean(input.dismiss);
  // A secret request can be turned down; every other card needs an answer.
  if (dismissed && (!secretAsk || input.answer)) return null;
  const secretRequest = {
    runId: input.runId,
    spaceId: input.spaceId,
    kind: "request_secret",
    status: "intended",
  };
  if (
    dismissed &&
    !(await tx.externalEffect.findFirst({ where: secretRequest, select: { id: true } }))
  )
    return null;
  if (secretAsk && !dismissed && !runSecretWriter) return null;
  // A code is answered as the page will take it; anything that is not a code is not stored.
  const code =
    secretAsk && !dismissed && pendingAsk.oneTimeCode
      ? normalizeOneTimeCode(input.answer)
      : undefined;
  if (secretAsk && !dismissed && pendingAsk.oneTimeCode && !code) return null;
  const loginAsk = secretAsk && !dismissed && pendingAsk.credential?.auth.type === "login";
  const login = loginAsk ? loginAnswerValue(pendingAsk.loginFields, input) : undefined;
  // Login fields belong only to a login card, which cannot be saved without them.
  if (loginAsk ? !login : input.username !== undefined || input.fields !== undefined) return null;
  if (input.remember !== undefined && !loginAsk) return null;
  if (secretAsk && input.answer.length > BOT_SECRET_VALUE_MAX_LENGTH)
    throw new AnswerTooLongError();
  let approvalEffect: {
    id: string;
    kind: string;
    request: Prisma.JsonValue;
    batchActions: Prisma.JsonValue;
  } | null = null;
  let editedInstructions: string | undefined;
  let approvalAnswer = input.answer;
  if (approvalAsk && pendingAsk.instructionUpdate && input.answer.startsWith("{")) {
    try {
      const edited = JSON.parse(input.answer);
      if (
        typeof edited.instructions !== "string" ||
        edited.instructions.length > BOT_INSTRUCTIONS_MAX_LENGTH ||
        Object.keys(edited).length !== 1
      )
        return null;
      editedInstructions = edited.instructions;
      approvalAnswer = "allow";
    } catch {
      return null;
    }
  }
  let approvalUserId: string | null = null;

  if (approvalAsk) {
    if (!pendingAsk.actions?.some((action) => action.id === approvalAnswer)) return null;
    approvalEffect = await tx.externalEffect.findFirst({
      where: {
        id: pendingAsk.approvalEffectId,
        spaceId: input.spaceId,
        runId: input.runId,
        status: "intended",
      },
    });
    if (!approvalEffect) return null;
    if (pendingAsk.instructionUpdate) {
      if (
        approvalEffect.kind !== "update_bot" ||
        pendingAsk.instructionUpdate.botId !== run.botId ||
        (approvalAnswer !== "allow" && approvalAnswer !== "deny") ||
        run.userId !== input.answeredByUserId
      )
        return null;
    }
    if (input.answer === "always") {
      if (run.userId !== input.answeredByUserId) return null;
      approvalUserId = input.answeredByUserId;
    }
  }

  // Answering the creation intro's or a daily check-in's question resumes as the user's
  // turn: with the conversation and every tool, to get going on that answer.
  const answersOpener =
    run.trigger === "created" ||
    (run.trigger === "routine" &&
      Boolean(run.clientNonce?.startsWith(`${STRATEGIC_INITIATIVE_NONCE_PREFIX}:`)));
  const resumedTrigger = answersOpener && !approvalAsk && !secretAsk ? "user" : run.trigger;
  const queued = await tx.run.updateMany({
    where: {
      id: input.runId,
      spaceId: input.spaceId,
      threadId: input.threadId,
      status: "waiting_input",
    },
    data: {
      status: "queued",
      ...(resumedTrigger !== run.trigger ? { trigger: resumedTrigger } : {}),
      ...(choiceAsk ? { checkpoint: null } : {}),
    },
  });
  if (queued.count !== 1) return null;

  const recordedAnswer = secretAsk ? "" : (selectedChoice?.id ?? approvalAnswer);
  const callId = callIdFromClientNonce(input.clientNonce);
  const recordsCallUtterance = Boolean(callId && !secretAsk);

  // Give spoken answers the same durable, call-scoped user utterance as other voice turns.
  // Secret asks stay out of message history; the call UI requires those answers on screen.
  if (recordsCallUtterance) {
    const blocks = [{ kind: "text" as const, text: input.answer }];
    const utterance = await createThreadMessageInTransaction(tx, {
      threadId: input.threadId,
      role: "user",
      blocks,
      botId: run.botId,
      authorUserId: input.answeredByUserId,
      runId: input.runId,
      clientNonce: input.clientNonce,
    });
    const author = await loadMessageAuthor(tx, input.answeredByUserId);
    await appendEventInTransaction(tx, {
      spaceId: input.spaceId,
      threadId: input.threadId,
      botId: run.botId,
      type: "thread.message.created",
      runId: input.runId,
      payload: { messageId: utterance.id, role: "user", blocks, callId, author },
    });
  }

  if (approvalAsk) {
    if (pendingAsk.instructionUpdate) {
      if (editedInstructions !== undefined) {
        const stored = await tx.externalEffect.findUniqueOrThrow({
          where: { id: approvalEffect!.id },
        });
        const request = stored.request as Record<string, Prisma.InputJsonValue>;
        await tx.externalEffect.update({
          where: { id: approvalEffect!.id },
          data: {
            request: { ...request, instructions: editedInstructions },
            idempotencyKey: approvalEffectKey(input.runId, approvalEffect!.kind, {
              ...request,
              instructions: editedInstructions,
            }),
          },
        });
      }
    }
    const allowed = approvalAnswer === "allow" || approvalAnswer === "always";
    await tx.externalEffect.update({
      where: { id: approvalEffect!.id },
      data: { status: allowed ? "approved" : "denied" },
    });
    // "Always" on a card for a request to a site allows that site, never every site the tool can
    // reach, and on a batch allows each action in it, never every action the batch tool can run.
    const site = alwaysAllowedSite(approvalEffect!);
    const tools = storedBatchActions(approvalEffect!.batchActions) ?? [approvalEffect!.kind];
    if (input.answer === "always" && (site || approvalEffect!.kind !== "web_fetch")) {
      // Saved where the member's confirmations apply in this Space: the account or its override.
      for (const tool of site ? [site] : tools) {
        await saveApprovalRule(
          tx,
          { userId: approvalUserId!, spaceId: input.spaceId },
          { effect: "always_allow", matchKind: site ? "site" : "tool", matchValue: tool },
        );
      }
    }
  } else if (dismissed) {
    // Nothing is stored. The bot's request_secret call returns the dismissal, and the resumed
    // run is told why.
    await tx.externalEffect.updateMany({
      where: secretRequest,
      data: { status: "completed", result: DISMISSED_SECRET_RESULT },
    });
    const task = await tx.task.updateMany({
      where: { runs: { some: { id: input.runId } } },
      data: { prompt: resumePrompt(run, pendingAsk.text, DISMISSED_SECRET_PROMPT) },
    });
    if (task.count !== 1) throw new Error("Run task was not available to answer");
  } else if (secretAsk) {
    await runSecretWriter!.store({
      botId: run.botId,
      credential: pendingAsk.credential,
      oneTimeCode: pendingAsk.oneTimeCode,
      remember: input.remember !== false,
      runId: input.runId,
      userId: run.userId,
      spaceId: input.spaceId,
      plaintext: login ? encodeLoginSecret(login) : (code ?? input.answer),
      tx,
    });
    await tx.externalEffect.updateMany({
      where: {
        runId: input.runId,
        spaceId: input.spaceId,
        kind: "request_secret",
        status: "intended",
      },
      data: {
        status: "approved",
        ...(pendingAsk.credential ? { result: { credentialSaved: pendingAsk.credential } } : {}),
      },
    });
  } else {
    const resumeLabel = selectedChoice
      ? resumeChoiceLabel(selectedChoice, run.checkpoint)
      : undefined;
    const task = await tx.task.updateMany({
      where: { runs: { some: { id: input.runId } } },
      data: {
        prompt: resumePrompt(
          { ...run, trigger: resumedTrigger },
          pendingAsk.text,
          selectedChoice ? `Selected choice ${selectedChoice.id}: ${resumeLabel}` : input.answer,
        ),
      },
    });
    if (task.count !== 1) throw new Error("Run task was not available to answer");
  }

  const blocks = parsed.data.map((block) =>
    block === pendingAsk
      ? {
          ...block,
          status: "answered" as const,
          answer: recordedAnswer,
          ...(dismissed ? { dismissed: true as const } : {}),
          ...(input.remember === false ? { remembered: false as const } : {}),
          ...(editedInstructions !== undefined && pendingAsk.instructionUpdate
            ? {
                instructionUpdate: { ...pendingAsk.instructionUpdate, after: editedInstructions },
                detail: instructionUpdateDiff(
                  pendingAsk.instructionUpdate.before,
                  editedInstructions,
                ),
              }
            : {}),
        }
      : block,
  );
  await tx.message.update({ where: { id: message.id }, data: { blocks } });
  const updated = await appendEventInTransaction(tx, {
    spaceId: input.spaceId,
    threadId: input.threadId,
    botId: run.botId,
    type: "thread.message.updated",
    runId: input.runId,
    payload: { messageId: message.id, role: "bot", blocks },
  });
  return {
    threadId: updated.threadId,
    seq: updated.seq,
    ...(approvalEffect
      ? { approval: { decision: approvalAnswer, effectKind: approvalEffect.kind } }
      : {}),
  };
}

export async function answerRunInput(
  prisma: PrismaClient,
  input: AnswerRunInput,
  realtime?: RealtimeFanout,
  runSecretWriter?: RunSecretWriter,
): Promise<boolean> {
  const commit = (writer = runSecretWriter) =>
    prisma.$transaction(
      async (tx: Prisma.TransactionClient) => commitAnswerRunInput(tx, input, writer),
      THREAD_LOCK_TRANSACTION_OPTIONS,
    );
  // Unwrapping space keys can wait on the key manager; keep that wait outside the transaction.
  await contentEncryptionOf(prisma)?.ring.all(input.spaceId);
  // A dismissal has no secret to prepare.
  const committed =
    runSecretWriter?.withPrepared && !input.dismiss
      ? await runSecretWriter.withPrepared(prisma, input, commit)
      : await commit();

  if (!committed) return false;
  if (committed.approval) {
    await recordSecurityEvent({
      type: "approval.decided",
      userId: input.answeredByUserId,
      spaceId: input.spaceId,
      metadata: {
        decision: committed.approval.decision,
        effectKind: committed.approval.effectKind,
        runId: input.runId,
      },
    });
  }
  await notifyRealtime(realtime, committed.threadId, committed.seq);
  return true;
}

export interface SavedCredentialAskResolution {
  threadId: string;
  runId: string;
  messageId: string;
  seq: number;
}

export interface ResolveSecretAsksForSavedCredentialInput {
  spaceId: string;
  userId: string;
  destination: BotSecretDestination;
}

/**
 * Whether the saved credential satisfies a pending secret ask, judged by what the resumed
 * request_secret call can find: the same credential by name, the only login for the site,
 * or the only cookie item for the site. A cookie is a login route (the browser injects it
 * on navigate), so it satisfies a login ask; anything else stays pending. The site lookups
 * are HTTPS-only, matching findSiteLogin / findSiteCookie.
 */
function savedCredentialSatisfiesSecretAsk(
  saved: BotSecretDestination,
  ask: BotSecretDestination,
  counts: { logins: number; cookies: number },
): boolean {
  if (!saved.origin || saved.origin !== ask.origin) return false;
  const siteLookup = saved.origin.startsWith("https://");
  if (ask.auth.type === "login") {
    if (saved.auth.type === "login") {
      return saved.name === ask.name || (siteLookup && counts.logins === 1);
    }
    if (saved.auth.type === "browser_cookies") {
      return siteLookup && counts.cookies === 1;
    }
    return false;
  }
  if (ask.auth.type === "browser_cookies") {
    if (saved.auth.type !== "browser_cookies") return false;
    return saved.name === ask.name || (siteLookup && counts.cookies === 1);
  }
  return false;
}

/**
 * Answer every pending secret ask this saved credential satisfies, so a run parked on
 * request_secret resumes instead of waiting for a card the person already answered by
 * saving in Settings. The credential is already stored; this only marks the asks
 * answered, approves their request_secret effects with the saved credential, and queues
 * the runs. A save the run cannot read (another vault) resolves nothing. The counts are
 * read once up front; a concurrent save changing them can only make the resumed tool
 * ask again, never use the wrong credential.
 */
export async function answerPendingSecretAsksForSavedCredential(
  prisma: PrismaClient,
  input: ResolveSecretAsksForSavedCredentialInput,
  realtime?: RealtimeFanout,
): Promise<SavedCredentialAskResolution[]> {
  const { spaceId, userId, destination } = input;
  if (!destination.origin) return [];
  // The vault this Space's runs read: the account's, or the Space's own.
  const target = await settingsTarget(prisma, { userId, spaceId }, "credentials");
  const vaultWhere = { userId, spaceId: target === "space" ? spaceId : null };
  // The saved row must be in the vault the run reads; a save aimed at the other vault is
  // invisible to the bot, so resolving would resume a run that still finds nothing.
  const savedRow = await prisma.vaultCredential.findFirst({
    where: { ...vaultWhere, name: destination.name },
    select: { id: true },
  });
  if (!savedRow) return [];
  const rows = await prisma.vaultCredential.findMany({
    where: { ...vaultWhere, origin: destination.origin },
    select: { auth: true },
  });
  const counts = { logins: 0, cookies: 0 };
  for (const row of rows) {
    const auth = BotSecretAuth.safeParse(row.auth).data;
    if (auth?.type === "login") counts.logins += 1;
    else if (auth?.type === "browser_cookies") counts.cookies += 1;
  }
  const runs = await prisma.run.findMany({
    where: { spaceId, userId, status: "waiting_input" },
    select: { id: true, threadId: true, botId: true },
  });
  const resolved: SavedCredentialAskResolution[] = [];
  for (const run of runs) {
    const messages = await prisma.message.findMany({
      where: { threadId: run.threadId, runId: run.id, role: "bot" },
      orderBy: { seq: "desc" },
      take: 50,
      select: { id: true, blocks: true },
    });
    // A waiting run is parked on exactly one pending ask; older asks are already answered.
    let pending: { messageId: string; credential: BotSecretDestination } | null = null;
    for (const message of messages) {
      const parsed = MessageBlockSchema.array().safeParse(message.blocks);
      if (!parsed.success) continue;
      const ask = parsed.data.find(
        (block) =>
          block.kind === "ask" &&
          block.status !== "answered" &&
          block.input === "secret" &&
          block.credential !== undefined,
      );
      if (ask?.kind === "ask" && ask.credential) {
        pending = { messageId: message.id, credential: ask.credential };
        break;
      }
    }
    if (!pending) continue;
    if (!savedCredentialSatisfiesSecretAsk(destination, pending.credential, counts)) continue;
    const committed = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) =>
        commitResolveSecretAsk(tx, {
          spaceId,
          threadId: run.threadId,
          runId: run.id,
          botId: run.botId,
          messageId: pending.messageId,
          userId,
          savedDestination: destination,
        }),
      THREAD_LOCK_TRANSACTION_OPTIONS,
    );
    if (committed) {
      resolved.push(committed);
      await notifyRealtime(realtime, committed.threadId, committed.seq);
    }
  }
  return resolved;
}

/**
 * The answer half of commitAnswerRunInput for a credential that is already stored: mark the
 * ask answered, approve its request_secret effect with the saved credential, and queue the
 * run. No value is stored and no login fields are validated here; the vault save that
 * called this already did both.
 */
async function commitResolveSecretAsk(
  tx: Prisma.TransactionClient,
  input: {
    spaceId: string;
    threadId: string;
    runId: string;
    botId: string;
    messageId: string;
    userId: string;
    savedDestination: BotSecretDestination;
  },
): Promise<{ threadId: string; runId: string; messageId: string; seq: number } | null> {
  await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
  const run = await tx.run.findFirst({
    where: {
      id: input.runId,
      spaceId: input.spaceId,
      threadId: input.threadId,
      status: "waiting_input",
    },
    select: { userId: true },
  });
  if (!run || run.userId !== input.userId) return null;
  const message = await tx.message.findFirst({
    where: {
      id: input.messageId,
      threadId: input.threadId,
      runId: input.runId,
      role: "bot",
    },
  });
  const parsed = MessageBlockSchema.array().safeParse(message?.blocks);
  if (!message || !parsed.success) return null;
  const pendingAsk = parsed.data.find(
    (block) => block.kind === "ask" && block.status !== "answered",
  );
  if (pendingAsk?.kind !== "ask") return null;
  // The ask may have been answered or dismissed since it was found; only a still-pending
  // secret ask for a credential is resolved here.
  if (!isSecretAskBlock(pendingAsk) || !pendingAsk.credential) return null;
  const queued = await tx.run.updateMany({
    where: {
      id: input.runId,
      spaceId: input.spaceId,
      threadId: input.threadId,
      status: "waiting_input",
    },
    data: { status: "queued" },
  });
  if (queued.count !== 1) return null;
  await tx.externalEffect.updateMany({
    where: {
      runId: input.runId,
      spaceId: input.spaceId,
      kind: "request_secret",
      status: "intended",
    },
    data: {
      status: "approved",
      result: { credentialSaved: input.savedDestination },
    },
  });
  const blocks = parsed.data.map((block) =>
    block === pendingAsk ? { ...block, status: "answered" as const, answer: "" } : block,
  );
  await tx.message.update({ where: { id: message.id }, data: { blocks } });
  const updated = await appendEventInTransaction(tx, {
    spaceId: input.spaceId,
    threadId: input.threadId,
    botId: input.botId,
    type: "thread.message.updated",
    runId: input.runId,
    payload: { messageId: message.id, role: "bot", blocks },
  });
  return {
    threadId: updated.threadId,
    runId: input.runId,
    messageId: message.id,
    seq: updated.seq,
  };
}

/** The caller holds the thread row lock acquired while accepting the new user message. */
export async function retireWaitingQuestionInTransaction(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; threadId: string; botId: string; runId: string; answer: string },
): Promise<boolean> {
  const answer = input.answer.trim();
  if (!answer) return false;
  const where = {
    id: input.runId,
    spaceId: input.spaceId,
    threadId: input.threadId,
    botId: input.botId,
    status: "waiting_input",
  };
  const run = await tx.run.findFirst({ where, select: { taskId: true, userId: true } });
  if (!run) return false;
  const messages = await tx.message.findMany({
    where: { threadId: input.threadId, runId: input.runId, role: "bot" },
    select: { id: true, blocks: true },
  });
  const questions = [];
  for (const message of messages) {
    const parsed = MessageBlockSchema.array().safeParse(message.blocks);
    if (!parsed.success) return false;
    const pending = parsed.data.filter(
      (block) => block.kind === "ask" && block.status !== "answered",
    );
    // Never implicitly dismiss credentials or authorize an external effect, even on a mixed card.
    if (
      pending.some(
        (block) => block.kind === "ask" && (block.input === "secret" || block.approvalEffectId),
      )
    )
      return false;
    if (pending.length) {
      questions.push({
        id: message.id,
        blocks: parsed.data.map((block) =>
          pending.includes(block) ? { ...block, status: "answered" as const, answer } : block,
        ),
      });
    }
  }
  if (!questions.length) return false;
  const now = new Date();
  const retired = await tx.run.updateMany({
    where,
    data: {
      status: "cancelled",
      completedAt: now,
      checkpoint: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  if (retired.count !== 1) return false;
  await tx.externalEffect.deleteMany({
    where: { runId: input.runId, kind: RUN_TURN_CHECKPOINT_KIND, status: RUN_TURN_CHECKPOINT_KIND },
  });
  await deleteRunSecretsInTransaction(tx, [
    { id: input.runId, userId: run.userId, spaceId: input.spaceId },
  ]);
  await tx.attempt.updateMany({
    where: { runId: input.runId, status: "waiting_input" },
    data: { status: "cancelled", finishedAt: now },
  });
  await tx.task.updateMany({
    where: { id: run.taskId, runs: { none: { status: { in: [...ACTIVE_RUN_STATUSES] } } } },
    data: { status: "cancelled" },
  });
  for (const question of questions) {
    await tx.message.update({ where: { id: question.id }, data: { blocks: question.blocks } });
    await appendEventInTransaction(tx, {
      ...input,
      type: "thread.message.updated",
      allowCancelledRun: true,
      payload: { messageId: question.id, role: "bot", blocks: question.blocks },
    });
  }
  await appendEventInTransaction(tx, { ...input, type: "run.cancelled", payload: {} });
  return true;
}

/** Read-only eligibility shared by image admission and composer free-text answers. */
export async function eligibleWaitingTextAnswer(
  tx: Prisma.TransactionClient,
  input: {
    spaceId: string;
    threadId: string;
    runId: string;
    answeredByUserId: string;
    answer: string;
    beforeMessageSeq?: number;
    /** Explicit reaction target; composer replies must pass the latest-message check. */
    messageId?: string;
  },
): Promise<string | null> {
  const answer = input.answer.trim();
  if (!answer) return null;
  const found = await findPendingAsk(tx, input);
  if (!found) return null;
  if (isApprovalAskBlock(found.pendingAsk) || isSecretAskBlock(found.pendingAsk)) return null;
  if (input.messageId !== undefined) {
    if (input.messageId !== found.messageId) return null;
  } else {
    // Reactions are projected beneath their target, not new transcript messages.
    let beforeSeq = input.beforeMessageSeq;
    while (true) {
      const latest = await tx.message.findFirst({
        where: {
          threadId: input.threadId,
          ...(beforeSeq === undefined ? {} : { seq: { lt: beforeSeq } }),
        },
        orderBy: { seq: "desc" },
        select: { id: true, seq: true, role: true, blocks: true, replyToMessageId: true },
      });
      if (!latest) return null;
      if (!messageReaction({ ...latest, blocks: latest.blocks as MessageBlock[] })) {
        if (latest.id !== found.messageId) return null;
        break;
      }
      beforeSeq = latest.seq;
    }
  }
  return found.messageId;
}

/** Commit only answers that pass the same read-only composer eligibility check. */
export async function answerWaitingRunWithTextInTransaction(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof eligibleWaitingTextAnswer>[1],
): Promise<{ threadId: string; seq: number } | null> {
  const messageId = await eligibleWaitingTextAnswer(tx, input);
  return messageId
    ? commitAnswerRunInput(tx, { ...input, messageId, answer: input.answer.trim() })
    : null;
}

export async function pauseRunForInput(
  prisma: PrismaClient,
  input: PauseRunForInput,
  realtime?: RealtimeFanout,
): Promise<FinalizeRunResult | false> {
  const committed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Thread row first, then run rows — the same order as clearThread and finalizeRun, so a
    // concurrent clear cannot deadlock against this transaction.
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
    const paused = await tx.run.updateMany({
      where: {
        id: input.runId,
        spaceId: input.spaceId,
        threadId: input.threadId,
        botId: input.botId,
        status: "running",
        leaseOwner: input.leaseOwner,
        leaseFence: input.leaseFence,
      },
      data: {
        status: "waiting_input",
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(input.offeredActions?.length
          ? { checkpoint: choiceAskCheckpoint(input.offeredActions) }
          : {}),
      },
    });
    if (paused.count !== 1) return null;
    await expireComputerExecutionLeases(tx, { runId: input.runId });

    const attempt = await tx.attempt.updateMany({
      where: {
        id: input.attemptId,
        runId: input.runId,
        fence: input.leaseFence,
        status: "running",
      },
      data: { status: "waiting_input", finishedAt: new Date() },
    });
    if (attempt.count !== 1) throw new Error("Active run attempt was not available to pause");

    const message = await createThreadMessageInTransaction(tx, {
      threadId: input.threadId,
      role: "bot",
      blocks: input.blocks,
      botId: input.botId,
      runId: input.runId,
    });
    const response = await appendEventInTransaction(tx, {
      spaceId: input.spaceId,
      threadId: input.threadId,
      botId: input.botId,
      type: "thread.message.created",
      runId: input.runId,
      payload: { messageId: message.id, role: "bot", blocks: input.blocks },
    });
    const run = await tx.run.findUnique({
      where: { id: input.runId },
      select: { userId: true },
    });
    const waitingEvent = await appendEventInTransaction(tx, {
      spaceId: input.spaceId,
      threadId: input.threadId,
      botId: input.botId,
      type: "run.waiting_input",
      runId: input.runId,
      payload: run?.userId ? { userId: run.userId } : {},
    });
    await tx.event.deleteMany({
      where: { runId: input.runId, ...transientRunEventsWhere() },
    });
    const continuationRunId = await createPendingSteeringRun(tx, input);
    return {
      threadId: waitingEvent.threadId,
      seq: waitingEvent.seq,
      continuationRunId,
      firstResponseRunId: response.firstResponse ? input.runId : undefined,
    };
  }, THREAD_LOCK_TRANSACTION_OPTIONS);

  if (!committed) return false;
  await notifyCommittedEvent(
    prisma,
    realtime,
    committed.threadId,
    committed.seq,
    committed.firstResponseRunId,
  );
  return { continuationRunId: committed.continuationRunId };
}

function alwaysAllowedSite(effect: {
  kind: string;
  request: Prisma.JsonValue;
}): string | undefined {
  if (!SITE_SENDING_TOOLS.has(effect.kind)) return undefined;
  const request = effect.request as { url?: unknown } | null;
  return typeof request?.url === "string" ? urlSite(request.url) : undefined;
}
