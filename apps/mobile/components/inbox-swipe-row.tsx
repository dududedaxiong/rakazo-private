import type { ReactElement } from "react";
import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useI18n } from "../lib/i18n";
import type { InboxRowAction } from "../lib/inbox-swipe";
import { INBOX_ROW_ACTIONS } from "../lib/inbox-swipe";
import type { MobileBotSection } from "../lib/mobile-types";
import { useMobileTokens } from "../lib/native";
import type { BotOrganizationUpdate } from "./bot-organize-modal";
import type { InboxChatPreviewProps } from "./inbox-chat-preview";

export type InboxSwipeRowProps = {
  rowKey: string;
  unread?: boolean;
  pinned?: boolean;
  /** Bots only; groups have no finish notifications. */
  notifyOnFinish?: boolean;
  sectionId?: string | null;
  sections: readonly MobileBotSection[];
  preview: InboxChatPreviewProps;
  onAction: (action: InboxRowAction) => void;
  onOrganize: (update: BotOrganizationUpdate) => void;
  onEditSection: (mode: "create" | "rename") => void;
  children: ReactElement;
};

/**
 * Swipe-left-to-delete on Android. iOS gets system swipe actions and the context menu
 * from the SwiftUI list; other platforms keep the long-press sheet, and swipe left to
 * reveal Delete. Rows without actions stay a plain pass-through.
 */
export function InboxSwipeRow({ onAction, children }: InboxSwipeRowProps) {
  const { t } = useI18n();
  const mobileTokens = useMobileTokens();
  const swipeable = useRef<Swipeable>(null);
  if (!onAction) return children;
  return (
    <Swipeable
      ref={swipeable}
      renderRightActions={() => (
        <View style={[styles.deleteAction, { backgroundColor: mobileTokens.destructiveFill }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(INBOX_ROW_ACTIONS.delete.label)}
            onPress={() => {
              swipeable.current?.close();
              onAction("delete");
            }}
            style={styles.deleteButton}
          >
            <Text style={[styles.deleteLabel, { color: mobileTokens.destructiveForeground }]}>
              {t(INBOX_ROW_ACTIONS.delete.label)}
            </Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  deleteAction: { justifyContent: "center", width: 88 },
  deleteButton: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  deleteLabel: { fontSize: 15, fontWeight: "600" },
});
