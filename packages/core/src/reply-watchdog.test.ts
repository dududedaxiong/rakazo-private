import { describe, expect, it } from "vitest";
import {
  isReplyStalled,
  isWatchdogEvent,
  liveRunIsBusy,
  REPLY_BUSY_LIMIT_MS,
  REPLY_IDLE_LIMIT_MS,
  ReplyWatchdog,
} from "./reply-watchdog.js";
import { stuckWorkingRuns } from "./run-stuck.js";

describe("isReplyStalled", () => {
  it("uses the idle limit when not busy", () => {
    expect(isReplyStalled(0, REPLY_IDLE_LIMIT_MS - 1, false)).toBe(false);
    expect(isReplyStalled(0, REPLY_IDLE_LIMIT_MS, false)).toBe(true);
  });

  it("uses the busy limit while the platform reports busy", () => {
    expect(isReplyStalled(0, REPLY_IDLE_LIMIT_MS, true)).toBe(false);
    expect(isReplyStalled(0, REPLY_BUSY_LIMIT_MS - 1, true)).toBe(false);
    expect(isReplyStalled(0, REPLY_BUSY_LIMIT_MS, true)).toBe(true);
  });
});

describe("liveRunIsBusy", () => {
  it("counts tool steps and activity progress as busy", () => {
    expect(
      liveRunIsBusy([{ kind: "steps", steps: [{ label: "Search", count: 1 }] } as never]),
    ).toBe(true);
    expect(
      liveRunIsBusy([{ kind: "progress", text: "Searching…", activity: true } as never]),
    ).toBe(true);
  });

  it("counts plain narration progress as idle", () => {
    expect(liveRunIsBusy([{ kind: "progress", text: "Thinking…" } as never])).toBe(false);
    expect(liveRunIsBusy([])).toBe(false);
  });
});

describe("isWatchdogEvent", () => {
  it("accepts live output events and rejects the rest", () => {
    expect(isWatchdogEvent("thread.progress")).toBe(true);
    expect(isWatchdogEvent("agent.tool.called")).toBe(true);
    expect(isWatchdogEvent("thread.message.created")).toBe(true);
    expect(isWatchdogEvent("run.started")).toBe(true);
    expect(isWatchdogEvent("bot.updated")).toBe(false);
    expect(isWatchdogEvent("heartbeat")).toBe(false);
  });
});

describe("ReplyWatchdog", () => {
  it("starts the clock on first sight and flags quiet bots per key", () => {
    let now = 0;
    const watchdog = new ReplyWatchdog(() => now);
    expect(watchdog.stalled(["a", "b"], () => false)).toEqual([]);
    now = REPLY_IDLE_LIMIT_MS - 1;
    expect(watchdog.stalled(["a", "b"], () => false)).toEqual([]);
    now = REPLY_IDLE_LIMIT_MS;
    expect(watchdog.stalled(["a", "b"], () => false)).toEqual(["a", "b"]);
  });

  it("keeps each bot on its own clock", () => {
    let now = 0;
    const watchdog = new ReplyWatchdog(() => now);
    watchdog.touch("a");
    now = REPLY_IDLE_LIMIT_MS;
    watchdog.touch("b");
    expect(watchdog.stalled(["a", "b"], () => false)).toEqual(["a"]);
    expect(watchdog.lastEventAt("b")).toBe(REPLY_IDLE_LIMIT_MS);
  });

  it("gives a busy bot the longer limit", () => {
    let now = 0;
    const watchdog = new ReplyWatchdog(() => now);
    watchdog.touch("a");
    now = REPLY_IDLE_LIMIT_MS;
    expect(watchdog.stalled(["a"], (id) => id === "a")).toEqual([]);
    now = REPLY_BUSY_LIMIT_MS;
    expect(watchdog.stalled(["a"], (id) => id === "a")).toEqual(["a"]);
  });

  it("forgets a bot and prunes keys that stopped typing", () => {
    const watchdog = new ReplyWatchdog(() => 0);
    watchdog.touch("a");
    watchdog.forget("a");
    expect(watchdog.lastEventAt("a")).toBeUndefined();
    watchdog.touch("a");
    watchdog.touch("b");
    expect(watchdog.stalled(["a"], () => false)).toEqual([]);
    expect(watchdog.lastEventAt("b")).toBeUndefined();
  });
});

describe("stuckWorkingRuns with a watchdog clock", () => {
  const STARTED_AT = "2026-11-14T12:00:00.000Z";
  const startedMs = Date.parse(STARTED_AT);
  const userMessage = { id: "u1", role: "user", runId: "run-1", blocks: [] as never[] };
  const run = {
    id: "run-1",
    status: "running",
    botId: "bot-1",
    modelProvider: "openai-compatible",
    modelId: "m",
    startedAt: STARTED_AT,
    createdAt: STARTED_AT,
  };

  it("does not flag a run with a recent live event", () => {
    const now = startedMs + 10 * 60_000;
    const clock = { lastEventAt: () => now - 60_000, isBusy: () => false };
    expect(stuckWorkingRuns([userMessage], [run], now, clock)).toEqual([]);
  });

  it("flags a run whose last event is past the idle limit", () => {
    const now = startedMs + 10 * 60_000;
    const clock = { lastEventAt: () => now - REPLY_IDLE_LIMIT_MS, isBusy: () => false };
    expect(stuckWorkingRuns([userMessage], [run], now, clock).map((s) => s.runId)).toEqual([
      "run-1",
    ]);
  });

  it("gives a busy run the longer limit", () => {
    const now = startedMs + 20 * 60_000;
    const clock = {
      lastEventAt: () => now - 10 * 60_000,
      isBusy: () => true,
    };
    expect(stuckWorkingRuns([userMessage], [run], now, clock)).toEqual([]);
    const older = {
      lastEventAt: () => now - REPLY_BUSY_LIMIT_MS,
      isBusy: () => true,
    };
    expect(stuckWorkingRuns([userMessage], [run], now, older).map((s) => s.runId)).toEqual([
      "run-1",
    ]);
  });

  it("falls back to the start-time rule when the clock never saw the bot", () => {
    const now = startedMs + 10 * 60_000;
    const clock = { lastEventAt: () => undefined, isBusy: () => false };
    expect(stuckWorkingRuns([userMessage], [run], now, clock).map((s) => s.runId)).toEqual([
      "run-1",
    ]);
  });
});
