import type { MessageBlock } from "@rakazo_mickvvw/contracts";
import { splitTrailingMark } from "./media-mark.js";
import { redactShareText } from "./share-redaction.js";
import type { LiveThreadMessage } from "./thread-snapshot-events.js";

/** A share card is 1080px wide, whatever its height. */
export const SHARE_CARD_WIDTH = 1080;
/** The card's side padding; the plan and every renderer read this one number. */
export const SHARE_CARD_PADDING = 76;
const CONTENT_WIDTH = SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;

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
 * The text a card shows instead of the reply's own words: a translation the
 * reader is looking at. The model names who wrote the visible text.
 */
export type ShareCardTextOverride = {
  text: string;
  model?: string;
};

/**
 * A video's length as m:ss, for the play mark on a video card. The seconds
 * come from the video element, not the message.
 */
export function formatShareCardDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The card for one reply: its text (the trailing "当前模型:" line split off
 * into `model`), its picture when it has one, its video when it has one.
 * Nothing else in the message reaches a card. A text override swaps the body
 * for what the reader is looking at — a translation — while the picture,
 * question, and date stay the reply's own.
 */
export function shareCardContentFromMessage(
  message: LiveThreadMessage,
  question?: string,
  textOverride?: ShareCardTextOverride,
): ShareCardContent | null {
  const rawText = textOverride
    ? textOverride.text.trim()
    : message.blocks
        .map((block) => {
          if (block.kind === "text" || block.kind === "progress" || block.kind === "ask")
            return block.text;
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
  const split = splitTrailingMark(rawText);
  const text = redactShareText((split?.text ?? rawText).trim());
  const model = textOverride?.model ?? messageModel(message) ?? split?.mark.modelId ?? undefined;
  const date = message.createdAt?.slice(0, 10);
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

function messageModel(message: LiveThreadMessage): string | undefined {
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

function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

/**
 * A canvas-free width estimate for callers without a canvas (the native app):
 * every CJK-wide character is one em, Latin letters and digits a conservative
 * 0.6em, spaces 0.3em, other ASCII 0.5em, combining marks nothing, plus a 6%
 * margin. It over-measures Latin prose a little, so lines wrap early rather
 * than overflowing the card; Chinese text, the common case, measures exactly.
 */
export function estimateShareCardTextWidth(text: string, px: number, _font: ShareCardFont): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x20) {
      units += 0.3;
      continue;
    }
    if (isCombiningMark(code)) continue;
    if (isWideChar(code)) {
      units += 1;
      continue;
    }
    if (code < 0x7f) {
      units += /[A-Za-z0-9]/.test(char) ? 0.6 : 0.5;
      continue;
    }
    units += 0.6;
  }
  return units * px * 1.06;
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
  /** Top of the question lines; null when the card has no question. */
  questionY: number;
  /** The rule under the question; null when the card has no question. */
  questionDividerY: number | null;
  /** Top of the picture area. */
  mediaY: number;
  /** Top of the body lines. */
  bodyY: number;
  /** The rule above the footer; null when the card has no footer. */
  footerDividerY: number | null;
  /** Top of the footer line; null when the card has no footer. */
  footerY: number | null;
};

/**
 * Where every line goes, from the text alone: the preview and the PNG draw
 * from the same plan, so what is downloaded is what was shown. The plan
 * carries every section's y, so the web canvas and the native WebView draw
 * the same card from the same numbers instead of each keeping its own copy
 * of the layout.
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
  const questionY = 64;
  const questionDividerY =
    questionLines.length > 0 ? questionY + questionLines.length * questionPx * 1.6 + 28 : null;
  const mediaY = questionDividerY !== null ? questionDividerY + 28 : 64;
  const bodyY = mediaY + (mediaHeight > 0 ? mediaHeight + 24 : 0);
  const footerDividerY = footer ? bodyY + bodyLines.length * style.fontSize * 1.75 + 48 : null;
  const footerY = footerDividerY !== null ? footerDividerY + 20 : null;
  // The height keeps the web card's exact formula: the question block counts
  // 28 once here, while the draw puts a 28 gap on both sides of its divider,
  // so a card with a question ends up with 36px of bottom padding instead of
  // 64. The content still fits; changing the height would resize every
  // existing card, so the quirk stays until the layout is deliberately revised.
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
    questionY,
    questionDividerY,
    mediaY,
    bodyY,
    footerDividerY,
    footerY,
  };
}

/** The picture's drawn rectangle, in card coordinates. */
export type ShareCardMediaRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Where the picture lands on the card, from the plan and the picture's own
 * size — the same fit `drawShareCard` uses, so a tap inside this rectangle
 * is a tap on the picture. Null when the card has no picture area.
 */
export function shareCardMediaRect(
  plan: ShareCardPlan,
  naturalWidth: number,
  naturalHeight: number,
): ShareCardMediaRect | null {
  if (plan.mediaHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(CONTENT_WIDTH / naturalWidth, plan.mediaHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: SHARE_CARD_PADDING + (CONTENT_WIDTH - width) / 2,
    y: plan.mediaY,
    width,
    height,
  };
}

export function shareCardFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").slice(0, 13);
  return `share-card-${stamp}.png`;
}
