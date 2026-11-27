import { useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import {
  setLocalTrafficEnabled,
  setLocalTrafficPosition,
  useLocalTraffic,
} from "../lib/computer-local-traffic";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

const FLOAT_SIZE = 44;
const TAP_SLOP_PX = 6;
const NOTICE_MS = 4000;

type Point = { x: number; y: number };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Keep the button's centre at least half a button inside the screen, so it
 * never hangs off an edge. Falls back to the plain 0..1 range on screens
 * narrower than the button itself.
 */
function clampPosition(point: Point, width: number, height: number): Point {
  const minX = width >= FLOAT_SIZE ? FLOAT_SIZE / 2 / width : 0;
  const minY = height >= FLOAT_SIZE ? FLOAT_SIZE / 2 / height : 0;
  return {
    x: Math.min(1 - minX, Math.max(minX, clamp01(point.x))),
    y: Math.min(1 - minY, Math.max(minY, clamp01(point.y))),
  };
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    wrapper: {
      ...StyleSheet.absoluteFill,
      zIndex: 5,
    },
    button: {
      position: "absolute",
      width: FLOAT_SIZE,
      height: FLOAT_SIZE,
      borderRadius: FLOAT_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      elevation: 4,
    },
    buttonOn: {
      backgroundColor: tokens.primary,
    },
    buttonOff: {
      backgroundColor: tokens.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border,
      opacity: 0.85,
    },
    noticeWrap: {
      position: "absolute",
      top: 12,
      left: 0,
      right: 0,
      alignItems: "center",
    },
    notice: {
      backgroundColor: tokens.primary,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: "90%",
    },
    noticeText: {
      color: tokens.primaryForeground,
      fontSize: 13,
      textAlign: "center",
    },
  });
}

/**
 * One movable floating switch for local traffic, overlaid on the computer
 * screen (the small window and the full-screen view share it).
 *
 * Tap toggles the preference; drag moves the button and its position is
 * persisted, so it stays where the user left it. The button is the only
 * floating control on the screen: the in-page control panels are hidden by
 * the injected screen chrome instead.
 *
 * The toggle only records the preference. The routing that would send the
 * bot's browser traffic over this phone does not exist yet, so turning it on
 * shows a short note that it takes effect once the supporting update
 * arrives — it never claims to be live.
 */
export function ComputerLocalTrafficFloat() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const tokens = mobileTokens();
  const { enabled, x, y } = useLocalTraffic();
  const [drag, setDrag] = useState<Point | null>(null);
  const [notice, setNotice] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const stateRef = useRef({ enabled, x, y });
  stateRef.current = { enabled, x, y };
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const dragRef = useRef<Point | null>(null);
  const dragBase = useRef<Point>({ x, y });
  const moved = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const toggle = () => {
    const next = !stateRef.current.enabled;
    setLocalTrafficEnabled(next);
    if (next) {
      setNotice(true);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(false), NOTICE_MS);
    } else {
      setNotice(false);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        moved.current = false;
        dragBase.current = { x: stateRef.current.x, y: stateRef.current.y };
        dragRef.current = null;
      },
      onPanResponderMove: (_event, gesture) => {
        const { width, height } = sizeRef.current;
        if (width <= 0 || height <= 0) return;
        if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > TAP_SLOP_PX) {
          moved.current = true;
        }
        const next = {
          x: clamp01(dragBase.current.x + gesture.dx / width),
          y: clamp01(dragBase.current.y + gesture.dy / height),
        };
        dragRef.current = next;
        setDrag(next);
      },
      onPanResponderRelease: () => {
        if (!moved.current) {
          toggle();
        } else if (dragRef.current) {
          const { width, height } = sizeRef.current;
          setLocalTrafficPosition(
            clampPosition(dragRef.current, width, height).x,
            clampPosition(dragRef.current, width, height).y,
          );
        }
        dragRef.current = null;
        setDrag(null);
      },
    }),
  ).current;

  const shown = drag ?? { x, y };
  const display = clampPosition(shown, size.width, size.height);

  return (
    <View
      style={styles.wrapper}
      pointerEvents="box-none"
      onLayout={(event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      <View
        style={[
          styles.button,
          enabled ? styles.buttonOn : styles.buttonOff,
          {
            left: `${display.x * 100}%`,
            top: `${display.y * 100}%`,
            transform: [{ translateX: -FLOAT_SIZE / 2 }, { translateY: -FLOAT_SIZE / 2 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={enabled ? t("Local traffic on") : t("Local traffic off")}
        accessibilityState={{ selected: enabled }}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "activate") toggle();
        }}
        {...panResponder.panHandlers}
      >
        <NativeSymbol
          ios={enabled ? "wifi" : "wifi.slash"}
          android={enabled ? "wifi" : "wifi-outline"}
          size={22}
          color={enabled ? tokens.primaryForeground : tokens.mutedForeground}
        />
      </View>
      {notice ? (
        <View style={styles.noticeWrap} pointerEvents="none">
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              {t("Saved. Takes effect once the supporting update arrives.")}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
