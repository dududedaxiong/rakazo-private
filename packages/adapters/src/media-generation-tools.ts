import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationProvider,
  MediaReference,
  MediaVideoJob,
} from "@rakazo_mickvvw/adapter-kit";
import { MediaGenerationError } from "@rakazo_mickvvw/adapter-kit";
import type { MessageBlock, ModelSwitches } from "@rakazo_mickvvw/contracts";
import { ModelSwitchesSchema } from "@rakazo_mickvvw/contracts";
import {
  buildModelSwitches,
  failModelSwitchAttempt,
  messageBlockForArtifact,
} from "@rakazo_mickvvw/core";
import type { ExternalEffect, Prisma, PrismaClient } from "@rakazo_mickvvw/db";
import { isUniqueViolation } from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import { z } from "zod";
import {
  decodeAsyncVideoJobId,
  mediaPromptSchema,
  validateGeneratedMedia,
} from "./media-generation-provider.js";

export const MEDIA_JOB_KIND = "media_generation_job";
export const savedJob = z.object({
  provider: z.string(),
  jobId: z.string().optional(),
  artifactId: z.string().optional(),
  /** The bot-configured model that produced the media, for the "当前模型: X" mark on recovery. */
  modelId: z.string().optional(),
  /** The prompt preset applied to the media, for the mark on recovery. */
  presetName: z.string().optional(),
  /** The viewer's extra prompt for this generation; a re-run appends it to the raw prompt. */
  supplementaryPrompt: z.string().max(4000).optional(),
  /** The model-switch timeline; only when a switch happened while producing it. */
  modelSwitches: ModelSwitchesSchema.optional(),
});

/** What a media job row stores as its request: the prompt plus how to re-run it. */
export const mediaJobRequest = z.object({
  tool: z.enum(["generate_image", "generate_video"]),
  prompt: z.string().min(1),
  executionId: z.string().min(1),
  threadGeneration: z.number().int().optional(),
  /** Detail edit or a fresh random generation; absent means a chat-triggered generation. */
  mode: z.enum(["edit", "random"]).optional(),
  /** The artifact being edited, for an image edit; the reference is its bytes. */
  sourceArtifactId: z.string().optional(),
  /** An uploaded image, for a video edit; the reference is its bytes. */
  referenceArtifactId: z.string().optional(),
});
export type MediaJobRequest = z.infer<typeof mediaJobRequest>;

