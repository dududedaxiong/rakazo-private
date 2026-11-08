/**
 * 移动端云电脑悬浮窗/画中画体验优化 (Mobile Floating PiP Enhancement)
 *
 * 结合现有 computer.tsx 的架构，新增：
 * - 关键帧伴随播报（高保真局部截图注入聊天流）
 * - 触控手势优化（双指缩放、长按右键、边缘滑动手势）
 * - 画中画自动恢复与断线重连增强
 * - 免登持久化与 Session 保持提示
 */

import type { ComputerMode, ComputerStatus } from "@rakazo/contracts";
import type { ScreenPageState } from "@rakazo/core";

/** 触控手势类型 */
export type MobileTouchGesture =
  | "tap"               // 单击
  | "double_tap"        // 双击
  | "long_press"        // 长按（右键）
  | "pinch_zoom"        // 双指缩放
  | "two_finger_scroll" // 双指滚动
  | "edge_swipe_left"   // 左边缘滑动（返回）
  | "edge_swipe_right"  // 右边缘滑动（前进）;

/** 关键帧截图的触发条件 */
export type KeyframeTrigger =
  | "page_load"         // 页面加载完成
  | "verification_detected" // 检测到人机验证
  | "error_state"       // 错误状态
  | "task_complete"     // 任务完成
  | "user_requested"    // 用户手动请求
  | "periodic"          // 定期自动截图
  | "state_change";     // 状态变更

/** 关键帧伴随播报配置 */
export interface KeyframeBroadcastConfig {
  /** 是否启用关键帧播报 */
  enabled: boolean;
  /** 触发条件 */
  triggers: KeyframeTrigger[];
  /** 定期截图间隔（毫秒），仅对 periodic 触发有效 */
  periodicIntervalMs: number;
  /** 截图质量 (0-100) */
  quality: number;
  /** 最大截图宽度 */
  maxWidth: number;
  /** 是否在聊天流中自动插入截图 */
  injectIntoChat: boolean;
}

/** 默认关键帧播报配置 */
export const DEFAULT_KEYFRAME_CONFIG: KeyframeBroadcastConfig = {
  enabled: true,
  triggers: [
    "verification_detected",
    "error_state",
    "task_complete",
    "user_requested",
  ],
  periodicIntervalMs: 120_000, // 2 分钟
  quality: 75,
  maxWidth: 720,
  injectIntoChat: true,
};

/** 触控手势增强配置 */
export interface MobileGestureConfig {
  /** 是否启用手势增强 */
  enabled: boolean;
  /** 长按触发时间（毫秒） */
  longPressDelayMs: number;
  /** 双指缩放灵敏度 (0-1) */
  pinchZoomSensitivity: number;
  /** 边缘滑动触发区域宽度（像素） */
  edgeSwipeThreshold: number;
  /** 双击最大间隔（毫秒） */
  doubleTapIntervalMs: number;
}

export const DEFAULT_GESTURE_CONFIG: MobileGestureConfig = {
  enabled: true,
  longPressDelayMs: 500,
  pinchZoomSensitivity: 0.5,
  edgeSwipeThreshold: 40,
  doubleTapIntervalMs: 300,
};

