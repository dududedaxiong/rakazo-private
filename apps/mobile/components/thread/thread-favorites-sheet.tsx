import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import type { MobileBot } from "../../lib/mobile-types";
import type { ThreadFavorite } from "../../lib/thread-favorites";
import {
  favoriteMessageId,
  removeThreadFavorite,
  useThreadFavorites,
} from "../../lib/thread-favorites";
import { translationSettingsFromBot } from "../../lib/translation";
import { NativeActionButton } from "../native-action-button";
import { NativeSheet, useNativeSheet } from "../native-sheet";
import {
  MessageTranslationView,
  TranslateButton,
  useMessageTranslation,
} from "./message-translation";

/**
 * The thread's favorited replies: tapping one closes the sheet and jumps
 * back to that reply in the conversation; each card can be deleted here, or
 * translated in place with the bot's translation model.
 */
export function ThreadFavoritesSheet({
  visible,
  threadKey,
  bot,
  onClose,
  onJump,
}: {
  visible: boolean;
  threadKey: string | undefined;
  /** The bot whose replies these are; without it there is no translation model to use. */
  bot?: MobileBot | null;
  onClose: () => void;
  onJump: (messageId: string) => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const Sheet = useNativeSheet();
  const favorites = useThreadFavorites(threadKey);

  if (!visible || Sheet === undefined) return null;

  const content = (
    <View style={{ backgroundColor: tokens.card, paddingBottom: 12 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingTop: Sheet ? 4 : 12,
          paddingBottom: 8,
        }}
      >
        <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "600" }}>
          {t("My favorites")}
        </Text>
        <NativeActionButton label={t("Cancel")} prominence="plain" onPress={onClose} />
      </View>
      <Text
        style={{
          color: tokens.mutedForeground,
          fontSize: 13,
          paddingHorizontal: 20,
          paddingBottom: 12,
        }}
      >
        {t("Tap a favorite to jump back to it in the conversation.")}
      </Text>
      {favorites.length === 0 ? (
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 14,
            paddingHorizontal: 20,
            paddingVertical: 24,
            textAlign: "center",
          }}
        >
          {t("Nothing saved yet. Favorite a useful reply and it will show up here.")}
        </Text>
      ) : (
        <>
          <ScrollView style={{ maxHeight: 480 }}>
            {favorites.map((item) => (
              <FavoriteCard
                key={item.messageId}
                item={item}
                threadKey={threadKey}
                bot={bot}
                onClose={onClose}
                onJump={onJump}
              />
            ))}
          </ScrollView>
          <Text
            style={{
              color: tokens.mutedForeground,
              fontSize: 12,
              textAlign: "center",
              paddingHorizontal: 20,
              paddingTop: 12,
            }}
          >
            {t(
              "Translations only show here and don't change the original. A favorite without a translation model will ask you to pick one first.",
            )}
          </Text>
        </>
      )}
    </View>
  );

  if (Sheet) {
    return (
      <NativeSheet Sheet={Sheet} onClose={onClose} label={t("My favorites")}>
        {content}
      </NativeSheet>
    );
  }
  if (Platform.OS === "ios") {
    return (
      <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
        {content}
      </Modal>
    );
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        {content}
      </View>
    </Modal>
  );
}

function FavoriteCard({
  item,
  threadKey,
  bot,
  onClose,
  onJump,
}: {
  item: ThreadFavorite;
  threadKey: string | undefined;
  bot?: MobileBot | null;
  onClose: () => void;
  onJump: (messageId: string) => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const settings = translationSettingsFromBot(bot ?? null);
  // Older favorites only stored the 64-character snippet; translate that.
  const text = item.text ?? item.snippet;
  const translation = useMessageTranslation({
    botId: bot?.id,
    text,
    settings,
    autoTranslate: false,
    composing: false,
  });
  // A finished translation that is only folded away reopens instead of
  // spending another translation call.
  const handleTranslatePress = () => {
    if (translation.status === "done" && translation.result && !translation.expanded) {
      translation.expand();
      return;
    }
    translation.translate();
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: 12,
        padding: 12,
        marginHorizontal: 20,
        marginVertical: 6,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Tap to jump back")}
        onPress={() => {
          onClose();
          // A translation favorite jumps back to the message it translates.
          onJump(favoriteMessageId(item));
        }}
        style={({ pressed }) => ({ ...(pressed ? { opacity: 0.6 } : null) })}
      >
        <Text style={{ color: tokens.foreground, fontSize: 15 }} numberOfLines={2}>
          {item.snippet}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 12, marginTop: 4 }}>
          {new Date(item.createdAt).toLocaleString()}
        </Text>
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Delete")}
          onPress={() => {
            if (threadKey) removeThreadFavorite(threadKey, item.messageId);
          }}
          hitSlop={8}
          style={({ pressed }) => ({ paddingVertical: 6, ...(pressed ? { opacity: 0.6 } : null) })}
        >
          <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Delete")}</Text>
        </Pressable>
        {bot ? <TranslateButton label={t("Translate")} onPress={handleTranslatePress} /> : null}
      </View>
      <MessageTranslationView
        translation={translation}
        showActions={settings.showTranslationActions}
        style={{ marginBottom: 0, marginTop: 10 }}
      />
    </View>
  );
}
