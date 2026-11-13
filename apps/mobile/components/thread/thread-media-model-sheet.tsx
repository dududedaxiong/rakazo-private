import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import type { MobileModel } from "../../lib/mobile-types";
import { BottomSheetShell, SheetHeader } from "../bottom-sheet-shell";
import { Chevron } from "../row-accessories";
import type { ThreadModelSave } from "./thread-model-picker-sheet";

export type MediaModelRole = "video" | "image";

/**
 * The media models as one sheet from the chat's 影图模型 card: two rows, one
 * per role, each opening the detected-model list for that role. Saving happens
 * in the model picker sheet, in place, without leaving the chat.
 */
export function ThreadMediaModelSheet({
  visible,
  catalog,
  video,
  image,
  onPickRole,
  onClose,
}: {
  visible: boolean;
  catalog: MobileModel[] | null;
  video: ThreadModelSave;
  image: ThreadModelSave;
  onPickRole: (role: MediaModelRole) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  if (!visible) return null;

  const labelFor = (save: ThreadModelSave) => {
    if (!save.provider || !save.modelId) return t("Not set");
    const entry = catalog?.find(
      (item) => item.provider === save.provider && item.id === save.modelId,
    );
    return entry?.label ?? save.modelId;
  };

  const rows: { role: MediaModelRole; label: string; value: string }[] = [
    { role: "video", label: t("Video generation model"), value: labelFor(video) },
    { role: "image", label: t("Image generation model"), value: labelFor(image) },
  ];

  return (
    <BottomSheetShell visible={visible} label={t("Media model")} onClose={onClose}>
      <SheetHeader title={t("Media model")} onClose={onClose} />
      {rows.map((row) => (
        <Pressable
          key={row.role}
          accessibilityRole="button"
          accessibilityLabel={`${row.label}: ${row.value}`}
          onPress={() => onPickRole(row.role)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 20,
            paddingVertical: 14,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: tokens.foreground, fontSize: 16 }}>{row.label}</Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
              {row.value}
            </Text>
          </View>
          <Chevron />
        </Pressable>
      ))}
    </BottomSheetShell>
  );
}
