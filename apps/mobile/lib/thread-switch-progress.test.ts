import type { ProductEvent } from "@rakazo_mickvvw/contracts";
import { reduceThreadSnapshot, withLiveStreamingProgress } from "@rakazo_mickvvw/core";
import { describe, expect, it } from "vitest";
import type { MobileSnapshot } from "./mobile-types";

/**
 * The fallback-switch transition rides the existing `thread.progress` live
 * row: the server sends `{text, activity: true}` while it switches, the
 * shared reducer shows that text under the reply as a `progress:{runId}`
 * row, and the run's terminal event drops the row so the reply's own
 * "current model" label takes over. No new rendering is involved.
 */
function snapshot(): MobileSnapshot {
  return {
    threadId: "thread-1",
    cursor: 0,
    messages: [],
    olderCursor: null,
    run: { id: "run-1", status: "running", botId: "bot-1" },
  } as MobileSnapshot;
}

function event(overrides: Partial<ProductEvent>): ProductEvent {
  return {
    id: "event-1",
    spaceId: "workspace-1",
    threadId: "thread-1",
    botId: "bot-1",
    seq: 1,
    type: "thread.progress",
    runId: "run-1",
    createdAt: "2026-11-15T00:00:01.000Z",
    payload: {},
    ...overrides,
  };
}

function progressRow(snap: MobileSnapshot | null): MobileSnapshot["messages"][number] | undefined {
  return snap?.messages.find((message) => message.id === "progress:run-1");
}

function progressText(snap: MobileSnapshot | null): string | undefined {
  const block = progressRow(snap)?.blocks.find((candidate) => candidate.kind === "progress");
  return block?.kind === "progress" ? block.text : undefined;
}

describe("fallback-switch transition row", () => {
  it("shows the switch text under the reply while switching", () => {
    const started = reduceThreadSnapshot(
      snapshot(),
      event({ type: "run.started", seq: 1, runId: "run-1" }),
    );
    const switching = reduceThreadSnapshot(
      started,
      event({
        seq: 2,
        payload: { text: "DeepSeek 失败，正在尝试备用模型 Kimi", activity: true },
      }),
    );
    expect(progressRow(switching)?.role).toBe("bot");
    expect(progressText(switching)).toBe("DeepSeek 失败，正在尝试备用模型 Kimi");
    // An activity progress row stays visible with streaming off: it is the
    // switch in progress, not streamed reply text.
    expect(withLiveStreamingProgress(switching, false)?.messages).toHaveLength(1);
    expect(progressText(withLiveStreamingProgress(switching, false))).toBe(
      "DeepSeek 失败，正在尝试备用模型 Kimi",
    );
  });

  it("updates the same row when the switch moves to another backup", () => {
    const first = reduceThreadSnapshot(
      snapshot(),
      event({
        seq: 2,
        payload: { text: "正在切换到备用模型…", activity: true },
      }),
    );
    const second = reduceThreadSnapshot(
      first,
      event({
        seq: 3,
        payload: { text: "正在切换到备用模型 Kimi…", activity: true },
      }),
    );
    expect(second?.messages).toHaveLength(1);
    expect(progressText(second)).toBe("正在切换到备用模型 Kimi…");
  });

  it("drops the transition row when the run ends", () => {
    const switching = reduceThreadSnapshot(
      snapshot(),
      event({
        seq: 2,
        payload: { text: "正在切换到备用模型…", activity: true },
      }),
    );
    expect(progressRow(switching)).toBeDefined();
    const done = reduceThreadSnapshot(
      switching,
      event({ type: "run.completed", seq: 3, runId: "run-1" }),
    );
    expect(done?.messages).toEqual([]);
    expect(done?.run).toBeNull();
  });

  it("drops the transition row when the run fails instead", () => {
    const switching = reduceThreadSnapshot(
      snapshot(),
      event({
        seq: 2,
        payload: { text: "正在切换到备用模型…", activity: true },
      }),
    );
    const failed = reduceThreadSnapshot(
      switching,
      event({
        type: "run.failed",
        seq: 3,
        runId: "run-1",
        payload: { error: "boom" },
      }),
    );
    expect(failed?.messages).toEqual([]);
    expect(failed?.run?.status).toBe("failed");
  });
});
