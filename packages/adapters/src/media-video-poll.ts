import type {
  AdapterContext,
  AgentRuntime,
  ArtifactStore,
  JobPublisher,
  MediaGenerationProvider,
  MediaReference,
  SecretStore,
} from "@rakazo_mickvvw/adapter-kit";
import { mediaPollJob, runContinueJob } from "@rakazo_mickvvw/adapter-kit";
import type { ModelSwitches } from "@rakazo_mickvvw/contracts";
import type { Prisma, PrismaClient, ThreadEvents } from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import { resolveBotMediaGenerationProvider } from "./bot-media-generation.js";
import {
  generateMediaFromTool,
  MEDIA_JOB_KIND,
  mediaJobRequest,
  savedJob,
} from "./media-generation-tools.js";
import type { CodexLiveCatalog } from "./pi-codex-catalog.js";
import { persistMessageInTransaction } from "./run-messages.js";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";

/** A short video takes minutes; one still unfinished after this is reported as failed. */
export const MEDIA_POLL_DEADLINE_MS = 60 * 60_000;
/** A poll lock held this long belongs to a worker that died; a live poll finishes well within it. */
const ABANDONED_POLL_LOCK_MS = 10 * 60_000;
/** How long past the deadline provider errors are retried before the video is reported failed. */
const ERROR_GRACE_MS = 15 * 60_000;
/** Longer than the widest poll interval, so a job left this long lost its scheduled poll. */
const STALLED_MS = 10 * 60_000;
const PENDING_STATUSES = ["media_pending", "media_polling"];
/** Images share the job kind but finish within their turn; only videos are polled. */
const VIDEO_JOB = { kind: MEDIA_JOB_KIND, request: { path: ["tool"], equals: "generate_video" } };
/** An image regenerate job: submitted by the RPC, finished by a background poll. */
const IMAGE_JOB = { kind: MEDIA_JOB_KIND, request: { path: ["tool"], equals: "generate_image" } };

export interface MediaVideoDeps {
  prisma: PrismaClient;
  jobs: JobPublisher;
  events: Pick<ThreadEvents, "notify">;
  artifacts?: ArtifactStore;
  maxUploadSizeBytes?: number;
  mediaGeneration?: MediaGenerationProvider;
  /**
   * Resolving a bot's own media provider for a poll, the same way a run
   * resolves it; absent, only the global provider can poll. The background
   * job handler passes its secret store and deployment-model inputs.
   */
  secretStore?: SecretStore;
  codexCatalog?: CodexLiveCatalog;
  mcpAllowPrivateEndpoint?: boolean;
  runtime?: AgentRuntime;
  billingEnabled?: boolean;
  deploymentModelKey?: string;
  deploymentModelConfigured?: boolean;
}

type MediaRun = { id: string; threadId: string; botId: string; userId: string; spaceId: string };

/** Poll soon after submission, then less often as the job ages. */
export function nextMediaPollAt(createdAt: Date, now = Date.now()): Date {
  const delay = Math.min(5 * 60_000, Math.max(10_000, (now - createdAt.getTime()) / 5));
  return new Date(now + delay);
}

/** The job row is the outbox; a lost enqueue is recovered by reconcileMediaVideos. */
export async function scheduleMediaPoll(
  jobs: JobPublisher,
  jobId: string,
  createdAt = new Date(),
): Promise<void> {
  await jobs.enqueue(mediaPollJob(jobId, nextMediaPollAt(createdAt))).catch((error) => {
    getLogger().warn("media.poll_deferred", { "media.job_id": jobId, error });
  });
}

type Settled = "completed" | "failed";

