/**
 * 模型故障自愈与一键切换模块 (Model Auto Recovery & One-Click Switch)
 *
 * 当底层模型因额度/限流/渠道故障不可用时，自动识别异常类型，
 * 触发一键切模交互卡片，引导用户无感切换到备用模型。
 */

import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  isModelCredentialRejected,
  isRetryableProviderUnavailable,
  isTransientModelError,
} from "@rakazo/adapter-kit";

/** 故障原因分类 */
export type ModelFailureReason =
  | "quota_exhausted"     // 额度耗尽
  | "rate_limited"        // 限流 (429)
  | "server_error"        // 服务端错误 (500/502/503)
  | "credential_rejected" // 凭据被拒绝 (401)
  | "network_error"       // 网络不可达
  | "timeout"             // 超时
  | "channel_broken"      // 通道故障
  | "unknown";            // 未知

/** 推荐的备用模型条目 */
export interface BackupModelEntry {
  /** 模型唯一标识 */
  modelId: string;
  /** 显示名称 */
  label: string;
  /** 提供商标识 */
  provider: string;
  /** 建议的思考档位 */
  thinkingLevel: ModelThinkingLevel | "off";
  /** 切换理由 */
  reason: string;
  /** 是否首选备用 */
  primary: boolean;
}

/**
 * 主力备用模型候选池。
 * 保持与多维态控制台页面同步。
 */
export const PRIMARY_BACKUP_MODELS: BackupModelEntry[] = [
  {
    modelId: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    thinkingLevel: "low",
    reason: "Google 官方极速通道，低延迟高可用",
    primary: true,
  },
  {
    modelId: "deepseek-flash",
    label: "DeepSeek Flash",
    provider: "openrouter",
    thinkingLevel: "off",
    reason: "国内低延迟，中文理解优秀",
    primary: true,
  },
  {
    modelId: "kimi-k2.6",
    label: "Kimi K2.6",
    provider: "openrouter",
    thinkingLevel: "medium",
    reason: "均衡性能，性价比高",
    primary: false,
  },
  {
    modelId: "gemini-3.7-flash-thinking",
    label: "Gemini 3.7 Flash Thinking",
    provider: "google",
    thinkingLevel: "medium",
    reason: "需要深度推理时的备用",
    primary: false,
  },
  {
    modelId: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    thinkingLevel: "medium",
    reason: "代码和复杂任务场景",
    primary: false,
  },
];

/**
 * 从异常错误对象中识别故障原因。
 * 复用现有的 model-errors 模块的错误分类逻辑。
 */
export function diagnoseModelFailure(error: unknown): ModelFailureReason {
  const message = error instanceof Error ? error.message : String(error ?? "");

  // 凭据被拒绝 (401)
  if (isModelCredentialRejected(error)) return "credential_rejected";

  // 限流 (429)
  if (message.includes("429") || /rate[ _-]?limit|too many requests/i.test(message)) {
    return "rate_limited";
  }

  // 额度耗尽
  if (/insufficient[ _](?:credits?|funds|balance|quota)|out of (?:credits?|balance|quota)|quota exceeded|usage limit/i.test(message)) {
    return "quota_exhausted";
  }

  // 服务端错误
  if (/50[023]/i.test(message) || /service unavailable|server error|gateway timeout/i.test(message)) {
    return "server_error";
  }

  // 超时
  if (/timed?[ _]?out|timeout/i.test(message)) return "timeout";

  // 网络错误
  if (/network[ _]error|connection (?:error|reset|refused)|fetch failed|econnreset|econnrefused|etimedout/i.test(message)) {
    return "network_error";
  }

  // 通道故障（包括非 429 的暂时性错误）
  if (isRetryableProviderUnavailable(error) || isTransientModelError(error)) {
    return "channel_broken";
  }

  return "unknown";
}

/** 故障原因中文标签 */
export function failureReasonLabel(reason: ModelFailureReason): string {
  switch (reason) {
    case "quota_exhausted": return "💰 额度耗尽";
    case "rate_limited": return "🚦 请求限流 (429)";
    case "server_error": return "🔧 服务端异常 (5xx)";
    case "credential_rejected": return "🔑 凭据被拒 (401)";
    case "network_error": return "🌐 网络不可达";
    case "timeout": return "⏱️ 请求超时";
    case "channel_broken": return "📡 通道故障";
    case "unknown": return "❓ 未知错误";
  }
}

