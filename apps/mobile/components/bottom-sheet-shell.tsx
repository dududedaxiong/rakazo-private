import type { ReactNode } from "react";
import { Modal, Platform, ScrollView, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { NativeSheet, useNativeSheet } from "./native-sheet";
import { SheetCloseButton } from "./sheet-close-button";

/**
 * A bottom sheet wherever the platform has one; iOS falls back to a form
 * sheet and Android without the native sheet to a bottom modal, following the
 * bot menu and the model picker.
 */
export function BottomSheetShell({
  visible,
  label,
  expanded = false,
  onClose,
  children,
}: {
  visible: boolean;
  label: string;
  expanded?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const tokens = mobileTokens();
  const Sheet = useNativeSheet();

  if (!visible || Sheet === undefined) return null;

  if (Sheet) {
    return (
      <NativeSheet Sheet={Sheet} onClose={onClose} expanded={expanded} label={label}>
        <View style={{ backgroundColor: tokens.card, paddingHorizontal: 20, paddingBottom: 24 }}>
          {children}
        </View>
      </NativeSheet>
    );
  }
  const body = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        backgroundColor: tokens.card,
        paddingHorizontal: 20,
        paddingBottom: 24,
      }}
    >
      {children}
    </ScrollView>
  );
  if (Platform.OS === "ios") {
    return (
      <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
        {body}
      </Modal>
    );
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        {body}
      </View>
    </Modal>
  );
}

/** A sheet's title row: the title on the left, the close button on the right. */
export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const tokens = mobileTokens();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: 4,
        paddingBottom: 8,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: tokens.foreground, fontSize: 17, fontWeight: "600" }}
      >
        {title}
      </Text>
      <SheetCloseButton onPress={onClose} />
    </View>
  );
}
