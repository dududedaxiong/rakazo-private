import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { AdapterContext } from "@rakazo_mickvvw/adapter-kit";
import type { ExecutorDeps } from "@rakazo_mickvvw/adapters";
import {
  generateMediaFromTool,
  MEDIA_JOB_KIND,
  mediaDelivery,
  mediaJobRequest,
  resolveBotMediaGenerationProvider,
  savedJob,
  scheduleMediaPoll,
} from "@rakazo_mickvvw/adapters";
import type { Actor } from "@rakazo_mickvvw/contracts";
import type { Prisma, PrismaClient } from "@rakazo_mickvvw/db";
import type { RouterContext } from "./context.js";

/** A bot-owned generated file; anything else is NOT_FOUND, never a leak. */
async function loadOwnedArtifact(prisma: PrismaClient, actor: Actor, artifactId: string) {
  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: actor.spaceId, userId: actor.userId },
    select: { id: true, botId: true, runId: true },
  });
  if (!artifact?.botId || !artifact.runId)
    throw new ORPCError("NOT_FOUND", { message: "找不到这个媒体文件" });
  return { id: artifact.id, botId: artifact.botId, runId: artifact.runId };
}

/** The generation job that produced an artifact, by the artifact it saved. */
async function loadMediaJob(prisma: PrismaClient, actor: Actor, artifactId: string) {
  return prisma.externalEffect.findFirst({
    where: {
      kind: MEDIA_JOB_KIND,
      spaceId: actor.spaceId,
      result: { path: ["artifactId"], equals: artifactId },
    },
    select: { id: true, request: true, result: true },
  });
}

/**
 * A generated image or video, by its artifact. The supplementary prompt lives
 * on the generation's job row; a re-run replays the raw prompt plus that
 * prompt under the bot's current media settings, as a new generation in the
 * same thread. Media files the caller's bot did not generate are NOT_FOUND.
 */
