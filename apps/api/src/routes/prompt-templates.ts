import { ORPCError } from "@orpc/server";
import { createSafeRemoteFetch } from "@rakazo_mickvvw/adapters";
import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import {
  APPLY_IMAGE_PRESET_REASON,
  APPLY_TEMPLATE_REASON,
  APPLY_VIDEO_PRESET_REASON,
  activeBotPromptPreset,
  PromptTemplateImportError,
  parseBotPromptPresets,
  parsePromptTemplateImport,
} from "@rakazo_mickvvw/contracts";
import { cancelResponseBody } from "@rakazo_mickvvw/core";
import {
  commitBotUpdate,
  createPromptTemplate,
  IsolationError,
  isUniqueViolation,
  listPromptTemplates,
  PromptTemplateNameConflictError,
  removePromptTemplate,
  restoreDefaultPromptTemplates,
  updatePromptTemplate,
  upsertPromptTemplate,
} from "@rakazo_mickvvw/db";
import type { RouterContext } from "./context.js";

/** A subscription file holds at most 100 templates of 20000 characters each. */
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 2_000_000;

/** A duplicate name, whether the pre-check or the unique constraint caught it. */
function isNameConflict(error: unknown): boolean {
  return error instanceof PromptTemplateNameConflictError || isUniqueViolation(error);
}

/** Read a subscription body as text, cut off at the cap instead of buffering it whole. */
async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelResponseBody(response);
    return { text: "", truncated: true };
  }
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { text, truncated: true };
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: false };
  } finally {
    reader.releaseLock();
  }
}

/** The file name of a subscription URL, without its extension, is the template name. */
function templateNameFromUrl(url: URL): string {
  const base = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(base.replace(/\.(txt|md|json)$/i, ""));
  } catch {
    return "";
  }
}