/** The mark under a generated image or video: which model made it, and which preset. */
function mediaModelMark(modelId: string, presetName?: string): MessageBlock {
  return {
    kind: "text",
    text: presetName ? `当前模型: ${modelId} · ${presetName}` : `当前模型: ${modelId}`,
  };
}
export async function generateMediaFromTool(options: {
  name: "generate_image" | "generate_video";
  args: Record<string, unknown>;
  executionId: string;
  /** Recover only persisted state; never submit a new billed generation. */
  recoverOnly?: boolean;
  /**
   * Only create the job row and return its id; the provider is not called.
   * A background poll finishes the job. Idempotent: an existing unsubmitted
   * reservation returns its id instead of submitting twice.
   */
  submitOnly?: boolean;
  /**
   * Run the provider call for a reservation an earlier submitOnly created.
   * Claims the reservation first, so two workers never generate twice.
   */
  resume?: boolean;
  /** Reference media for an edit; absent, the call is a fresh generation. */
  references?: MediaReference[];
  /**
   * Until when (epoch ms) a failed polled video task may resubmit to the next
   * model in its chain, inside the poll cycle. Only the poll worker passes
   * it; without it a failed task settles failed. A resubmit is not a new
   * generation: it continues the same job's model chain (same prompt, same
   * job row), so `recoverOnly` still blocks fresh submissions.
   */
  resubmitUntil?: number;
  /** Detail edit or a fresh random generation; stored on the job row. */
  mode?: "edit" | "random";
  /** The artifact being edited, for an image edit; stored on the job row. */
  sourceArtifactId?: string;
  /** An uploaded image, for a video edit; stored on the job row. */
  referenceArtifactId?: string;
  /** The viewer's extra prompt; seeded onto the job row so the result keeps it. */
  supplementaryPrompt?: string;
  provider: MediaGenerationProvider;
  prisma: PrismaClient;
  context: AdapterContext;
  run: { id: string; threadId: string; botId: string; userId: string; spaceId: string };
  /** Saved with a new job so background delivery skips a chat that was cleared since. */
  threadGeneration?: number;
  attach: (
    output: GeneratedMedia,
    name: string,
    job: { id: string; result: { provider: string; jobId?: string } },
  ) => Promise<{ artifactId: string; block: MessageBlock }>;
  publish: (
    blocks: MessageBlock[],
    jobId: string,
    artifactId: string,
    /** The bot-configured model that produced the media; kept in the saved job for recovery. */
    modelId?: string,
    /** The prompt preset applied to the media; kept in the saved job for recovery. */
    presetName?: string,
    /** Kept in the saved job with the message: its switch timeline and extra prompt. */
    meta?: { modelSwitches?: ModelSwitches; supplementaryPrompt?: string },
  ) => Promise<unknown>;
  /** Commits with a video's provider failure, so whatever follows it cannot be lost. */
  onSettled?: (tx: Prisma.TransactionClient, status: "failed") => Promise<void>;
}) {
  const { provider, prisma, context, run, args } = options;
  const video = options.name === "generate_video";
  if (!(video ? provider.capabilities.video : provider.capabilities.images))
    return { error: "Media generation is unavailable." };
  try {
    if (
      args.jobId !== undefined &&
      (!video ||
        typeof args.jobId !== "string" ||
        !args.jobId ||
        args.jobId.length > 200 ||
        args.prompt !== undefined)
    ) {
      return { error: "Use a prompt to submit or jobId alone to poll a video." };
    }
    let reservation: ExternalEffect | null = null;
    let polling = false;
    let resumed = false;
    if (video && typeof args.jobId === "string") {
      reservation = await prisma.externalEffect.findFirst({
        where: {
          id: args.jobId,
          kind: MEDIA_JOB_KIND,
          spaceId: run.spaceId,
          run: { userId: run.userId, botId: run.botId, threadId: run.threadId },
        },
      });
      if (!reservation) return { error: "Video job is unavailable." };
      const saved = savedJob.safeParse(reservation.result);
      if (!saved.success || saved.data.provider !== provider.id)
        return {
          error:
            "Video job provider changed or submission is uncertain. Do not resubmit automatically.",
        };
      if (saved.data.artifactId && reservation.status === "media_completed")
        return { status: "completed", artifactId: saved.data.artifactId };
      if (reservation.status === "media_failed") return { status: "failed" };
      if (!saved.data.jobId && !saved.data.artifactId)
        return { error: "Submission is uncertain. Do not resubmit automatically." };
    } else {
      const prior = await prisma.externalEffect.findFirst({
        where: {
          runId: run.id,
          kind: MEDIA_JOB_KIND,
          request: { path: ["executionId"], equals: options.executionId },
        },
      });
      if (prior) {
        const saved = savedJob.safeParse(prior.result);
        if (saved.success && saved.data.artifactId) {
          if (prior.status === "media_completed")
            return { status: "completed", artifactId: saved.data.artifactId };
          reservation = prior;
        } else {
          if (video && saved.success && saved.data.jobId)
            return {
              jobId: prior.id,
              status: prior.status === "media_failed" ? "failed" : "queued",
            };
          if (options.submitOnly) return { jobId: prior.id, status: "queued" };
          if (options.resume) {
            // One worker owns the generation: the claim below moves the row
            // out of media_submitting, so a racing worker sees it as running.
            const claimed = await prisma.externalEffect.updateMany({
              where: { id: prior.id, status: "media_submitting" },
              data: { status: "media_polling" },
            });
            if (!claimed.count) return { jobId: prior.id, status: "running" };
            resumed = true;
            reservation = prior;
          } else if (options.recoverOnly) return undefined;
          else
            return {
              jobId: prior.id,
              error:
                "Submission already attempted. Poll a video job; do not resubmit automatically.",
            };
        }
      }
      if (!reservation) {
        if (options.recoverOnly) return undefined;
        const input = mediaPromptSchema.safeParse(args);
        if (!input.success) return { error: "A prompt of 1–4000 characters is required." };
        // A unique slot makes the per-run cap durable even across concurrent calls/restarts.
        for (let slot = 0; slot < 2; slot++) {
          try {
            reservation = await prisma.externalEffect.create({
              data: {
                spaceId: run.spaceId,
                runId: run.id,
                kind: MEDIA_JOB_KIND,
                idempotencyKey: `media:${run.id}:${slot}`,
                status: "media_submitting",
                request: {
                  tool: options.name,
                  prompt: input.data.prompt,
                  executionId: options.executionId,
                  ...(options.threadGeneration === undefined
                    ? {}
                    : { threadGeneration: options.threadGeneration }),
                  ...(options.mode ? { mode: options.mode } : {}),
                  ...(options.sourceArtifactId
                    ? { sourceArtifactId: options.sourceArtifactId }
                    : {}),
                  ...(options.referenceArtifactId
                    ? { referenceArtifactId: options.referenceArtifactId }
                    : {}),
                },
                result: {
                  provider: provider.id,
                  ...(options.supplementaryPrompt
                    ? { supplementaryPrompt: options.supplementaryPrompt }
                    : {}),
                },
              },
            });
            break;
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
          }
        }
        if (!reservation)
          return { error: "Media generation limit reached (two submissions per run)." };
        // The final prompt, as submitted: the preset and the supplementary
        // prompt are already folded in by the caller.
        getLogger().info("media.generate", {
          "media.tool": options.name,
          "media.prompt": input.data.prompt,
          "media.execution_id": options.executionId,
        });
      }
      if (options.submitOnly) return { jobId: reservation.id, status: "queued" };
    }
    const saved = savedJob.parse(reservation.result);
    if (saved.artifactId) {
      const artifact = await prisma.artifact.findFirst({
        where: { id: saved.artifactId, spaceId: run.spaceId, userId: run.userId, botId: run.botId },
      });
      if (!artifact) return { error: "Generated attachment is unavailable." };
      const block = messageBlockForArtifact(artifact);
      // Only pass the extra fields when the job actually saved them, so the
      // recovery path keeps the exact call shape it had before.
      const meta =
        saved.modelSwitches || saved.supplementaryPrompt
          ? { modelSwitches: saved.modelSwitches, supplementaryPrompt: saved.supplementaryPrompt }
          : undefined;
      await options.publish(
        saved.modelId ? [block, mediaModelMark(saved.modelId, saved.presetName)] : [block],
        reservation.id,
        artifact.id,
        saved.modelId,
        saved.presetName,
        ...(meta ? [meta] : []),
      );
      return {
        status: "completed",
        artifactId: artifact.id,
        ...(saved.modelId ? { modelId: saved.modelId } : {}),
      };
    }
    if (video && typeof args.jobId === "string") {
      const claim = await prisma.externalEffect.updateMany({
        where: {
          id: reservation.id,
          OR: [
            { status: "media_pending" },
            { status: "media_polling", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
          ],
        },
        data: { status: "media_polling" },
      });
      if (!claim.count)
        return options.recoverOnly
          ? { jobId: reservation.id, status: "running" }
          : {
              error:
                "Video job is already being checked or needs recovery. Do not resubmit automatically.",
            };
      polling = true;
    }
    let output: MediaVideoJob | { status: "completed"; output: GeneratedMedia };
    try {
      // The prompt is parsed only when a generation runs: polling an
      // already-submitted video carries no prompt at all.
      const input = () => ({
        ...mediaPromptSchema.parse(args),
        ...(options.references?.length ? { references: options.references } : {}),
      });
      output = video
        ? saved.jobId
          ? await provider.pollVideo(saved.jobId, context)
          : await provider.generateVideo(input(), context)
        : {
            status: "completed" as const,
            output: await provider.generateImage(input(), context),
          };
      // A failed polled task moves to the next model in the same chain,
      // within the poll cycle and before the job deadline. The prompt comes
      // from the stored request; an edit needs its reference frame, and
      // without one the chain cannot continue.
      if (
        video &&
        saved.jobId &&
        output.status === "failed" &&
        options.resubmitUntil !== undefined &&
        Date.now() < options.resubmitUntil &&
        provider.resubmitVideoAfter
      ) {
        const request = mediaJobRequest.safeParse(reservation.request);
        const isEdit = request.success && request.data.mode === "edit";
        if (request.success && (!isEdit || options.references?.length)) {
          const resubmitted = await provider.resubmitVideoAfter(
            saved.jobId,
            {
              prompt: request.data.prompt,
              ...(options.references?.length ? { references: options.references } : {}),
            },
            context,
            saved.modelSwitches?.attempts ?? [],
          );
          if (resubmitted) output = resubmitted;
        }
      }
    } catch (error) {
      // Release only this check's claim; a finished or failed job stays settled.
      if (polling)
        await prisma.externalEffect.updateMany({
          where: { id: reservation.id, status: "media_polling" },
          data: { status: "media_pending" },
        });
      throw error;
    }
    if (video && "id" in output) {
      // The timeline the settled result keeps: the output's own when it has
      // one (a resubmit's), else the submit-time timeline with the failed
      // submitter flipped to failed, so a failed job never records a success.
      let settledSwitches: ModelSwitches | undefined;
      if ("modelSwitches" in output && output.modelSwitches) {
        settledSwitches = output.modelSwitches;
      } else if (output.status === "failed" && saved.jobId) {
        const failedModel = decodeAsyncVideoJobId(saved.jobId)?.model;
        if (failedModel) {
          const attempts = [...(saved.modelSwitches?.attempts ?? [])];
          failModelSwitchAttempt(attempts, failedModel, "video task failed");
          settledSwitches = buildModelSwitches(attempts);
        }
      }
      const settle = async (tx: Prisma.TransactionClient) => {
        const updated = await tx.externalEffect.updateMany({
          where: {
            id: reservation.id,
            // A resumed submit claimed media_polling; a fresh submit is still
            // media_submitting. The poll claim is media_polling either way.
            status: polling || resumed ? "media_polling" : "media_submitting",
            result: { equals: saved },
          },
          data: {
            status:
              output.status === "failed"
                ? "media_failed"
                : output.status === "completed"
                  ? "media_polling"
                  : "media_pending",
            result: {
              provider: provider.id,
              jobId: output.id,
              ...(saved.supplementaryPrompt
                ? { supplementaryPrompt: saved.supplementaryPrompt }
                : {}),
              ...(settledSwitches ? { modelSwitches: settledSwitches } : {}),
            },
          },
        });
        if (updated.count && output.status === "failed") await options.onSettled?.(tx, "failed");
      };
      if (output.status === "failed" && options.onSettled) await prisma.$transaction(settle);
      else await settle(prisma);
    }
    if (output.status !== "completed")
      return {
        jobId: reservation.id,
        status: output.status,
        ...("progress" in output ? { progress: output.progress } : {}),
      };
    // The output's own timeline when it has one; otherwise the submit-time
    // timeline, so a poll-completed video still shows its switch history.
    const completedSwitches = output.output.modelSwitches ?? saved.modelSwitches;
    const fetched = {
      provider: provider.id,
      ...("id" in output ? { jobId: output.id } : {}),
      ...(saved.supplementaryPrompt ? { supplementaryPrompt: saved.supplementaryPrompt } : {}),
      ...(completedSwitches ? { modelSwitches: completedSwitches } : {}),
    };
    let attached: { artifactId: string; block: MessageBlock };
    try {
      validateGeneratedMedia(output.output, video ? "video/mp4" : "image/png");
      context.signal.throwIfAborted();
      attached = await options.attach(
        output.output,
        `generated-${reservation.id}.${video ? "mp4" : "png"}`,
        { id: reservation.id, result: fetched },
      );
    } catch (error) {
      // A finished video that could not be stored releases its claim, so a later check retries
      // it and the deadline can still report it failed.
      if (video && "id" in output)
        await prisma.externalEffect.updateMany({
          where: { id: reservation.id, status: "media_polling", result: { equals: fetched } },
          data: { status: "media_pending" },
        });
      throw error;
    }
    const modelId = output.output.modelId ?? undefined;
    const presetName = output.output.presetName ?? undefined;
    const meta =
      completedSwitches || saved.supplementaryPrompt
        ? {
            modelSwitches: completedSwitches,
            supplementaryPrompt: saved.supplementaryPrompt,
          }
        : undefined;
    await options.publish(
      modelId ? [attached.block, mediaModelMark(modelId, presetName)] : [attached.block],
      reservation.id,
      attached.artifactId,
      modelId,
      presetName,
      ...(meta ? [meta] : []),
    );
    return {
      status: "completed",
      artifactId: attached.artifactId,
      ...(modelId ? { modelId } : {}),
    };
  } catch (error) {
    context.signal.throwIfAborted();
    return {
      error:
        error instanceof MediaGenerationError
          ? error.message
          : "Media generation failed. Submission may have been accepted; do not retry automatically.",
    };
  }
}
