import { useEffect, useState } from "react";
import type { PressableProps } from "react-native";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactTarget } from "../lib/artifact-open";
import { imageArtifactPreview } from "../lib/artifact-open";
import { useI18n } from "../lib/i18n";
import type { ImageSize } from "../lib/inline-image";
import { fitImageSize } from "../lib/inline-image";

const MAX_INLINE_HEIGHT = 360;

/**
 * An image attachment rendered inside a chat bubble. The artifact is fetched through the
 * authenticated RPC (the server does not serve artifacts to a bare URL), cached on disk and
 * shown at its natural size, scaled down to fit the bubble. Tapping it opens the viewer.
 * A generated image (`collapsible`) can also be folded away: the folded row keeps the
 * file name and a Show button, so a long run of images stays tidy.
 */
export function InlineImageAttachment({
  threadTarget,
  artifactId,
  name,
  mimeType,
  onOpen,
  pressableProps,
  labelColor,
  collapsible,
}: {
  threadTarget: MobileArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  onOpen: () => void;
  pressableProps?: Omit<PressableProps, "onPress" | "children" | "style">;
  labelColor: string;
  /** A generated image in a bot reply folds away; a sent image stays as-is. */
  collapsible?: boolean;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const { width: windowWidth } = useWindowDimensions();
  const maxWidth = Math.min(Math.round(windowWidth * 0.68), 400);
  const [collapsed, setCollapsed] = useState(false);
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; uri: string; size: ImageSize } | { status: "error" }
  >({ status: "loading" });
  const targetBotId = "botId" in threadTarget ? threadTarget.botId : undefined;
  const targetGroupId = "groupId" in threadTarget ? threadTarget.groupId : undefined;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const target: MobileArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    imageArtifactPreview(target, artifactId, mimeType)
      .then((loaded) => {
        if (!cancelled) setState({ status: "ready", ...loaded });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [targetBotId, targetGroupId, artifactId, mimeType]);

  if (collapsible && collapsed) {
    return (
      <Pressable
        {...pressableProps}
        accessibilityRole="button"
        accessibilityLabel={t("Show")}
        onPress={() => setCollapsed(false)}
      >
        <View style={[styles.placeholder, { backgroundColor: tokens.muted }]}>
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <Text style={[styles.label, { color: labelColor, flex: 1 }]} numberOfLines={1}>
              🖼 {name}
            </Text>
            <Text style={[styles.hint, { color: tokens.mutedForeground }]}>{t("Show")}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  if (state.status === "ready") {
    const size = fitImageSize(state.size, maxWidth, MAX_INLINE_HEIGHT);
    return (
      <View>
        <Pressable
          {...pressableProps}
          accessibilityRole="imagebutton"
          accessibilityLabel={t("Open image {name}", { name })}
          onPress={onOpen}
        >
          <Image
            source={{ uri: state.uri }}
            style={[styles.image, size, { backgroundColor: tokens.muted }]}
            accessibilityIgnoresInvertColors
          />
        </Pressable>
        {collapsible ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 6,
            }}
          >
            <Text style={{ color: labelColor, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Collapse")}
              onPress={() => setCollapsed(true)}
              hitSlop={8}
            >
              <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{t("Collapse")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <Pressable {...pressableProps} onPress={state.status === "error" ? onOpen : undefined}>
      <View style={[styles.placeholder, { backgroundColor: tokens.muted }]}>
        <Text style={[styles.label, { color: labelColor }]}>🖼 {name}</Text>
        {state.status === "loading" ? (
          <ActivityIndicator
            color={tokens.mutedForeground}
            accessibilityLabel={t("Loading image…")}
          />
        ) : (
          <Text style={[styles.hint, { color: tokens.mutedForeground }]}>{t("Tap to open")}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: { borderRadius: 12, overflow: "hidden" },
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