/** 断线重连增强配置 */
export interface ReconnectEnhanceConfig {
  /** 最大重连次数 */
  maxAttempts: number;
  /** 基础重试延迟（毫秒） */
  baseDelayMs: number;
  /** 最大退避延迟（毫秒） */
  maxBackoffMs: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 是否在网络恢复时自动重连 */
  autoReconnectOnNetwork: boolean;
  /** 是否显示重连进度提示 */
  showReconnectProgress: boolean;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectEnhanceConfig = {
  maxAttempts: 10,
  baseDelayMs: 500,
  maxBackoffMs: 30_000,
  backoffMultiplier: 2,
  autoReconnectOnNetwork: true,
  showReconnectProgress: true,
};

/** 免登持久化状态 */
export type PersistedSessionState =
  | "active"           // Session 有效
  | "expiring"         // 即将过期
  | "expired"          // 已过期
  | "refreshing"       // 刷新中
  | "none";            // 无 Session

/** 免登持久化配置 */
export interface SessionPersistenceConfig {
  /** 是否启用免登持久化 */
  enabled: boolean;
  /** Session 提前刷新剩余时间（毫秒） */
  refreshBeforeExpiryMs: number;
  /** 最大刷新次数 */
  maxRefreshes: number;
  /** 过期提示延迟（毫秒） */
  expiryWarningMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionPersistenceConfig = {
  enabled: true,
  refreshBeforeExpiryMs: 5 * 60_000, // 提前 5 分钟刷新
  maxRefreshes: 20,
  expiryWarningMs: 2 * 60_000, // 提前 2 分钟提示
};

/**
 * 计算机状态事件总线接口，
 * 用于在各组件间传递关键帧、手势、重连等事件。
 */
export interface ComputerEventBus {
  /** 触发关键帧截图请求 */
  requestKeyframe(trigger: KeyframeTrigger, label?: string): void;
  /** 发送手势事件 */
  sendGesture(gesture: MobileTouchGesture, x?: number, y?: number): void;
  /** 通知重连状态 */
  reconnectState(state: "connecting" | "connected" | "failed", attempt?: number): void;
  /** 通知 Session 状态 */
  sessionState(state: PersistedSessionState, expiresAt?: number): void;
}

/**
 * 检测页面内容中是否包含人机验证特征。
 * 在 WebView 注入的 JS 中运行，检测 DOM 特征。
 */
export const CAPTCHA_DETECTION_SCRIPT = `
(function() {
  try {
    var body = document.body.innerText || '';
    var html = document.documentElement.outerHTML || '';
    var patterns = [
      /cloudflare/i, /turnstile/i, /hcaptcha/i, /recaptcha/i,
      /verify you are human/i, /are you a robot/i, /security check/i,
      /人机验证/i, /安全验证/i, /滑块验证/i, /点击验证/i,
      /please wait.*seconds/i, /just a moment/i,
      /checking your browser/i, /ddos protection/i
    ];
    var found = [];
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(body) || patterns[i].test(html)) {
        found.push(patterns[i].source);
      }
    }
    if (found.length > 0) {
      return JSON.stringify({captcha: true, patterns: found});
    }
    return JSON.stringify({captcha: false});
  } catch(e) {
    return JSON.stringify({captcha: false, error: e.message});
  }
})();
`;

/**
 * 将人机验证检测脚本注入到 WebView。
 */
export function captchaDetectionInjectedScript(): string {
  return `window.__rakazoCaptchaCheck = ${CAPTCHA_DETECTION_SCRIPT};`;
}

/**
 * 构建移动端计算机优化的初始化配置对象。
 */
export function buildMobileComputerConfig(input: {
  keyframe?: Partial<KeyframeBroadcastConfig>;
  gesture?: Partial<MobileGestureConfig>;
  reconnect?: Partial<ReconnectEnhanceConfig>;
  session?: Partial<SessionPersistenceConfig>;
}): {
  keyframe: KeyframeBroadcastConfig;
  gesture: MobileGestureConfig;
  reconnect: ReconnectEnhanceConfig;
  session: SessionPersistenceConfig;
} {
  return {
    keyframe: { ...DEFAULT_KEYFRAME_CONFIG, ...input.keyframe },
    gesture: { ...DEFAULT_GESTURE_CONFIG, ...input.gesture },
    reconnect: { ...DEFAULT_RECONNECT_CONFIG, ...input.reconnect },
    session: { ...DEFAULT_SESSION_CONFIG, ...input.session },
  };
}

/**
 * 计算指数退避重连延迟。
 */
export function backoffDelay(
  attempt: number,
  config: ReconnectEnhanceConfig,
): number {
  if (attempt <= 0) return config.baseDelayMs;
  const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxBackoffMs);
}

/**
 * 判断计算机是否处于可交互状态。
 */
export function isComputerInteractive(status: ComputerStatus | null): boolean {
  if (!status) return false;
  return status.state === "running" && !status.busyBotName;
}

/**
 * 构建手势操作的动作描述文本。
 */
export function gestureActionLabel(gesture: MobileTouchGesture): string {
  switch (gesture) {
    case "tap": return "点击";
    case "double_tap": return "双击";
    case "long_press": return "长按（右键）";
    case "pinch_zoom": return "双指缩放";
    case "two_finger_scroll": return "双指滚动";
    case "edge_swipe_left": return "左滑返回";
    case "edge_swipe_right": return "右滑前进";
  }
}