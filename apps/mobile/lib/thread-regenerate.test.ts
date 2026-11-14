import { describe, expect, it } from "vitest";
import type { MobileMessage } from "./mobile-types";
import {
  buildRegeneratePayload,
  previousUserMessageText,
  resendableUserMessageText,
} from "./thread-regenerate";

function message(id: string, role: "user" | "bot", text: string): MobileMessage {
  return {
    id,
    role,
    createdAt: "2026-01-01T00:00:00.000Z",
    blocks: [{ kind: "text", text }],
  } as unknown as MobileMessage;
}

describe("previousUserMessageText", () => {
  it("returns the user message directly above a bot reply", () => {
    const messages = [message("u1", "user", "What is 2 + 2?"), message("b1", "bot", "4")];
    expect(previousUserMessageText(messages, "b1")).toBe("What is 2 + 2?");
  });

  it("skips bot messages to reach the nearest user message", () => {
    const messages = [
      message("u1", "user", "First question"),
      message("b1", "bot", "First answer"),
      message("u2", "user", "Second question"),
      message("b2", "bot", "Second answer"),
    ];
    expect(previousUserMessageText(messages, "b2")).toBe("Second question");
  });

  it("returns null when no user message precedes the reply", () => {
    const messages = [message("b1", "bot", "Hello")];
    expect(previousUserMessageText(messages, "b1")).toBeNull();
  });

  it("skips empty user messages", () => {
    const messages = [
      message("u1", "user", "   "),
      message("u2", "user", "Real question"),
      message("b1", "bot", "Answer"),
    ];
    expect(previousUserMessageText(messages, "b1")).toBe("Real question");
  });
});

describe("resendableUserMessageText", () => {
  it("returns the user message's own text", () => {
    expect(resendableUserMessageText(message("u1", "user", "What is 2 + 2?"))).toBe(
      "What is 2 + 2?",
    );
  });

  it("returns null for a bot reply", () => {
    expect(resendableUserMessageText(message("b1", "bot", "4"))).toBeNull();
  });

  it("returns null when the user message has no text to resend", () => {
    expect(resendableUserMessageText(message("u1", "user", "   "))).toBeNull();
  });
});

describe("buildRegeneratePayload", () => {
  it("builds a plain resend of the user text through the normal send plan", () => {
    const payload = buildRegeneratePayload({
      text: "What is 2 + 2?",
      originThreadKey: "bot-1",
      botTarget: "bot-1",
    });
    expect(payload.displayText).toBe("What is 2 + 2?");
    expect(payload.plan.trimmed).toBe("What is 2 + 2?");
    expect(payload.plan.shouldSend).toBe(true);
    expect(payload.plan.isNoOp).toBe(false);
    expect(payload.originThreadKey).toBe("bot-1");
    expect(payload.botTarget).toBe("bot-1");
    expect(payload.reroutedToGroup).toBe(false);
    expect(payload.attachments).toEqual([]);
    expect(payload.replyQuote).toBeNull();
  });
});
