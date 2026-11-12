import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

/** What the finger chose while holding the waveform button. */
export type HoldVoiceMode = "send" | "cancel" | "edit";

const OVERLAY_HEIGHT = 240;
const STRIPS = 16;
const BARS = 13;
const PULSE_MS = 150;

function randomLevels(): number[] {
  return Array.from({ length: BARS }, () => 8 + Math.floor(Math.random() * 45));
}

/**
 * The Doubao-style hold-to-talk sheet: a live transcript over a pulsing
 * waveform, tinted by what releasing the finger will do. The waveform is a
 * decorative pulse: no audio-level signal reaches this layer, so it cannot
 * follow the caller's voice.
 */
export function HoldVoiceOverlay({ mode, text }: { mode: HoldVoiceMode; text: string }) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const [levels, setLevels] = useState<number[]>(randomLevels);
  useEffect(() => {
    const id = setInterval(() => setLevels(randomLevels()), PULSE_MS);
    return () => clearInterval(id);
  }, []);
  const color =
    mode === "cancel" ? tokens.destructiveFill : mode === "edit" ? tokens.success : tokens.link;
  const hint =
    mode === "cancel"
      ? t("Release to cancel")
      : mode === "edit"
        ? t("Release to edit")
        : t("Release to send · Slide up to cancel · Slide down to edit");
  return (
    <View
      testID="hold-voice-overlay"
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: OVERLAY_HEIGHT }}
    >
      {Array.from({ length: STRIPS }, (_, index) => (
        <View
          key={index}
          style={{ flex: 1, backgroundColor: color, opacity: ((index + 1) / STRIPS) * 0.92 }}
        />
      ))}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 40,
          gap: 14,
        }}
      >
        <View
          style={{
            backgroundColor: tokens.overlay,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 6,
            maxWidth: "88%",
          }}
        >
          <Text
            numberOfLines={3}
            style={{ color: tokens.destructiveForeground, fontSize: 17, lineHeight: 22 }}
          >
            {text.trim() ? text : t("Listening...")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 56 }}>
          {levels.map((height, index) => (
            <View
              key={index}
              style={{
                width: 4,
                height,
                borderRadius: 2,
                backgroundColor: tokens.destructiveForeground,
              }}
            />
          ))}
        </View>
        <Text style={{ color: tokens.destructiveForeground, fontSize: 15, letterSpacing: 1 }}>
          {hint}
        </Text>
        {mode === "edit" ? (
          <Text style={{ color: tokens.destructiveForeground, fontSize: 13, opacity: 0.85 }}>
            {t("Release to edit the text, then tap send")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
