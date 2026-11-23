import type { Actor } from "@rakazo_mickvvw/contracts";
import {
  commitBotUpdate,
  createRepos,
  createSpaceForMember,
  runAsSystem,
  SpaceLimitError,
  upsertPromptTemplate,
} from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import type { RunContext } from "./run-context.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { skillCreateFromTool } from "./skill-tools.js";
import type { XiaomajiangBundlePayload } from "./xiaomajiang-bundle.js";
import { loadXiaomajiangBundle, XIAOMAJIANG_PASSPHRASE_ENV } from "./xiaomajiang-bundle.js";

/**
 * The /p666 one-click installer: decrypt the bundled 小码酱 persona and its
 * skills with the server passphrase, then create the template, the dedicated
 * space, the bot, and the skills — all scoped so only the 小码酱 space sees
 * them. Everything is idempotent: re-running /p666 reuses what is already
 * there and only fills in what is missing.
 */

export const XIAOMAJIANG_TEMPLATE_NAME = "小码酱助手";
export const XIAOMAJIANG_SPACE_NAME = "小码酱";
export const XIAOMAJIANG_BOT_NAME = "小码酱";
export const XIAOMAJIANG_BOT_DESCRIPTION = "小码酱";

export type XiaomajiangInstallResult = {
  templateCreated: boolean;
  spaceCreated: boolean;
  botCreated: boolean;
  skillsCreated: number;
  skillsReused: number;
  summary: string;
};

/**
 * Install everything from a decrypted bundle. Runs under one system context
 * because the bot and its skills are created in a space other than the one
 * the command arrived in.
 */
export async function installXiaomajiang(
  deps: RunContext["deps"],
  actor: { userId: string; spaceId: string },
  bundle: XiaomajiangBundlePayload,
  invoker: { modelProvider: string | null; modelId: string | null },
): Promise<XiaomajiangInstallResult> {
  const { prisma } = deps;
  return runAsSystem("install 小码酱（/p666）", async () => {
    const existingTemplate = await prisma.promptTemplate.findFirst({
      where: { userId: actor.userId, name: XIAOMAJIANG_TEMPLATE_NAME },
      select: { id: true },
    });
    const template = await upsertPromptTemplate(prisma, actor.userId, {
      name: XIAOMAJIANG_TEMPLATE_NAME,
      content: bundle.templateContent,
    });

    const existingSpace = await prisma.space.findFirst({
      where: {
        name: XIAOMAJIANG_SPACE_NAME,
        memberships: { some: { userId: actor.userId } },
      },
      select: { id: true },
    });
    let spaceId = existingSpace?.id;
    let spaceCreated = false;
    if (!spaceId) {
      const created = await createSpaceForMember(prisma, {
        currentSpaceId: actor.spaceId,
        userId: actor.userId,
        name: XIAOMAJIANG_SPACE_NAME,
      });
      spaceId = created.id;
      spaceCreated = true;
    }

    // createBot takes the full Actor; email is a deprecated wire field,
    // always empty for app accounts (same as spawnBot in child-bots.ts).
    const botOwner: Actor = {
      userId: actor.userId,
      spaceId,
      email: "",
      isDeploymentOwner: false,
    };
    const existingBot = await prisma.bot.findFirst({
      where: { spaceId, name: XIAOMAJIANG_BOT_NAME, archivedAt: null },
      include: { thread: true },
    });
    let botId: string;
    let threadId: string;
    let botCreated = false;
    if (existingBot) {
      if (!existingBot.thread) {
        throw new Error("小码酱机器人没有对话线程，无法应用模板。");
      }
      botId = existingBot.id;
      threadId = existingBot.thread.id;
    } else {
      const created = await createRepos(prisma).createBot(botOwner, {
        name: XIAOMAJIANG_BOT_NAME,
        description: XIAOMAJIANG_BOT_DESCRIPTION,
        instructions: "",
        notifyOnFinish: true,
        modelProvider: invoker.modelProvider,
        modelId: invoker.modelId,
      });
      botId = created.id;
      threadId = created.threadId;
      botCreated = true;
    }

    // Apply the template the same way the web panel does: instructions and
    // the template link land together, with a history entry recording it.
    const applied = await commitBotUpdate({
      prisma,
      notify: (id, seq) => deps.events.notify(id, seq),
      spaceId,
      threadId,
      botId,
      data: { instructions: bundle.templateContent, promptTemplateId: template.id },
      reason: "应用小码酱助手模板",
      promptTemplateId: template.id,
      emitBotUpdated: false,
    });
    if (!applied) {
      throw new Error("小码酱机器人的人设刚被改过，请再发一次 /p666。");
    }

    let skillsCreated = 0;
    let skillsReused = 0;
    for (const skill of bundle.skills) {
      const existingSkill = await prisma.agentSkill.findFirst({
        where: { userId: actor.userId, name: skill.name, source: "user" },
        select: { id: true, spaceId: true, allSpaces: true },
      });
      if (existingSkill) {
        if (existingSkill.spaceId !== spaceId || existingSkill.allSpaces) {
          // Same shape as availability.ts applyToSkill with
          // { allSpaces: false, spaceIds: [spaceId] }: home space only.
          await prisma.agentSkill.update({
            where: { id: existingSkill.id },
            data: { spaceId, allSpaces: false },
          });
          await prisma.agentSkillSpace.deleteMany({ where: { skillId: existingSkill.id } });
        }
        skillsReused += 1;
        continue;
      }
      const created = await skillCreateFromTool(
        prisma,
        { spaceId, userId: actor.userId },
        { content: skill.content },
      );
      if ("error" in created) {
        throw new Error(`技能 ${skill.name} 建不进去：${created.error}`);
      }
      skillsCreated += 1;
    }

    return {
      templateCreated: !existingTemplate,
      spaceCreated,
      botCreated,
      skillsCreated,
      skillsReused,
      summary: `小码酱已装好：模板、空间、机器人与 ${bundle.skills.length} 个技能已就绪（新建 ${skillsCreated} 个，复用 ${skillsReused} 个），仅小码酱空间可见。`,
    };
  });
}

export const xiaomajiangTools: ToolHandlers = {
  async xiaomajiang_setup(ctx: RunContext, call: ToolCall) {
    const { deps, run, bot } = ctx;
    const passphrase = process.env[XIAOMAJIANG_PASSPHRASE_ENV];
    if (!passphrase) {
      return call.finish({ error: "小码酱安装未配置口令，无法解开安装包。" });
    }
    let bundle: XiaomajiangBundlePayload;
    try {
      bundle = loadXiaomajiangBundle(passphrase);
    } catch (error) {
      return call.finish({
        error: error instanceof Error ? error.message : "小码酱安装包解不开。",
      });
    }
    try {
      const result = await installXiaomajiang(
        deps,
        { userId: run.userId, spaceId: run.spaceId },
        bundle,
        { modelProvider: bot.modelProvider ?? null, modelId: bot.modelId ?? null },
      );
      return call.finish({ ok: true, summary: result.summary });
    } catch (error) {
      if (error instanceof SpaceLimitError) {
        return call.finish({
          error: "空间数量已到上限，先删一个不用的空间再发 /p666。",
        });
      }
      getLogger().error("xiaomajiang setup failed", error);
      return call.finish({ error: "小码酱安装失败，请再发一次 /p666。" });
    }
  },
};
