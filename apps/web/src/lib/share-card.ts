import type { ShareCardContent, ShareCardPlan, ShareCardStyle } from "@rakazo/core";
import { SHARE_CARD_PADDING, SHARE_CARD_WIDTH, shareCardFont } from "@rakazo/core";

export {
  DEFAULT_SHARE_CARD_STYLE,
  estimateShareCardTextWidth,
  planShareCard,
  SHARE_CARD_FONT_SIZE_MAX,
  SHARE_CARD_FONT_SIZE_MIN,
  SHARE_CARD_PADDING,
  SHARE_CARD_PRESETS,
  SHARE_CARD_WIDTH,
  shareCardContentFromMessage,
  shareCardFilename,
  shareCardFont,
  wrapShareCardLines,
} from "@rakazo/core";
export type {
  ShareCardContent,
  ShareCardFont,
  ShareCardMeasure,
  ShareCardPlan,
  ShareCardStyle,
} from "@rakazo/core";

const CONTENT_WIDTH = SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;

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
  const questionPx = Math.round(style.fontSize * 0.85);
  const labelPx = Math.round(style.fontSize * 0.62);
  // When the picture has not loaded yet, the body and footer move up to fill its place.
  const shift = plan.mediaHeight > 0 && !media?.image ? plan.mediaHeight + 24 : 0;
  if (plan.questionLines.length > 0) {
    ctx.font = shareCardFont(questionPx, style.font);
    ctx.fillStyle = style.text;
    ctx.globalAlpha = 0.62;
    ctx.textBaseline = "top";
    let y = plan.questionY;
    for (const line of plan.questionLines) {
      ctx.fillText(line, SHARE_CARD_PADDING, y);
      y += questionPx * 1.6;
    }
    ctx.globalAlpha = 1;
    if (plan.questionDividerY !== null) {
      ctx.strokeStyle = style.accent;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(SHARE_CARD_PADDING, plan.questionDividerY);
      ctx.lineTo(width - SHARE_CARD_PADDING, plan.questionDividerY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  if (plan.mediaHeight > 0 && media?.image) {
    const image = media.image;
    const scale = Math.min(
      CONTENT_WIDTH / image.naturalWidth,
      plan.mediaHeight / image.naturalHeight,
    );
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const x = SHARE_CARD_PADDING + (CONTENT_WIDTH - drawWidth) / 2;
    roundRect(ctx, x, plan.mediaY, drawWidth, drawHeight, 24);
    ctx.save();
    ctx.clip();
    ctx.drawImage(image, x, plan.mediaY, drawWidth, drawHeight);
    ctx.restore();
    if (content.kind === "video") {
      drawPlayBadge(ctx, x + drawWidth / 2, plan.mediaY + drawHeight / 2);
      if (content.durationLabel) {
        ctx.font = shareCardFont(labelPx, style.font, 600);
        const label = content.durationLabel;
        const labelWidth = ctx.measureText(label).width + 28;
        const badgeX = x + drawWidth - labelWidth - 16;
        const badgeY = plan.mediaY + drawHeight - labelPx - 32;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        roundRect(ctx, badgeX, badgeY, labelWidth, labelPx + 16, labelPx);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, badgeX + 14, badgeY + (labelPx + 16) / 2);
      }
    }
  }
  ctx.font = shareCardFont(style.fontSize, style.font);
  ctx.fillStyle = style.text;
  ctx.textBaseline = "top";
  let y = plan.bodyY - shift;
  for (const line of plan.bodyLines) {
    if (line !== "") ctx.fillText(line, SHARE_CARD_PADDING, y);
    y += style.fontSize * 1.75;
  }
  if (plan.footer && plan.footerDividerY !== null && plan.footerY !== null) {
    const dividerY = plan.footerDividerY - shift;
    const footerY = plan.footerY - shift;
    ctx.strokeStyle = style.accent;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(SHARE_CARD_PADDING, dividerY);
    ctx.lineTo(width - SHARE_CARD_PADDING, dividerY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = shareCardFont(labelPx, style.font);
    ctx.fillStyle = style.accent;
    ctx.textBaseline = "top";
    ctx.fillText(plan.footer, SHARE_CARD_PADDING, footerY);
    const date = content.date ?? new Date().toISOString().slice(0, 10);
    const dateWidth = ctx.measureText(date).width;
    ctx.fillText(date, width - SHARE_CARD_PADDING - dateWidth, footerY);
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