/** Attach a finished video to the run's chat and post it, once, with the job's completion. */
export function mediaDelivery(
  deps: Pick<MediaVideoDeps, "prisma" | "events" | "maxUploadSizeBytes"> & {
    artifacts: ArtifactStore;
  },
  run: MediaRun,
  options: {
    providerId: string;
    groupId?: string;
    operationId: string;
    /** Background delivery outlives the turn that asked, even one that was stopped. */
    afterRun?: boolean;
    /** Commits with the job's final state, so what follows it cannot be lost to a crash. */
    onSettled?: (tx: Prisma.TransactionClient, status: Settled) => Promise<void>;
  },
) {
  return {
    attach: (
      output: { bytes: Uint8Array },
      fileName: string,
      job: { id: string; result: { provider: string; jobId?: string } },
    ) =>
      attachWorkspaceFileToThread(
        {
          prisma: deps.prisma,
          artifacts: deps.artifacts,
          maxUploadSizeBytes: deps.maxUploadSizeBytes,
        },
        {
          spaceId: run.spaceId,
          userId: run.userId,
          botId: run.botId,
          groupId: options.groupId,
          runId: run.id,
          filePath: fileName,
          bytes: output.bytes,
          operationId: options.operationId,
          onAttached: async (tx, artifact) => {
            const checkpointed = await tx.externalEffect.updateMany({
              where: {
                id: job.id,
                status: { in: ["media_submitting", "media_polling"] },
                result: { equals: job.result },
              },
              data: {
                status: "media_polling",
                result: { ...job.result, artifactId: artifact.id },
              },
            });
            if (!checkpointed.count) throw new Error("Media attachment was already checkpointed");
          },
        },
      ),
    publish: async (
      blocks: Parameters<typeof persistMessageInTransaction>[3],
      jobId: string,
      artifactId: string,
      modelId?: string,
      presetName?: string,
      /** Kept in the saved job with the message: its switch timeline and extra prompt. */
      meta?: { modelSwitches?: ModelSwitches; supplementaryPrompt?: string },
    ) => {
      const committed = await deps.prisma.$transaction(async (tx) => {
        // Commit completion with the message so a restarted poll cannot post twice, and a job
        // closed meanwhile is never posted.
        const claimed = await tx.externalEffect.updateMany({
          where: { id: jobId, status: "media_polling" },
          data: {
            status: "media_completed",
            result: {
              provider: options.providerId,
              artifactId,
              ...(modelId ? { modelId } : {}),
              ...(presetName ? { presetName } : {}),
              ...(meta?.modelSwitches ? { modelSwitches: meta.modelSwitches } : {}),
              ...(meta?.supplementaryPrompt
                ? { supplementaryPrompt: meta.supplementaryPrompt }
                : {}),
            },
          },
        });
        if (!claimed.count) return null;
        const message = await persistMessageInTransaction(
          tx,
          run,
          "bot",
          blocks,
          undefined,
          undefined,
          options.afterRun,
          undefined,
          meta?.modelSwitches,
        );
        await options.onSettled?.(tx, "completed");
        return message;
      });
      if (committed)
        await deps.events
          .notify(run.threadId, committed.eventSeq, committed.firstResponseRunId)
          .catch(() => undefined);
    },
    onSettled: options.onSettled,
  };
}

class MediaRecipientGone extends Error {}

/**
 * Whether the chat that asked can still receive the video: its bot and owner remain and it was
 * not cleared since. In a transaction, the thread row is locked first, as clearing a chat does.
 */
async function recipientRemains(
  db: Prisma.TransactionClient,
  run: MediaRun,
  threadGeneration: number | undefined,
): Promise<boolean> {
  const thread = await db.thread.updateMany({
    where: {
      id: run.threadId,
      spaceId: run.spaceId,
      ...(threadGeneration === undefined ? {} : { historyCompactionGeneration: threadGeneration }),
    },
    data: { nextEventSeq: { increment: 0 } },
  });
  if (!thread.count) return false;
  const [member, bot] = await Promise.all([
    db.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: run.spaceId, userId: run.userId } },
      select: { id: true },
    }),
    db.bot.findFirst({
      where: { id: run.botId, spaceId: run.spaceId, archivedAt: null },
      select: { id: true },
    }),
  ]);
  return Boolean(member && bot);
}

/**
 * The provider that submitted a video job: the run's bot media provider,
 * resolved the same way the run resolved it, with the global provider as the
 * fallback. A job whose bot is gone or whose models no longer resolve polls
 * under the global provider only, so it fails instead of hanging.
 */
