import { lazy, Suspense, useEffect, useState } from "react";
import type { PressableProps } from "react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactTarget } from "../lib/artifact-open";
import { videoArtifactUri } from "../lib/artifact-open";
import { useI18n } from "../lib/i18n";

// The player is loaded only once a video is on screen: importing expo-video up front would
// pull the native player into every message row, including rows without a video.
const InlineVideoPlayer = lazy(() => import("./inline-video-player"));

/**
 * A video attachment rendered inside a chat bubble. The artifact is fetched through the
 * authenticated RPC (the server does not serve artifacts to a bare URL) and cached on disk;
 * the player then plays it in place, first frame as the cover, like the web's inline video.
 * Tapping the cover plays; the detail player stays behind the message's Open action.
 */
export function InlineVideoAttachment({
  threadTarget,
  artifactId,
  name,
  mimeType,
  labelColor,
  pressableProps,
  onOpen,
}: {
  threadTarget: MobileArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  labelColor: string;
  pressableProps?: Omit<PressableProps, "onPress" | "children" | "style">;
  /** Opens the video's detail player. */
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; uri: string } | { status: "error" }
  >({ status: "loading" });
  const targetBotId = "botId" in threadTarget ? threadTarget.botId : undefined;
  const targetGroupId = "groupId" in threadTarget ? threadTarget.groupId : undefined;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const target: MobileArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    videoArtifactUri(target, artifactId, mimeType)
      .then((uri) => {
        if (!cancelled) setState({ status: "ready", uri });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [targetBotId, targetGroupId, artifactId, mimeType]);

  // The row takes the message long-press; screen readers get the message actions on the
  // name instead so the play control stays separately focusable.
  const { accessibilityActions, onAccessibilityAction, ...touchProps } = pressableProps ?? {};
  if (state.status === "ready") {
    return (
      <View>
        <Suspense
          fallback={
            <View style={[styles.placeholder, { backgroundColor: tokens.muted }]}>
              <Text style={[styles.label, { color: labelColor }]}>🎬 {name}</Text>
              <ActivityIndicator color={tokens.mutedForeground} />
            </View>
          }
        >
          <InlineVideoPlayer
            uri={state.uri}
            name={name}
            labelColor={labelColor}
            touchProps={touchProps}
            onOpen={onOpen}
          />
        </Suspense>
        <Text
          accessible
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          numberOfLines={1}
          style={{ color: labelColor, fontSize: 13, marginTop: 6 }}
        >
          {name}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      {...touchProps}
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={state.status === "error" ? onOpen : undefined}
    >
      <View style={[styles.placeholder, { backgroundColor: tokens.muted }]}>
        <Text style={[styles.label, { color: labelColor }]}>🎬 {name}</Text>
        {state.status === "loading" ? (
          <ActivityIndicator color={tokens.mutedForeground} />
        ) : (
          <Text style={[styles.hint, { color: tokens.mutedForeground }]}>{t("Tap to open")}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
