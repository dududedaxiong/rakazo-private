import type { ShareCardContent, ShareCardPlan, ShareCardStyle } from "@rakazo_mickvvw/core";
import { SHARE_CARD_PADDING, SHARE_CARD_WIDTH, shareCardFont } from "@rakazo_mickvvw/core";

/** Long enough for a local canvas draw plus image decode on a slow phone. */
export const SHARE_CARD_RENDER_TIMEOUT_MS = 15_000;

/** Largest PNG data URL the renderer may post back; a tall card stays far below this. */
export const MAX_SHARE_CARD_PNG_DATA_URL_LENGTH = 32_000_000;

export type ShareCardRenderMedia = {
  /** The picture as a data URL; never uploaded anywhere. */
  dataUrl: string;
  width: number;
  height: number;
};

export type ShareCardRenderInput = {
  plan: ShareCardPlan;
  content: ShareCardContent;
  /** The style to draw; backgroundImage must be null, the picture travels as `background`. */
  style: ShareCardStyle;
  /** Resolved canvas fonts, so the page never repeats the font stacks. */
  fonts: { question: string; body: string; label: string; labelBold: string };
  sizes: { question: number; body: number; label: number };
  today: string;
  media?: ShareCardRenderMedia | null;
  background?: ShareCardRenderMedia | null;
};

/**
 * The render input for one card: the plan and content plus the fonts and
 * sizes the page draws with. The background picture travels separately from
 * the style so its data URL is not duplicated in the JSON.
 */
export function buildShareCardRenderInput({
  plan,
  content,
  style,
  media,
  background,
  today = new Date().toISOString().slice(0, 10),
}: {
  plan: ShareCardPlan;
  content: ShareCardContent;
  style: ShareCardStyle;
  media?: ShareCardRenderMedia | null;
  background?: ShareCardRenderMedia | null;
  today?: string;
}): ShareCardRenderInput {
  const questionPx = Math.round(style.fontSize * 0.85);
  const labelPx = Math.round(style.fontSize * 0.62);
  return {
    plan,
    content,
    style: { ...style, backgroundImage: null },
    fonts: {
      question: shareCardFont(questionPx, style.font),
      body: shareCardFont(style.fontSize, style.font),
      label: shareCardFont(labelPx, style.font),
      labelBold: shareCardFont(labelPx, style.font, 600),
    },
    sizes: { question: questionPx, body: style.fontSize, label: labelPx },
    today,
    ...(media ? { media } : {}),
    ...(background ? { background } : {}),
  };
}

export function shareCardPadding(): number {
  return SHARE_CARD_PADDING;
}