async function resolveMediaProviderForJob(
  deps: MediaVideoDeps,
  run: { botId: string; userId: string; spaceId: string },
): Promise<MediaGenerationProvider | undefined> {
  if (!deps.secretStore) return deps.mediaGeneration;
  const bot = await deps.prisma.bot.findFirst({
    where: { id: run.botId, spaceId: run.spaceId },
    select: {
      videoModels: true,
      imageModels: true,
      imageEditModels: true,
      videoEditModels: true,
      videoPromptPresets: true,
      activeVideoPromptPreset: true,
      imagePromptPresets: true,
      activeImagePromptPreset: true,
    },
  });
  if (!bot) return deps.mediaGeneration;
  return resolveBotMediaGenerationProvider(
    {
      prisma: deps.prisma,
      secretStore: deps.secretStore,
      codexCatalog: deps.codexCatalog,
      mcpAllowPrivateEndpoint: deps.mcpAllowPrivateEndpoint,
      ...(deps.runtime ? { runtime: deps.runtime } : {}),
      billingEnabled: deps.billingEnabled,
      deploymentModelKey: deps.deploymentModelKey,
      deploymentModelConfigured: deps.deploymentModelConfigured,
    },
    { userId: run.userId, spaceId: run.spaceId },
    bot,
    deps.mediaGeneration,
  );
}

/**
 * Check one submitted video for the chat that asked for it. A finished video is posted and a
 * failed or expired one is marked failed; either way the bot gets one turn to follow up.
 */
