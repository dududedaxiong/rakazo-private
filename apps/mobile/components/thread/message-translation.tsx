import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewStyle } from "react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { shareMessageText } from "../../lib/message-context-menu";
import { useMobileTokens, useResolvedAppearance } from "../../lib/native";
import type { BotTranslationResult, BotTranslationSettings } from "../../lib/translation";
import {
  hasTranslationModel,
  translateBotMessage,
  translationSourceLabel,
  translationTargetLabel,
} from "../../lib/translation";
import { errorText } from "../../lib/user-error";
import { NativeSymbol } from "../native-symbol";

/** The wide blue globe pill that opens a translation, shared by rows and cards. */
export function TranslateButton({ label, onPress }: { label: string; onPress: () => void }) {
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 36,
        borderRadius: 10,
        backgroundColor: colorScheme === "dark" ? tokens.link : "#2f6bff",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        ...(pressed ? { transform: [{ scale: 0.96 }] } : null),
      })}
    >
      <NativeSymbol ios="globe" android="globe-outline" size={17} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export type MessageTranslationStatus = "idle" | "loading" | "done" | "error" | "no-model";

export type MessageTranslation = {
  status: MessageTranslationStatus;
  result: BotTranslationResult | null;
  error: string | null;
  /** Whether the translation area is open. */
  expanded: boolean;
  translate: () => void;
  collapse: () => void;
};

/**
 * One message's translation state, shared by the thread row and the favorites
 * card. The translation only ever shows locally; the original never changes.
 * Auto-translate fires once, when a reply finishes arriving while mounted;
 * history loaded already complete never auto-translates, and collapsing
 * stops it from re-expanding for that message.
 */
export function useMessageTranslation({
  botId,
  text,
  settings,
  autoTranslate,
  composing,
}: {
  botId: string | undefined;
  text: string;
  settings: BotTranslationSettings;
  autoTranslate: boolean;
  /** True while this reply is still streaming in. */
  composing: boolean;
}): MessageTranslation {
  const { t } = useI18n();
  const [status, setStatus] = useState<MessageTranslationStatus>("idle");
  const [result, setResult] = useState<BotTranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const collapsedRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const composingRef = useRef(composing);
  const argsRef = useRef({ botId, text, settings });
  argsRef.current = { botId, text, settings };
  const runRef = useRef(0);

  const translate = useCallback(() => {
    const { botId: currentBotId, text: currentText, settings: currentSettings } = argsRef.current;
    if (!currentBotId || !currentText.trim()) return;
    collapsedRef.current = false;
    setExpanded(true);
    if (!hasTranslationModel(currentSettings)) {
      setStatus("no-model");
      return;
    }
    const runId = ++runRef.current;
    setStatus("loading");
    setError(null);
    void translateBotMessage(currentBotId, currentText, currentSettings)
      .then((next) => {
        if (runRef.current !== runId) return;
        setResult(next);
        setStatus("done");
      })
      .catch((err) => {
        if (runRef.current !== runId) return;
        setError(errorText(err, t("Translation failed. Try again.")));
        setStatus("error");
      });
  }, [t]);

  const translateRef = useRef(translate);
  translateRef.current = translate;

  useEffect(() => {
    const wasComposing = composingRef.current;
    composingRef.current = composing;
    if (!autoTranslate || !wasComposing || composing) return;
    if (collapsedRef.current || statusRef.current !== "idle") return;
    if (!hasTranslationModel(argsRef.current.settings)) return;
    translateRef.current();
  }, [autoTranslate, composing]);

  const collapse = useCallback(() => {
    collapsedRef.current = true;
    setExpanded(false);
  }, []);

  return { status, result, error, expanded, translate, collapse };
}

/**
 * The expanded translation area: a light-blue box under the message with a
 * "翻译 · 用 {model} 翻译 · {source} to {target}" header, the translated text,
 * and copy / collapse actions. Loading and failure render in place.
 * Read-aloud, share, and favorite act on the translated text; each renders
 * only when its handler is provided and the bot shows translation actions.
 * The favorites sheet passes no speak or favorite handler, so its cards
 * offer share only.
 */
