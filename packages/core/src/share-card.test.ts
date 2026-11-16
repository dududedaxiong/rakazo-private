import { describe, expect, it } from "vitest";
import type { ShareCardMeasure } from "./share-card.js";
import {
  DEFAULT_SHARE_CARD_STYLE,
  estimateShareCardTextWidth,
  formatShareCardDuration,
  planShareCard,
  SHARE_CARD_WIDTH,
  shareCardContentFromMessage,
  shareCardFilename,
  shareCardMediaRect,
  wrapShareCardLines,
} from "./share-card.js";
import type { LiveThreadMessage } from "./thread-snapshot-events.js";

/** Every character is 10px wide at 20px type, so wrapping is predictable. */
const measure: ShareCardMeasure = (text, px) => text.length * px * 0.5;

function message(
  overrides: Partial<LiveThreadMessage> & { blocks: LiveThreadMessage["blocks"] },
): LiveThreadMessage {
  return {
    id: "m_1",
    threadId: "t_1",
    seq: 1,
    role: "bot",
    createdAt: "2026-11-16T14:02:11+08:00",
    ...overrides,
  };
}

describe("formatShareCardDuration", () => {
  it("writes a length as m:ss", () => {
    expect(formatShareCardDuration(0)).toBe("0:00");
    expect(formatShareCardDuration(9.4)).toBe("0:09");
    expect(formatShareCardDuration(70)).toBe("1:10");
    expect(formatShareCardDuration(-5)).toBe("0:00");
  });
});

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

  it("shows a translation instead of the original when one is shown", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Hello world" }] }),
      undefined,
      { text: "你好，世界", model: "translator-a" },
    );
    expect(content).toEqual({
      kind: "text",
      text: "你好，世界",
      model: "translator-a",
      date: "2026-11-16",
    });
  });

  it("keeps the picture and the question when the text is a translation", () => {
    const content = shareCardContentFromMessage(
      message({
        blocks: [
          { kind: "text", text: "A watercolor mountain" },
          { kind: "image", artifactId: "a_1", mimeType: "image/png", name: "mountain.png" },
        ],
      }),
      "Draw a mountain",
      { text: "一幅水彩山水画", model: "translator-a" },
    );
    expect(content).toEqual({
      kind: "image",
      question: "Draw a mountain",
      text: "一幅水彩山水画",
      model: "translator-a",
      imageName: "mountain.png",
      artifactId: "a_1",
      prompt: "Draw a mountain",
      date: "2026-11-16",
    });
  });

  it("falls back to the reply's model when the override names none", () => {
    const content = shareCardContentFromMessage(
      message({
        blocks: [{ kind: "text", text: "Hello\n当前模型: model-a" }],
        modelSwitches: {
          attempts: [
            { model: "model-a", provider: "Relay A", outcome: "succeeded", at: "2026-11-16" },
          ],
          finalModel: "model-a",
        },
      }),
      undefined,
      { text: "你好" },
    );
    expect(content?.text).toBe("你好");
    expect(content?.model).toBe("model-a (Relay A)");
  });

  it("drops the original's trailing model line with the original text", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Hello\n当前模型: model-a" }] }),
      undefined,
      { text: "你好" },
    );
    expect(content?.text).toBe("你好");
    expect(content?.model).toBeUndefined();
  });

  it("redacts secrets in a translation like in the original", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Hello" }] }),
      undefined,
      { text: "key sk-proj-abcdefghij1234567890", model: "translator-a" },
    );
    expect(content?.text).toBe("key [Redacted]");
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

describe("planShareCard positions", () => {
  it("places every section where the draw puts it", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Here\n当前模型: model-a" }] }),
      "What is this?",
    )!;
    const plan = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure);
    // questionPx 17, one question line: divider 28 below the lines, media 28 below that.
    expect(plan.questionY).toBe(64);
    expect(plan.questionDividerY).toBeCloseTo(64 + 17 * 1.6 + 28, 5);
    expect(plan.mediaY).toBeCloseTo(64 + 17 * 1.6 + 56, 5);
    expect(plan.bodyY).toBe(plan.mediaY);
    expect(plan.footerDividerY).toBeCloseTo(plan.bodyY + 20 * 1.75 + 48, 5);
    expect(plan.footerY).toBeCloseTo(plan.footerDividerY! + 20, 5);
    // The height keeps the web card's exact formula (see planShareCard).
    expect(plan.height).toBe(Math.ceil(64 + 17 * 1.6 + 28 + 20 * 1.75 + 48 + 12 * 1.5 + 20 + 64));
  });

  it("omits the question and footer positions when they are absent", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Hello" }] }),
    )!;
    const plan = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure);
    expect(plan.questionDividerY).toBeNull();
    expect(plan.footerDividerY).toBeNull();
    expect(plan.footerY).toBeNull();
    expect(plan.mediaY).toBe(64);
    expect(plan.bodyY).toBe(64);
  });
});

describe("shareCardMediaRect", () => {
  it("returns null when the card has no picture area", () => {
    const content = shareCardContentFromMessage(
      message({ blocks: [{ kind: "text", text: "Hello" }] }),
    )!;
    const plan = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure);
    expect(shareCardMediaRect(plan, 800, 600)).toBeNull();
    expect(shareCardMediaRect(plan, 0, 0)).toBeNull();
  });

  it("fits a wide picture across the content width", () => {
    const content = shareCardContentFromMessage(
      message({
        blocks: [
          { kind: "text", text: "A mountain" },
          { kind: "image", artifactId: "a_1", mimeType: "image/png", name: "m.png" },
        ],
      }),
    )!;
    const plan = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure, 16 / 9);
    const rect = shareCardMediaRect(plan, 1600, 900)!;
    expect(rect.y).toBe(plan.mediaY);
    expect(rect.x).toBeCloseTo(76, 5);
    expect(rect.width).toBeCloseTo(928, 5);
    expect(rect.height).toBeCloseTo(plan.mediaHeight, 5);
  });

  it("centers a tall picture inside the picture area", () => {
    const content = shareCardContentFromMessage(
      message({
        blocks: [
          { kind: "text", text: "A tower" },
          { kind: "image", artifactId: "a_1", mimeType: "image/png", name: "t.png" },
        ],
      }),
    )!;
    const plan = planShareCard(content, DEFAULT_SHARE_CARD_STYLE, measure, 16 / 9);
    const rect = shareCardMediaRect(plan, 900, 1600)!;
    expect(rect.height).toBeCloseTo(plan.mediaHeight, 5);
    expect(rect.width).toBeLessThan(928);
    expect(rect.x).toBeCloseTo(76 + (928 - rect.width) / 2, 5);
  });
});

describe("estimateShareCardTextWidth", () => {
  it("measures a CJK character as exactly one em", () => {
    expect(estimateShareCardTextWidth("山", 20, "serif")).toBeCloseTo(20 * 1.06, 5);
    expect(estimateShareCardTextWidth("山水", 20, "serif")).toBeCloseTo(40 * 1.06, 5);
  });

  it("never measures below zero and grows with the text", () => {
    expect(estimateShareCardTextWidth("", 20, "sans")).toBe(0);
    const short = estimateShareCardTextWidth("abc", 20, "sans");
    const long = estimateShareCardTextWidth("abcdef", 20, "sans");
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("over-measures Latin prose rather than under-measuring it", () => {
    // 0.6em per letter plus the margin stays above a plain 0.5em measure.
    expect(estimateShareCardTextWidth("Hello", 20, "sans")).toBeGreaterThan(5 * 20 * 0.5);
  });
});