export function mediaRoutes(ctx: RouterContext) {
  const { deps, repos, authed } = ctx;
  return {
    media: {
      getSupplementaryPrompt: authed.media.getSupplementaryPrompt.handler(
        async ({ context, input }) => {
          const artifact = await loadOwnedArtifact(deps.prisma, context.actor, input.artifactId);
          await repos.getBot(context.actor, artifact.botId);
          const job = await loadMediaJob(deps.prisma, context.actor, input.artifactId);
          const saved = job ? savedJob.safeParse(job.result) : undefined;
          const data = saved?.success ? saved.data : undefined;
          return {
            supplementaryPrompt: data?.supplementaryPrompt ?? "",
            ...(data?.modelId ? { modelId: data.modelId } : {}),
            ...(data?.presetName ? { presetName: data.presetName } : {}),
          };
        },
      ),
      setSupplementaryPrompt: authed.media.setSupplementaryPrompt.handler(
        async ({ context, input }) => {
          const artifact = await loadOwnedArtifact(deps.prisma, context.actor, input.artifactId);
          await repos.getBot(context.actor, artifact.botId);
          const job = await loadMediaJob(deps.prisma, context.actor, input.artifactId);
          if (!job) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
          const saved = savedJob.safeParse(job.result);
          if (!saved.success) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
          const result = { ...(job.result as Record<string, unknown>) };
          if (input.supplementaryPrompt) result.supplementaryPrompt = input.supplementaryPrompt;
          else delete result.supplementaryPrompt;
          await deps.prisma.externalEffect.update({
            where: { id: job.id },
            data: { result: result as Prisma.InputJsonValue },
          });
          return { ok: true as const };
        },
      ),
      regenerate: authed.media.regenerate.handler(async ({ context, input }) => {
        const actor = context.actor;
        // Old clients send no mode; they keep the previous single-button
        // behavior, which is a fresh random generation.
        const mode = input.mode ?? "random";
        const artifact = await loadOwnedArtifact(deps.prisma, actor, input.artifactId);
        const bot = await repos.getBot(actor, artifact.botId);
        const job = await loadMediaJob(deps.prisma, actor, input.artifactId);
        if (!job) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
        const request = mediaJobRequest.safeParse(job.request);
        if (!request.success) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
        const saved = savedJob.safeParse(job.result);
        const supplementaryPrompt = saved.success ? saved.data.supplementaryPrompt : undefined;
        const originalRun = await deps.prisma.run.findUnique({
          where: { id: artifact.runId },
          select: { threadId: true },
        });
        if (!originalRun) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
        const thread = await deps.prisma.thread.findUnique({
          where: { id: originalRun.threadId, spaceId: actor.spaceId },
          select: { id: true, groupId: true, historyCompactionGeneration: true },
        });
        if (!thread) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
        // Only what resolving a bot media model reads: the credential store,
        // the catalog, and the deployment key for a hosted model.
        const resolveDeps = {
          prisma: deps.prisma,
          secretStore: deps.secrets,
          codexCatalog: ctx.codexCatalog,
          billingEnabled: deps.billing?.modelCreditsEnabled,
          deploymentModelKey: deps.env.deploymentModelKey,
          deploymentModelConfigured: deps.env.deploymentModelConfigured,
        } as unknown as ExecutorDeps;
        const scope = { userId: actor.userId, spaceId: actor.spaceId };
        const provider = await resolveBotMediaGenerationProvider(
          resolveDeps,
          scope,
          bot,
          deps.mediaGeneration,
        );
        const isImage = request.data.tool === "generate_image";
        // An edit answers from the bot's edit list, never the generation
        // list; a random generation from the generation list. A bot with no
        // list for the mode has nothing to run.
        const hasModels =
          mode === "edit"
            ? provider?.editCapabilities?.[isImage ? "images" : "video"]
            : isImage
              ? provider?.capabilities.images
              : provider?.capabilities.video;
        if (!provider || !hasModels)
          throw new ORPCError("BAD_REQUEST", {
            message:
              mode === "edit"
                ? "这个机器人还没有配置编辑模型，请先在影图模型设置里添加"
                : "这个机器人没有可用的媒体模型",
          });
        // An edit is the supplementary prompt alone: the reference already
        // carries the content, and no preset is applied. A random generation
        // replays the raw prompt plus the supplementary prompt, with the
        // current preset applied inside the provider call, as for a fresh
        // request. The supplementary prompt applies to both modes.
        if (mode === "edit" && !supplementaryPrompt)
          throw new ORPCError("BAD_REQUEST", { message: "请先填写细节提示词" });
        const prompt =
          mode === "edit"
            ? supplementaryPrompt!
            : supplementaryPrompt
              ? `${request.data.prompt}\n${supplementaryPrompt}`
              : request.data.prompt;
        // A video edit needs a reference frame: the uploaded image, which
        // takes priority, or a frame the server extracted from the original
        // video. Extraction is not available yet, so without an upload there
        // is no reference to edit from.
        let referenceArtifactId: string | undefined;
        if (mode === "edit" && !isImage) {
          if (!input.referenceArtifactId)
            throw new ORPCError("BAD_REQUEST", { message: "视频编辑需要上传一张参考图" });
          const reference = await deps.prisma.artifact.findFirst({
            where: { id: input.referenceArtifactId, spaceId: actor.spaceId, userId: actor.userId },
            select: { id: true, mimeType: true },
          });
          if (!reference?.mimeType.startsWith("image/"))
            throw new ORPCError("NOT_FOUND", { message: "找不到这张参考图" });
          referenceArtifactId = reference.id;
        }
        // A fresh run anchors the new job: its own idempotency namespace, so
        // the original run's two media slots are never contended. It starts
        // running, with no lease, so the run reconciler never picks it up
        // and no stray turn starts; the background poll settles it to
        // completed or failed when the media lands or fails. The message
        // still lands in the original thread.
        const operationId = `media-regenerate:${input.artifactId}:${randomUUID()}`;
        const created = await deps.prisma.$transaction(async (tx) => {
          const task = await tx.task.create({
            data: {
              spaceId: actor.spaceId,
              botId: bot.id,
              threadId: thread.id,
              userId: actor.userId,
              prompt: "重新生成媒体",
              status: "running",
            },
          });
          const run = await tx.run.create({
            data: {
              spaceId: actor.spaceId,
              botId: bot.id,
              threadId: thread.id,
              userId: actor.userId,
              taskId: task.id,
              status: "running",
              trigger: "media",
              clientNonce: operationId,
              startedAt: new Date(),
            },
          });
          return { task, run };
        });
        const run = {
          id: created.run.id,
          threadId: thread.id,
          botId: bot.id,
          userId: actor.userId,
          spaceId: actor.spaceId,
        };
        const adapterContext: AdapterContext = {
          operationId,
          traceId: operationId,
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId: bot.id,
          signal: context.signal ?? AbortSignal.timeout(5 * 60_000),
        };
        // The chat shows it is generating right away, the same progress line
        // a fresh generation shows; it clears when the run settles.
        await deps.events
          .append({
            spaceId: actor.spaceId,
            threadId: thread.id,
            botId: bot.id,
            type: "thread.progress",
            payload: {
              text: isImage ? "正在生成图片…" : "正在生成视频…",
              activity: true,
            },
            runId: created.run.id,
          })
          .catch(() => undefined);
        const delivery = mediaDelivery(
          { prisma: deps.prisma, events: deps.events, artifacts: deps.artifacts },
          run,
          {
            providerId: provider.id,
            groupId: thread.groupId ?? undefined,
            operationId,
          },
        );
        // Submit only: the job row is created and the poll is scheduled, and
        // the RPC returns at once instead of holding the connection while
        // the media renders. The poll runs the generation and delivers it.
        const result = await generateMediaFromTool({
          name: request.data.tool,
          args: { prompt },
          executionId: operationId,
          submitOnly: true,
          mode,
          ...(mode === "edit" && isImage ? { sourceArtifactId: artifact.id } : {}),
          ...(referenceArtifactId ? { referenceArtifactId } : {}),
          ...(supplementaryPrompt ? { supplementaryPrompt } : {}),
          provider,
          prisma: deps.prisma,
          context: adapterContext,
          run,
          threadGeneration: thread.historyCompactionGeneration,
          ...delivery,
        });
        if (!result || "error" in result) {
          // Nothing was submitted; close the run honestly instead of
          // leaving it working, and close any reservation this run made.
          const error = result && "error" in result && result.error ? result.error : "重新生成失败";
          await deps.prisma
            .$transaction(async (tx) => {
              await tx.externalEffect.updateMany({
                where: { runId: created.run.id, kind: MEDIA_JOB_KIND },
                data: { status: "media_failed" },
              });
              await tx.run.updateMany({
                where: { id: created.run.id, status: "running" },
                data: { status: "failed", error, completedAt: new Date() },
              });
              await tx.task.updateMany({
                where: { id: created.task.id },
                data: { status: "failed" },
              });
            })
            .catch(() => undefined);
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: error });
        }
        if ("jobId" in result && result.jobId) {
          await scheduleMediaPoll(deps.jobs, result.jobId);
          return { ok: true as const, status: "queued" as const };
        }
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "重新生成失败" });
      }),
    },
  };
}