export async function pollMediaVideo(deps: MediaVideoDeps, payload: { jobId: string }) {
  const artifacts = deps.artifacts;
  if (!artifacts) return;
  const job = await deps.prisma.externalEffect.findFirst({
    where: {
      id: payload.jobId,
      ...VIDEO_JOB,
      status: { in: ["media_submitting", ...PENDING_STATUSES] },
    },
    select: {
      id: true,
      createdAt: true,
      request: true,
      result: true,
      run: {
        select: {
          id: true,
          threadId: true,
          botId: true,
          userId: true,
          spaceId: true,
          thread: { select: { groupId: true } },
        },
      },
    },
  });
  if (!job) return;
  const { thread, ...run } = job.run;
  // The video was submitted through the bot's own media provider, so the poll
  // resolves that same provider; the global provider is only the fallback for
  // a bot with no media models. Without a secret store (unit callers) there
  // is nothing to resolve with, and only the global provider can poll.
  const provider = await resolveMediaProviderForJob(deps, run);
  const request = mediaJobRequest.safeParse(job.request);
  const threadGeneration = request.success ? request.data.threadGeneration : undefined;
  // A regenerate job's run is the anchor the RPC created; its status is
  // settled here, while a chat run's status belongs to the executor.
  const isRegenerate = request.success && request.data.mode !== undefined;
  // An edit answers from the bot's edit list; a fresh generation from its
  // generation list. A bot with only edit models still has no generation list.
  const isEdit = request.success && request.data.mode === "edit";
  const canGenerate = isEdit ? provider?.editCapabilities?.video : provider?.capabilities.video;
  if (!provider || !canGenerate) return;
  const expired = Date.now() - job.createdAt.getTime() >= MEDIA_POLL_DEADLINE_MS;
  // Nobody is left to tell once the bot or its owner is gone or the chat was cleared. A job
  // saved before background delivery existed is closed quietly once overdue, so old chats stay
  // quiet. Closing it stops recovery from picking it up again.
  if (
    (threadGeneration === undefined && expired) ||
    !(await recipientRemains(deps.prisma, run, threadGeneration))
  ) {
    await deps.prisma.$transaction(async (tx) => {
      const failed = await tx.externalEffect.updateMany({
        where: {
          id: job.id,
          status: { in: ["media_submitting", ...PENDING_STATUSES] },
        },
        data: { status: "media_failed" },
      });
      if (failed.count && isRegenerate)
        await settleRegenerateRun(tx, run.id, "failed", "Media generation failed.");
    });
    return;
  }
  let wakeRunId: string | null = null;
  const onSettled = async (tx: Prisma.TransactionClient, status: Settled) => {
    if (!(await recipientRemains(tx, run, threadGeneration))) {
      // Undo the post; the next check finds the recipient gone and closes the job.
      if (status === "completed") throw new MediaRecipientGone();
      return;
    }
    if (isRegenerate) await settleRegenerateRun(tx, run.id, status);
    wakeRunId = await queueWake(tx, job.id, run, status === "completed");
  };
  const operationId = `media.poll:${job.id}`;
  const context: AdapterContext = {
    operationId,
    traceId: job.id,
    spaceId: run.spaceId,
    userId: run.userId,
    botId: run.botId,
    signal: AbortSignal.timeout(5 * 60_000),
  };
  const saved = savedJob.safeParse(job.result);
  const delivery = mediaDelivery({ ...deps, artifacts }, run, {
    providerId: provider.id,
    groupId: thread.groupId ?? undefined,
    operationId,
    afterRun: true,
    onSettled,
  });
  // A job the provider already accepted is polled; a regenerate job the RPC
  // only reserved is submitted here, from the stored prompt and references.
  // A chat job still submitting is left alone: its own call finishes it.
  const result =
    saved.success && saved.data.jobId
      ? await (async () => {
          // An edit's resubmit needs its reference frame; load it only for
          // edit jobs, mirroring the regenerate-submit branch below.
          const references =
            isEdit && request.success
              ? await loadMediaReferences(deps, run, request.data, context)
              : undefined;
          return generateMediaFromTool({
            name: "generate_video",
            args: { jobId: job.id },
            executionId: operationId,
            recoverOnly: true,
            // A failed task may resubmit to the next model in its chain until
            // the job deadline; the deadline is from job creation and a
            // resubmit never extends it.
            resubmitUntil: job.createdAt.getTime() + MEDIA_POLL_DEADLINE_MS,
            ...(references?.length ? { references } : {}),
            provider,
            prisma: deps.prisma,
            context,
            run,
            ...delivery,
          });
        })()
      : isRegenerate && request.success
        ? await (async () => {
            const references = await loadMediaReferences(deps, run, request.data, context);
            if (request.data.mode === "edit" && !references?.length) {
              await deps.prisma.$transaction(async (tx) => {
                const failed = await tx.externalEffect.updateMany({
                  where: { id: job.id, status: { in: ["media_submitting", ...PENDING_STATUSES] } },
                  data: { status: "media_failed" },
                });
                if (failed.count) {
                  await settleRegenerateRun(
                    tx,
                    run.id,
                    "failed",
                    "The reference image is unavailable.",
                  );
                  if (await recipientRemains(tx, run, threadGeneration))
                    wakeRunId = await queueWake(tx, job.id, run, false);
                }
              });
              return { status: "failed" as const };
            }
            return generateMediaFromTool({
              name: "generate_video",
              args: { prompt: request.data.prompt },
              executionId: request.data.executionId,
              resume: true,
              ...(references?.length ? { references } : {}),
              provider,
              prisma: deps.prisma,
              context,
              run,
              threadGeneration,
              ...delivery,
            });
          })()
        : undefined;
  let settled = result?.status === "completed" || result?.status === "failed";
  // A final check that errored is no answer; keep trying a little longer before giving up.
  const unanswered = Boolean(result && "error" in result);
  if (
    !settled &&
    expired &&
    (!unanswered || Date.now() - job.createdAt.getTime() >= MEDIA_POLL_DEADLINE_MS + ERROR_GRACE_MS)
  ) {
    // Still unfinished after the final check: report it failed. Only a released or abandoned
    // claim is taken, so a check still in flight decides instead. A job still
    // submitting past the deadline lost its submitter.
    settled = await deps.prisma.$transaction(async (tx) => {
      const failed = await tx.externalEffect.updateMany({
        where: {
          id: job.id,
          OR: [
            { status: "media_submitting" },
            { status: "media_pending" },
            {
              status: "media_polling",
              updatedAt: { lt: new Date(Date.now() - ABANDONED_POLL_LOCK_MS) },
            },
          ],
        },
        data: { status: "media_failed" },
      });
      if (failed.count) {
        if (isRegenerate)
          await settleRegenerateRun(tx, run.id, "failed", "Media generation failed.");
        await onSettled(tx, "failed");
      }
      return failed.count > 0;
    });
  }
  // Still running, briefly locked by another check, or a provider error: try again later.
  if (!settled) await scheduleMediaPoll(deps.jobs, job.id, job.createdAt);
  // The run reconciler recovers a queued wake after an enqueue failure.
  if (wakeRunId)
    await deps.jobs.enqueue(runContinueJob(wakeRunId)).catch((error) => {
      getLogger().warn("media.wake_deferred", {
        "media.job_id": job.id,
        "run.id": wakeRunId,
        error,
      });
    });
}