export function promptTemplatesRoutes(ctx: RouterContext) {
  const { deps, repos, authed } = ctx;
  return {
    promptTemplates: {
      list: authed.promptTemplates.list.handler(async ({ context }) =>
        listPromptTemplates(deps.prisma, context.actor.userId),
      ),
      create: authed.promptTemplates.create.handler(async ({ context, input }) => {
        try {
          return await createPromptTemplate(deps.prisma, context.actor.userId, input);
        } catch (error) {
          if (isNameConflict(error)) {
            throw new ORPCError("CONFLICT", { message: "已有同名模板" });
          }
          throw error;
        }
      }),
      update: authed.promptTemplates.update.handler(async ({ context, input }) => {
        try {
          return await updatePromptTemplate(deps.prisma, context.actor.userId, input);
        } catch (error) {
          if (isNameConflict(error)) {
            throw new ORPCError("CONFLICT", { message: "已有同名模板" });
          }
          throw error;
        }
      }),
      remove: authed.promptTemplates.remove.handler(async ({ context, input }) => {
        await removePromptTemplate(deps.prisma, context.actor.userId, input.templateId);
        return { ok: true as const };
      }),
      apply: authed.promptTemplates.apply.handler(async ({ context, input }) => {
        const template = await deps.prisma.promptTemplate.findFirst({
          where: { id: input.templateId, userId: context.actor.userId },
        });
        if (!template) throw new IsolationError();
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.thread) throw new IsolationError();
        const committed = await commitBotUpdate({
          prisma: deps.prisma,
          notify: (threadId, seq) => deps.events.notify(threadId, seq),
          spaceId: context.actor.spaceId,
          threadId: bot.thread.id,
          botId: input.botId,
          data: { instructions: template.content, promptTemplateId: template.id },
          reason: APPLY_TEMPLATE_REASON,
          promptTemplateId: template.id,
          emitBotUpdated: false,
        });
        if (!committed) {
          throw new ORPCError("CONFLICT", { message: "机器人的人设刚被改过，请再试一次" });
        }
        const updated = (await repos.listBots(context.actor)).find((bot) => bot.id === input.botId);
        if (!updated) throw new IsolationError();
        return updated;
      }),
      applyPreset: authed.promptTemplates.applyPreset.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.thread) throw new IsolationError();
        const preset = activeBotPromptPreset(
          parseBotPromptPresets(
            input.kind === "image" ? bot.imagePromptPresets : bot.videoPromptPresets,
          ),
          input.kind === "image" ? bot.activeImagePromptPreset : bot.activeVideoPromptPreset,
        );
        if (!preset) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              input.kind === "image"
                ? "这个机器人没有图片提示词预设，先在机器人设置里添加一个"
                : "这个机器人没有视频提示词预设，先在机器人设置里添加一个",
          });
        }
        const committed = await commitBotUpdate({
          prisma: deps.prisma,
          notify: (threadId, seq) => deps.events.notify(threadId, seq),
          spaceId: context.actor.spaceId,
          threadId: bot.thread.id,
          botId: input.botId,
          // A preset persona is not a template: the write clears the template
          // link, and the previous instructions stay in history to undo it.
          data: { instructions: preset.prompt, promptTemplateId: null },
          reason: input.kind === "image" ? APPLY_IMAGE_PRESET_REASON : APPLY_VIDEO_PRESET_REASON,
          promptTemplateId: null,
          emitBotUpdated: false,
        });
        if (!committed) {
          throw new ORPCError("CONFLICT", { message: "机器人的人设刚被改过，请再试一次" });
        }
        const updated = (await repos.listBots(context.actor)).find((bot) => bot.id === input.botId);
        if (!updated) throw new IsolationError();
        return updated;
      }),
      saveCurrentAsTemplate: authed.promptTemplates.saveCurrentAsTemplate.handler(
        async ({ context, input }) => {
          const bot = await repos.getBot(context.actor, input.botId);
          const content = bot.instructions.trim();
          if (!content) {
            throw new ORPCError("BAD_REQUEST", {
              message: "当前人设是空的，没什么可保存的",
            });
          }
          return upsertPromptTemplate(deps.prisma, context.actor.userId, {
            name: input.name ?? bot.name,
            content,
          });
        },
      ),
      restoreDefaults: authed.promptTemplates.restoreDefaults.handler(async ({ context }) =>
        restoreDefaultPromptTemplates(deps.prisma, context.actor.userId),
      ),
      fetchFromUrl: authed.promptTemplates.fetchFromUrl.handler(async ({ input }) => {
        const url = new URL(input.url);
        if (url.protocol !== "https:") {
          throw new ORPCError("BAD_REQUEST", { message: "订阅地址要用 https" });
        }
        const safeFetch = createSafeRemoteFetch();
        let response: Response;
        try {
          response = await safeFetch(url, {
            headers: { accept: "text/plain, application/json, */*" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
        } catch {
          throw new ORPCError("BAD_REQUEST", { message: "拉取失败，请检查订阅地址" });
        } finally {
          safeFetch.close();
        }
        if (!response.ok) {
          throw new ORPCError("BAD_REQUEST", {
            message: `订阅地址返回了 ${response.status}，请检查地址`,
          });
        }
        const { text, truncated } = await readBoundedResponseText(response, FETCH_MAX_BYTES);
        if (truncated) {
          throw new ORPCError("BAD_REQUEST", { message: "订阅内容太大了" });
        }
        try {
          return {
            templates: parsePromptTemplateImport({
              text,
              suggestedName: templateNameFromUrl(url),
            }),
          };
        } catch (error) {
          if (error instanceof PromptTemplateImportError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      }),
      confirmImport: authed.promptTemplates.confirmImport.handler(async ({ context, input }) => {
        const templates: PromptTemplate[] = [];
        for (const item of input.templates) {
          templates.push(
            await upsertPromptTemplate(deps.prisma, context.actor.userId, {
              ...item,
              sourceUrl: input.sourceUrl,
            }),
          );
        }
        // An imported template the bot already uses takes effect at once.
        if (input.botId) {
          const bot = await repos.getBot(context.actor, input.botId);
          const linked = templates.find((template) => template.id === bot.promptTemplateId);
          if (linked && bot.thread) {
            await commitBotUpdate({
              prisma: deps.prisma,
              notify: (threadId, seq) => deps.events.notify(threadId, seq),
              spaceId: context.actor.spaceId,
              threadId: bot.thread.id,
              botId: input.botId,
              data: { instructions: linked.content, promptTemplateId: linked.id },
              reason: APPLY_TEMPLATE_REASON,
              promptTemplateId: linked.id,
              emitBotUpdated: false,
            });
          }
        }
        return { templates };
      }),
    },
  };
}