export function MessageTranslationView({
  translation,
  style,
  showActions = true,
  speaking = false,
  onSpeakText,
  favorited = false,
  onToggleFavorite,
  /** Opens the translation-model picker; absent where switching is unavailable. */
  onSwitchModel,
}: {
  translation: MessageTranslation;
  /** Overrides the outer spacing (a card, unlike a row, supplies its own). */
  style?: ViewStyle;
  /** The bot's switch for the read-aloud, share, and favorite actions. */
  showActions?: boolean;
  /** This message's translation is being read aloud right now. */
  speaking?: boolean;
  /** Reads the translated text; absent where voice is unavailable. */
  onSpeakText?: (text: string) => void;
  /** This translation is in the thread's favorites. */
  favorited?: boolean;
  /** Toggles this translation in the thread's favorites. */
  onToggleFavorite?: () => void;
  /** Opens the translation-model picker. */
  onSwitchModel?: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const blue = colorScheme === "dark" ? tokens.link : "#2f6bff";
  const background = colorScheme === "dark" ? tokens.accent : "#e8f1ff";
  const { status, result, error, expanded } = translation;

  if (!expanded || status === "idle") return null;

  // Tapping the model name opens the picker; without a handler it is plain text.
  const modelTextProps = onSwitchModel
    ? {
        onPress: onSwitchModel,
        accessibilityRole: "button" as const,
        accessibilityLabel: t("Switch translation model"),
      }
    : {};
  const modelLine =
    status === "done" && result
      ? result.usedFallback
        ? t("Translated with {model} (backup) · {source} to {target}", {
            model: result.modelId,
            source: translationSourceLabel(result.sourceLanguage),
            target: translationTargetLabel(result.targetLanguage),
          })
        : t("Translated with {model} · {source} to {target}", {
            model: result.modelId,
            source: translationSourceLabel(result.sourceLanguage),
            target: translationTargetLabel(result.targetLanguage),
          })
      : "";

  return (
    <View
      style={{
        backgroundColor: background,
        borderRadius: 12,
        padding: 12,
        marginTop: 2,
        marginBottom: 20,
        ...style,
      }}
    >
      {status === "loading" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={blue} />
          <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Translating…")}</Text>
        </View>
      ) : status === "done" && result ? (
        <>
          <Text style={{ fontSize: 13 }}>
            <Text style={{ color: blue, fontWeight: "700" }}>{t("Translate")}</Text>
            <Text style={{ color: tokens.mutedForeground }} {...modelTextProps}>
              {" · "}
              {modelLine}
            </Text>
          </Text>
          <Text selectable style={{ color: tokens.foreground, fontSize: 15, marginTop: 6 }}>
            {result.translatedText}
          </Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Copy translation")}
              onPress={() => {
                void Clipboard.setStringAsync(result.translatedText).catch(() => undefined);
              }}
              hitSlop={8}
            >
              <Text style={{ color: blue, fontSize: 14 }}>{t("Copy translation")}</Text>
            </Pressable>
            {showActions && onSpeakText ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={speaking ? t("Stop") : t("Speak message")}
                onPress={() => onSpeakText(result.translatedText)}
                hitSlop={8}
              >
                <Text style={{ color: blue, fontSize: 14 }}>
                  {speaking ? t("Stop") : t("Speak message")}
                </Text>
              </Pressable>
            ) : null}
            {showActions ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Share")}
                onPress={() => shareMessageText(result.translatedText)}
                hitSlop={8}
              >
                <Text style={{ color: blue, fontSize: 14 }}>{t("Share")}</Text>
              </Pressable>
            ) : null}
            {showActions && onToggleFavorite ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={favorited ? t("Unfavorite") : t("Favorite")}
                onPress={onToggleFavorite}
                hitSlop={8}
              >
                <Text style={{ color: blue, fontSize: 14 }}>
                  {favorited ? t("Unfavorite") : t("Favorite")}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Collapse")}
              onPress={translation.collapse}
              hitSlop={8}
            >
              <Text style={{ color: blue, fontSize: 14 }}>{t("Collapse")}</Text>
            </Pressable>
          </View>
        </>
      ) : status === "error" ? (
        <>
          <Text style={{ color: tokens.destructive, fontSize: 14 }}>
            {error ?? t("Translation failed. Try again.")}
          </Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Retry")}
              onPress={translation.translate}
              hitSlop={8}
            >
              <Text style={{ color: blue, fontSize: 14 }}>{t("Retry")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Collapse")}
              onPress={translation.collapse}
              hitSlop={8}
            >
              <Text style={{ color: blue, fontSize: 14 }}>{t("Collapse")}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>
            {t("Choose a translation model in Model settings first.")}
          </Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Collapse")}
              onPress={translation.collapse}
              hitSlop={8}
            >
              <Text style={{ color: blue, fontSize: 14 }}>{t("Collapse")}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
