import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { AdapterContext } from "@rakazo/adapter-kit";
import type { ExecutorDeps } from "@rakazo/adapters";
import {
  generateMediaFromTool,
  MEDIA_JOB_KIND,
  mediaDelivery,
  resolveBotMediaGenerationProvider,
  savedJob,
  scheduleMediaPoll,
} from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import type { RouterContext } from "./context.js";

/** What generateMediaFromTool stored on the job row when it submitted. */
function parseMediaJobRequest(
  value: unknown,
): { tool: "generate_image" | "generate_video"; prompt: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.tool !== "generate_image" && record.tool !== "generate_video") return undefined;
  if (typeof record.prompt !== "string" || !record.prompt) return undefined;
  return { tool: record.tool, prompt: record.prompt };
}

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
        const artifact = await loadOwnedArtifact(deps.prisma, actor, input.artifactId);
        const bot = await repos.getBot(actor, artifact.botId);
        const job = await loadMediaJob(deps.prisma, actor, input.artifactId);
        if (!job) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
        const request = parseMediaJobRequest(job.request);
        if (!request) throw new ORPCError("NOT_FOUND", { message: "找不到这次生成" });
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
        if (!provider)
          throw new ORPCError("BAD_REQUEST", { message: "这个机器人没有可用的媒体模型" });
        // A fresh run anchors the new job: its own idempotency namespace, so
        // the original run's two media slots are never contended, and a
        // status that the run reconciler never picks up, so no stray turn
        // starts. The message still lands in the original thread.
        const operationId = `media-regenerate:${input.artifactId}:${randomUUID()}`;
        const created = await deps.prisma.$transaction(async (tx) => {
          const task = await tx.task.create({
            data: {
              spaceId: actor.spaceId,
              botId: bot.id,
              threadId: thread.id,
              userId: actor.userId,
              prompt: "重新生成媒体",
              status: "completed",
            },
          });
          const run = await tx.run.create({
            data: {
              spaceId: actor.spaceId,
              botId: bot.id,
              threadId: thread.id,
              userId: actor.userId,
              taskId: task.id,
              status: "completed",
              trigger: "media",
              clientNonce: operationId,
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
        // The raw prompt, plus the extra prompt when one is set; the current
        // preset is applied inside the provider call, as for a fresh request.
        const prompt = supplementaryPrompt
          ? `${request.prompt}\n${supplementaryPrompt}`
          : request.prompt;
        const delivery = mediaDelivery(
          { prisma: deps.prisma, events: deps.events, artifacts: deps.artifacts },
          run,
          {
            providerId: provider.id,
            groupId: thread.groupId ?? undefined,
            operationId,
          },
        );
        const result = await generateMediaFromTool({
          name: request.tool,
          args: { prompt },
          executionId: operationId,
          provider,
          prisma: deps.prisma,
          context: adapterContext,
          run,
          threadGeneration: thread.historyCompactionGeneration,
          ...delivery,
        });
        if (!result || "error" in result)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: result && "error" in result ? result.error : "重新生成失败",
          });
        if ("jobId" in result && result.jobId && result.status !== "completed") {
          // A video still rendering: the existing poll delivers it.
          await scheduleMediaPoll(deps.jobs, result.jobId);
          return { ok: true as const, status: "queued" as const };
        }
        if (result.status === "completed" && "artifactId" in result && result.artifactId)
          return { ok: true as const, status: "completed" as const, artifactId: result.artifactId };
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "重新生成失败" });
      }),
    },
  };
}
