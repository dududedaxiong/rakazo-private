/**
 * 安全脱敏与人机验证接管模块 (Secret Sanitization & Human Verification Bypass)
 *
 * 提供输入输出数据脱敏、敏感字段识别、人机验证自动接管触发、
 * 长效 Cookie/Session 持久化等安全增强功能。
 */

/** 敏感信息类别 */
export type SensitiveCategory =
  | "password"       // 密码
  | "api_key"        // API 密钥
  | "token"          // 访问令牌
  | "private_key"    // 私钥
  | "credit_card"    // 信用卡号
  | "phone"          // 手机号
  | "email"          // 邮箱
  | "id_number"      // 身份证号
  | "bank_account"   // 银行账号
  | "address"        // 地址
  | "otp";           // 一次性验证码

/** 脱敏策略 */
export type SanitizationStrategy =
  | "mask"           // 部分掩码（如 138****1234）
  | "redact"         // 完全移除
  | "replace"        // 替换为占位符
  | "hash";          // 哈希后保留

/** 敏感字段识别规则 */
export interface SensitiveFieldRule {
  /** 字段名模式（支持正则） */
  fieldPattern: RegExp;
  /** 敏感信息类别 */
  category: SensitiveCategory;
  /** 脱敏策略 */
  strategy: SanitizationStrategy;
  /** 优先级（数字越大越优先） */
  priority: number;
}

/** 默认敏感字段识别规则集 */
export const DEFAULT_SENSITIVE_RULES: SensitiveFieldRule[] = [
  {
    fieldPattern: /password|passwd|pwd|secret|private[_-]?key/i,
    category: "password",
    strategy: "redact",
    priority: 100,
  },
  {
    fieldPattern: /api[_-]?key|apikey|access[_-]?key/i,
    category: "api_key",
    strategy: "mask",
    priority: 90,
  },
  {
    fieldPattern: /token|bearer|jwt|auth/i,
    category: "token",
    strategy: "mask",
    priority: 90,
  },
  {
    fieldPattern: /card[_-]?number|credit[_-]?card|cc[_-]?num/i,
    category: "credit_card",
    strategy: "mask",
    priority: 80,
  },
  {
    fieldPattern: /phone|mobile|cell|tel/i,
    category: "phone",
    strategy: "mask",
    priority: 70,
  },
  {
    fieldPattern: /email|e[_-]?mail/i,
    category: "email",
    strategy: "mask",
    priority: 70,
  },
  {
    fieldPattern: /id[_-]?number|id[_-]?card|ssn|national[_-]?id/i,
    category: "id_number",
    strategy: "mask",
    priority: 80,
  },
  {
    fieldPattern: /bank|account[_-]?number|routing/i,
    category: "bank_account",
    strategy: "mask",
    priority: 80,
  },
  {
    fieldPattern: /address|location|street|zip|postal/i,
    category: "address",
    strategy: "mask",
    priority: 50,
  },
  {
    fieldPattern: /otp|one[_-]?time|verification[_-]?code|2fa|mfa/i,
    category: "otp",
    strategy: "redact",
    priority: 95,
  },
];

/**
 * 对文本内容按策略进行脱敏处理。
 */
export function sanitizeValue(
  value: string,
  strategy: SanitizationStrategy,
  category: SensitiveCategory,
): string {
  if (!value) return value;

  switch (strategy) {
    case "redact":
      return "[REDACTED]";

    case "mask":
      return maskByCategory(value, category);

    case "replace":
      return `[${category.toUpperCase()}]`;

    case "hash":
      return hashValue(value);

    default:
      return value;
  }
}

