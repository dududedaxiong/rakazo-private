import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import {
  listModelConnectionsFromTool,
  showManagementMenuFromTool,
  testModelConnectionFromTool,
} from "./model-management-tools.js";
import { serializeModelSecret } from "./model-secret.js";

const { probeModelHealthMock } = vi.hoisted(() => ({ probeModelHealthMock: vi.fn() }));

vi.mock("./pi-openai-compatible-provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pi-openai-compatible-provider.js")>();
  return { ...actual, probeModelHealth: probeModelHealthMock };
});

const run = { id: "run-1", spaceId: "space-1", userId: "user-1", botId: "bot-1" };

function fakeDeps(overrides: Record<string, unknown> = {}) {
  const plaintext = serializeModelSecret({
    kind: "openai_compatible",
    baseUrl: "https://relay.example.test",
    apiProtocol: "anthropic-messages",
    authMode: "x-api-key",
    apiKey: "test-key-that-must-never-leak",
    enabledModelIds: ["model-a", "model-b"],
  });
  const prisma = {
    userModelCredential: {
      findMany: vi.fn(async () => [
        {
          id: "cred-1",
          userId: "user-1",
          provider: "openai-compatible",
          label: "Test Relay",
          secretId: "secret-1",
          supportsImages: true,
          userPreferences: [{ modelId: "model-a" }],
        },
      ]),
    },
    secret: {
      findFirst: vi.fn(async () => ({ id: "secret-1", ciphertext: "ciphertext-1" })),
    },
    messagingIdentity: {
      findUnique: vi.fn(async () => ({
        id: "ident-1",
        provider: "telegram",
        address: "12345",
        dmThreadId: "telegram:12345",
      })),
    },
  };
  const secretStore = {
    load: vi.fn(async () => plaintext),
  };
  return {
    deps: {
      prisma,
      secretStore,
      ...overrides,
    } as unknown as ExecutorDeps,
    plaintext,
  };
}

describe("listModelConnectionsFromTool", () => {
  it("lists connections with labels and models, never the API key", async () => {
    const { deps, plaintext } = fakeDeps();
    const result = await listModelConnectionsFromTool(deps, run);
    const text = JSON.stringify(result);
    expect(text).not.toContain("test-key-that-must-never-leak");
    expect(text).not.toContain(plaintext);
    expect(result.connections).toMatchObject([
      {
        id: "cred-1",
        provider: "openai-compatible",
        label: "Test Relay",
        baseUrl: "https://relay.example.test",
        defaultModel: "model-a",
        models: ["model-a", "model-b"],
        authMode: "x-api-key",
        hasKey: true,
      },
    ]);
  });

  it("reports when there are no connections", async () => {
    const { deps } = fakeDeps();
    (
      deps.prisma as unknown as {
        userModelCredential: { findMany: ReturnType<typeof vi.fn> };
      }
    ).userModelCredential.findMany = vi.fn(async () => []);
    const result = await listModelConnectionsFromTool(deps, run);
    expect(result.connections).toEqual([]);
  });
});

describe("testModelConnectionFromTool", () => {
  it("asks for a connection when none is given", async () => {
    const { deps } = fakeDeps();
    const result = await testModelConnectionFromTool(deps, run, {});
    expect(result.error).toMatch(/which connection/i);
  });

  it("reports when no connection matches", async () => {
    const { deps } = fakeDeps();
    const result = await testModelConnectionFromTool(deps, run, {
      connection: "no-such-provider",
    });
    expect(result.error).toMatch(/no model connection matches/i);
  });

  it("reports when the saved key cannot be read", async () => {
    const { deps } = fakeDeps();
    (deps.secretStore as unknown as { load: ReturnType<typeof vi.fn> }).load = vi.fn(async () => {
      throw new Error("decrypt failed");
    });
    const result = await testModelConnectionFromTool(deps, run, {
      connection: "Test Relay",
    });
    expect(result.error).toMatch(/could not read the saved key/i);
  });

  it("tests every model and reports which work, with the reason for each failure", async () => {
    const { deps } = fakeDeps();
    probeModelHealthMock.mockResolvedValue({
      total: 2,
      truncated: false,
      ok: ["model-a"],
      results: [
        { model: "model-a", state: "ok", detail: "2", seconds: 1.2 },
        {
          model: "model-b",
          state: "auth",
          detail: "预扣费额度失败，用户剩余额度：10，需要预扣费额度：50",
          seconds: 0.8,
        },
      ],
      summary: {
        ok: 1,
        empty: 0,
        limited: 0,
        auth: 1,
        notfound: 0,
        badreq: 0,
        servererr: 0,
        timeout: 0,
        neterr: 0,
      },
    });
    const result = await testModelConnectionFromTool(deps, run, { connection: "Test Relay" });
    expect(result.ok).toBe(true);
    expect(result.usable).toEqual(["model-a"]);
    expect(result.message).toBe(
      "① Test Relay：2 个里 1 个能用 —— model-a\n" +
        "无权限 1 个\n" +
        "需要你处理的：无权限 1 个（预扣费额度失败，用户剩余额度：10，需要预扣费额度：50）",
    );
    expect(JSON.stringify(result)).not.toContain("test-key-that-must-never-leak");
    expect(probeModelHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://relay.example.test",
        models: ["model-a", "model-b"],
      }),
      undefined,
      undefined,
      { allowPrivate: true },
    );
  });

  it("says so when the provider lists no models", async () => {
    const { deps } = fakeDeps();
    probeModelHealthMock.mockResolvedValue({
      total: 0,
      truncated: false,
      ok: [],
      results: [],
      summary: {
        ok: 0,
        empty: 0,
        limited: 0,
        auth: 0,
        notfound: 0,
        badreq: 0,
        servererr: 0,
        timeout: 0,
        neterr: 0,
      },
    });
    const result = await testModelConnectionFromTool(deps, run, { connection: "Test Relay" });
    expect(result.message).toBe("「Test Relay」能连通，但没有列出模型。");
  });
});

describe("showManagementMenuFromTool", () => {
  const token = "test-bot-token";
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = token;
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
  });

  it("posts the button menu to the linked Telegram chat", async () => {
    const { deps } = fakeDeps();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, status: 200, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    const result = await showManagementMenuFromTool(deps, run);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    const body = calls[0]?.body as {
      chat_id: string;
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(body.chat_id).toBe("12345");
    expect(body.reply_markup.inline_keyboard).toEqual([
      [{ text: "📋 查看模型", callback_data: "/pmodels" }],
      [{ text: "🧪 测试连接", callback_data: "/ptest" }],
      [{ text: "🔄 换模型", callback_data: "/model" }],
    ]);
  });

  it("reports when no Telegram chat is linked", async () => {
    const { deps } = fakeDeps({
      prisma: {
        messagingIdentity: { findUnique: vi.fn(async () => null) },
      },
    });
    const result = await showManagementMenuFromTool(deps, run);
    expect(result.error).toMatch(/no linked telegram chat/i);
  });
});
