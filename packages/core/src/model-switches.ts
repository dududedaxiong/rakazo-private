import type { ModelSwitchAttempt, ModelSwitches } from "@rakazo_mickvvw/contracts";
import { normalizeRunError } from "./run-error.js";

/** Longest failure detail stored per attempt; the contract schema enforces the same bound. */
export const MODEL_SWITCH_ERROR_MESSAGE_MAX_LENGTH = 300;

/**
 * Short failure class for one attempt's timeline label, from the run-error
 * classification. Kind-less provider faults (overload, timeout, refused
 * connection) are classified from the message the same way normalizeRunError
 * groups them, so the timeline can name them too.
 */
export function modelSwitchErrorCode(details: string): string | undefined {
  const { kind, status } = normalizeRunError(details);
  switch (kind) {
    case "rate":
      return "rate_limit";
    case "key":
      return "key_limit";
    case "credit":
      return "credit_limit";
    case "spending":
      return "spending_limit";
    case "auth":
      return "authentication";
    case "access":
      return "access_denied";
    case "model":
      return "model_unavailable";
    case "context":
      return "context_limit";
    case "output":
      return "output_error";
    default:
      break;
  }
  if (
    status === 408 ||
    status === 504 ||
    /timed?[_ -]?out|ETIMEDOUT|stream ended|\bterminated\b|socket hang up|ECONNRESET|connection reset|fetch failed|network error/i.test(
      details,
    )
  )
    return "timeout";
  if (
    /^connection error\.?$/i.test(details.trim()) ||
    /ECONNREFUSED|connection refused|ENOTFOUND|getaddrinfo|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN/i.test(
      details,
    )
  )
    return "connection";
  if (
    status === 502 ||
    status === 503 ||
    status === 529 ||
    /overload|over capacity|temporarily unavailable|service unavailable/i.test(details)
  )
    return "unavailable";
  return undefined;
}

/**
 * One attempt for the switch timeline. The caller sanitizes `error` first
 * (never a raw provider message); it is collapsed to one line and cut to 300
 * characters here. `errorCode` is classified from `error` when not given.
 */
export function createModelSwitchAttempt(input: {
  model: string;
  /** The connection display name the model ran on; absent when unknown. */
  provider?: string;
  outcome: ModelSwitchAttempt["outcome"];
  /** Sanitized failure detail; ignored for a succeeded attempt. */
  error?: string;
  errorCode?: string;
  at?: string;
}): ModelSwitchAttempt {
  const message = input.error
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, MODEL_SWITCH_ERROR_MESSAGE_MAX_LENGTH)
    .trim();
  const errorCode =
    input.errorCode ?? (input.error ? modelSwitchErrorCode(input.error) : undefined);
  return {
    model: input.model,
    ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
    outcome: input.outcome,
    ...(errorCode ? { errorCode } : {}),
    ...(message ? { errorMessage: message } : {}),
    at: input.at ?? new Date().toISOString(),
  };
}

function attemptKey(attempt: Pick<ModelSwitchAttempt, "model" | "provider">): string {
  return `${attempt.provider ?? ""}\0${attempt.model}`;
}

/**
 * Adds one attempt to a run's timeline, in try order. A model retried after a
 * transient failure keeps one entry — its latest outcome — so a retry that
 * then succeeds leaves no phantom switch behind.
 */
export function recordModelSwitchAttempt(
  attempts: ModelSwitchAttempt[],
  attempt: ModelSwitchAttempt,
): void {
  const key = attemptKey(attempt);
  const index = attempts.findIndex((item) => attemptKey(item) === key);
  if (index >= 0) attempts[index] = attempt;
  else attempts.push(attempt);
}

/**
 * The timeline for a finished message, or undefined when no switch happened:
 * a message answered by its first model carries none, even if that model was
 * retried, and a run with no successful attempt has no message to hang one on.
 * The final model is the last one that succeeded.
 */
export function buildModelSwitches(
  attempts: readonly ModelSwitchAttempt[],
): ModelSwitches | undefined {
  const succeeded = [...attempts].reverse().find((item) => item.outcome === "succeeded");
  if (!succeeded) return undefined;
  const finalKey = attemptKey(succeeded);
  const switched = attempts.some(
    (item) => item.outcome !== "succeeded" && attemptKey(item) !== finalKey,
  );
  if (!switched) return undefined;
  return { attempts: [...attempts], finalModel: succeeded.model };
}
