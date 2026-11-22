import type { ComponentProps } from "react";
import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useMobileTokens, useResolvedAppearance } from "../../lib/native";
import { NativeSymbol } from "../native-symbol";

/**
 * The three tile colorways the action rows share: blue for the ordinary
 * actions, plain gray for the trailing one, blue filled when favorited.
 */
export function useActionTileColors(favorited: boolean) {
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const tile =
    colorScheme === "dark"
      ? { background: tokens.accent, icon: tokens.link }
      : { background: "#e8efff", icon: "#2f6bff" };
  const plain =
    colorScheme === "dark"
      ? { background: tokens.muted, icon: tokens.mutedForeground }
      : { background: "#f4f5f7", icon: "#5b6470" };
  const favoriteTile = favorited
    ? { background: colorScheme === "dark" ? tokens.link : "#2f6bff", icon: "#fff" }
    : tile;
  return { tile, plain, favoriteTile };
}

/** One 36×36 action tile: a native symbol on a soft background. */
export function ActionTile({
  label,
  ios,
  android,
  background,
  color,
  onPress,
  pulse = false,
  reducedMotion = false,
}: {
  label: string;
  ios: string;
  android: ComponentProps<typeof NativeSymbol>["android"];
  background: string;
  color: string;
  onPress: () => void;
  /** Loop the icon's opacity while this tile's action is live; static otherwise. */
  pulse?: boolean;
  reducedMotion?: boolean;
}) {
  // The loop starts and stops with the pulse, and always cleans up: ending,
  // switching messages, and unmounting all restore the static icon.
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useEffect(() => {
    if (!pulse || reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(withTiming(0.5, { duration: 450 }), withTiming(1, { duration: 450 })),
      -1,
      true,
    );
    return () => {
      cancelAnimation(opacity);
      opacity.value = 1;
    };
  }, [pulse, reducedMotion, opacity]);
  const icon = <NativeSymbol ios={ios} android={android} size={19} color={color} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
        ...(pressed ? { transform: [{ scale: 0.94 }] } : null),
      })}
    >
      {pulse && !reducedMotion ? <Animated.View style={animatedStyle}>{icon}</Animated.View> : icon}
    </Pressable>
  );
}