/** 故障原因用户提示语 */
export function failureReasonHint(reason: ModelFailureReason): string {
  switch (reason) {
    case "quota_exhausted":
      return "当前模型的 API 额度已用完，切换备用模型即可继续。";
    case "rate_limited":
      return "请求太频繁被限流，切换到其他通道的模型不受影响。";
    case "server_error":
      return "模型服务端暂时不可用，建议切换到其他提供商的模型。";
    case "credential_rejected":
      return "API 凭据失效或被拒，请在设置中更新凭据或切换模型。";
    case "network_error":
      return "无法连接到模型服务器，切换到其他通道试试。";
    case "timeout":
      return "模型响应超时，可切换到更快的模型。";
    case "channel_broken":
      return "当前模型通道出现故障，立即切换可恢复服务。";
    case "unknown":
      return "模型调用遇到错误，建议尝试备用模型。";
  }
}

/**
 * 根据故障原因过滤合适的备用模型列表。
 * 优先推荐与原模型不同 provider 的备选。
 */
export function filterBackupModels(
  failedProvider: string,
  failedModelId: string,
  customBackups?: BackupModelEntry[],
): BackupModelEntry[] {
  const pool = customBackups ?? PRIMARY_BACKUP_MODELS;

  // 排除已故障的同模型
  const candidates = pool.filter(
    (entry) => entry.modelId !== failedModelId,
  );

  // 优先不同 provider 的
  const differentProvider = candidates.filter(
    (entry) => entry.provider !== failedProvider,
  );
  const sameProvider = candidates.filter(
    (entry) => entry.provider === failedProvider,
  );

  // 最多返回 4 个选项
  return [...differentProvider, ...sameProvider].slice(0, 4);
}

/**
 * 构建一键切换模型的交互卡片数据。
 * 用于 Chat UI 渲染可点击的模型切换按钮。
 */
export function buildSwitchModelCard(input: {
  failedModelLabel: string;
  failureReason: ModelFailureReason;
  failureDetail: string;
  backups: BackupModelEntry[];
  /** 多维态控制台页面 ID */
  consolePageId?: string;
}): Record<string, unknown> {
  return {
    type: "switch_model_card",
    failedModel: input.failedModelLabel,
    reason: failureReasonLabel(input.failureReason),
    reasonHint: failureReasonHint(input.failureReason),
    detail: input.failureDetail,
    backups: input.backups.map((entry) => ({
      modelId: entry.modelId,
      label: entry.label,
      provider: entry.provider,
      thinkingLevel: entry.thinkingLevel,
      reason: entry.reason,
      primary: entry.primary,
    })),
    consolePageId: input.consolePageId ?? "cmw7hilla00ib07jw25k86n8y",
    consoleLabel: "🔧 Chief 多维态模型控制台",
    actionLabel: "一键切换",
  };
}

/**
 * 构建纯文本的故障与切换提示。
 * 用于 Telegram 等纯文本渠道。
 */
export function switchModelTextMessage(input: {
  failedModelLabel: string;
  failureReason: ModelFailureReason;
  backups: BackupModelEntry[];
}): string {
  const reasonText = failureReasonLabel(input.failureReason);
  const hintText = failureReasonHint(input.failureReason);

  const lines = [
    `⚠️ **${input.failedModelLabel}** 不可用`,
    `${reasonText}`,
    `> ${hintText}`,
    "",
    "🔄 **推荐备用模型：**",
    ...input.backups.map(
      (entry, i) =>
        `${i + 1}. ${entry.label} — ${entry.reason}`,
    ),
    "",
    "📋 在设置中切换模型，或使用 /model 命令。",
  ];

  return lines.join("\n");
}

/** 判断异常是否为可自动恢复的短暂故障（无需用户介入） */
export function isAutoRecoverable(reason: ModelFailureReason): boolean {
  return ["rate_limited", "server_error", "timeout"].includes(reason);
}

/** 判断异常是否需要用户介入（额度/凭据问题） */
export function requiresUserAction(reason: ModelFailureReason): boolean {
  return ["quota_exhausted", "credential_rejected"].includes(reason);
}