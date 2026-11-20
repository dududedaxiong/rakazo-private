import type { MessageBlock } from "@rakazo_mickvvw/contracts";

/**
 * The client-side stall watchdog, ported as design from BotArk's
 * `src/renderer/src/store/replyWatchdog.ts`. Typing ("thinking…") is driven
 * only by live events; if a stream dies without its final event, the
 * indicator used to stay on forever. The watchdog clears it after a long
 * quiet period — and, through the stuck-run clock, keeps long actively
 * working runs (tool calls, long jobs) from tripping the stuck row.
 *
 * Keys are bot ids: one clock per bot, so a busy bot never masks a quiet one.
 */

/** No event at all for this long while a reply is expected → give up waiting. */
export const REPLY_IDLE_LIMIT_MS = 3 * 60_000;
/** Same, while the platform still reports the agent as busy (tools, long jobs). */
export const REPLY_BUSY_LIMIT_MS = 15 * 60_000;

export function isReplyStalled(lastEventAt: number, now: number, busy: boolean): boolean {
  return now - lastEventAt >= (busy ? REPLY_BUSY_LIMIT_MS : REPLY_IDLE_LIMIT_MS);
}

/** True when the live progress shows tool activity: steps, or an activity progress segment. */
export function liveRunIsBusy(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) => block.kind === "steps" || (block.kind === "progress" && block.activity === true),
  );
}

/** Live event types that prove a bot's run is still producing output. */
const WATCHDOG_EVENT_TYPES: ReadonlySet<string> = new Set([
  "thread.progress",
  "agent.tool.called",
  "thread.message.created",
  "thread.cloud_agent",
  "thread.subagent",
  "run.started",
  "computer.status",
]);

export function isWatchdogEvent(type: string): boolean {
  return WATCHDOG_EVENT_TYPES.has(type);
}

/** Tracks the last sign of life per bot. */
export class ReplyWatchdog {
  private readonly lastEvent = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  touch(botId: string): void {
    this.lastEvent.set(botId, this.now());
  }

  forget(botId: string): void {
    this.lastEvent.delete(botId);
  }

  lastEventAt(botId: string): number | undefined {
    return this.lastEvent.get(botId);
  }

  /**
   * Bots among `typingBotIds` that have been quiet too long. Bots seen for
   * the first time start their clock now.
   */
  stalled(typingBotIds: readonly string[], isBusy: (botId: string) => boolean): string[] {
    const now = this.now();
    const typing = new Set(typingBotIds);
    for (const id of [...this.lastEvent.keys()]) if (!typing.has(id)) this.lastEvent.delete(id);
    const out: string[] = [];
    for (const id of typing) {
      const last = this.lastEvent.get(id);
      if (last === undefined) {
        this.lastEvent.set(id, now);
        continue;
      }
      if (isReplyStalled(last, now, isBusy(id))) out.push(id);
    }
    return out;
  }
}
