import type { ThreadMessage } from "@rakazo_mickvvw/contracts";
import { SharedConversationSchema } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import { buildSharedConversation } from "./share-snapshot.js";

const START = new Date("2026-11-16T14:02:11+08:00");

function message(
  overrides: Partial<ThreadMessage> & { blocks: ThreadMessage["blocks"] },
): ThreadMessage {
  return {
    id: `m_${overrides.seq ?? 1}`,
    threadId: "t_1",
    seq: overrides.seq ?? 1,
    role: "bot",
    createdAt: START.toISOString(),
    ...overrides,
  };
}

describe("buildSharedConversation", () => {
  it("builds a versioned snapshot with relative times, models, and media refs", () => {
    const snapshot = buildSharedConversation({
      title: "Test chat",
      botName: "Helper",
      totalMessages: 3,
      createdAt: START,
      messages: [
        message({
          seq: 1,
          role: "user",
          createdAt: START.toISOString(),
          blocks: [{ kind: "text", text: "Draw a mountain" }],
        }),
        message({
          seq: 2,
          createdAt: new Date(START.getTime() + 90_000).toISOString(),
          blocks: [
            { kind: "text", text: "Here it is" },
            { kind: "image", artifactId: "a_1", mimeType: "image/png", name: "mountain.png" },
            {
              kind: "steps",
              steps: [{ label: "Generated image", count: 1, note: "watercolor style" }],
            },
          ],
          modelSwitches: {
            attempts: [
              {
                model: "model-a",
                provider: "Relay A",
                outcome: "succeeded",
                at: START.toISOString(),
              },
            ],
            finalModel: "model-a",
          },
        }),
        message({
          seq: 3,
          createdAt: new Date(START.getTime() + 140_000).toISOString(),
          blocks: [{ kind: "text", text: "Done" }],
        }),
      ],
    });
    expect(SharedConversationSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.v).toBe(2);
    expect(snapshot.kind).toBe("conversation");
    expect(snapshot.model).toBe("model-a (Relay A)");
    expect(snapshot.start).toBe(START.toISOString());
    expect(snapshot.entries).toEqual([
      { type: "user", t: 0, text: "Draw a mountain" },
      {
        type: "reply",
        t: 90_000,
        text: "Here it is",
        model: "model-a (Relay A)",
        images: [{ name: "mountain.png" }],
      },
      {
        type: "tool",
        t: 90_000,
        name: "Generated image",
        summary: "watercolor style",
        status: "ok",
      },
      { type: "reply", t: 140_000, text: "Done" },
    ]);
    expect(snapshot.range).toBeUndefined();
  });

  it("redacts secrets and home paths, and drops peer receipts", () => {
    const snapshot = buildSharedConversation({
      title: "Test chat",
      totalMessages: 2,
      createdAt: START,
      messages: [
        message({
          seq: 1,
          role: "user",
          blocks: [{ kind: "text", text: "my key is sk-proj-abcdefghij1234567890" }],
        }),
        message({
          seq: 2,
          blocks: [
            { kind: "bot_message_sent", toBotId: "b_2", toBotName: "Other", text: "hi" },
            { kind: "text", text: "saved to /home/alice/notes.txt" },
          ],
        }),
      ],
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toEqual({
      type: "user",
      t: 0,
      text: "my key is [Redacted]",
    });
  });

  it("keeps only the newest entries of a long thread and names the range", () => {
    const messages = Array.from({ length: 1002 }, (_, index) =>
      message({
        seq: index + 1,
        role: index % 2 === 0 ? "user" : "bot",
        createdAt: new Date(START.getTime() + index * 1000).toISOString(),
        blocks: [{ kind: "text", text: `message ${index + 1}` }],
      }),
    );
    const snapshot = buildSharedConversation({
      title: "Long chat",
      totalMessages: 1002,
      createdAt: START,
      messages,
    });
    expect(snapshot.entries).toHaveLength(1000);
    expect(snapshot.entries[0]).toEqual({ type: "user", t: 2000, text: "message 3" });
    expect(snapshot.range).toEqual({ from: 3, to: 1002, of: 1002 });
    expect(SharedConversationSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("drops messages with nothing readable", () => {
    const snapshot = buildSharedConversation({
      title: "Test chat",
      totalMessages: 2,
      createdAt: START,
      messages: [
        message({ seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }] }),
        message({ seq: 2, blocks: [{ kind: "meta", text: "typing…" }] }),
      ],
    });
    expect(snapshot.entries).toHaveLength(1);
  });
});
