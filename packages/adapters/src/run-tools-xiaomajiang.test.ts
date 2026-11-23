import {
  commitBotUpdate,
  createRepos,
  createSpaceForMember,
  SpaceLimitError,
  upsertPromptTemplate,
} from "@rakazo_mickvvw/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { xiaomajiangTools } from "./run-tools-xiaomajiang.js";
import { skillCreateFromTool } from "./skill-tools.js";
import type { XiaomajiangBundlePayload } from "./xiaomajiang-bundle.js";
import { loadXiaomajiangBundle } from "./xiaomajiang-bundle.js";

vi.mock("@rakazo_mickvvw/db", () => {
  class SpaceLimitError extends Error {}
  return {
    commitBotUpdate: vi.fn(),
    createRepos: vi.fn(),
    createSpaceForMember: vi.fn(),
    runAsSystem: async (_reason: string, fn: () => Promise<unknown>) => fn(),
    SpaceLimitError,
    upsertPromptTemplate: vi.fn(),
  };
});
vi.mock("./skill-tools.js", () => ({ skillCreateFromTool: vi.fn() }));
vi.mock("./xiaomajiang-bundle.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./xiaomajiang-bundle.js")>();
  return { ...original, loadXiaomajiangBundle: vi.fn() };
});

type SkillRow = {
  id: string;
  name: string;
  description: string;
  content: string;
  spaceId: string;
  allSpaces: boolean;
};

function fakeBundle(): XiaomajiangBundlePayload {
  return {
    version: 1,
    templateContent: `你是小码酱。${"行为准则。".repeat(200)}`,
    skills: [
      {
        name: "passive-recon",
        description: "被动侦察",
        content: "---\nname: passive-recon\ndescription: 被动侦察\n---\n\n收集公开信息。",
      },
      {
        name: "web-fingerprint",
        description: "指纹识别",
        content: "---\nname: web-fingerprint\ndescription: 指纹识别\n---\n\n识别网站技术栈。",
      },
    ],
  };
}

function setupStore(seed?: {
  template?: boolean;
  space?: boolean;
  bot?: boolean;
  skills?: SkillRow[];
}) {
  const TEMPLATE_NAME = "小码酱助手";
  const templates: Record<string, { id: string; name: string; content: string }> = {};
  const spaces: { id: string; name: string }[] = [];
  const bots: {
    id: string;
    spaceId: string;
    name: string;
    threadId: string;
    thread?: { id: string };
  }[] = [];
  const skills: SkillRow[] = [...(seed?.skills ?? [])];
  if (seed?.template) {
    templates[TEMPLATE_NAME] = { id: "template-1", name: TEMPLATE_NAME, content: "old" };
  }
  if (seed?.space) spaces.push({ id: "space-xmj", name: "小码酱" });
  if (seed?.bot) {
    bots.push({
      id: "bot-xmj",
      spaceId: "space-xmj",
      name: "小码酱",
      threadId: "thread-xmj",
      thread: { id: "thread-xmj" },
    });
  }
  const prisma = {
    promptTemplate: {
      findFirst: async () => templates[TEMPLATE_NAME] ?? null,
    },
    space: {
      findFirst: async () => spaces.find((s) => s.name === "小码酱") ?? null,
    },
    bot: {
      findFirst: async () =>
        bots.find((b) => b.spaceId === "space-xmj" && b.name === "小码酱") ?? null,
    },
    agentSkill: {
      findFirst: async ({ where }: { where: { name: string } }) =>
        skills.find((s) => s.name === where.name) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<SkillRow> }) => {
        const row = skills.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    agentSkillSpace: {
      deleteMany: async () => ({ count: 0 }),
    },
  };
  vi.mocked(upsertPromptTemplate).mockImplementation(
    async (_client: unknown, _userId: string, input: { name: string; content: string }) => {
      const row = { id: templates[input.name]?.id ?? "template-1", ...input };
      templates[input.name] = row;
      return row as never;
    },
  );
  vi.mocked(createSpaceForMember).mockImplementation(async () => {
    const row = { id: "space-xmj", name: "小码酱" };
    spaces.push(row);
    return row;
  });
  vi.mocked(createRepos).mockImplementation(
    () =>
      ({
        createBot: async (_owner: unknown, input: { name: string }) => {
          const row = {
            id: "bot-xmj",
            spaceId: "space-xmj",
            name: input.name,
            threadId: "thread-xmj",
          };
          bots.push(row);
          return row;
        },
      }) as never,
  );
  vi.mocked(commitBotUpdate).mockImplementation(
    async (args: { botId: string }) =>
      ({
        id: args.botId,
      }) as never,
  );
  vi.mocked(skillCreateFromTool).mockImplementation(async (_client, owner, { content }) => {
    const text = content ?? "";
    const name = text.match(/^name: (.+)$/m)?.[1] ?? "unknown";
    const description = text.match(/^description: (.+)$/m)?.[1] ?? "";
    const row: SkillRow = {
      id: `skill-${name}`,
      name,
      description,
      content: text,
      spaceId: owner.spaceId,
      allSpaces: false,
    };
    skills.push(row);
    return { ok: true, id: row.id };
  });
  return { prisma, templates, spaces, bots, skills };
}