/** Queue one turn for the bot on the outcome, so it can follow up and the user is notified. */
async function queueWake(
  tx: Prisma.TransactionClient,
  jobId: string,
  run: MediaRun,
  completed: boolean,
  label = "Video",
): Promise<string | null> {
  const clientNonce = `media-wake:${jobId}`;
  const prior = await tx.run.findFirst({
    where: { spaceId: run.spaceId, clientNonce },
    select: { id: true },
  });
  if (prior) return null;
  const task = await tx.task.create({
    data: {
      spaceId: run.spaceId,
      botId: run.botId,
      threadId: run.threadId,
      userId: run.userId,
      prompt: completed
        ? `${label} job ${jobId} finished and is attached to the chat.`
        : `${label} job ${jobId} failed. Do not resubmit unless the user asks.`,
      status: "queued",
    },
  });
  const wake = await tx.run.create({
    data: {
      spaceId: run.spaceId,
      botId: run.botId,
      threadId: run.threadId,
      userId: run.userId,
      taskId: task.id,
      status: "queued",
      trigger: "media",
      clientNonce,
    },
  });
  return wake.id;
}

/**
 * Mark a regenerate run and its task finished. Only regenerate jobs have one:
 * a chat run's status belongs to the executor, never to a media poll. The
 * update only moves a run still marked running, so a concurrent settle cannot
 * rewrite a terminal state.
 */
async function settleRegenerateRun(
  tx: Prisma.TransactionClient,
  runId: string,
  status: Settled,
  error?: string,
): Promise<void> {
  const updated = await tx.run.updateMany({
    where: { id: runId, status: "running" },
    data: { status, ...(error ? { error } : {}), completedAt: new Date() },
  });
  if (!updated.count) return;
  const run = await tx.run.findUnique({ where: { id: runId }, select: { taskId: true } });
  if (run) await tx.task.updateMany({ where: { id: run.taskId }, data: { status } });
}

/**
 * The reference media for an edit job: the original image for an image edit,
 * or the uploaded image for a video edit. The bytes come from the artifact
 * store; a missing artifact means the edit cannot run.
 */
async function loadMediaReferences(
  deps: Pick<MediaVideoDeps, "prisma" | "artifacts">,
  run: MediaRun,
  request: { mode?: "edit" | "random"; sourceArtifactId?: string; referenceArtifactId?: string },
  context: AdapterContext,
): Promise<MediaReference[] | undefined> {
  if (request.mode !== "edit") return undefined;
  const artifactId = request.sourceArtifactId ?? request.referenceArtifactId;
  if (!artifactId || !deps.artifacts) return undefined;
  const artifact = await deps.prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: run.spaceId, userId: run.userId },
    select: { id: true, mimeType: true },
  });
  if (!artifact) return undefined;
  const bytes = await deps.artifacts.get(artifact.id, context).catch(() => undefined);
  if (!bytes) return undefined;
  return [{ bytes, mimeType: artifact.mimeType, role: "first" }];
}

/**
 * Run one submitted image regenerate job. Unlike a video poll, this is the
 * generation itself, not a status check: it runs once, so a failed image is
 * reported failed instead of retried into another billed generation. A job
 * another worker already claimed reports running and is left alone.
 */
