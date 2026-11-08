/**
 * 模型多维态能力检测与展示模块 (Model Multimode Capability Display)
 *
 * 当用户查询模型列表或切换模型时，输出含模态支持、上下文窗口、响应速度、
 * 思考/推理档位等完整技术参数的卡片，支持移动端和 Web 端的结构化对比。
 */

import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

/** 模型支持的输入模态 */
export type ModelModality =
  | "text"
  | "vision"
  | "audio"
  | "voice"
  | "video";

/** 响应速度等级 */
export type ModelSpeedTier =
  | "flash"       // 极速
  | "standard"    // 均衡
  | "deep";       // 重思考

/** 模型的完整多维态描述 */
export interface ModelMultimodeProfile {
  /** 模型标识 */
  provider: string;
  modelId: string;
  label: string;

  /** 支持的模态 */
  modalities: ModelModality[];

  /** 上下文窗口大小（token 数） */
  contextWindow: number;

  /** 响应速度等级 */
  speedTier: ModelSpeedTier;

  /** 支持的思考档位 */
  thinkingLevels: ModelThinkingLevel[];

  /** 是否支持计算机控制 */
  computerUse: boolean;

  /** 最大输出 token */
  maxTokens?: number;

  /** 是否推荐作为日常主力 */
  recommended: boolean;
}

/**
 * 已知模型的速度等级映射。
 * 基于实时观测和官方文档维护。
 */
const KNOWN_SPEED_TIERS: Record<string, ModelSpeedTier> = {
  "gemini-2.0-flash": "flash",
  "gemini-2.5-flash": "flash",
  "gemini-3.8-flash": "flash",
  "deepseek-chat": "flash",
  "deepseek-flash": "flash",
  "gpt-4o-mini": "flash",
  "claude-3.5-haiku": "flash",

  "gemini-2.5-pro": "standard",
  "gemini-3.0-pro": "standard",
  "gpt-4o": "standard",
  "claude-3.5-sonnet": "standard",
  "claude-sonnet-4": "standard",
  "kimi-k2.6": "standard",

  "gemini-3.7-flash-thinking": "deep",
  "gemini-3.9-pro-deep": "deep",
  "o3-mini": "deep",
  "o1": "deep",
  "claude-opus-4": "deep",
  "grok-4.6": "deep",
};

/**
 * 已知模型的上下文窗口大小映射（token）。
 */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-2.0-flash": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-3.8-flash": 1_048_576,
  "gemini-2.5-pro": 2_097_152,
  "gemini-3.0-pro": 2_097_152,
  "gemini-3.7-flash-thinking": 1_048_576,
  "gemini-3.9-pro-deep": 2_097_152,
  "deepseek-chat": 131_072,
  "deepseek-flash": 131_072,
  "gpt-4o": 131_072,
  "gpt-4o-mini": 131_072,
  "o3-mini": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-opus-4": 200_000,
  "claude-3.5-haiku": 200_000,
  "grok-4.6": 1_000_000,
  "kimi-k2.6": 131_072,
};

/**
 * 已知模型的推荐标记。
 */
const RECOMMENDED_MODELS: string[] = [
  "gemini-3.8-flash",
  "deepseek-flash",
  "kimi-k2.6",
];

/** 按 label 查询速度等级，支持模糊匹配。 */
export function resolveModelSpeedTier(
  modelId: string,
  provider: string,
): ModelSpeedTier {
  const lower = modelId.toLowerCase();
  // 精确匹配
  if (KNOWN_SPEED_TIERS[lower]) return KNOWN_SPEED_TIERS[lower]!;
  // 关键词匹配
  if (/flash/.test(lower)) return "flash";
  if (/deep|thinking|reasoning|opus/.test(lower)) return "deep";
  if (/sonnet|pro|k2/.test(lower)) return "standard";
  // 默认均衡
  return "standard";
}

/** 按 label 查询上下文窗口大小。 */
export function resolveModelContextWindow(
  modelId: string,
  defaultWindow = 131_072,
): number {
  const lower = modelId.toLowerCase();
  return KNOWN_CONTEXT_WINDOWS[lower] ?? defaultWindow;
}

