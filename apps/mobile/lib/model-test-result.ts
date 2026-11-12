import type { ModelHealthState } from "@rakazo/contracts";

/** One model's latest same-day test result, keyed by "provider::modelId". */
export type ModelTestResult = {
  key: string;
  provider: string;
  modelId: string;
  state: ModelHealthState;
  detail: string;
  seconds: number;
  testedAt: number;
};

/** How a test result paints its row: failed is red, slow is blue, fast is green. */
export type ModelTestLineTone = "fast" | "mid" | "slow" | "failed" | "muted" | "running";

/** The probe's per-model budget in seconds; mirrors MODEL_HEALTH_TIMEOUT_MS server-side. */
export const MODEL_TEST_TIMEOUT_SECONDS = 60;

export type Translate = (message: string, values?: Record<string, string | number>) => string;

/** The short state word the row and the menu share; badreq/servererr/neterr stay distinct. */
export function modelTestStateLabel(state: ModelHealthState, t: Translate): string {
  switch (state) {
    case "ok":
      return t("Usable");
    case "empty":
      return t("Empty reply");
    case "limited":
      return t("Rate limited");
    case "auth":
      return t("No permission");
    case "notfound":
      return t("Not found");
    case "timeout":
      return t("Timed out");
    case "badreq":
      return t("Invalid request");
    case "servererr":
      return t("Upstream error");
    case "neterr":
      return t("Network error");
  }
}

/** "0.8s", "8.6s", "60s": one decimal unless the value is whole. */
export function formatModelTestSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/** "07:46 12/11/26": local time with the year, the way the user reads test times. */
export function formatModelTestTime(testedAt: number): string {
  const date = new Date(testedAt);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())} ${two(date.getDate())}/${two(
    date.getMonth() + 1,
  )}/${two(date.getFullYear() % 100)}`;
}

/** "09:36": local clock for an interruption. */
export function formatModelTestClock(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The model type tag on the row: image-capable models read images, the rest are text. */
export function modelTestTypeLabel(images: boolean | undefined, t: Translate): string {
  return images === true ? t("Text and images") : t("Text");
}

/** The model type name under the menu title. */
export function modelTestTypeName(images: boolean | undefined, t: Translate): string {
  return images === true ? t("Text and image model") : t("Text model");
}

/** One row's test line, or null when the picker has no run to show yet. */
export function modelTestRowLine(args: {
  result: {
    state: ModelHealthState;
    seconds: number;
    testedAt: number;
  } | null;
  testing: boolean;
  interrupted: boolean;
  interruptedAt: number | null;
  images: boolean | undefined;
  t: Translate;
}): { text: string; tone: ModelTestLineTone } | null {
  const { result, testing, interrupted, interruptedAt, images, t } = args;
  if (testing) return { text: t("Testing…"), tone: "running" };
  if (!result) {
    if (interrupted && interruptedAt !== null) {
      return {
        text: t("Interrupted at {time}", { time: formatModelTestClock(interruptedAt) }),
        tone: "muted",
      };
    }
    return { text: t("Not tested"), tone: "muted" };
  }
  const type = modelTestTypeLabel(images, t);
  const time = formatModelTestTime(result.testedAt);
  if (result.state === "ok") {
    const tone: ModelTestLineTone =
      result.seconds >= 5 ? "slow" : result.seconds < 2 ? "fast" : "mid";
    return {
      text: `✓ ${t("Usable")} · ${t("Latency")} ${formatModelTestSeconds(result.seconds)}s · ${type} · ${time}`,
      tone,
    };
  }
  return {
    text: `✕ ${modelTestStateLabel(result.state, t)} · ${formatModelTestSeconds(result.seconds)}s · ${type} · ${time}`,
    tone: "failed",
  };
}

/** The row line's color from the shared tokens; the list passes the tokens in. */
export function modelTestLineColor(
  tone: ModelTestLineTone,
  tokens: {
    success?: string;
    link?: string;
    destructive?: string;
    mutedForeground?: string;
  },
): string | undefined {
  switch (tone) {
    case "fast":
      return tokens.success;
    case "slow":
    case "running":
      return tokens.link;
    case "failed":
      return tokens.destructive;
    case "mid":
    case "muted":
      return tokens.mutedForeground;
  }
}

/**
 * What the menu says went wrong, and what to do about it. The upstream's own
 * detail joins only when it says more than the generic word for the state.
 */
const GENERIC_STATE_DETAIL: Partial<Record<ModelHealthState, string>> = {
  empty: "空回复",
  limited: "限流",
  auth: "无权限",
  notfound: "模型不存在或已停用",
  badreq: "请求无效",
  servererr: "上游服务错误",
  timeout: "请求超时",
};

export function modelTestReason(
  state: ModelHealthState,
  detail: string,
  t: Translate,
): string | null {
  let reason: string;
  switch (state) {
    case "ok":
      return null;
    case "empty":
      reason = t("The model replied with nothing. Try again, or switch models.");
      break;
    case "limited":
      reason = t("The provider is rate limiting requests. Try again later.");
      break;
    case "auth":
      reason = t(
        "The key has no permission, or the plan ran out. Check the key and plan, or reconnect the provider.",
      );
      break;
    case "notfound":
      reason = t(
        "The model does not exist or was retired. Remove it, or check the provider settings.",
      );
      break;
    case "timeout":
      reason = t(
        "The request did not return within 60 seconds. The relay may be overloaded or the model may be retired. Try again later, or check the provider settings.",
      );
      break;
    case "badreq":
      reason = t("The request was rejected. Check the provider settings.");
      break;
    case "servererr":
      reason = t("The provider returned a server error. Try again later.");
      break;
    case "neterr":
      reason = t("The network failed. Check the connection and try again.");
      break;
  }
  const extra = detail.trim();
  if (extra && GENERIC_STATE_DETAIL[state] !== extra && !reason.includes(extra)) {
    return `${reason}（${extra}）`;
  }
  return reason;
}
