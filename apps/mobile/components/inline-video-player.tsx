import { requireOptionalNativeModule } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import type { PressableProps } from "react-native";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { NativeSymbol } from "./native-symbol";

// Loaded only when the build has the player: an over-the-air update can reach a build made
// before it, where importing the player would fail.
const playerAvailable = Boolean(requireOptionalNativeModule("ExpoVideo"));

const MAX_INLINE_HEIGHT = 360;

type PlayerProps = {
  uri: string;
  name: string;
  labelColor: string;
  /** The message row's long-press; the cover keeps it while the video is paused. */
  touchProps?: Pick<PressableProps, "onLongPress">;
  /** Opens the video's detail player. */
  onOpen: () => void;
};

/** A video attachment played inline in the chat bubble. */
export function InlineVideoPlayer(props: PlayerProps) {
  if (!playerAvailable) {
    return <VideoFallback {...props} />;
  }
  return <InlineVideoPlayerView {...props} />;
}

export default InlineVideoPlayer;

function InlineVideoPlayerView({ uri, name, labelColor, touchProps, onOpen }: PlayerProps) {
  const { t } = useI18n();
  const { width: windowWidth } = useWindowDimensions();
  const maxWidth = Math.min(Math.round(windowWidth * 0.68), 400);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [error, setError] = useState(false);
  const player = useVideoPlayer(uri, (player) => {
    player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") setDuration(player.duration);
      if (status === "error") setError(true);
    });
    player.addListener("videoTrackChange", ({ videoTrack }) => {
      const size = videoTrack?.size;
      if (size && size.width > 0 && size.height > 0) setAspect(size.width / size.height);
    });
    player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying));
    player.addListener("playToEnd", () => setPlaying(false));
  });
  if (error) {
    return (
      <VideoFallback name={name} labelColor={labelColor} touchProps={touchProps} onOpen={onOpen} />
    );
  }
  const height = Math.min(Math.round(maxWidth / aspect), MAX_INLINE_HEIGHT);
  const play = () => {
    if (duration !== null && player.currentTime >= duration - 0.1) player.currentTime = 0;
    player.play();
  };
  return (
    <View style={[styles.cover, { width: maxWidth, height, backgroundColor: "#000000" }]}>
      <VideoView
        accessibilityLabel={name}
        player={player}
        nativeControls
        contentFit="contain"
        style={styles.fill}
      />
      {playing ? null : (
        <Pressable
          {...touchProps}
          accessibilityRole="button"
          accessibilityLabel={t("Play")}
          onPress={play}
          style={styles.overlay}
        >
          <View style={styles.playCircle}>
            <NativeSymbol ios="play.fill" android="play" size={26} color="#ffffff" />
          </View>
          {duration !== null ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{formatVideoDuration(duration)}</Text>
            </View>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

/** The file card the video falls back to when it cannot play inline. */
function VideoFallback({ name, labelColor, touchProps, onOpen }: Omit<PlayerProps, "uri">) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  return (
    <Pressable {...touchProps} accessibilityRole="button" onPress={onOpen}>
      <View style={[styles.placeholder, { backgroundColor: tokens.muted }]}>
        <Text style={[styles.label, { color: labelColor }]}>🎬 {name}</Text>
        <Text style={[styles.hint, { color: tokens.mutedForeground }]}>{t("Tap to open")}</Text>
      </View>
    </Pressable>
  );
}

function formatVideoDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  cover: { borderRadius: 12, overflow: "hidden" },
  fill: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  playCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  durationBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  durationText: { color: "#ffffff", fontSize: 12 },
  placeholder: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { fontSize: 15 },
  hint: { fontSize: 13, marginTop: 2 },
});
