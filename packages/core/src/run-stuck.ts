import type { MessageBlock } from "@rakazo/contracts";
import { copyableMessageText } from "./message-text.js";
import { isRunWorking } from "./run-state.js";

/**
 * A working run that produced no reply for this long counts as stuck. The
 * value is the server's own stream-idle limit: MODEL_STREAM_IDLE_TIMEOUT_MS
 * (packages/adapters/src/pi-runtime-limits.ts) fails a silent stream after
 * this long, so a run still working past it is past what the server waits out
 * on its own. Reasoning models get up to 120s to first token under
 * MODEL_STREAM_TIMEOUT_MS, inside this budget, so a normal slow thinker does
 * not trip it.
 */
export const STUCK_RUN_NO_OUTPUT_MS = 180_000;

/** The message fields stuck detection reads; both apps' message types fit. */
export type StuckRunMessage = {
  id: string;
  role: string;
  runId?: string | null;
  blocks: readonly MessageBlock[];
};

/** The run fields stuck detection reads; live and full runs both fit. */
export type StuckRunCandidate = {
  id: string;
  status: string;
  /** Absent on a live run that has not reported its bot yet; such a run is skipped. */
  botId?: string;
  modelProvider?: string | null;
  modelId?: string | null;
  startedAt?: string | null;
  createdAt?: string;
};

/** A working run whose originating user message is still waiting for a reply. */
export type StuckRun = {
  runId: string;
  botId: string;
  messageId: string;
  /** The model the stuck run is on, so the retry picker can mark it current. */
  modelProvider: string | null;
  modelId: string | null;
};

/**
 * Finds working runs that have gone quiet: their originating user message
 * (linked by message.runId) still has no bot reply with text, and the run
 * started more than STUCK_RUN_NO_OUTPUT_MS ago. Runs with no originating user
 * message (routines, webhooks) are skipped — there is no message to hang the
 * recovery actions under. A bot message with text counts as a reply even if
 * the run keeps working afterwards; progress and tool-only messages do not.
 */
export function stuckWorkingRuns(
  messages: readonly StuckRunMessage[],
  runs: readonly StuckRunCandidate[],
  now: number,
): StuckRun[] {
  const stuck: StuckRun[] = [];
  for (const run of runs) {
    if (!isRunWorking(run.status)) continue;
    // Without a bot there is no model to switch to and no message to retry on.
    if (!run.botId) continue;
    const originIndex = messages.findIndex(
      (message) => message.role === "user" && message.runId === run.id,
    );
    if (originIndex === -1) continue;
    if (hasBotReply(messages, originIndex)) continue;
    const startedAt = Date.parse(run.startedAt ?? run.createdAt ?? "");
    if (Number.isNaN(startedAt) || now - startedAt <= STUCK_RUN_NO_OUTPUT_MS) continue;
    stuck.push({
      runId: run.id,
      botId: run.botId,
      messageId: messages[originIndex]!.id,
      modelProvider: run.modelProvider ?? null,
      modelId: run.modelId ?? null,
    });
  }
  return stuck;
}

function hasBotReply(messages: readonly StuckRunMessage[], originIndex: number): boolean {
  for (let i = originIndex + 1; i < messages.length; i++) {
    const next = messages[i]!;
    if (next.role === "user") return false;
    if (
      next.role === "bot" &&
      !next.id.startsWith("progress:") &&
      copyableMessageText(next).trim() !== ""
    ) {
      return true;
    }
  }
  return false;
}
