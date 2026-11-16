import type { MessageBlock, ThreadMessage } from "@rakazo/contracts";
import { redactShareText } from "@rakazo/core";
import { splitTrailingMark } from "./media-mark.js";

/** A share card is 1080px wide, whatever its height. */
export const SHARE_CARD_WIDTH = 1080;
const CARD_PADDING = 76;
const CONTENT_WIDTH = SHARE_CARD_WIDTH - CARD_PADDING * 2;

export type ShareCardFont = "serif" | "sans";

export type ShareCardStyle = {
  background: string;
  text: string;
  accent: string;
  /** Body size in px; the question and labels scale from it. */
  fontSize: number;
  font: ShareCardFont;
  /** A local picture under the text, as a data URL; never uploaded. */
  backgroundImage: string | null;
  /** How much of the background picture shows, 0–100. */
  backgroundOpacity: number;
};

export const SHARE_CARD_FONT_SIZE_MIN = 14;
export const SHARE_CARD_FONT_SIZE_MAX = 26;

export const DEFAULT_SHARE_CARD_STYLE: ShareCardStyle = {
  background: "#faf7f0",
  text: "#1a1a1a",
  accent: "#8a7d5c",
  fontSize: 20,
  font: "serif",
  backgroundImage: null,
  backgroundOpacity: 35,
};

/** Card themes; the dialog names them, the canvas only reads colors. */
export const SHARE_CARD_PRESETS: { id: string; style: ShareCardStyle }[] = [
  {
    id: "ink",
    style: {
      background: "#17171a",
      text: "#f2ede3",
      accent: "#c9a86a",
      fontSize: 20,
      font: "serif",
      backgroundImage: null,
      backgroundOpacity: 35,
    },
  },
  { id: "rice", style: { ...DEFAULT_SHARE_CARD_STYLE } },
  {
    id: "paper",
    style: {
      background: "#f0e6d2",
      text: "#2b2620",
      accent: "#a34d2d",
      fontSize: 20,
      font: "serif",
      backgroundImage: null,
      backgroundOpacity: 35,
    },
  },
];

export type ShareCardContent = {
  kind: "text" | "image" | "video";
  /** The question this reply answers, shown above it when present. */
  question?: string;
  text: string;
  model?: string;
  imageName?: string;
  /** The artifact to draw for an image or video card. */
  artifactId?: string;
  /** The prompt behind a generated picture, when the question names it. */
  prompt?: string;
  /** e.g. "0:10"; read off the video element, not the message. */
  durationLabel?: string;
  /** The reply's date, YYYY-MM-DD, for the card footer. */
  date?: string;
};

/**
 * The card for one reply: its text (the trailing "当前模型:" line split off
 * into `model`), its picture when it has one, its video when it has one.
 * Nothing else in the message reaches a card.
 */
