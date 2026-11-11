// Management-type bot tools: list and test the user's model connections
// (providers), so the bot can be managed from chat the way mickvvwai is
// managed from Telegram (/pmodels, /ptest). Switching the bot's own model
// already works through update_bot; these two fill the gap. show_management_menu
// sends the Telegram button menu (/menu) those commands live behind.
//
// Security: results never include an API key or any secret value. The list
// shows only labels, providers, model ids and whether a key is present.
// The test sends every model one real question and reports which answer;
// a provider can list dozens of models and only enable a few, so listing
// alone never proves a model works. The menu sender calls Telegram directly
// with the bot's own token; it only ever messages the chat the bot is already
// linked to.
import type { ModelHealthReport } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { modelCredentialDto } from "./model-connect.js";
import { parseModelSecret } from "./model-secret.js";
import { loadStoredModelSecret } from "./model-selection.js";
import { verifyCatalogProviderApiKey } from "./pi-models.js";
import { probeModelHealth } from "./pi-openai-compatible-provider.js";

type RunRef = { id: string; spaceId: string; userId: string; botId: string };

const MAX_MODELS_SHOWN = 20;

/** Buttons on the Telegram management menu: label and the command tapping it sends. */
const MENU_BUTTONS: Array<{ label: string; command: string }> = [
  { label: "📋 查看模型", command: "/pmodels" },
  { label: "🧪 测试连接", command: "/ptest" },
  { label: "🔄 换模型", command: "/model" },
];

