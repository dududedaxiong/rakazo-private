import { describe, expect, it } from "vitest";
import { STUCK_RUN_NO_OUTPUT_MS, stuckWorkingRuns } from "./run-stuck.js";

const STARTED_AT = "2026-11-14T12:00:00.000Z";
const now = Date.parse(STARTED_AT) + STUCK_RUN_NO_OUTPUT_MS + 1_000;

function userMessage(id: string, runId: string | null) {
  return {
    id,
    role: "user",
    runId,
    blocks: [{ kind: "text" as const, text: "hello" }],
  };
}

function botMessage(id: string, text: string) {
  return {
    id,
    role: "bot",
    runId: null,
    blocks: [{ kind: "text" as const, text }],
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "running",
    botId: "bot-1",
    modelProvider: "openai-compatible",
    modelId: "model-1",
    startedAt: STARTED_AT,
    createdAt: STARTED_AT,
    ...overrides,
  };
}

describe("stuckWorkingRuns", () => {
  it("flags a working run whose message has no reply past the threshold", () => {
    expect(stuckWorkingRuns([userMessage("m1", "run-1")], [run()], now)).toEqual([
      {
        runId: "run-1",
        botId: "bot-1",
        messageId: "m1",
        modelProvider: "openai-compatible",
        modelId: "model-1",
      },
    ]);
  });

  it("ignores a run that answered, even while it keeps working", () => {
    const messages = [userMessage("m1", "run-1"), botMessage("m2", "here it is")];
    expect(stuckWorkingRuns(messages, [run()], now)).toEqual([]);
  });

  it("ignores a run younger than the threshold", () => {
    expect(
      stuckWorkingRuns([userMessage("m1", "run-1")], [run()], Date.parse(STARTED_AT) + 60_000),
    ).toEqual([]);
  });

  it("ignores completed runs and runs with no originating user message", () => {
    expect(
      stuckWorkingRuns(
        [userMessage("m1", "run-1")],
        [run({ status: "completed" }), run({ id: "run-2" })],
        now,
      ),
    ).toEqual([]);
  });

  it("does not count progress or tool-only messages as a reply", () => {
    const progress = {
      id: "progress:run-1",
      role: "bot",
      runId: null,
      blocks: [{ kind: "progress" as const, text: "Working…" }],
    };
    const toolOnly = {
      id: "m2",
      role: "bot",
      runId: null,
      blocks: [{ kind: "steps" as const, steps: [{ label: "web.search", count: 1 }] }],
    };
    expect(
      stuckWorkingRuns([userMessage("m1", "run-1"), progress, toolOnly], [run()], now),
    ).toEqual([
      {
        runId: "run-1",
        botId: "bot-1",
        messageId: "m1",
        modelProvider: "openai-compatible",
        modelId: "model-1",
      },
    ]);
  });

  it("stops looking for a reply at the next user message", () => {
    const messages = [
      userMessage("m1", "run-1"),
      userMessage("m2", null),
      botMessage("m3", "reply to the second message"),
    ];
    expect(stuckWorkingRuns(messages, [run()], now)).toEqual([
      {
        runId: "run-1",
        botId: "bot-1",
        messageId: "m1",
        modelProvider: "openai-compatible",
        modelId: "model-1",
      },
    ]);
  });

  it("falls back to createdAt for a run that never started", () => {
    expect(
      stuckWorkingRuns(
        [userMessage("m1", "run-1")],
        [run({ status: "queued", startedAt: null })],
        now,
      ),
    ).toEqual([
      {
        runId: "run-1",
        botId: "bot-1",
        messageId: "m1",
        modelProvider: "openai-compatible",
        modelId: "model-1",
      },
    ]);
  });
});