export function shareCardContentWidth(): number {
  return SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The page a card is drawn in. Its policy allows no requests at all — the
 * pictures arrive as data URLs in the injected script — and no frames, forms,
 * or fonts; it is loaded as `about:blank` HTML, so it has none of the app's
 * cookies or storage either. Mirrors the diagram page in mermaid-webview.
 */
export function shareCardDocument(): string {
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`,
    "<style>html,body{margin:0;padding:0;background:transparent}canvas{display:block}</style>",
    '</head><body><canvas id="card"></canvas></body></html>',
  ].join("");
}

/**
 * Runs in the page once it loads (native injection, which the page's policy
 * does not block). Draws the card on the canvas from the plan — the same
 * positions the web canvas draws from — then posts the PNG back as a data
 * URL, or `failed` so the sheet can say so instead of hanging.
 */
export function shareCardBootScript(input: ShareCardRenderInput): string {
  return `(function () {
  var post = function (message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  var fail = function () { post({ type: "failed" }); };
  var input = ${JSON.stringify(input)};
  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("image failed to load")); };
      image.src = dataUrl;
    });
  }
  function roundRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
  function drawCover(ctx, image, width, height) {
    var scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    var drawWidth = image.naturalWidth * scale;
    var drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }
  function drawPlayBadge(ctx, cx, cy) {
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
  Promise.all([
    input.media ? loadImage(input.media.dataUrl) : Promise.resolve(null),
    input.background ? loadImage(input.background.dataUrl) : Promise.resolve(null),
  ]).then(function (images) {
    var mediaImage = images[0];
    var backgroundImage = images[1];
    var plan = input.plan;
    var content = input.content;
    var style = input.style;
    var padding = ${SHARE_CARD_PADDING};
    var contentWidth = ${SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2};
    var canvas = document.getElementById("card");
    canvas.width = plan.width;
    canvas.height = plan.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return fail();
    try {
      ctx.save();
      ctx.clearRect(0, 0, plan.width, plan.height);
      ctx.fillStyle = style.background;
      ctx.fillRect(0, 0, plan.width, plan.height);
      if (backgroundImage) {
        ctx.save();
        ctx.globalAlpha = style.backgroundOpacity / 100;
        drawCover(ctx, backgroundImage, plan.width, plan.height);
        ctx.restore();
      }
      var questionPx = input.sizes.question;
      var labelPx = input.sizes.label;
      var shift = plan.mediaHeight > 0 && !mediaImage ? plan.mediaHeight + 24 : 0;
      if (plan.questionLines.length > 0) {
        ctx.font = input.fonts.question;
        ctx.fillStyle = style.text;
        ctx.globalAlpha = 0.62;
        ctx.textBaseline = "top";
        var y = plan.questionY;
        for (var i = 0; i < plan.questionLines.length; i++) {
          ctx.fillText(plan.questionLines[i], padding, y);
          y += questionPx * 1.6;
        }
        ctx.globalAlpha = 1;
        if (plan.questionDividerY !== null) {
          ctx.strokeStyle = style.accent;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(padding, plan.questionDividerY);
          ctx.lineTo(plan.width - padding, plan.questionDividerY);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      if (plan.mediaHeight > 0 && mediaImage) {
        var scale = Math.min(
          contentWidth / mediaImage.naturalWidth,
          plan.mediaHeight / mediaImage.naturalHeight,
        );
        var drawWidth = mediaImage.naturalWidth * scale;
        var drawHeight = mediaImage.naturalHeight * scale;
        var x = padding + (contentWidth - drawWidth) / 2;
        roundRectPath(ctx, x, plan.mediaY, drawWidth, drawHeight, 24);
        ctx.save();
        ctx.clip();
        ctx.drawImage(mediaImage, x, plan.mediaY, drawWidth, drawHeight);
        ctx.restore();
        if (content.kind === "video") {
          drawPlayBadge(ctx, x + drawWidth / 2, plan.mediaY + drawHeight / 2);
          if (content.durationLabel) {
            ctx.font = input.fonts.labelBold;
            var labelWidth = ctx.measureText(content.durationLabel).width + 28;
            var badgeX = x + drawWidth - labelWidth - 16;
            var badgeY = plan.mediaY + drawHeight - labelPx - 32;
            ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
            roundRectPath(ctx, badgeX, badgeY, labelWidth, labelPx + 16, labelPx);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(content.durationLabel, badgeX + 14, badgeY + (labelPx + 16) / 2);
          }
        }
      }
      ctx.font = input.fonts.body;
      ctx.fillStyle = style.text;
      ctx.textBaseline = "top";
      var bodyY = plan.bodyY - shift;
      for (var j = 0; j < plan.bodyLines.length; j++) {
        if (plan.bodyLines[j] !== "") ctx.fillText(plan.bodyLines[j], padding, bodyY);
        bodyY += input.sizes.body * 1.75;
      }
      if (plan.footer && plan.footerDividerY !== null && plan.footerY !== null) {
        var dividerY = plan.footerDividerY - shift;
        var footerY = plan.footerY - shift;
        ctx.strokeStyle = style.accent;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(padding, dividerY);
        ctx.lineTo(plan.width - padding, dividerY);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = input.fonts.label;
        ctx.fillStyle = style.accent;
        ctx.textBaseline = "top";
        ctx.fillText(plan.footer, padding, footerY);
        var date = content.date || input.today;
        var dateWidth = ctx.measureText(date).width;
        ctx.fillText(date, plan.width - padding - dateWidth, footerY);
      }
      ctx.restore();
      canvas.toBlob(function (blob) {
        if (!blob) return fail();
        var reader = new FileReader();
        reader.onload = function () { post({ type: "done", dataUrl: reader.result }); };
        reader.onerror = fail;
        reader.readAsDataURL(blob);
      }, "image/png");
    } catch (error) { fail(); }
  }).catch(fail);
})();
true;`;
}

export type ShareCardRenderMessage = { type: "done"; dataUrl: string } | { type: "failed" };

export function parseShareCardMessage(data: string): ShareCardRenderMessage | null {
  try {
    const message = JSON.parse(data) as { type?: unknown; dataUrl?: unknown };
    if (message.type === "failed") return { type: "failed" };
    if (
      message.type === "done" &&
      typeof message.dataUrl === "string" &&
      message.dataUrl.startsWith("data:image/png;base64,") &&
      message.dataUrl.length <= MAX_SHARE_CARD_PNG_DATA_URL_LENGTH
    ) {
      return { type: "done", dataUrl: message.dataUrl };
    }
  } catch {
    // Not a message this page sends.
  }
  return null;
}
