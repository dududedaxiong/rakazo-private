import { createStreamingRedactor } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import type { ReplyState } from "./run-context.js";
import { discardStalledTurnText, fallbackAnswerMark } from "./run-progress.js";

function replyState(overrides: Partial<ReplyState> = {}): ReplyState {
  return {
    assembled: "",
    currentTextSegment: "",
    messageSegments: [],
    publishedTerminalSubagent: false,
    publishedMidTurnUserMessage: false,
    discardedMidTurnNarration: false,
    lastDiscardedMidTurnNarration: "",
    explicitNoResponse: false,
    assistantTurnText: "",
    midTurnUserTexts: [],
    midTurnProgressCount: 0,
    turnStartedAtMs: 0,
    progressBudgetStart: 0,
    steeringReplyPending: false,
    computerTaskStarted: false,
    steeringResets: 0,
    lastSteeringResetAt: Number.NEGATIVE_INFINITY,
    workingNotes: [],
    textSinceLastStep: "",
    narrationSoFar: "",
    narrationStatusShowing: false,
    pendingToolNames: [],
    pendingProgress: "",
    lastProgressAt: 0,
    hasStreamedText: false,
    assistantTurnBreakPending: false,
    currentTurnSeparatorLength: 0,
    redactor: createStreamingRedactor([]),
    ...overrides,
  };
}

describe("discardStalledTurnText", () => {
  it("drops a simple stalled turn", () => {
    const reply = replyState({
      assembled: "Stalled.",
      currentTextSegment: "Stalled.",
      assistantTurnText: "Stalled.",
      textSinceLastStep: "Stalled.",
      pendingProgress: "Stalled.",
      hasStreamedText: true,
    });
    discardStalledTurnText(reply);
    expect(reply.assembled).toBe("");
    expect(reply.currentTextSegment).toBe("");
    expect(reply.assistantTurnText).toBe("");
    expect(reply.textSinceLastStep).toBe("");
    expect(reply.pendingProgress).toBe("");
    expect(reply.hasStreamedText).toBe(false);
    expect(reply.currentTurnSeparatorLength).toBe(0);
    expect(reply.messageSegments).toEqual([]);
  });

  it("drops the turn and its separator, keeping earlier text", () => {
    const reply = replyState({
      assembled: "Earlier.\n\nStalled.",
      currentTextSegment: "Earlier.\n\nStalled.",
      assistantTurnText: "Stalled.",
      textSinceLastStep: "Stalled.",
      currentTurnSeparatorLength: 2,
      hasStreamedText: true,
    });
    discardStalledTurnText(reply);
    expect(reply.assembled).toBe("Earlier.");
    expect(reply.currentTextSegment).toBe("Earlier.");
    expect(reply.assistantTurnText).toBe("");
    expect(reply.textSinceLastStep).toBe("");
    expect(reply.hasStreamedText).toBe(true);
    expect(reply.currentTurnSeparatorLength).toBe(0);
  });

  it("drops text flushed to the message segments", () => {
    const reply = replyState({
      assembled: "Earlier.\n\nStalled part. rest.",
      currentTextSegment: " rest.",
      messageSegments: [{ kind: "text", text: "Earlier.\n\nStalled part." }],
      assistantTurnText: "Stalled part. rest.",
      textSinceLastStep: "Stalled part. rest.",
      currentTurnSeparatorLength: 2,
      hasStreamedText: true,
    });
    discardStalledTurnText(reply);
    expect(reply.messageSegments).toEqual([{ kind: "text", text: "Earlier." }]);
    expect(reply.currentTextSegment).toBe("");
    expect(reply.assembled).toBe("Earlier.");
    expect(reply.assistantTurnText).toBe("");
    expect(reply.textSinceLastStep).toBe("");
    expect(reply.hasStreamedText).toBe(true);
  });

  it("drops a flushed turn whose segment becomes empty", () => {
    const reply = replyState({
      assembled: "Stalled.",
      currentTextSegment: "",
      messageSegments: [{ kind: "text", text: "Stalled." }],
      assistantTurnText: "Stalled.",
      textSinceLastStep: "Stalled.",
      hasStreamedText: true,
    });
    discardStalledTurnText(reply);
    expect(reply.messageSegments).toEqual([]);
    expect(reply.assembled).toBe("");
    expect(reply.hasStreamedText).toBe(false);
  });

  it("does nothing when the turn wrote nothing", () => {
    const reply = replyState({
      assembled: "Earlier.",
      currentTextSegment: "Earlier.",
      assistantTurnText: "",
      textSinceLastStep: "",
    });
    discardStalledTurnText(reply);
    expect(reply.assembled).toBe("Earlier.");
    expect(reply.currentTextSegment).toBe("Earlier.");
  });

  it("does nothing when the text is no longer the reply's tail", () => {
    const reply = replyState({
      assembled: "Published already.",
      currentTextSegment: "Stalled.",
      assistantTurnText: "Stalled.",
      textSinceLastStep: "Stalled.",
      hasStreamedText: true,
    });
    discardStalledTurnText(reply);
    expect(reply.assembled).toBe("Published already.");
    expect(reply.currentTextSegment).toBe("Stalled.");
    expect(reply.assistantTurnText).toBe("Stalled.");
  });

  it("does nothing when the segment disagrees with the turn", () => {
    const reply = replyState({
      assembled: "Stalled.",
      currentTextSegment: "Something else!",
      assistantTurnText: "Stalled.",
      textSinceLastStep: "Stalled.",
      hasStreamedText: true,
    });
    discardStalledTurnText(reply);
    expect(reply.assembled).toBe("Stalled.");
    expect(reply.currentTextSegment).toBe("Something else!");
    expect(reply.assistantTurnText).toBe("Stalled.");
  });
});

describe("fallbackAnswerMark", () => {
  it("marks the answering model when it differs from the starting model", () => {
    expect(fallbackAnswerMark("primary", "backup-a")).toBe("当前模型: backup-a");
  });

  it("marks nothing when the same model answered", () => {
    expect(fallbackAnswerMark("primary", "primary")).toBeUndefined();
  });

  it("marks nothing without an answering model", () => {
    expect(fallbackAnswerMark("primary", undefined)).toBeUndefined();
    expect(fallbackAnswerMark("primary", null)).toBeUndefined();
  });

  it("marks the answering model when the starting model is unknown", () => {
    expect(fallbackAnswerMark(undefined, "backup-a")).toBe("当前模型: backup-a");
  });
});
