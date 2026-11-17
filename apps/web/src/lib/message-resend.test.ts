import type { ThreadMessage } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import { userMessageHasNoNormalReply } from "./message-resend";

function message(
  id: string,
  role: ThreadMessage["role"],
  blocks: ThreadMessage["blocks"],
): ThreadMessage {
  return { id, threadId: "thread", seq: 1, role, createdAt: new Date().toISOString(), blocks };
}

const user = (id: string, text = "Shanghai weather") =>
  message(id, "user", [{ kind: "text", text }]);
const botText = (id: string, text = "Sunny today") => message(id, "bot", [{ kind: "text", text }]);
const progressBubble = (id: string) => message(id, "bot", [{ kind: "progress", text: "Working…" }]);
const toolOnly = (id: string) =>
  message(id, "bot", [
    { kind: "progress", text: "Using shell", activity: true },
    { kind: "steps", steps: [{ label: "Shell", count: 2 }] },
  ]);

describe("userMessageHasNoNormalReply", () => {
  it("is true for a user message followed by progress-only, then the end", () => {
    expect(userMessageHasNoNormalReply([user("u1"), progressBubble("progress:1")], 0, true)).toBe(
      true,
    );
  });

  it("is false when a bot text reply follows", () => {
    expect(userMessageHasNoNormalReply([user("u1"), botText("b1")], 0, true)).toBe(false);
  });

  it("is true when another user message follows", () => {
    expect(userMessageHasNoNormalReply([user("u1"), user("u2")], 0, true)).toBe(true);
  });

  it("is true when the user message is the last one", () => {
    expect(userMessageHasNoNormalReply([botText("b1"), user("u1")], 1, true)).toBe(true);
  });

  it("is true when only a tool-only bot message follows", () => {
    expect(userMessageHasNoNormalReply([user("u1"), toolOnly("b1")], 0, true)).toBe(true);
  });

  it("ignores a bot reply that belongs to a later user message", () => {
    expect(userMessageHasNoNormalReply([user("u1"), user("u2"), botText("b1")], 0, true)).toBe(
      true,
    );
    expect(userMessageHasNoNormalReply([user("u1"), user("u2"), botText("b1")], 1, true)).toBe(
      false,
    );
  });

  it("is false for a bot message or a user message without text", () => {
    expect(userMessageHasNoNormalReply([botText("b1")], 0, true)).toBe(false);
    expect(userMessageHasNoNormalReply([user("u1", "   ")], 0, true)).toBe(false);
  });
});
