import type { MessageBlock } from "@rakazo/contracts";
import type { ShareCardStyle } from "@rakazo/core";
import {
  DEFAULT_SHARE_CARD_STYLE,
  estimateShareCardTextWidth,
  formatShareCardDuration,
  planShareCard,
  SHARE_CARD_FONT_SIZE_MAX,
  SHARE_CARD_FONT_SIZE_MIN,
  SHARE_CARD_PRESETS,
  SHARE_CARD_WIDTH,
  shareCardContentFromMessage,
  shareCardFilename,
} from "@rakazo/core";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, PanResponder, Pressable, Text, View } from "react-native";
import type { WebViewMessageEvent } from "react-native-webview";
import { WebView } from "react-native-webview";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactTarget } from "../lib/artifact-open";
import { shareLocalFile, videoArtifactUri } from "../lib/artifact-open";
import { useI18n } from "../lib/i18n";
import type { MobileMessage } from "../lib/mobile-types";
import type { ShareCardMediaInput } from "../lib/share-card-media";
import {
  saveShareCardPng,
  shareCardBackgroundInput,
  shareCardImageInput,
  shareCardVideoPoster,
} from "../lib/share-card-media";
import {
  buildShareCardRenderInput,
  parseShareCardMessage,
  SHARE_CARD_RENDER_TIMEOUT_MS,
  shareCardBootScript,
  shareCardDocument,
} from "../lib/share-card-webview";
import { BottomSheetShell } from "./bottom-sheet-shell";
import { NativeSwitch } from "./native-switch";

/**
 * Reads a local video's length through expo-video, the way the web reads it
 * off a <video> element, and reports it once as m:ss.
 */
function VideoDurationReader({
  uri,
  onDuration,
}: {
  uri: string;
  onDuration: (seconds: number) => void;
}) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.pause();
  });
  const duration = player.duration;
  const onDurationRef = useRef(onDuration);
  onDurationRef.current = onDuration;
  useEffect(() => {
    if (duration > 0) onDurationRef.current(duration);
  }, [duration]);
  return null;
}