export async function pollMediaImage(deps: MediaVideoDeps, payload: { jobId: string }) {
  const artifacts = deps.artifacts;
  if (!artifacts) return;
  const job = await deps.prisma.externalEffect.findFirst({
    where: {
      id: payload.jobId,
      ...IMAGE_JOB,
      status: { in: ["media_submitting", "media_polling"] },
    },
    select: {
      id: true,
      createdAt: true,
      request: true,
      run: {
        select: {
          id: true,
          taskId: true,
          threadId: true,
          botId: true,
          userId: true,
          spaceId: true,
          thread: { select: { groupId: true } },
        },
      },
    },
  });
  if (!job) return;
  const { thread, ...run } = job.run;
  const request = mediaJobRequest.safeParse(job.request);
  if (!request.success) {
    getLogger().warn("media.image_job_request", { "media.job_id": job.id });
    return;
  }
  const threadGeneration = request.data.threadGeneration;
  const expired = Date.now() - job.createdAt.getTime() >= MEDIA_POLL_DEADLINE_MS;
  const fail = async (error: string) => {
    await deps.prisma.$transaction(async (tx) => {
      const failed = await tx.externalEffect.updateMany({
        where: { id: job.id, status: { in: ["media_submitting", "media_polling"] } },
        data: { status: "media_failed" },
      });
      if (!failed.count) return;
      if (request.data.mode) await settleRegenerateRun(tx, run.id, "failed", error);
      if (await recipientRemains(tx, run, threadGeneration))
        await queueWake(tx, job.id, run, false, "Image");
    });
  };
  if (expired || !(await recipientRemains(deps.prisma, run, threadGeneration))) {
    await fail("Media generation failed.");
    return;
  }
  const provider = await resolveMediaProviderForJob(deps, run);
  const canGenerate =
    request.data.mode === "edit"
      ? provider?.editCapabilities?.images
      : provider?.capabilities.images;
  if (!canGenerate) {
    await fail("Media generation is unavailable.");
    return;
  }
  const operationId = `media.image-poll:${job.id}`;
  const context: AdapterContext = {
    operationId,
    traceId: job.id,
    spaceId: run.spaceId,
    userId: run.userId,
    botId: run.botId,
    signal: AbortSignal.timeout(5 * 60_000),
  };
  const references = await loadMediaReferences(deps, run, request.data, context);
  if (request.data.mode === "edit" && !references?.length) {
    await fail("The image to edit is unavailable.");
    return;
  }
  let wakeRunId: string | null = null;
  const onSettled = async (tx: Prisma.TransactionClient, status: Settled) => {
    if (!(await recipientRemains(tx, run, threadGeneration))) {
      if (status === "completed") throw new MediaRecipientGone();
      return;
    }
    if (request.data.mode) await settleRegenerateRun(tx, run.id, status);
    wakeRunId = await queueWake(tx, job.id, run, status === "completed", "Image");
  };
  const result = await generateMediaFromTool({
    name: "generate_image",
    args: { prompt: request.data.prompt },
    executionId: request.data.executionId,
    resume: true,
    ...(references?.length ? { references } : {}),
    provider: provider!,
    prisma: deps.prisma,
    context,
    run,
    threadGeneration,
    ...mediaDelivery({ ...deps, artifacts }, run, {
      providerId: provider!.id,
      groupId: thread.groupId ?? undefined,
      operationId,
      afterRun: true,
      onSettled,
    }),
  });
  if (result?.status === "completed") {
    // The publish already settled the run and queued the wake.
  } else if (result && "status" in result && result.status === "running") {
    // Another worker owns the generation; its outcome settles the job.
    return;
  } else {
    const error =
      result && "error" in result && result.error ? result.error : "Media generation failed.";
    await fail(error);
    return;
  }
  // The run reconciler recovers a queued wake after an enqueue failure.
  if (wakeRunId)
    await deps.jobs.enqueue(runContinueJob(wakeRunId)).catch((error) => {
      getLogger().warn("media.wake_deferred", {
        "media.job_id": job.id,
        "run.id": wakeRunId,
        error,
      });
    });
}

