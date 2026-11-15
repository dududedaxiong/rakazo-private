import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewStyle } from "react-native";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { shareMessageText } from "../../lib/message-context-menu";
import {
  describeModelError,
  modelErrorActionKinds,
  modelErrorActionLabel,
  modelErrorSummary,
} from "../../lib/model-error";
import { finalSwitchAttempt, translationModelSwitches } from "../../lib/model-switches";
import { useMobileTokens, useResolvedAppearance } from "../../lib/native";
import type {
  BotTranslationResult,
  BotTranslationSettings,
  TranslationSourceLanguage,
  TranslationTargetLanguage,
} from "../../lib/translation";
import {
  hasTranslationModel,
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  translateBotMessage,
  translationSourceLabel,
  translationTargetLabel,
} from "../../lib/translation";
import { errorText } from "../../lib/user-error";
import { BottomSheetShell, SheetHeader } from "../bottom-sheet-shell";
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

export type TranslationLanguageSwitch = {
  sourceLanguage?: TranslationSourceLanguage;
  targetLanguage?: TranslationTargetLanguage | null;
};

export type MessageTranslation = {
  status: MessageTranslationStatus;
  result: BotTranslationResult | null;
  error: string | null;
  /** Whether the translation area is open. */
  expanded: boolean;
  translate: (override?: TranslationLanguageSwitch) => void;
  collapse: () => void;
  /** The languages in effect, including a just-switched pair the bot snapshot has not caught up with yet. */
  settings: BotTranslationSettings;
  /** Saves a new language pair on the bot, then re-translates with it. */
  switchLanguage: (next: TranslationLanguageSwitch) => void;
  /** A language switch is in flight; the language sheet stays disabled until it lands. */
  languageApplying: boolean;
  /** The last language-switch failure, if any. */
  languageError: string | null;
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
  /**
   * A just-switched language pair, kept until the bot snapshot catches up:
   * the next translate after a switch must use the new languages even
   * before the parent re-renders with the updated bot.
   */
  const languageOverrideRef = useRef<TranslationLanguageSwitch | null>(null);
  const [languageApplying, setLanguageApplying] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);

  const translate = useCallback(
    (override?: TranslationLanguageSwitch) => {
      const { botId: currentBotId, text: currentText, settings: currentSettings } = argsRef.current;
      if (!currentBotId || !currentText.trim()) return;
      collapsedRef.current = false;
      setExpanded(true);
      const merged = {
        ...currentSettings,
        ...(languageOverrideRef.current ?? {}),
        ...(override ?? {}),
      };
      if (override) languageOverrideRef.current = { ...languageOverrideRef.current, ...override };
      // A null target means "follow the system language"; the settings type
      // carries that as "auto", which translateBotMessage resolves.
      const effective: BotTranslationSettings = {
        ...merged,
        targetLanguage: merged.targetLanguage ?? "auto",
      };
      if (!hasTranslationModel(effective)) {
        setStatus("no-model");
        return;
      }
      const runId = ++runRef.current;
      setStatus("loading");
      setError(null);
      void translateBotMessage(currentBotId, currentText, effective)
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
    },
    [t],
  );

  const translateRef = useRef(translate);
  translateRef.current = translate;

  /**
   * Switches the bot's translation languages, then re-translates with them —
   * the web's switchLanguage, in the same order: save, then translate with
   * the new pair (passed as an override, so it applies immediately).
   */
  const switchLanguage = useCallback(
    (next: TranslationLanguageSwitch) => {
      const { botId: currentBotId, settings: currentSettings } = argsRef.current;
      if (!currentBotId || languageApplying) return;
      const effective = { ...currentSettings, ...(languageOverrideRef.current ?? {}) };
      const sourceLanguage = next.sourceLanguage ?? effective.sourceLanguage;
      const targetLanguage =
        next.targetLanguage !== undefined ? next.targetLanguage : effective.targetLanguage;
      if (
        sourceLanguage === effective.sourceLanguage &&
        targetLanguage === effective.targetLanguage
      ) {
        return;
      }
      setLanguageApplying(true);
      setLanguageError(null);
      void rpc("bots/update", {
        botId: currentBotId,
        ...(next.sourceLanguage !== undefined
          ? { translationSourceLanguage: next.sourceLanguage }
          : {}),
        ...(next.targetLanguage !== undefined
          ? { translationTargetLanguage: next.targetLanguage }
          : {}),
      })
        .then(() => {
          languageOverrideRef.current = { sourceLanguage, targetLanguage };
          translateRef.current({ sourceLanguage, targetLanguage });
        })
        .catch((err: unknown) => {
          setLanguageError(errorText(err, t("Could not switch translation language")));
        })
        .finally(() => setLanguageApplying(false));
    },
    [languageApplying, t],
  );

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

  const languageOverride = languageOverrideRef.current;
  const effectiveSettings: BotTranslationSettings = {
    ...argsRef.current.settings,
    ...(languageOverride?.sourceLanguage !== undefined
      ? { sourceLanguage: languageOverride.sourceLanguage }
      : {}),
    targetLanguage:
      languageOverride?.targetLanguage === undefined
        ? argsRef.current.settings.targetLanguage
        : (languageOverride.targetLanguage ?? "auto"),
  };
  return {
    status,
    result,
    error,
    expanded,
    translate,
    collapse,
    settings: effectiveSettings,
    switchLanguage,
    languageApplying,
    languageError,
  };
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
  /** The bot's translation-model connection, for the timeline's provider label. */
  modelProvider,
  /** Opens the switch-history timeline; absent where it is unavailable (favorites). */
  onShowTimeline,
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
  modelProvider?: string | null;
  onShowTimeline?: () => void;
}) {
  const { t, locale } = useI18n();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const blue = colorScheme === "dark" ? tokens.link : "#2f6bff";
  const background = colorScheme === "dark" ? tokens.accent : "#e8f1ff";
  const { status, result, error, expanded } = translation;
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);
  const [keyChecking, setKeyChecking] = useState(false);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  // The failure in plain language, and the button that fixes its class.
  // Retrying an invalid key or a missing model cannot help, so those offer
  // the fix instead; a transient failure keeps its retry.
  const translationErrorSummary = error ? modelErrorSummary(t, error, locale, false) : null;
  const translationErrorKey = error ? describeModelError(error).key : "unknown";
  // The key check and the provider settings live behind a tap, so their
  // modules (API layer, router) load only then — the message row itself
  // stays light enough to render without them.
  const testTranslationKey = () => {
    if (!modelProvider || keyChecking) return;
    setKeyChecking(true);
    void (async () => {
      try {
        const { checkKeyForProvider } = await import("../../lib/key-health");
        const checked = await checkKeyForProvider(modelProvider);
        if (!checked) {
          Alert.alert(t("Could not check this key"));
          return;
        }
        const { keyCheckAlert } = await import("../../lib/model-error-alert");
        keyCheckAlert(t, checked.result);
      } catch (err) {
        Alert.alert(t("Could not check this key"), errorText(err, t("Try again.")));
      } finally {
        setKeyChecking(false);
      }
    })();
  };
  const translationErrorActions: { label: string; onPress: () => void; busy?: boolean }[] = [];
  for (const kind of modelErrorActionKinds(translationErrorKey)) {
    if (kind === "test-key") {
      if (modelProvider)
        translationErrorActions.push({
          label: modelErrorActionLabel(t, kind),
          onPress: testTranslationKey,
          busy: keyChecking,
        });
    } else if (kind === "switch-provider") {
      translationErrorActions.push({
        label: modelErrorActionLabel(t, kind),
        onPress: () => {
          void import("../../lib/model-settings").then(({ openModelSettings }) =>
            openModelSettings(),
          );
        },
      });
    } else if (kind === "change-model") {
      if (onSwitchModel)
        translationErrorActions.push({
          label: modelErrorActionLabel(t, kind),
          onPress: onSwitchModel,
        });
    } else if (kind === "try-later" || kind === "check-network") {
      translationErrorActions.push({
        label: modelErrorActionLabel(t, kind),
        onPress: () => translation.collapse(),
      });
    } else if (kind === "retry") {
      translationErrorActions.push({
        label: modelErrorActionLabel(t, kind),
        onPress: () => translation.translate(),
      });
    }
  }

  if (!expanded || status === "idle") return null;

  // Tapping the model name opens the picker; without a handler it is plain text.
  const modelTextProps = onSwitchModel
    ? {
        onPress: onSwitchModel,
        accessibilityRole: "button" as const,
        accessibilityLabel: t("Switch translation model"),
      }
    : {};
  // Tapping the language direction opens the language sheet instead: the
  // whole header used to be one pressable that opened the model picker.
  const languageTextProps = {
    onPress: () => setLanguageSheetOpen(true),
    accessibilityRole: "button" as const,
    accessibilityLabel: t("Translation languages"),
  };
  // The header renders as the same sentence as before — "用 {model} 翻译 ·
  // {source} to {target}" — split into three segments so each opens its own
  // sheet: "翻译 · " is static, the model name switches models, the language
  // direction switches languages.
  const modelLabel =
    status === "done" && result
      ? result.usedFallback
        ? t("Translated with {model} (backup)", { model: result.modelId })
        : t("Translated with {model}", { model: result.modelId })
      : "";
  const languageLabel =
    status === "done" && result
      ? `${translationSourceLabel(result.sourceLanguage)} to ${translationTargetLabel(result.targetLanguage)}`
      : "";
  // The switch history for this panel only: the attempts the server sent,
  // or the single succeeded try when it sent none.
  const timelineSwitches =
    status === "done" && result ? translationModelSwitches(result, modelProvider ?? null) : null;
  const finalAttempt = timelineSwitches ? finalSwitchAttempt(timelineSwitches) : undefined;
  const showTimelineBar = Boolean(timelineSwitches && onShowTimeline && finalAttempt);

  return (
    <>
      <View
        style={{
          backgroundColor: background,
          borderRadius: 12,
          padding: 12,
          marginTop: 2,
          marginBottom: showTimelineBar ? 8 : 20,
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
              <Text style={{ color: tokens.mutedForeground }}>{" · "}</Text>
              <Text style={{ color: blue }} {...modelTextProps}>
                {modelLabel}
              </Text>
              <Text style={{ color: tokens.mutedForeground }}>{" · "}</Text>
              <Text style={{ color: blue }} {...languageTextProps}>
                {languageLabel}
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
              {translationErrorSummary ?? t("Translation failed. Try again.")}
            </Text>
            {errorDetailsOpen && error ? (
              <Text
                selectable
                style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 8 }}
              >
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
              {translationErrorActions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  disabled={action.busy}
                  onPress={action.onPress}
                  hitSlop={8}
                >
                  <Text style={{ color: blue, fontSize: 14, opacity: action.busy ? 0.5 : 1 }}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
              {translationErrorKey === "unknown" && error ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Details")}
                  onPress={() => setErrorDetailsOpen((open) => !open)}
                  hitSlop={8}
                >
                  <Text style={{ color: blue, fontSize: 14 }}>{t("Details")}</Text>
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
      {showTimelineBar && finalAttempt && onShowTimeline ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Switch history")}
          onPress={onShowTimeline}
          hitSlop={4}
          style={{ marginBottom: 20 }}
        >
          <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
            {t("Active model")}:{" "}
            <Text style={{ color: tokens.foreground, fontWeight: "600" }}>
              {finalAttempt.model}
              {finalAttempt.provider ? ` · ${finalAttempt.provider}` : ""}
            </Text>{" "}
            <Text style={{ color: tokens.mutedForeground }}>›</Text>
          </Text>
        </Pressable>
      ) : null}
      <TranslationLanguageSheet
        visible={languageSheetOpen}
        source={translation.settings.sourceLanguage}
        target={translation.settings.targetLanguage}
        applying={translation.languageApplying}
        error={translation.languageError}
        onSelectSource={(code) => {
          setLanguageSheetOpen(false);
          translation.switchLanguage({ sourceLanguage: code });
        }}
        onSelectTarget={(code) => {
          setLanguageSheetOpen(false);
          translation.switchLanguage({ targetLanguage: code });
        }}
        onClose={() => setLanguageSheetOpen(false)}
      />
    </>
  );
}

/**
 * The translation language sheet: a source group and a target group, each
 * with the current language checked. Picking one saves it on the bot and
 * re-translates the message with the new direction at once.
 */
function TranslationLanguageSheet({
  visible,
  source,
  target,
  applying,
  error,
  onSelectSource,
  onSelectTarget,
  onClose,
}: {
  visible: boolean;
  source: TranslationSourceLanguage;
  target: TranslationTargetLanguage;
  applying: boolean;
  error: string | null;
  onSelectSource: (code: TranslationSourceLanguage) => void;
  onSelectTarget: (code: TranslationTargetLanguage) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const blue = colorScheme === "dark" ? tokens.link : "#2f6bff";
  const row = (code: string, label: string, selected: boolean, onSelect: () => void) => (
    <Pressable
      key={code}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      disabled={applying}
      onPress={onSelect}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 11,
        opacity: applying ? 0.5 : 1,
      }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 15 }}>{label}</Text>
      {selected ? <Text style={{ color: blue, fontSize: 15, fontWeight: "700" }}>✓</Text> : null}
    </Pressable>
  );
  return (
    <BottomSheetShell visible={visible} label={t("Translation languages")} onClose={onClose}>
      <SheetHeader title={t("Translation languages")} onClose={onClose} />
      <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 8 }}>
        {t("Source language")}
      </Text>
      {TRANSLATION_SOURCE_LANGUAGES.map((code) =>
        row(code, translationSourceLabel(code), code === source, () => onSelectSource(code)),
      )}
      <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 12 }}>
        {t("Target language")}
      </Text>
      {TRANSLATION_TARGET_LANGUAGES.map((code) =>
        row(code, translationTargetLabel(code), code === target, () => onSelectTarget(code)),
      )}
      {error ? (
        <Text style={{ color: tokens.destructive, fontSize: 14, marginTop: 12 }}>{error}</Text>
      ) : null}
    </BottomSheetShell>
  );
}
