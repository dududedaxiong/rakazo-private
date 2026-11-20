import type { MessageBlock } from "@rakazo_mickvvw/contracts";
import { hasBotTextReplyAfter } from "./run-stuck.js";

/**
 * Delivery states for a chat send, ported as design from BotArk's
 * `src/renderer/src/store/delivery.ts` (Electron + zustand). Only the pure
 * rules move: Rakazo's sends are durable on the server (Postgres) and, on
 * mobile, in the outbox files — BotArk's localStorage persistence, account
 * sanitizing, and quota compaction do not apply here.
 *
 * States: sending -> accepted -> sent. A failure splits two ways:
 * `failed` (never left the client: safe to retry) and `no-reply` (the server
 * accepted it but no reply arrived: confirm before resending, or it sends
 * twice). Once the server accepts a message it is never `failed` again.
 */

/** Hard bound for one threads.send call. The call returns once the message and run are durable; it does not wait for the reply (unlike BotArk's adapters, which wait inside sendMessage), so two minutes is a generous bound, not twelve. */
export const SEND_HARD_TIMEOUT_MS = 120_000;

export type DeliveryState = "sending" | "accepted" | "sent" | "failed" | "no-reply";

export type DeliveryErrorKind = "no-reply" | "timeout" | "other";

/**
 * Delivery state after a send failed. Once the server accepted the message it
 * is never "failed" (a retry would double-send), only "no-reply".
 */
export function deliveryAfterError(
  accepted: boolean,
  kind: DeliveryErrorKind,
  detail: string,
  acceptedThenFailed: string,
): { delivery: "failed" | "no-reply"; error: string } {
  if (kind === "no-reply") return { delivery: "no-reply", error: detail };
  if (accepted)
    return {
      delivery: "no-reply",
      error: kind === "timeout" ? acceptedThenFailed : `${acceptedThenFailed} (${detail})`,
    };
  return { delivery: "failed", error: detail };
}

/** One delivery per message at a time: a double-clicked retry must not send twice. */
export function createInFlightSet(): {
  enter(id: string): boolean;
  leave(id: string): void;
  has(id: string): boolean;
} {
  const ids = new Set<string>();
  return {
    enter(id) {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
    leave(id) {
      ids.delete(id);
    },
    has(id) {
      return ids.has(id);
    },
  };
}

export class SendTimeoutError extends Error {
  constructor(message = "Send timed out") {
    super(message);
    this.name = "SendTimeoutError";
  }
}

/**
 * Race `promise` against a timer. If the timer wins, reject with
 * SendTimeoutError; a late result still reaches `onLate` so the caller can
 * correct the state it already showed.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onLate?: (outcome: { ok: true; value: T } | { ok: false; error: unknown }) => void,
  timeoutMessage = "Send timed out",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new SendTimeoutError(timeoutMessage));
    }, ms);
    // Normalize: a caller passing a plain value (or an unmocked stub in tests)
    // must resolve it, not crash on `.then`.
    Promise.resolve(promise).then(
      (value) => {
        if (timedOut) return onLate?.({ ok: true, value });
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (timedOut) return onLate?.({ ok: false, error });
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** A persisted client-side send record, as the restart rule reads it. */
export type DeliveryRecord = {
  delivery: DeliveryState;
  error?: string | null;
};

/**
 * Clean delivery states loaded from disk: nothing can still be in flight
 * after a restart, so a persisted `sending` send or an `accepted` send with
 * no reply would otherwise stay stuck forever. Returns the same reference
 * when nothing needs fixing.
 */
export function sanitizeDeliveryStates<T extends DeliveryRecord>(
  records: Record<string, readonly T[]>,
  texts: { interruptedSend: string; interruptedReply: string },
): Record<string, T[]> {
  let changed = false;
  const next: Record<string, T[]> = {};
  for (const [key, list] of Object.entries(records)) {
    const fixed = list.map((record) => {
      if (record.delivery === "accepted") {
        changed = true;
        return { ...record, delivery: "no-reply" as const, error: texts.interruptedReply };
      }
      if (record.delivery !== "sending") return record;
      changed = true;
      return { ...record, delivery: "failed" as const, error: texts.interruptedSend };
    });
    next[key] = fixed;
  }
  if (!changed) return records as Record<string, T[]>;
  return next;
}

/** The message fields the no-reply derivation reads; both apps' message types fit. */
export type NoReplyMessage = {
  id: string;
  role: string;
  runId?: string | null;
  blocks: readonly MessageBlock[];
};

/** The run fields the no-reply derivation reads; live and full runs both fit. */
export type NoReplyRun = {
  id: string;
  status: string;
};

/**
 * User messages that were accepted but never answered: their run reached a
 * terminal failed or cancelled state and no bot message with text follows
 * them. These are the messages a resend must confirm first — the server
 * already has them, so resending is a new message, not a replay.
 */
export function noReplyMessageIds(
  messages: readonly NoReplyMessage[],
  runs: readonly NoReplyRun[],
): Set<string> {
  const terminal = new Set(
    runs
      .filter((run) => run.status === "failed" || run.status === "cancelled")
      .map((run) => run.id),
  );
  const ids = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== "user" || !message.runId || !terminal.has(message.runId)) continue;
    if (hasBotTextReplyAfter(messages, i)) continue;
    ids.add(message.id);
  }
  return ids;
}
