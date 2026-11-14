import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMobileTokens } from "../../lib/native";
import { NativeActionButton } from "../native-action-button";
import { NativeSymbol } from "../native-symbol";

/**
 * The bottom bar shown while messages are selected: how many are picked,
 * and the batch delete for them. It replaces the composer until selection
 * ends, so a tap on Delete cannot also send a message.
 */
export function MessageSelectionBar({
  count,
  busy,
  onDelete,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const styles = StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    count: {
      flex: 1,
      color: tokens.mutedForeground,
      fontSize: 15,
    },
  });
  return (
    <View style={styles.bar}>
      <Text style={styles.count}>
        {t("{count} selected", { count })}
      </Text>
      <NativeActionButton
        label={t("Delete")}
        prominence="destructive"
        variant="text"
        disabled={count === 0 || busy}
        busy={busy}
        onPress={onDelete}
      />
      <NativeActionButton
        label={t("Cancel")}
        prominence="plain"
        variant="text"
        disabled={busy}
        onPress={onCancel}
      />
    </View>
  );
}

/** A checkbox shown on a message row while selecting. */
export function MessageSelectCheckbox({
  selected,
  onToggle,
}: {
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const styles = StyleSheet.create({
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: selected ? tokens.link : tokens.mutedForeground,
      backgroundColor: selected ? tokens.link : "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
  });
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={selected ? t("Deselect message") : t("Select message")}
      accessibilityState={{ checked: selected }}
      hitSlop={8}
      onPress={onToggle}
      style={styles.checkbox}
    >
      {selected ? (
        <NativeSymbol ios="checkmark" android="checkmark-outline" size={14} color="#fff" />
      ) : null}
    </Pressable>
  );
}