/** 判断模型是否推荐。 */
export function isModelRecommended(modelId: string): boolean {
  return RECOMMENDED_MODELS.some((id) => modelId.toLowerCase().includes(id));
}

/**
 * 构建模型的多维态展示卡片数据。
 * 用于移动端 /pmodels 和 Web 端模型选择器的结构化展示。
 */
export function buildModelMultimodeProfile(input: {
  provider: string;
  modelId: string;
  label: string;
  /** 模型是否支持推理（reasoning enabled） */
  reasoning: boolean;
  /** 模型上报的支持档位 */
  thinkingLevels?: ModelThinkingLevel[];
  /** 上下文窗口 */
  contextWindow?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** 是否支持视觉 */
  supportsVision?: boolean;
  /** 是否支持音频 */
  supportsAudio?: boolean;
  /** 是否支持视频 */
  supportsVideo?: boolean;
  /** 是否支持计算机控制 */
  computerUse?: boolean;
}): ModelMultimodeProfile {
  const modalities: ModelModality[] = ["text"];

  if (input.supportsVision) modalities.push("vision");
  if (input.supportsAudio) modalities.push("audio", "voice");
  if (input.supportsVideo) modalities.push("video");

  return {
    provider: input.provider,
    modelId: input.modelId,
    label: input.label,
    modalities,
    contextWindow:
      input.contextWindow ??
      resolveModelContextWindow(input.modelId),
    speedTier: resolveModelSpeedTier(input.modelId, input.provider),
    thinkingLevels: input.thinkingLevels ?? (input.reasoning
      ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
      : ["off"]),
    computerUse: input.computerUse ?? false,
    maxTokens: input.maxTokens,
    recommended: isModelRecommended(input.modelId),
  };
}

/** 速度等级中文标签 */
export function speedTierLabel(tier: ModelSpeedTier): string {
  switch (tier) {
    case "flash": return "⚡ 极速";
    case "standard": return "⚖️ 均衡";
    case "deep": return "🧠 深度思考";
  }
}

/** 速度等级 emoji */
export function speedTierEmoji(tier: ModelSpeedTier): string {
  switch (tier) {
    case "flash": return "⚡";
    case "standard": return "⚖️";
    case "deep": return "🧠";
  }
}

/** 模态标签 */
export function modalityLabel(modality: ModelModality): string {
  switch (modality) {
    case "text": return "📝 文本";
    case "vision": return "👁️ 视觉";
    case "audio": return "🎵 音频";
    case "voice": return "🎤 语音";
    case "video": return "🎬 视频";
  }
}

/** 上下文窗口格式化 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}

/**
 * 构建可发送给用户的模型多维态摘要文本。
 * 用于 Telegram 等纯文本渠道。
 */
export function modelMultimodeSummary(profile: ModelMultimodeProfile): string {
  const bullet = profile.recommended ? "⭐" : "•";
  const modalities = profile.modalities.map(modalityLabel).join(" ");
  const thinking = profile.thinkingLevels.length > 1
    ? `🧠 思考档位: [${profile.thinkingLevels.join(", ")}]`
    : "";
  const ctx = `📐 上下文: ${formatContextWindow(profile.contextWindow)}`;
  const speed = `${speedTierLabel(profile.speedTier)}`;

  return [
    `${bullet} **${profile.label}**`,
    `  ${modalities} | ${speed} | ${ctx}`,
    thinking ? `  ${thinking}` : "",
    profile.computerUse ? "  🖥️ 支持计算机控制" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 构建面向机器人的多维态数据卡片，
 * 供 Chat UI 渲染交互式按钮。
 */
export function modelMultimodeCard(profile: ModelMultimodeProfile): Record<string, unknown> {
  return {
    type: "model_multimode_card",
    ...profile,
    speedLabel: speedTierLabel(profile.speedTier),
    speedEmoji: speedTierEmoji(profile.speedTier),
    contextWindowFormatted: formatContextWindow(profile.contextWindow),
    modalitiesFormatted: profile.modalities.join(", "),
    thinkingLevelsFormatted: profile.thinkingLevels.join(", "),
  };
}