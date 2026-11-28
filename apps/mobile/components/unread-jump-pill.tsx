import { fontWeight, typeScale } from "@rakazo_mickvvw/ui-tokens";
import { Pressable, StyleSheet, Text } from "react-native";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import type { JumpDirection } from "../lib/offscreen-unreads";
import { GlassSurface } from "./glass-surface";
import { NativeSymbol } from "./native-symbol";

export const UNREAD_JUMP_PILL_HEIGHT = 38;

/** An unread-blue glass capsule with a directional chevron and label. */
export function UnreadJumpPill({
  direction,
  label,
  accessibilityLabel,
  onPress,
  onLongPress,
}: {
  direction: JumpDirection;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  /** Cancels the stuck runs behind an attention pill; absent on unread pills. */
  onLongPress?: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  // White on the tinted glass in both themes, like the user bubble's text.
  const onFill = tokens.chatUserForeground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onLongPress ? t("Long press to cancel") : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <GlassSurface
        tint={tokens.unread}
        style={styles.pill}
        fallbackStyle={{
          backgroundColor: tokens.unread,
          boxShadow: "0 2px 6px rgba(0, 0, 0, 0.22)",
        }}
      >
        <NativeSymbol
          ios={direction === "above" ? "chevron.up" : "chevron.down"}
          android={direction === "above" ? "chevron-up" : "chevron-down"}
          size={16}
          weight="semibold"
          color={onFill}
        />
        <Text style={[styles.label, { color: onFill }]}>{label}</Text>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: UNREAD_JUMP_PILL_HEIGHT,
    borderRadius: UNREAD_JUMP_PILL_HEIGHT / 2,
    paddingStart: 12,
    paddingEnd: 14,
  },
  label: {
    ...typeScale.secondary,
    fontWeight: fontWeight.medium,
  },
});
