import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { pickFromLibrary } from "../lib/pick-attachments";
import type { PickedAttachment } from "../lib/pick-attachments-filter";
import { NativeActionButton } from "./native-action-button";

/**
 * The edit dialog: the supplementary prompt, and for a video a reference
 * image to edit from. The prompt is required; a video also requires the
 * image, which the user picks from the photo library.
 */
export function MediaEditDialog({
  kind,
  initialPrompt,
  busy,
  onSubmit,
  onClose,
}: {
  kind: "image" | "video";
  initialPrompt: string;
  busy: boolean;
  onSubmit: (prompt: string, file: PickedAttachment | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [draft, setDraft] = useState(initialPrompt);
  const [file, setFile] = useState<PickedAttachment | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const canSubmit = draft.trim().length > 0 && (kind === "image" || file !== null) && !busy;

  async function pickReference() {
    setPickError(null);
    try {
      const { attachments, skipped } = await pickFromLibrary(0);
      if (attachments[0]) {
        setFile(attachments[0]);
      } else if (skipped.length > 0) {
        setPickError(t("Could not read the selected image. Try again."));
      }
    } catch {
      setPickError(t("Could not read the selected image. Try again."));
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: native.fill }}
      >
        <View
          accessibilityViewIsModal
          style={{ padding: 24, gap: 16, borderRadius: 16, backgroundColor: tokens.card }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 18 }}>{t("Edit details")}</Text>
          <View style={{ gap: 8 }}>
            <Text style={{ color: native.secondaryLabel, fontSize: 13 }}>
              {t("Supplementary prompt")}
            </Text>
            <TextInput
              autoFocus
              accessibilityLabel={t("Supplementary prompt")}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={{ minHeight: 88, color: tokens.foreground, fontSize: 16 }}
            />
          </View>
          {kind === "video" ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: native.secondaryLabel, fontSize: 13 }}>
                {t("Reference image")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Choose a reference image")}
                onPress={() => void pickReference()}
                style={{
                  borderWidth: 1,
                  borderColor: tokens.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                }}
              >
                <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 15 }}>
                  {file ? file.name : t("Choose a reference image")}
                </Text>
              </Pressable>
              {pickError ? (
                <Text role="alert" style={{ color: tokens.destructive, fontSize: 13 }}>
                  {pickError}
                </Text>
              ) : null}
            </View>
          ) : null}
          <NativeActionButton
            label={busy ? t("Starting…") : t("Start edit")}
            busy={busy}
            disabled={!canSubmit}
            onPress={() => onSubmit(draft.trim(), file)}
          />
          <NativeActionButton label={t("Cancel")} prominence="plain" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