/** A drag slider, the same PanResponder track the background sheet uses. */
function SliderRow({
  label,
  value,
  min,
  max,
  disabled,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const tokens = mobileTokens();
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (event) => {
        if (widthRef.current <= 0) return;
        onChangeRef.current(
          Math.round(min + (event.nativeEvent.locationX / widthRef.current) * (max - min)),
        );
      },
      onPanResponderMove: (event) => {
        if (widthRef.current <= 0) return;
        onChangeRef.current(
          Math.round(min + (event.nativeEvent.locationX / widthRef.current) * (max - min)),
        );
      },
    }),
  ).current;
  return (
    <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: tokens.foreground, fontSize: 15 }}>{label}</Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>{format(value)}</Text>
      </View>
      <View
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        {...responder.panHandlers}
        style={{ height: 28, justifyContent: "center" }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: tokens.muted }} />
        <View
          style={{
            position: "absolute",
            left: 0,
            width: `${ratio * 100}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: tokens.primary,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: `${ratio * 100}%`,
            width: 20,
            height: 20,
            marginLeft: -10,
            borderRadius: 10,
            backgroundColor: tokens.primary,
          }}
        />
      </View>
    </View>
  );
}

/** A row of colour dots; one per preset, so the card keeps the web's palette. */
function ColorRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (color: string) => void;
}) {
  const tokens = mobileTokens();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: tokens.foreground, fontSize: 15 }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {options.map((color) => (
          <Pressable
            key={color}
            accessibilityLabel={color}
            accessibilityRole="button"
            onPress={() => onChange(color)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: color,
              borderWidth: value === color ? 2 : 1,
              borderColor: value === color ? tokens.primary : tokens.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** The media block the card draws, with the mime type its download needs. */
function mediaBlockFor(message: MobileMessage, kind: "image" | "video") {
  if (kind === "image") {
    return (
      message.blocks.find(
        (block): block is Extract<MessageBlock, { kind: "image" }> => block.kind === "image",
      ) ??
      message.blocks.find(
        (block): block is Extract<MessageBlock, { kind: "file" }> =>
          block.kind === "file" && block.mimeType.startsWith("image/"),
      )
    );
  }
  return message.blocks.find(
    (block): block is Extract<MessageBlock, { kind: "file" }> =>
      block.kind === "file" && block.mimeType.startsWith("video/"),
  );
}

/**
 * Makes a 1080px PNG card from one bot reply, like the web hover menu's
 * "做成分享卡", and saves it into the app's Rakazo folder or hands it to the
 * system share sheet. The card is drawn in a hidden WebView on a canvas,
 * the same drawing code the web uses; the WebView never loads a network
 * page, and the style resets when the sheet opens, like the web dialog.
 */
export function ShareCardSheet({
  visible,
  onClose,
  message,
  previousUserMessageText,
  target,
}: {
  visible: boolean;
  onClose: () => void;
  message: MobileMessage;
  previousUserMessageText: string;
  target: MobileArtifactTarget;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [style, setStyle] = useState<ShareCardStyle>(DEFAULT_SHARE_CARD_STYLE);
  const [showQuestion, setShowQuestion] = useState(true);
  const [background, setBackground] = useState<ShareCardMediaInput | null>(null);
  const [media, setMedia] = useState<ShareCardMediaInput | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [durationLabel, setDurationLabel] = useState<string | undefined>(undefined);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renderNonce, setRenderNonce] = useState(0);
  const renderIdRef = useRef(0);
  const targetKey = "botId" in target ? `bot:${target.botId}` : `group:${target.groupId}`;

  const baseContent = useMemo(
    () => shareCardContentFromMessage(message, showQuestion ? previousUserMessageText : ""),
    [message, previousUserMessageText, showQuestion],
  );
  const content = useMemo(
    () => (baseContent && durationLabel ? { ...baseContent, durationLabel } : baseContent),
    [baseContent, durationLabel],
  );
  const plan = useMemo(
    () => (content ? planShareCard(content, style, estimateShareCardTextWidth) : null),
    [content, style],
  );
  const renderInput = useMemo(
    () =>
      content && plan
        ? buildShareCardRenderInput({
            plan,
            content,
            style,
            ...(media ? { media } : {}),
            ...(background ? { background } : {}),
          })
        : null,
    [content, plan, style, media, background],
  );

  // A fresh sheet starts from the default style, like the web dialog.
  useEffect(() => {
    if (!visible) return;
    setStyle(DEFAULT_SHARE_CARD_STYLE);
    setShowQuestion(true);
    setBackground(null);
    setMedia(null);
    setMediaReady(false);
    setVideoUri(null);
    setDurationLabel(undefined);
    setPreviewUri(null);
    setRendering(false);
    setRenderError(false);
  }, [visible]);

  // The reply's picture, or a video's frame, through the artifact cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible || !baseContent) return;
    let cancelled = false;
    setMedia(null);
    setVideoUri(null);
    setDurationLabel(undefined);
    if (baseContent.kind === "text") {
      setMediaReady(true);
      return;
    }
    setMediaReady(false);
    const block = mediaBlockFor(message, baseContent.kind);
    if (!block || !("artifactId" in block)) {
      setMediaReady(true);
      return;
    }
    if (baseContent.kind === "image") {
      shareCardImageInput(target, block.artifactId, block.mimeType)
        .then((input) => {
          if (cancelled) return;
          setMedia(input);
          setMediaReady(true);
        })
        .catch(() => {
          if (!cancelled) setMediaReady(true);
        });
    } else {
      videoArtifactUri(target, block.artifactId, block.mimeType)
        .then(async (uri) => {
          if (cancelled) return;
          setVideoUri(uri);
          const poster = await shareCardVideoPoster(uri);
          if (cancelled) return;
          setMedia(poster);
          setMediaReady(true);
        })
        .catch(() => {
          if (!cancelled) setMediaReady(true);
        });
    }
    return () => {
      cancelled = true;
    };
    // targetKey stands in for target: the sheet must not re-resolve its
    // media when the screen hands it a fresh object for the same thread.
  }, [visible, baseContent, message, targetKey]);

  // Re-draw shortly after the last change, so a slider drag draws once.
  useEffect(() => {
    if (!visible || !renderInput || !mediaReady) return;
    setRendering(true);
    setRenderError(false);
    const id = ++renderIdRef.current;
    const draw = setTimeout(() => setRenderNonce((nonce) => nonce + 1), 350);
    const guard = setTimeout(() => {
      if (renderIdRef.current === id) {
        setRendering(false);
        setRenderError(true);
      }
    }, 350 + SHARE_CARD_RENDER_TIMEOUT_MS);
    return () => {
      clearTimeout(draw);
      clearTimeout(guard);
    };
  }, [visible, renderInput, mediaReady]);

  const onWebViewMessage = (event: WebViewMessageEvent) => {
    const parsed = parseShareCardMessage(event.nativeEvent.data);
    if (!parsed || parsed.type === "failed") {
      setRendering(false);
      setRenderError(true);
      return;
    }
    setPreviewUri(parsed.dataUrl);
    setRendering(false);
    setRenderError(false);
  };

  const currentPreset = SHARE_CARD_PRESETS.find(
    (preset) =>
      preset.style.background === style.background &&
      preset.style.text === style.text &&
      preset.style.accent === style.accent &&
      preset.style.font === style.font &&
      preset.style.fontSize === style.fontSize,
  )?.id;

  const applyPreset = (id: string) => {
    const preset = SHARE_CARD_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setStyle(preset.style);
  };

  const resetStyle = () => {
    setStyle(DEFAULT_SHARE_CARD_STYLE);
    setBackground(null);
  };

  async function pickBackground() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      setBackground(await shareCardBackgroundInput(asset.uri, asset.mimeType ?? "image/jpeg"));
    } catch {
      Alert.alert(t("Could not load that file"), t("Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function saveAndShare(share: boolean) {
    if (!previewUri || busy) return;
    setBusy(true);
    try {
      const uri = await saveShareCardPng(previewUri);
      if (share) {
        await shareLocalFile(uri, "image/png", uri.split("/").pop() ?? shareCardFilename());
      } else {
        Alert.alert(t("Saved"), t("Saved to the Rakazo folder"));
      }
    } catch {
      Alert.alert(t("Could not save the card"), t("Try again."));
    } finally {
      setBusy(false);
    }
  }

  const presetColors = (field: "background" | "text" | "accent") => [
    ...new Set(SHARE_CARD_PRESETS.map((preset) => preset.style[field])),
  ];

  return (
    <BottomSheetShell visible={visible} label={t("Share card")} onClose={onClose}>
      {renderInput && mediaReady ? (
        <WebView
          key={renderNonce}
          source={{ html: shareCardDocument(), baseUrl: "" }}
          injectedJavaScript={shareCardBootScript(renderInput)}
          onMessage={onWebViewMessage}
          javaScriptEnabled
          originWhitelist={["*"]}
          scrollEnabled={false}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        />
      ) : null}
      {videoUri ? (
        <VideoDurationReader
          uri={videoUri}
          onDuration={(seconds) => setDurationLabel(formatShareCardDuration(seconds))}
        />
      ) : null}
      {!baseContent ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>
          {t("Nothing to share in this reply")}
        </Text>
      ) : (
        <>
          {renderError ? (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 12 }}>
              <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>
                {t("Could not render the card")}
              </Text>
              <Pressable
                onPress={() => {
                  setRenderError(false);
                  setRendering(true);
                  setRenderNonce((nonce) => nonce + 1);
                }}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t("Try again")}</Text>
              </Pressable>
            </View>
          ) : previewUri && plan ? (
            <Image
              source={{ uri: previewUri }}
              resizeMode="contain"
              style={{ width: "100%", aspectRatio: SHARE_CARD_WIDTH / plan.height }}
            />
          ) : (
            <View style={{ height: 200, alignItems: "center", justifyContent: "center", gap: 8 }}>
              <ActivityIndicator />
              <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                {t("Rendering the card…")}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
            {SHARE_CARD_PRESETS.map((preset) => {
              const selected = currentPreset === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => applyPreset(preset.id)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: "center",
                    borderRadius: 8,
                    backgroundColor: selected ? tokens.accent : tokens.muted,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? tokens.accentForeground : tokens.foreground,
                      fontSize: 15,
                    }}
                  >
                    {preset.id === "ink"
                      ? t("Ink")
                      : preset.id === "rice"
                        ? t("Rice")
                        : t("Rice paper")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ gap: 16, marginTop: 16 }}>
            <ColorRow
              label={t("Background color")}
              value={style.background}
              options={presetColors("background")}
              onChange={(backgroundColor) =>
                setStyle((current) => ({ ...current, background: backgroundColor }))
              }
            />
            <ColorRow
              label={t("Text color")}
              value={style.text}
              options={presetColors("text")}
              onChange={(textColor) => setStyle((current) => ({ ...current, text: textColor }))}
            />
            <ColorRow
              label={t("Accent color")}
              value={style.accent}
              options={presetColors("accent")}
              onChange={(accentColor) =>
                setStyle((current) => ({ ...current, accent: accentColor }))
              }
            />
            <SliderRow
              label={t("Font size")}
              value={style.fontSize}
              min={SHARE_CARD_FONT_SIZE_MIN}
              max={SHARE_CARD_FONT_SIZE_MAX}
              format={(size) => `${size}`}
              onChange={(fontSize) => setStyle((current) => ({ ...current, fontSize }))}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["serif", "sans"] as const).map((font) => {
                const selected = style.font === font;
                return (
                  <Pressable
                    key={font}
                    onPress={() => setStyle((current) => ({ ...current, font }))}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      alignItems: "center",
                      borderRadius: 8,
                      backgroundColor: selected ? tokens.accent : tokens.muted,
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? tokens.accentForeground : tokens.foreground,
                        fontSize: 15,
                      }}
                    >
                      {font === "serif" ? "宋体" : "黑体"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                {t("Include the question")}
              </Text>
              <NativeSwitch
                value={showQuestion}
                onValueChange={setShowQuestion}
                accessibilityLabel={t("Include the question")}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable
                onPress={pickBackground}
                disabled={busy}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: tokens.border,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                  {background ? t("Change background image") : t("Add background image")}
                </Text>
              </Pressable>
              {background ? (
                <Pressable
                  onPress={() => setBackground(null)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: tokens.border,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t("Remove")}</Text>
                </Pressable>
              ) : null}
            </View>
            <SliderRow
              label={t("Background opacity")}
              value={style.backgroundOpacity}
              min={0}
              max={100}
              disabled={!background}
              format={(opacity) => `${opacity}%`}
              onChange={(backgroundOpacity) =>
                setStyle((current) => ({ ...current, backgroundOpacity }))
              }
            />
            <Pressable onPress={resetStyle} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
              <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>
                {t("Reset to default")}
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
            <Pressable
              onPress={() => void saveAndShare(false)}
              disabled={!previewUri || rendering || busy}
              style={{
                flex: 1,
                paddingVertical: 12,
                alignItems: "center",
                borderRadius: 8,
                backgroundColor: tokens.primary,
                opacity: !previewUri || rendering || busy ? 0.4 : 1,
              }}
            >
              <Text style={{ color: tokens.primaryForeground, fontSize: 16 }}>{t("Save")}</Text>
            </Pressable>
            <Pressable
              onPress={() => void saveAndShare(true)}
              disabled={!previewUri || rendering || busy}
              style={{
                flex: 1,
                paddingVertical: 12,
                alignItems: "center",
                borderRadius: 8,
                borderWidth: 1,
                borderColor: tokens.border,
                opacity: !previewUri || rendering || busy ? 0.4 : 1,
              }}
            >
              <Text style={{ color: tokens.foreground, fontSize: 16 }}>{t("Share")}</Text>
            </Pressable>
          </View>
        </>
      )}
    </BottomSheetShell>
  );
}
