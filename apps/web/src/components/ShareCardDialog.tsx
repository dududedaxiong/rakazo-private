import { Trans, useLingui } from "@lingui/react/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@rakazo/ui-web";
import { Download, ImagePlus, RotateCcw, X, ZoomIn } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactTarget } from "../lib/artifact-open.js";
import type { ShareCardStyle, ShareCardTextOverride } from "../lib/share-card.js";
import {
  DEFAULT_SHARE_CARD_STYLE,
  downloadBlob,
  drawShareCard,
  planShareCard,
  SHARE_CARD_FONT_SIZE_MAX,
  SHARE_CARD_FONT_SIZE_MIN,
  SHARE_CARD_PRESETS,
  SHARE_CARD_WIDTH,
  shareCardContentFromMessage,
  shareCardFilename,
  shareCardFont,
  shareCardMediaRect,
  shareCardToBlob,
} from "../lib/share-card.js";
import { useArtifactImage } from "../lib/use-artifact-image.js";

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ShareCardDialog({
  message,
  question,
  textOverride,
  artifactTarget,
  open,
  onOpenChange,
}: {
  message: ThreadMessage;
  question?: string;
  /** The text actually on screen, e.g. a shown translation, in place of the reply. */
  textOverride?: ShareCardTextOverride;
  artifactTarget: ArtifactTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const content = useMemo(
    () => shareCardContentFromMessage(message, question, textOverride),
    [message, question, textOverride],
  );
  const [style, setStyle] = useState<ShareCardStyle>(DEFAULT_SHARE_CARD_STYLE);
  const [presetId, setPresetId] = useState("rice");
  const [showQuestion, setShowQuestion] = useState(true);
  const [backgroundFile, setBackgroundFile] = useState<{ name: string; dataUrl: string } | null>(
    null,
  );
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [mediaImage, setMediaImage] = useState<HTMLImageElement | null>(null);
  const [durationLabel, setDurationLabel] = useState<string | undefined>(undefined);
  const [posterUrl, setPosterUrl] = useState<string | undefined>(undefined);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [previewBox, setPreviewBox] = useState<{
    width: number;
    left: number;
    top: number;
  } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const measureCanvas = useMemo(() => document.createElement("canvas"), []);
  const mediaSrc = useArtifactImage(
    artifactTarget,
    content?.artifactId ?? "",
    open && Boolean(content?.artifactId),
  );

  const shownContent = useMemo(
    () =>
      content && showQuestion ? content : content ? { ...content, question: undefined } : null,
    [content, showQuestion],
  );
  const shownContentWithDuration = useMemo(
    () => (shownContent && durationLabel ? { ...shownContent, durationLabel } : shownContent),
    [shownContent, durationLabel],
  );

  // The background picture is read locally and never uploaded.
  useEffect(() => {
    if (!backgroundFile) {
      setBackgroundImage(null);
      return;
    }
    const image = new Image();
    image.onload = () => setBackgroundImage(image);
    image.src = backgroundFile.dataUrl;
    return () => {
      image.onload = null;
    };
  }, [backgroundFile]);

  // The reply's picture, or the video's frame at one second in.
  useEffect(() => {
    setMediaImage(null);
    setDurationLabel(undefined);
    setPosterUrl(undefined);
    if (!mediaSrc || !content) return;
    if (content.kind === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        setDurationLabel(formatDuration(video.duration));
        video.currentTime = Math.min(1, Math.max(0, video.duration / 2));
      };
      video.onseeked = () => {
        const frame = document.createElement("canvas");
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        const frameCtx = frame.getContext("2d");
        if (!frameCtx) return;
        frameCtx.drawImage(video, 0, 0);
        const dataUrl = frame.toDataURL("image/png");
        const poster = new Image();
        poster.onload = () => setMediaImage(poster);
        poster.src = dataUrl;
        setPosterUrl(dataUrl);
      };
      video.src = mediaSrc;
      return () => {
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.removeAttribute("src");
      };
    }
    if (content.kind === "image") {
      const image = new Image();
      image.onload = () => setMediaImage(image);
      image.src = mediaSrc;
      return () => {
        image.onload = null;
      };
    }
  }, [mediaSrc, content]);

  // One plan feeds the preview, the picture's tap area, and the zoom cue.
  const plan = useMemo(() => {
    const measureCtx = measureCanvas.getContext("2d");
    if (!measureCtx || !shownContentWithDuration) return null;
    const measure = (text: string, px: number, font: "serif" | "sans") => {
      measureCtx.font = shareCardFont(px, font);
      return measureCtx.measureText(text).width;
    };
    const aspect =
      mediaImage && mediaImage.naturalWidth > 0
        ? mediaImage.naturalWidth / mediaImage.naturalHeight
        : undefined;
    return planShareCard(shownContentWithDuration, style, measure, aspect);
  }, [shownContentWithDuration, style, mediaImage, measureCanvas]);

  // The preview and the PNG draw from the same plan.
  useEffect(() => {
    const canvas = previewRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !plan || !shownContentWithDuration) return;
    canvas.width = plan.width;
    canvas.height = plan.height;
    drawShareCard(ctx, plan, shownContentWithDuration, style, {
      image: mediaImage,
      background: backgroundImage,
    });
  }, [plan, shownContentWithDuration, style, mediaImage, backgroundImage]);

  const mediaRect = useMemo(
    () =>
      plan && mediaImage
        ? shareCardMediaRect(plan, mediaImage.naturalWidth, mediaImage.naturalHeight)
        : null,
    [plan, mediaImage],
  );

  // Where the canvas sits on screen, so the zoom cue lands on the picture.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const measureBox = () =>
      setPreviewBox({
        width: canvas.clientWidth,
        left: canvas.offsetLeft,
        top: canvas.offsetTop,
      });
    measureBox();
    const observer = new ResizeObserver(measureBox);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [content]);

  // The picture itself, enlarged: the generated image, or the video's frame.
  const zoomUrl =
    content?.kind === "video"
      ? posterUrl
      : content?.kind === "image"
        ? (mediaSrc ?? undefined)
        : undefined;

  const openZoomAt = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = previewRef.current;
    if (!canvas || !mediaRect || !zoomUrl) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || canvas.width === 0) return;
    const scale = canvas.width / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    if (
      x >= mediaRect.x &&
      x <= mediaRect.x + mediaRect.width &&
      y >= mediaRect.y &&
      y <= mediaRect.y + mediaRect.height
    ) {
      setZoomOpen(true);
    }
  };

  const zoomCueStyle =
    mediaRect && zoomUrl && previewBox
      ? {
          left:
            previewBox.left +
            ((mediaRect.x + mediaRect.width) * previewBox.width) / SHARE_CARD_WIDTH -
            36,
          top:
            previewBox.top +
            ((mediaRect.y + mediaRect.height) * previewBox.width) / SHARE_CARD_WIDTH -
            36,
        }
      : undefined;

  if (!content) return null;

  const applyPreset = (id: string) => {
    const preset = SHARE_CARD_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setPresetId(id);
    setStyle((current) => ({ ...preset.style, backgroundImage: current.backgroundImage }));
    setBackgroundFile(null);
  };

  const resetStyle = () => {
    setPresetId("rice");
    setStyle(DEFAULT_SHARE_CARD_STYLE);
    setBackgroundFile(null);
  };

  const pickBackground = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      setBackgroundFile({ name: file.name, dataUrl });
      setStyle((current) => ({ ...current, backgroundImage: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const download = async () => {
    const preview = previewRef.current;
    if (!preview) return;
    const blob = await shareCardToBlob(preview);
    if (blob) downloadBlob(blob, shareCardFilename());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Share card</Trans>
          </DialogTitle>
        </DialogHeader>
        <div className="relative flex justify-center rounded-2xl bg-muted p-4">
          <canvas
            ref={previewRef}
            width={SHARE_CARD_WIDTH}
            className={cn("w-full max-w-md rounded-lg", mediaRect ? "cursor-pointer" : "")}
            onClick={openZoomAt}
            aria-label={t`Share card preview`}
          />
          {mediaRect && zoomUrl && zoomCueStyle ? (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute rounded-full bg-black/60 text-white hover:bg-black/70"
              style={zoomCueStyle}
              onClick={() => setZoomOpen(true)}
              aria-label={t`Enlarge picture`}
            >
              <ZoomIn />
            </Button>
          ) : null}
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {SHARE_CARD_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant={presetId === preset.id ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(preset.id)}
              >
                {preset.id === "ink" ? t`Ink` : preset.id === "rice" ? t`Rice` : t`Rice paper`}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={resetStyle}>
              <RotateCcw />
              <Trans>Reset</Trans>
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-label">
              <Trans>Background</Trans>
              <input
                type="color"
                value={style.background}
                onChange={(event) =>
                  setStyle((current) => ({ ...current, background: event.target.value }))
                }
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-card"
                aria-label={t`Background color`}
              />
            </label>
            <label className="flex flex-col gap-1 text-label">
              <Trans>Text</Trans>
              <input
                type="color"
                value={style.text}
                onChange={(event) =>
                  setStyle((current) => ({ ...current, text: event.target.value }))
                }
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-card"
                aria-label={t`Text color`}
              />
            </label>
            <label className="flex flex-col gap-1 text-label">
              <Trans>Accent</Trans>
              <input
                type="color"
                value={style.accent}
                onChange={(event) =>
                  setStyle((current) => ({ ...current, accent: event.target.value }))
                }
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-card"
                aria-label={t`Accent color`}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-label">
            <span className="flex justify-between">
              <Trans>Font size</Trans>
              <span>{style.fontSize}px</span>
            </span>
            <input
              type="range"
              min={SHARE_CARD_FONT_SIZE_MIN}
              max={SHARE_CARD_FONT_SIZE_MAX}
              value={style.fontSize}
              onChange={(event) =>
                setStyle((current) => ({ ...current, fontSize: Number(event.target.value) }))
              }
              aria-label={t`Font size`}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={style.font === "serif" ? "default" : "outline"}
              size="sm"
              onClick={() => setStyle((current) => ({ ...current, font: "serif" }))}
            >
              <Trans>Serif</Trans>
            </Button>
            <Button
              type="button"
              variant={style.font === "sans" ? "default" : "outline"}
              size="sm"
              onClick={() => setStyle((current) => ({ ...current, font: "sans" }))}
            >
              <Trans>Sans-serif</Trans>
            </Button>
          </div>
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => pickBackground(event.target.files?.[0])}
            />
            {backgroundFile ? (
              <div className="flex items-center gap-2">
                <img
                  src={backgroundFile.dataUrl}
                  alt=""
                  className="h-10 w-10 rounded-md object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
                  {backgroundFile.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setBackgroundFile(null);
                    setStyle((current) => ({ ...current, backgroundImage: null }));
                  }}
                  aria-label={t`Remove background image`}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus />
                <Trans>Upload background image</Trans>
              </Button>
            )}
            {style.backgroundImage ? (
              <label className="flex flex-col gap-1 text-label">
                <span className="flex justify-between">
                  <Trans>Background opacity</Trans>
                  <span>{style.backgroundOpacity}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={style.backgroundOpacity}
                  onChange={(event) =>
                    setStyle((current) => ({
                      ...current,
                      backgroundOpacity: Number(event.target.value),
                    }))
                  }
                  aria-label={t`Background opacity`}
                />
              </label>
            ) : null}
          </div>
          {question ? (
            <div className="flex items-center gap-2 text-body">
              <Switch
                checked={showQuestion}
                onCheckedChange={setShowQuestion}
                aria-label={t`Include the question`}
              />
              <Trans>Include the question</Trans>
            </div>
          ) : null}
          <Button type="button" onClick={download} className="w-full">
            <Download />
            <Trans>Download PNG</Trans>
          </Button>
        </div>
      </DialogContent>
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="sr-only">
              <Trans>Picture</Trans>
            </DialogTitle>
          </DialogHeader>
          {zoomUrl ? (
            <img src={zoomUrl} alt="" className="max-h-[75vh] w-full rounded-lg object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
