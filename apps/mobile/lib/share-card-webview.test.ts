import type { ShareCardContent, ShareCardPlan, ShareCardStyle } from "@rakazo_mickvvw/core";
import {
  DEFAULT_SHARE_CARD_STYLE,
  estimateShareCardTextWidth,
  planShareCard,
} from "@rakazo_mickvvw/core";
import { describe, expect, it } from "vitest";
import {
  buildShareCardRenderInput,
  MAX_SHARE_CARD_PNG_DATA_URL_LENGTH,
  parseShareCardMessage,
  shareCardBootScript,
  shareCardDocument,
} from "./share-card-webview";

const style: ShareCardStyle = DEFAULT_SHARE_CARD_STYLE;
const content: ShareCardContent = {
  kind: "text",
  question: "What is this?",
  text: "Here is the plan",
  model: "model-a",
  date: "2026-11-16",
};
const plan: ShareCardPlan = planShareCard(content, style, estimateShareCardTextWidth);

describe("shareCardDocument", () => {
  it("is a blank page with one canvas and no outside requests", () => {
    const document = shareCardDocument();
    expect(document).toContain('<canvas id="card">');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("img-src data:");
    expect(document).not.toContain("<script");
    expect(document).not.toContain("http://");
    expect(document).not.toContain("https://");
  });
});

describe("buildShareCardRenderInput", () => {
  it("resolves the fonts and sizes from the style and strips the background picture", () => {
    const input = buildShareCardRenderInput({
      plan,
      content,
      style: { ...style, backgroundImage: "data:image/png;base64,AAA" },
      background: { dataUrl: "data:image/png;base64,AAA", width: 100, height: 50 },
    });
    expect(input.style.backgroundImage).toBeNull();
    expect(input.background?.dataUrl).toBe("data:image/png;base64,AAA");
    expect(input.fonts.body).toBe('400 20px "Songti SC", "Noto Serif CJK SC", serif');
    expect(input.fonts.question).toBe('400 17px "Songti SC", "Noto Serif CJK SC", serif');
    expect(input.sizes).toEqual({ question: 17, body: 20, label: 12 });
    expect(input.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shareCardBootScript", () => {
  it("is valid JavaScript that draws the plan and posts the PNG back", () => {
    const input = buildShareCardRenderInput({ plan, content, style });
    const script = shareCardBootScript(input);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("window.ReactNativeWebView.postMessage");
    expect(script).toContain("toBlob");
    expect(script).toContain('type: "done"');
    expect(script).toContain(JSON.stringify(plan.width));
    // The style travels with its picture stripped; the picture goes separately.
    expect(script).toContain('"backgroundImage":null');
  });

  it("carries the media and background pictures as data URLs", () => {
    const input = buildShareCardRenderInput({
      plan,
      content,
      style,
      media: { dataUrl: "data:image/jpeg;base64,AAA", width: 800, height: 600 },
      background: { dataUrl: "data:image/png;base64,BBB", width: 100, height: 50 },
    });
    const script = shareCardBootScript(input);
    expect(script).toContain("data:image/jpeg;base64,AAA");
    expect(script).toContain("data:image/png;base64,BBB");
  });
});

describe("parseShareCardMessage", () => {
  it("accepts a finished render", () => {
    expect(
      parseShareCardMessage(JSON.stringify({ type: "done", dataUrl: "data:image/png;base64,AAA" })),
    ).toEqual({ type: "done", dataUrl: "data:image/png;base64,AAA" });
  });

  it("accepts a failure", () => {
    expect(parseShareCardMessage(JSON.stringify({ type: "failed" }))).toEqual({
      type: "failed",
    });
  });

  it("rejects anything else, including an oversized data URL", () => {
    expect(parseShareCardMessage("not json")).toBeNull();
    expect(parseShareCardMessage(JSON.stringify({ type: "done" }))).toBeNull();
    expect(
      parseShareCardMessage(
        JSON.stringify({
          type: "done",
          dataUrl: `data:image/png;base64,${"A".repeat(MAX_SHARE_CARD_PNG_DATA_URL_LENGTH)}`,
        }),
      ),
    ).toBeNull();
  });
});