function makeCtx(prisma: unknown) {
  return {
    deps: { prisma, events: { notify: async () => undefined } },
    run: { userId: "user-1", spaceId: "space-1" },
    bot: { modelProvider: "test-provider", modelId: "test-model" },
  };
}

function makeCall() {
  return {
    name: "xiaomajiang_setup",
    args: {},
    finish: async (result: unknown) => result,
  };
}

describe("xiaomajiang_setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("XIAOMAJIANG_PASSPHRASE", "test-passphrase-not-a-secret");
    vi.mocked(loadXiaomajiangBundle).mockImplementation(() => fakeBundle());
  });

  it("creates the template, space, bot, and skills on a fresh install", async () => {
    const { prisma, skills } = setupStore();
    const result = await xiaomajiangTools.xiaomajiang_setup!(
      makeCtx(prisma) as never,
      makeCall() as never,
    );
    expect(result).toEqual({
      ok: true,
      summary:
        "小码酱已装好：模板、空间、机器人与 2 个技能已就绪（新建 2 个，复用 0 个），仅小码酱空间可见。",
    });
    expect(vi.mocked(upsertPromptTemplate).mock.calls[0]?.[2].name).toBe("小码酱助手");
    expect(vi.mocked(createSpaceForMember).mock.calls[0]?.[1].name).toBe("小码酱");
    expect(vi.mocked(createRepos).mock.calls).toHaveLength(1);
    const update = vi.mocked(commitBotUpdate).mock.calls[0]?.[0] as {
      data: { instructions: string; promptTemplateId: string };
    };
    expect(update.data.instructions).toBe(fakeBundle().templateContent);
    expect(update.data.promptTemplateId).toBe("template-1");
    expect(vi.mocked(skillCreateFromTool).mock.calls).toHaveLength(2);
    expect(skills.every((s) => s.spaceId === "space-xmj" && !s.allSpaces)).toBe(true);
  });

  it("reuses what exists and re-scopes a skill that leaked into other spaces", async () => {
    const { prisma, skills } = setupStore({
      template: true,
      space: true,
      bot: true,
      skills: [
        {
          id: "skill-passive-recon",
          name: "passive-recon",
          description: "被动侦察",
          content: "x",
          spaceId: "space-xmj",
          allSpaces: false,
        },
        {
          id: "skill-web-fingerprint",
          name: "web-fingerprint",
          description: "指纹识别",
          content: "x",
          spaceId: "space-other",
          allSpaces: true,
        },
      ],
    });
    const result = await xiaomajiangTools.xiaomajiang_setup!(
      makeCtx(prisma) as never,
      makeCall() as never,
    );
    expect(result).toEqual({
      ok: true,
      summary:
        "小码酱已装好：模板、空间、机器人与 2 个技能已就绪（新建 0 个，复用 2 个），仅小码酱空间可见。",
    });
    expect(createSpaceForMember).not.toHaveBeenCalled();
    expect(createRepos).not.toHaveBeenCalled();
    expect(skillCreateFromTool).not.toHaveBeenCalled();
    const leaked = skills.find((s) => s.name === "web-fingerprint")!;
    expect(leaked.spaceId).toBe("space-xmj");
    expect(leaked.allSpaces).toBe(false);
  });

  it("fails closed when the passphrase is not configured", async () => {
    const { prisma } = setupStore();
    vi.unstubAllEnvs();
    const result = await xiaomajiangTools.xiaomajiang_setup!(
      makeCtx(prisma) as never,
      makeCall() as never,
    );
    expect(result).toEqual({ error: "小码酱安装未配置口令，无法解开安装包。" });
    expect(loadXiaomajiangBundle).not.toHaveBeenCalled();
  });

  it("returns the bundle error when decryption fails", async () => {
    const { prisma } = setupStore();
    vi.mocked(loadXiaomajiangBundle).mockImplementation(() => {
      throw new Error("验签失败：口令错误或密文被篡改。");
    });
    const result = await xiaomajiangTools.xiaomajiang_setup!(
      makeCtx(prisma) as never,
      makeCall() as never,
    );
    expect(result).toEqual({ error: "验签失败：口令错误或密文被篡改。" });
    expect(createSpaceForMember).not.toHaveBeenCalled();
  });

  it("reports the space limit in Chinese instead of a raw error", async () => {
    const { prisma } = setupStore();
    vi.mocked(createSpaceForMember).mockImplementation(async () => {
      throw new SpaceLimitError();
    });
    const result = await xiaomajiangTools.xiaomajiang_setup!(
      makeCtx(prisma) as never,
      makeCall() as never,
    );
    expect(result).toEqual({ error: "空间数量已到上限，先删一个不用的空间再发 /p666。" });
  });
});