/** 按敏感信息类别进行掩码 */
function maskByCategory(value: string, category: SensitiveCategory): string {
  const len = value.length;

  switch (category) {
    case "password":
    case "api_key":
    case "token":
      return len <= 4
        ? "****"
        : `${value.slice(0, 2)}${"*".repeat(Math.min(len - 4, 8))}${value.slice(-2)}`;

    case "phone":
      if (len >= 11) return `${value.slice(0, 3)}****${value.slice(-4)}`;
      if (len >= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`;
      return "****";

    case "email": {
      const atIndex = value.lastIndexOf("@");
      if (atIndex <= 1) return `***${value.slice(atIndex)}`;
      return `${value[0]}***${value.slice(atIndex)}`;
    }

    case "credit_card":
      return len >= 12
        ? `****-****-****-${value.slice(-4)}`
        : "****";

    case "id_number":
      return len >= 15
        ? `${value.slice(0, 3)}*********${value.slice(-3)}`
        : "****";

    case "bank_account":
      return len >= 8
        ? `****${value.slice(-4)}`
        : "****";

    case "address":
      return `${value.slice(0, Math.min(6, len))}...`;

    case "otp":
      return "******";

    default:
      return len <= 4 ? "****" : `${value.slice(0, 1)}***${value.slice(-1)}`;
  }
}

/** 简单哈希（用于日志关联，不用于安全） */
function hashValue(value: string): string {
  // DJB2 hash for non-cryptographic use
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return `hash:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * 检测对象中是否包含敏感字段，返回需要脱敏的路径列表。
 */
export interface SensitiveField {
  /** 字段路径，如 "config.apiKey" */
  path: string;
  /** 敏感类别 */
  category: SensitiveCategory;
  /** 字段名 */
  field: string;
}

export function detectSensitiveFields(
  obj: unknown,
  prefix = "",
  rules: SensitiveFieldRule[] = DEFAULT_SENSITIVE_RULES,
): SensitiveField[] {
  const found: SensitiveField[] = [];

  if (!obj || typeof obj !== "object") return found;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      found.push(
        ...detectSensitiveFields(obj[i], `${prefix}[${i}]`, rules),
      );
    }
    return found;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    // 优先匹配优先级最高的规则
    const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
    const matchedRule = sortedRules.find((rule) => rule.fieldPattern.test(key));

    if (matchedRule) {
      found.push({
        path: currentPath,
        category: matchedRule.category,
        field: key,
      });
    }

    if (typeof value === "object" && value !== null) {
      found.push(
        ...detectSensitiveFields(value, currentPath, rules),
      );
    }
  }

  return found;
}

/**
 * 递归清洗对象中的敏感字段。
 */
export function sanitizeObject(
  obj: unknown,
  rules: SensitiveFieldRule[] = DEFAULT_SENSITIVE_RULES,
): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, rules));
  }

  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const matchedRule = sortedRules.find((rule) => rule.fieldPattern.test(key));

    if (matchedRule && typeof value === "string") {
      result[key] = sanitizeValue(value, matchedRule.strategy, matchedRule.category);
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeObject(value, rules);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** 人机验证类型 */
export type CaptchaType =
  | "cloudflare_turnstile"   // Cloudflare Turnstile
  | "cloudflare_challenge"   // Cloudflare 5秒盾
  | "hcaptcha"               // hCaptcha
  | "recaptcha_v2"           // reCAPTCHA v2 (选图)
  | "recaptcha_v3"           // reCAPTCHA v3 (隐形)
  | "slider"                 // 滑块验证
  | "click_captcha"          // 点选验证
  | "sms_verification"       // 短信验证
  | "unknown";               // 未知类型

/** 人机验证检测结果 */
export interface CaptchaDetection {
  detected: boolean;
  type: CaptchaType;
  /** 页面 URL */
  pageUrl?: string;
  /** 检测到的特征文本 */
  clues: string[];
  /** 是否需要人工接管 */
  requiresTakeover: boolean;
  /** 建议操作 */
  suggestedAction: "takeover_now" | "auto_retry" | "wait" | "none";
}

/** 验证页面特征库 */
const CAPTCHA_SIGNATURES: Array<{
  pattern: RegExp;
  type: CaptchaType;
  requiresTakeover: boolean;
}> = [
  {
    pattern: /cloudflare.*(?:turnstile|challenge|security|checking|ray\s?id)/i,
    type: "cloudflare_challenge",
    requiresTakeover: false, // 通常 5 秒自动通过
  },
  {
    pattern: /(?:cf-)?turnstile|challenges\.cloudflare\.com/i,
    type: "cloudflare_turnstile",
    requiresTakeover: true, // 需要点击
  },
  {
    pattern: /hcaptcha\.com|h-captcha|data-hcaptcha/i,
    type: "hcaptcha",
    requiresTakeover: true,
  },
  {
    pattern: /recaptcha\/api2|g-recaptcha|data-sitekey/i,
    type: "recaptcha_v2",
    requiresTakeover: true,
  },
  {
    pattern: /recaptcha\/api\.js.*render.*v3|grecaptcha\.ready/i,
    type: "recaptcha_v3",
    requiresTakeover: false,
  },
  {
    pattern: /slide.*verify|slide.*captcha|滑块|滑动验证|drag.*slider/i,
    type: "slider",
    requiresTakeover: true,
  },
  {
    pattern: /click.*verify|click.*captcha|点选|点击验证|select.*all.*images/i,
    type: "click_captcha",
    requiresTakeover: true,
  },
  {
    pattern: /sms.*(?:verif|code)|phone.*verif|手机.*验证|短信.*码|send.*code/i,
    type: "sms_verification",
    requiresTakeover: false,
  },
];

/**
 * 检测页面内容中的人机验证类型。
 */
export function detectCaptcha(
  bodyText: string,
  html?: string,
  pageUrl?: string,
): CaptchaDetection {
  const allText = [bodyText, html].filter(Boolean).join(" ");
  const clues: string[] = [];

  let bestMatch: (typeof CAPTCHA_SIGNATURES)[number] | undefined;

  for (const signature of CAPTCHA_SIGNATURES) {
    const match = signature.pattern.exec(allText);
    if (match) {
      clues.push(match[0]);
      // 优先选择需要接管的类型
      if (!bestMatch || (signature.requiresTakeover && !bestMatch.requiresTakeover)) {
        bestMatch = signature;
      }
    }
  }

  if (!bestMatch) {
    return {
      detected: false,
      type: "unknown",
      clues,
      requiresTakeover: false,
      suggestedAction: "none",
    };
  }

  // 5秒盾和 v3 可自动重试等待
  const suggestedAction: CaptchaDetection["suggestedAction"] =
    bestMatch.requiresTakeover
      ? "takeover_now"
      : bestMatch.type === "cloudflare_challenge"
        ? "wait"
        : "auto_retry";

  return {
    detected: true,
    type: bestMatch.type,
    pageUrl,
    clues,
    requiresTakeover: bestMatch.requiresTakeover,
    suggestedAction,
  };
}

/** 验证类型中文描述 */
export function captchaTypeLabel(type: CaptchaType): string {
  switch (type) {
    case "cloudflare_turnstile": return "Cloudflare Turnstile 验证";
    case "cloudflare_challenge": return "Cloudflare 5秒盾";
    case "hcaptcha": return "hCaptcha 验证";
    case "recaptcha_v2": return "Google reCAPTCHA v2 选图验证";
    case "recaptcha_v3": return "Google reCAPTCHA v3 隐形验证";
    case "slider": return "滑块验证";
    case "click_captcha": return "点选验证";
    case "sms_verification": return "短信/手机验证";
    case "unknown": return "未知验证";
  }
}

/** 接管操作提示文本 */
export function takeoverPromptText(detection: CaptchaDetection): string {
  if (!detection.detected) return "";

  const typeName = captchaTypeLabel(detection.type);

  if (detection.suggestedAction === "takeover_now") {
    return `🔐 检测到 **${typeName}**，需手动操作。正在为你打开云电脑控制界面，请在弹出窗口中完成验证。`;
  }

  if (detection.suggestedAction === "wait") {
    return `⏳ 检测到 **${typeName}**，通常会自动通过。等待 5-10 秒...`;
  }

  return `🔍 检测到 **${typeName}**，尝试自动处理中...`;
}

/** 构建接管请求事件数据 */
export function buildTakeoverEvent(detection: CaptchaDetection): Record<string, unknown> {
  return {
    type: "verification_takeover_request",
    captcha: {
      type: detection.type,
      label: captchaTypeLabel(detection.type),
      pageUrl: detection.pageUrl,
      clues: detection.clues,
    },
    autoPrompt: takeoverPromptText(detection),
    timestamp: Date.now(),
  };
}