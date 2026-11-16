import type { ThreadMessage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { ShareCardMeasure } from "./share-card.js";
import {
  DEFAULT_SHARE_CARD_STYLE,
  planShareCard,
  SHARE_CARD_WIDTH,
  shareCardContentFromMessage,
  shareCardFilename,
  wrapShareCardLines,
} from "./share-card.js";

/** Every character is 10px wide at 20px type, so wrapping is predictable. */
const measure: ShareCardMeasure = (text, px) => text.length * px * 0.5;

function message(
  overrides: Partial<ThreadMessage> & { blocks: ThreadMessage["blocks"] },
): ThreadMessage {
  return {
    id: "m_1",
    threadId: "t_1",
    seq: 1,
    role: "bot",
    createdAt: "2026-11-16T14:02:11+08:00",
    ...overrides,
  };
}

describe("wrapShareCardLines", () => {
  it("wraps Chinese prose one character at a time", () => {
    const lines = wrapShareCardLines((text) => text.length * 10, "山水画中山水画", 25);
    expect(lines).toEqual(["山水", "画中", "山水", "画"]);
  });

  it("keeps blank lines and hard line breaks", () => {
    expect(wrapShareCardLines((text) => text.length * 10, "ab\n\ncd", 100)).toEqual([
      "ab",
      "",
      "cd",
    ]);
  });
});

describe("shareCardContentFromMessage", () => {
  it("splits the trailing model line off the text", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Here is the plan\n当前模型: model-a" }] }),
    );
    expect(content).toEqual({
      kind: "text",
      text: "Here is the plan",
      model: "model-a",
      date: "2026-11-16",
    });
  });

  it("prefers the switch timeline's final model with its connection", () => {
    const content = shareCardContentFromMessage(
      message({
        blocks: [{ kind: "text", text: "Done" }],
        modelSwitches: {
          attempts: [
            { model: "model-a", provider: "Relay A", outcome: "succeeded", at: "2026-11-16" },
          ],
          finalModel: "model-a",
        },
      }),
    );
    expect(content?.model).toBe("model-a (Relay A)");
  });

  it("makes an image card with the artifact to draw", () => {
    const content = shareCardContentFromMessage(
      message({
        blocks: [
          { kind: "text", text: "A watercolor mountain" },
          { kind: "image", artifactId: "a_1", mimeType: "image/png", name: "mountain.png" },
        ],
      }),
      "Draw a mountain",
    );
    expect(content).toEqual({
      kind: "image",
      question: "Draw a mountain",
      text: "A watercolor mountain",
      imageName: "mountain.png",
      artifactId: "a_1",
      prompt: "Draw a mountain",
      date: "2026-11-16",
    });
  });

  it("redacts secrets before they reach a card", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "key sk-proj-abcdefghij1234567890" }] }),
    );
    expect(content?.text).toBe("key [Redacted]");
  });

  it("returns null for a message with nothing to show", () => {
    expect(
      shareCardContentFromMessage(message({ blocks: [{ kind: "meta", text: "typing…" }] })),
    ).toBeNull();
  });
});

describe("planShareCard", () => {
  it("lays out a text card 1080 wide with room for the footer", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Hello" }] }),
    )!;
    const plan = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure);
    expect(plan.width).toBe(SHARE_CARD_WIDTH);
    expect(plan.bodyLines).toEqual(["Hello"]);
    expect(plan.height).toBe(64 + 20 * 1.75 + 48 + 64);
    expect(plan.footer).toBeNull();
  });

  it("grows with the question, the picture, and the model line", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Here\n当前模型: model-a" }] }),
      "What is this?",
    )!;
    const plain = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure);
    const withMedia = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure, 16 / 9);
    expect(withMedia.mediaHeight).toBeGreaterThan(0);
    expect(withMedia.height).toBeGreaterThan(plain.height);
    expect(plain.footer).toBe("当前模型: model-a");
    expect(plain.questionLines).toEqual(["What is this?"]);
  });
});

describe("shareCardFilename", () => {
  it("names the PNG from the date", () => {
    expect(shareCardFilename(new Date("2026-11-16T14:02:11+08:00"))).toBe(
      "share-card-20261116T0602.png",
    );
  });
});
