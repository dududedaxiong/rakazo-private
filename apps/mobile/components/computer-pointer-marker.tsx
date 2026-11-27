import { useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Animated, Image, StyleSheet, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { pointerDisplayPoint, useComputerPointer } from "../lib/computer-pointer";
import { POINTER_SNAPSHOT_LENS_SIZE } from "../lib/computer-pointer-snapshot";
import { useThemedStyles } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

/** Fully visible this long, then fades out; a new pointer restarts the clock. */
const MARKER_VISIBLE_MS = 4500;
const MARKER_FADE_MS = 600;
const RING_SIZE = 64;
const HALO_SIZE = 76;
const DOT_SIZE = 10;
const ARROW_SIZE = 36;
const ARROW_OUTLINE_SIZE = 40;
/** The arrow glyph's tip sits a few points inside its top-left corner. */
const ARROW_TIP_INSET = 6;
/**
 * Literal white: the contrast color against the screen's own content, which is
 * independent of the app theme — not a product color. It keeps the marker
 * readable on dark desktops, where the ink parts alone would disappear.
 */
const MARKER_CONTRAST = "#ffffff";

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    wrapper: {
      ...StyleSheet.absoluteFill,
      zIndex: 6,
    },
    halo: {
      position: "absolute",
      width: HALO_SIZE,
      height: HALO_SIZE,
      borderRadius: HALO_SIZE / 2,
      backgroundColor: MARKER_CONTRAST,
      opacity: 0.4,
      transform: [{ translateX: -HALO_SIZE / 2 }, { translateY: -HALO_SIZE / 2 }],
    },
    ring: {
      position: "absolute",
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      borderWidth: 3,
      borderColor: tokens.primary,
      transform: [{ translateX: -RING_SIZE / 2 }, { translateY: -RING_SIZE / 2 }],
    },
    arrowOutline: {
      position: "absolute",
    },
    arrow: {
      position: "absolute",
    },
    dot: {
      position: "absolute",
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: tokens.primary,
      borderWidth: 2,
      borderColor: MARKER_CONTRAST,
      transform: [{ translateX: -DOT_SIZE / 2 }, { translateY: -DOT_SIZE / 2 }],
    },
    lensOutline: {
      position: "absolute",
      width: POINTER_SNAPSHOT_LENS_SIZE + 8,
      height: POINTER_SNAPSHOT_LENS_SIZE + 8,
      borderRadius: (POINTER_SNAPSHOT_LENS_SIZE + 8) / 2,
      backgroundColor: MARKER_CONTRAST,
      opacity: 0.9,
      transform: [
        { translateX: -(POINTER_SNAPSHOT_LENS_SIZE + 8) / 2 },
        { translateY: -(POINTER_SNAPSHOT_LENS_SIZE + 8) / 2 },
      ],
    },
    lens: {
      position: "absolute",
      width: POINTER_SNAPSHOT_LENS_SIZE,
      height: POINTER_SNAPSHOT_LENS_SIZE,
      borderRadius: POINTER_SNAPSHOT_LENS_SIZE / 2,
      borderWidth: 3,
      borderColor: tokens.primary,
      overflow: "hidden",
      transform: [
        { translateX: -POINTER_SNAPSHOT_LENS_SIZE / 2 },
        { translateY: -POINTER_SNAPSHOT_LENS_SIZE / 2 },
      ],
    },
    lensImage: {
      width: POINTER_SNAPSHOT_LENS_SIZE,
      height: POINTER_SNAPSHOT_LENS_SIZE,
    },
  });
}

/**
 * A prominent marker at the AI's pointer on the computer screen.
 *
 * When a magnified snapshot of the screen around the click is available, a
 * circular lens shows it (2.5x, centred exactly on the click point, with
 * the dot marking the precise point in the middle); without a snapshot the
 * dot, ring and cursor arrow show instead. It stays fully visible for a few
 * seconds, then fades out; the next AI action replaces it immediately. It
 * never intercepts touches — it is purely visual, so driving the computer
 * is unaffected.
 *
 * The pointer comes from the server's observation of the live desktop pointer
 * (see computer-pointer), never from the noVNC cursor canvas, which follows
 * only the user's own mouse and would point at a stale place. The snapshot
 * comes from the noVNC canvas in the screen WebView (see
 * computer-pointer-snapshot).
 */
export function ComputerPointerMarker({ botId }: { botId: string }) {
  const styles = useThemedStyles(createStyles);
  const tokens = mobileTokens();
  const pointer = useComputerPointer();
  const opacity = useRef(new Animated.Value(1)).current;
  const [hidden, setHidden] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!pointer) return;
    opacity.setValue(1);
    setHidden(false);
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: MARKER_FADE_MS,
      delay: MARKER_VISIBLE_MS,
      useNativeDriver: false,
    });
    animation.start((result) => {
      if (result?.finished) setHidden(true);
    });
    return () => {
      animation.stop();
    };
  }, [pointer, opacity]);

  if (!pointer || pointer.botId !== botId || hidden) return null;
  const point = pointerDisplayPoint(pointer, size.width, size.height);

  return (
    <Animated.View
      style={[styles.wrapper, { opacity }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      {point ? (
        pointer.snapshot ? (
          <>
            <View style={[styles.lensOutline, { left: point.x, top: point.y }]} />
            <View style={[styles.lens, { left: point.x, top: point.y }]}>
              <Image
                source={{ uri: pointer.snapshot }}
                style={styles.lensImage}
                accessibilityIgnoresInvertColors
              />
            </View>
            <View style={[styles.dot, { left: point.x, top: point.y }]} />
          </>
        ) : (
          <>
            <View style={[styles.halo, { left: point.x, top: point.y }]} />
            <View style={[styles.ring, { left: point.x, top: point.y }]} />
            <View
              style={[
                styles.arrowOutline,
                { left: point.x - ARROW_TIP_INSET - 2, top: point.y - ARROW_TIP_INSET - 2 },
              ]}
            >
              <NativeSymbol
                ios="cursorarrow"
                // Ionicons has no cursor glyph; the boxed up-left arrow is the
                // closest match (it points the way a cursor does).
                android="arrow-up-left-box"
                size={ARROW_OUTLINE_SIZE}
                color={MARKER_CONTRAST}
              />
            </View>
            <View
              style={[
                styles.arrow,
                { left: point.x - ARROW_TIP_INSET, top: point.y - ARROW_TIP_INSET },
              ]}
            >
              <NativeSymbol
                ios="cursorarrow"
                // Ionicons has no cursor glyph; the boxed up-left arrow is the
                // closest match (it points the way a cursor does).
                android="arrow-up-left-box"
                size={ARROW_SIZE}
                color={tokens.primary}
              />
            </View>
            <View style={[styles.dot, { left: point.x, top: point.y }]} />
          </>
        )
      ) : null}
    </Animated.View>
  );
}