/** A media poll finishes whichever kind the job row holds: a video or an image. */
export async function pollMediaJob(deps: MediaVideoDeps, payload: { jobId: string }) {
  const job = await deps.prisma.externalEffect.findUnique({
    where: { id: payload.jobId },
    select: { request: true },
  });
  if (!job) return;
  const request = mediaJobRequest.safeParse(job.request);
  if (!request.success) return;
  if (request.data.tool === "generate_image") await pollMediaImage(deps, payload);
  else await pollMediaVideo(deps, payload);
}

/**
 * Re-enqueue unfinished videos whose poll was lost, for example to a worker restart. A healthy
 * job is checked at least every five minutes, so only one untouched for longer is picked up.
 */
export async function reconcileMediaVideos(
  deps: Pick<MediaVideoDeps, "prisma" | "jobs" | "mediaGeneration">,
) {
  // No gate on the global provider's video capability: a stuck job is
  // re-enqueued regardless, and the poll resolves the provider per job, so a
  // bot-submitted video recovers even when no global provider is configured.
  const now = Date.now();
  const pageSize = 100;
  let after: string | undefined;
  for (;;) {
    const page = await deps.prisma.externalEffect.findMany({
      where: {
        ...VIDEO_JOB,
        status: { in: PENDING_STATUSES },
        updatedAt: { lt: new Date(now - STALLED_MS) },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: pageSize,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, createdAt: true },
    });
    for (const job of page) {
      await deps.jobs
        .enqueue({
          ...mediaPollJob(job.id, nextMediaPollAt(job.createdAt, now)),
          // A scheduled poll is left alone; only a missing, exhausted or abandoned one is
          // replaced.
          keepExisting: true,
          replaceLockedBefore: new Date(now - ABANDONED_POLL_LOCK_MS),
        })
        .catch((error) =>
          getLogger().warn("media.poll_recovery_deferred", { "media.job_id": job.id, error }),
        );
    }
    if (page.length < pageSize) return;
    after = page.at(-1)?.id;
  }
}

/**
 * Close image regenerate jobs whose poll was lost, for example to a worker
 * restart. Unlike videos, an image poll IS the generation, so a lost one is
 * not re-run: re-running could bill a second generation for the same image.
 * The job is reported failed and the bot gets one turn to follow up.
 */
export async function reconcileMediaImages(deps: Pick<MediaVideoDeps, "prisma" | "jobs">) {
  const now = Date.now();
  const pageSize = 100;
  let after: string | undefined;
  for (;;) {
    const page = await deps.prisma.externalEffect.findMany({
      where: {
        ...IMAGE_JOB,
        status: { in: ["media_submitting", "media_polling"] },
        updatedAt: { lt: new Date(now - STALLED_MS) },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: pageSize,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: {
        id: true,
        request: true,
        run: {
          select: {
            id: true,
            threadId: true,
            botId: true,
            userId: true,
            spaceId: true,
          },
        },
      },
    });
    for (const job of page) {
      const request = mediaJobRequest.safeParse(job.request);
      const threadGeneration = request.success ? request.data.threadGeneration : undefined;
      await deps.prisma
        .$transaction(async (tx) => {
          const failed = await tx.externalEffect.updateMany({
            where: {
              id: job.id,
              status: { in: ["media_submitting", "media_polling"] },
            },
            data: { status: "media_failed" },
          });
          if (!failed.count) return null;
          if (request.success && request.data.mode)
            await settleRegenerateRun(tx, job.run.id, "failed", "Media generation failed.");
          if (!(await recipientRemains(tx, job.run, threadGeneration))) return null;
          return queueWake(tx, job.id, job.run, false, "Image");
        })
        .then(async (wakeRunId) => {
          if (wakeRunId)
            await deps.jobs.enqueue(runContinueJob(wakeRunId)).catch((error) => {
              getLogger().warn("media.wake_deferred", {
                "media.job_id": job.id,
                "run.id": wakeRunId,
                error,
              });
            });
        })
        .catch((error) =>
          getLogger().warn("media.image_recovery_deferred", { "media.job_id": job.id, error }),
        );
    }
    if (page.length < pageSize) return;
    after = page.at(-1)?.id;
  }
}