export function shareCardContentFromMessage(
  message: ThreadMessage,
  question?: string,
): ShareCardContent | null {
  const textBlocks = message.blocks
    .map((block) => {
      if (block.kind === "text" || block.kind === "progress" || block.kind === "ask")
        return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  const split = splitTrailingMark(textBlocks);
  const text = redactShareText((split?.text ?? textBlocks).trim());
  const model = messageModel(message) ?? split?.mark.modelId ?? undefined;
  const date = message.createdAt.slice(0, 10);
  const image = message.blocks.find(
    (block): block is Extract<MessageBlock, { kind: "image" }> => block.kind === "image",
  );
  const video = message.blocks.find(
    (block): block is Extract<MessageBlock, { kind: "file" }> =>
      block.kind === "file" && block.mimeType.startsWith("video/"),
  );
  const imageFile = message.blocks.find(
    (block): block is Extract<MessageBlock, { kind: "file" }> =>
      block.kind === "file" && block.mimeType.startsWith("image/"),
  );
  if (image || imageFile) {
    const name = image?.name ?? imageFile?.name ?? "";
    return {
      kind: "image",
      ...(question ? { question: redactShareText(question) } : {}),
      text,
      ...(model ? { model } : {}),
      imageName: name,
      artifactId: image?.artifactId ?? imageFile?.artifactId,
      ...(question ? { prompt: redactShareText(question) } : {}),
      date,
    };
  }
  if (video) {
    return {
      kind: "video",
      ...(question ? { question: redactShareText(question) } : {}),
      text,
      ...(model ? { model } : {}),
      imageName: video.name,
      artifactId: video.artifactId,
      date,
    };
  }
  if (!text) return null;
  return {
    kind: "text",
    ...(question ? { question: redactShareText(question) } : {}),
    text,
    ...(model ? { model } : {}),
    date,
  };
}

function messageModel(message: ThreadMessage): string | undefined {
  const switches = message.modelSwitches;
  if (!switches) return undefined;
  const winner = switches.attempts.find((attempt) => attempt.outcome === "succeeded");
  return winner?.provider ? `${switches.finalModel} (${winner.provider})` : switches.finalModel;
}

/** Width of `text` at `px` in `font`, supplied by the caller's canvas. */
export type ShareCardMeasure = (text: string, px: number, font: ShareCardFont) => number;

export function shareCardFont(px: number, font: ShareCardFont, weight = 400): string {
  const family =
    font === "serif"
      ? '"Songti SC", "Noto Serif CJK SC", serif'
      : '"PingFang SC", "Noto Sans CJK SC", sans-serif';
  return `${weight} ${px}px ${family}`;
}

/**
 * Lines of `text` that fit `maxWidth`, wrapping one character at a time so
 * Chinese prose without spaces still wraps. Blank lines stay blank.
 */
export function wrapShareCardLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const char of paragraph) {
      const next = line + char;
      if (line !== "" && measure(next) > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

export type ShareCardPlan = {
  width: number;
  height: number;
  questionLines: string[];
  bodyLines: string[];
  /** Height of the picture area, 0 when the card has no picture. */
  mediaHeight: number;
  footer: string | null;
};

/**
 * Where every line goes, from the text alone: the preview and the PNG draw
 * from the same plan, so what is downloaded is what was shown.
 */
export function planShareCard(
  content: ShareCardContent,
  style: ShareCardStyle,
  measure: ShareCardMeasure,
  mediaAspect?: number,
): ShareCardPlan {
  const questionPx = Math.round(style.fontSize * 0.85);
  const labelPx = Math.round(style.fontSize * 0.62);
  const questionLines = content.question
    ? wrapShareCardLines(
        (text) => measure(text, questionPx, style.font),
        content.question,
        CONTENT_WIDTH,
      )
    : [];
  const bodyLines = wrapShareCardLines(
    (text) => measure(text, style.fontSize, style.font),
    content.text,
    CONTENT_WIDTH,
  );
  const mediaHeight =
    mediaAspect && mediaAspect > 0 ? Math.min(Math.round(CONTENT_WIDTH / mediaAspect), 860) : 0;
  const footer = content.model ? `当前模型: ${content.model}` : null;
  let height = 64;
  if (questionLines.length > 0) height += questionLines.length * questionPx * 1.6 + 28;
  if (mediaHeight > 0) height += mediaHeight + 24;
  height += bodyLines.length * style.fontSize * 1.75;
  height += 48;
  if (footer) height += labelPx * 1.5 + 20;
  height += 64;
  return {
    width: SHARE_CARD_WIDTH,
    height: Math.ceil(height),
    questionLines,
    bodyLines,
    mediaHeight,
    footer,
  };
}

/** Draws `content` on `ctx` from `plan`; `media` is the picture or video frame. */
export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  plan: ShareCardPlan,
  content: ShareCardContent,
  style: ShareCardStyle,
  media?: { image: HTMLImageElement | null; background?: HTMLImageElement | null },
): void {
  const { width, height } = plan;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (media?.background) {
    ctx.save();
    ctx.globalAlpha = style.backgroundOpacity / 100;
    drawCover(ctx, media.background, width, height);
    ctx.restore();
  }
  let y = 64;
  const questionPx = Math.round(style.fontSize * 0.85);
  const labelPx = Math.round(style.fontSize * 0.62);
  if (plan.questionLines.length > 0) {
    ctx.font = shareCardFont(questionPx, style.font);
    ctx.fillStyle = style.text;
    ctx.globalAlpha = 0.62;
    ctx.textBaseline = "top";
    for (const line of plan.questionLines) {
      ctx.fillText(line, CARD_PADDING, y);
      y += questionPx * 1.6;
    }
    ctx.globalAlpha = 1;
    y += 28;
    ctx.strokeStyle = style.accent;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(CARD_PADDING, y);
    ctx.lineTo(width - CARD_PADDING, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    y += 28;
  }
  if (plan.mediaHeight > 0 && media?.image) {
    const image = media.image;
    const scale = Math.min(
      CONTENT_WIDTH / image.naturalWidth,
      plan.mediaHeight / image.naturalHeight,
    );
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const x = CARD_PADDING + (CONTENT_WIDTH - drawWidth) / 2;
    roundRect(ctx, x, y, drawWidth, drawHeight, 24);
    ctx.save();
    ctx.clip();
    ctx.drawImage(image, x, y, drawWidth, drawHeight);
    ctx.restore();
    if (content.kind === "video") {
      drawPlayBadge(ctx, x + drawWidth / 2, y + drawHeight / 2);
      if (content.durationLabel) {
        ctx.font = shareCardFont(labelPx, style.font, 600);
        const label = content.durationLabel;
        const labelWidth = ctx.measureText(label).width + 28;
        const badgeX = x + drawWidth - labelWidth - 16;
        const badgeY = y + drawHeight - labelPx - 32;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        roundRect(ctx, badgeX, badgeY, labelWidth, labelPx + 16, labelPx);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, badgeX + 14, badgeY + (labelPx + 16) / 2);
      }
    }
    y += plan.mediaHeight + 24;
  }
  ctx.font = shareCardFont(style.fontSize, style.font);
  ctx.fillStyle = style.text;
  ctx.textBaseline = "top";
  for (const line of plan.bodyLines) {
    if (line !== "") ctx.fillText(line, CARD_PADDING, y);
    y += style.fontSize * 1.75;
  }
  y += 48;
  if (plan.footer) {
    ctx.strokeStyle = style.accent;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(CARD_PADDING, y);
    ctx.lineTo(width - CARD_PADDING, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = shareCardFont(labelPx, style.font);
    ctx.fillStyle = style.accent;
    ctx.textBaseline = "top";
    ctx.fillText(plan.footer, CARD_PADDING, y + 20);
    const date = content.date ?? new Date().toISOString().slice(0, 10);
    const dateWidth = ctx.measureText(date).width;
    ctx.fillText(date, width - CARD_PADDING - dateWidth, y + 20);
  }
  ctx.restore();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawPlayBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy - 26);
  ctx.lineTo(cx - 16, cy + 26);
  ctx.lineTo(cx + 28, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The card as a PNG blob, ready to download or hand to the system share sheet. */
export function shareCardToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function shareCardFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").slice(0, 13);
  return `share-card-${stamp}.png`;
}
