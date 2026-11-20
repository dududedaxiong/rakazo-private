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
  /** Which pool the model belongs to: "main" for the main pool, "backup" for the backup pool. */
  pool?: ModelSwitchAttempt["pool"];
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
    ...(input.pool ? { pool: input.pool } : {}),
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
 * The submitted video task failed upstream, so the model that submitted it
 * did not deliver: its "succeeded" submit becomes a failed attempt. The
 * entry keeps its provider and pool; a model with no entry gains a failed one.
 */
export function failModelSwitchAttempt(
  attempts: ModelSwitchAttempt[],
  model: string,
  reason: string,
  detail?: { provider?: string; pool?: ModelSwitchAttempt["pool"] },
): void {
  for (let index = attempts.length - 1; index >= 0; index--) {
    const item = attempts[index]!;
    if (item.model !== model) continue;
    attempts[index] = createModelSwitchAttempt({
      model: item.model,
      ...(item.provider ? { provider: item.provider } : {}),
      outcome: "failed",
      ...(item.pool ? { pool: item.pool } : {}),
      error: reason,
    });
    return;
  }
  recordModelSwitchAttempt(
    attempts,
    createModelSwitchAttempt({
      model,
      ...(detail?.provider ? { provider: detail.provider } : {}),
      outcome: "failed",
      ...(detail?.pool ? { pool: detail.pool } : {}),
      error: reason,
    }),
  );
}

/**
 * The timeline for a finished message, or undefined when no switch happened:
 * a message answered by its first model carries none, even if that model was
 * retried. A run where no model answered still carries one: the attempts are
 * the record of what was tried and why each failed, and the final model is
 * the last one tried.
 */
export function buildModelSwitches(
  attempts: readonly ModelSwitchAttempt[],
): ModelSwitches | undefined {
  if (attempts.length === 0) return undefined;
  const succeeded = [...attempts].reverse().find((item) => item.outcome === "succeeded");
  if (succeeded) {
    const finalKey = attemptKey(succeeded);
    const switched = attempts.some(
      (item) => item.outcome !== "succeeded" && attemptKey(item) !== finalKey,
    );
    if (!switched) return undefined;
    return { attempts: [...attempts], finalModel: succeeded.model };
  }
  return { attempts: [...attempts], finalModel: attempts.at(-1)!.model };
}