/** Resolve the bot token env name for a Telegram provider id ("telegram" or "telegram-<name>"). */
function telegramTokenEnv(provider: string): string {
  if (provider === "telegram") return "TELEGRAM_BOT_TOKEN";
  if (provider.startsWith("telegram-")) {
    return `TELEGRAM_BOT_TOKEN_${provider.slice("telegram-".length).toUpperCase()}`;
  }
  return "TELEGRAM_BOT_TOKEN";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** list_model_connections: the user's model connections, without secrets. */
export async function listModelConnectionsFromTool(
  deps: ExecutorDeps,
  run: RunRef,
): Promise<Record<string, unknown>> {
  const rows = await deps.prisma.userModelCredential.findMany({
    where: { userId: run.userId },
    include: { userPreferences: { where: { userId: run.userId } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  if (rows.length === 0) {
    return {
      connections: [],
      message: "No model connections yet. Add one in Settings → Models.",
    };
  }
  const connections = [];
  for (const row of rows) {
    const preference = row.userPreferences[0];
    const own = {
      ...row,
      defaultModel: preference?.modelId ?? null,
      thinkingLevel: preference?.thinkingLevel ?? null,
    };
    const loaded = await loadStoredModelSecret(
      deps.prisma,
      deps.secretStore,
      run.userId,
      row.secretId,
    );
    const plaintext = loaded.status === "loaded" ? loaded.plaintext : undefined;
    const dto = modelCredentialDto(own, plaintext);
    const parsed = plaintext ? parseModelSecret(plaintext) : undefined;
    const enabledModelIds =
      parsed?.kind === "openai_compatible" ? (parsed.enabledModelIds ?? []) : [];
    const baseUrl = parsed?.kind === "openai_compatible" ? parsed.baseUrl : undefined;
    connections.push({
      id: row.id,
      provider: dto.provider,
      label: dto.label,
      ...(baseUrl ? { baseUrl } : {}),
      ...(dto.modelId ? { defaultModel: dto.modelId } : {}),
      ...(enabledModelIds.length > 0 ? { models: enabledModelIds.slice(0, MAX_MODELS_SHOWN) } : {}),
      ...(parsed?.kind === "openai_compatible" && parsed.authMode
        ? { authMode: parsed.authMode }
        : {}),
      hasKey: dto.hasKey,
      isDefault: dto.isDefault,
    });
  }
  return { connections };
}

/** test_model_connection: probe one connection live. */
export async function testModelConnectionFromTool(
  deps: ExecutorDeps,
  run: RunRef,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = asString(args.connection);
  if (!query) {
    return { error: "Tell me which connection to test: its label, provider, or id." };
  }
  const rows = await deps.prisma.userModelCredential.findMany({
    where: { userId: run.userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  const lower = query.toLowerCase();
  const row =
    rows.find((candidate) => candidate.id === query) ??
    rows.find((candidate) => candidate.label.toLowerCase() === lower) ??
    rows.find((candidate) => candidate.provider.toLowerCase() === lower);
  if (!row) {
    return {
      error: `No model connection matches "${query}". Use list_model_connections to see them.`,
    };
  }
  const loaded = await loadStoredModelSecret(
    deps.prisma,
    deps.secretStore,
    run.userId,
    row.secretId,
  );
  if (loaded.status !== "loaded") {
    return {
      error: `Could not read the saved key for "${row.label}". Reconnect it in Settings → Models.`,
    };
  }
  const parsed = parseModelSecret(loaded.plaintext);
  try {
    if (parsed.kind === "openai_compatible") {
      const report = await probeModelHealth(
        {
          baseUrl: parsed.baseUrl,
          apiKey: parsed.apiKey,
          headers: parsed.headers,
          apiProtocol: parsed.apiProtocol,
          authMode: parsed.authMode,
          models: parsed.enabledModelIds?.length ? parsed.enabledModelIds : undefined,
        },
        undefined,
        undefined,
        { allowPrivate: true },
      );
      return {
        ok: true,
        connection: row.label,
        provider: row.provider,
        total: report.total,
        truncated: report.truncated,
        usable: report.ok,
        results: report.results,
        summary: report.summary,
        message: modelHealthReportMessage(row.label, report),
      };
    }
    if (parsed.kind === "api_key") {
      await verifyCatalogProviderApiKey(
        { provider: row.provider, apiKey: parsed.key },
        undefined,
        undefined,
      );
      return {
        ok: true,
        connection: row.label,
        provider: row.provider,
        message: `The key for "${row.label}" was accepted.`,
      };
    }
    return {
      error: `Cannot test "${row.label}" (OAuth connections are verified by reconnecting).`,
    };
  } catch (error) {
    getLogger().warn("model_connection.test_failed", {
      provider: row.provider,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      connection: row.label,
      provider: row.provider,
      message: error instanceof Error ? error.message : `Could not reach "${row.label}".`,
    };
  }
}

/** The failure counts, grouped the way the user reads them; empty groups stay out. */
function modelHealthStatsLine(
  report: Omit<ModelHealthReport, "label" | "provider">,
): string | null {
  const groups: Array<[string, number]> = [
    ["限流", report.summary.limited],
    ["无权限", report.summary.auth],
    ["不存在", report.summary.notfound],
    ["失败", report.summary.badreq + report.summary.servererr + report.summary.neterr],
    ["超时", report.summary.timeout],
    ["空回复", report.summary.empty],
  ];
  const parts = groups
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count} 个`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** What the user has to act on: a key or plan failure, or an upstream outage. */
function modelHealthAttentionLine(
  report: Omit<ModelHealthReport, "label" | "provider">,
): string | null {
  const parts: string[] = [];
  const denied = report.results.filter((result) => result.state === "auth");
  if (denied.length > 0) {
    const detail = denied[0]?.detail;
    parts.push(`无权限 ${denied.length} 个${detail && detail !== "无权限" ? `（${detail}）` : ""}`);
  }
  if (report.summary.servererr > 0) parts.push(`上游故障 ${report.summary.servererr} 个`);
  return parts.length > 0 ? `需要你处理的：${parts.join("；")}` : null;
}

/** One provider, one line of conclusion, then the failures and what needs the user. */
function modelHealthReportMessage(
  label: string,
  report: Omit<ModelHealthReport, "label" | "provider">,
): string {
  if (report.total === 0) return `「${label}」能连通，但没有列出模型。`;
  const lines = [
    `① ${label}：${report.total} 个里 ${report.ok.length} 个能用${
      report.ok.length > 0 ? ` —— ${report.ok.join("、")}` : ""
    }`,
  ];
  const stats = modelHealthStatsLine(report);
  if (stats) lines.push(stats);
  const attention = modelHealthAttentionLine(report);
  if (attention) lines.push(attention);
  if (report.truncated) lines.push(`共 ${report.total} 个，只测了前 50 个。`);
  return lines.join("\n");
}

/**
 * show_management_menu: send the Telegram button menu for model management.
 * The bot's own token posts one message with inline buttons straight to the
 * linked chat; tapping a button sends its command back as an ordinary message.
 */
export async function showManagementMenuFromTool(
  deps: ExecutorDeps,
  run: RunRef,
): Promise<Record<string, unknown>> {
  const identity = await deps.prisma.messagingIdentity.findUnique({
    where: { botId: run.botId },
  });
  const dmThreadId = identity?.dmThreadId ?? null;
  if (!identity || !dmThreadId || !identity.provider.startsWith("telegram")) {
    return { error: "No linked Telegram chat for this bot. Link it first, then try /menu again." };
  }
  const provider = dmThreadId.split(":")[0] ?? "telegram";
  const chatId = dmThreadId.slice(provider.length + 1);
  if (!chatId) {
    return { error: "Could not tell which Telegram chat to send the menu to." };
  }
  const token = process.env[telegramTokenEnv(provider)];
  if (!token) {
    return { error: "The Telegram bot token is not configured on this deployment." };
  }
  const keyboard = MENU_BUTTONS.map((button) => [
    { text: button.label, callback_data: button.command },
  ]);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "模型管理\n点下面的按钮操作，也可以直接发命令。",
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      getLogger().warn("management_menu.send_failed", {
        status: response.status,
        detail: detail.slice(0, 200),
      });
      return { error: `Could not send the menu (Telegram returned ${response.status}).` };
    }
    return { ok: true, message: "菜单已发送，点按钮操作。" };
  } catch (error) {
    getLogger().warn("management_menu.send_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { error: "Could not reach Telegram to send the menu." };
  }
}
