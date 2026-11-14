import type {
  Bot,
  BotAvatarSet,
  BotModelEntry,
  BotPromptPreset,
  ComputerMode,
  ReplyMode,
  ThinkingLevel,
} from "@rakazo/contracts";
import {
  activeBotPromptPreset,
  BOT_AVATAR_SHAPE_COUNT,
  BOT_COLORS,
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_MODEL_LIST_MAX,
  BOT_NAME_MAX_LENGTH,
  moveBotModelToFront,
  resolveBotAvatarSet,
} from "@rakazo/contracts";
import {
  credentialForModel,
  MODEL_SEARCH_THRESHOLD,
  modelOptionKey,
  parseModelOptionKey,
  resolveSelectableModelId,
} from "@rakazo/core";
import { typeScale } from "@rakazo/ui-tokens";
import * as ImagePicker from "expo-image-picker";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { Voice } from "expo-speech";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BotAvatar } from "../components/bot-avatar";
import { BotContextCards } from "../components/bot-context-cards";
import { ComputerModePicker } from "../components/computer-mode-picker";
import { glassHeaderOptions } from "../components/glass-title";
import { GrowingTextInput } from "../components/growing-text-input";
import type { MenuPickerChoice } from "../components/menu-picker";
import { MenuPicker, MenuPickerMenu } from "../components/menu-picker";
import { NativeActionButton } from "../components/native-action-button";
import { NativeSymbol } from "../components/native-symbol";
import { ProfileEditDialog } from "../components/profile-edit-dialog";
import { Chevron } from "../components/row-accessories";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
  SettingsSwitch,
} from "../components/settings-group";
import { PromptPresetSection } from "../components/thread/prompt-preset-section";
import { currentApiBase, rpc, selectedSpaceId } from "../lib/api";
import {
  avatarColor,
  avatarShape,
  isAvatarPhoto,
  withAvatarColor,
  withAvatarShape,
} from "../lib/bot-avatar-edit";
import { deviceVoices, setVoiceForBot, voiceForBot, voiceLabel } from "../lib/bot-voices";
import { chatModelPickerChoices } from "../lib/chat-model";
import { COMPUTER_LIFECYCLE_TIMEOUT_MS } from "../lib/computer";
import { setComputerFloatEnabled, useComputerFloatEnabled } from "../lib/computer-float-settings";
import { notifyConversationCleared } from "../lib/conversation-cleared";
import { loadDeviceVoiceEnabled } from "../lib/device-voice";
import type { ExpressionFaceSlot } from "../lib/expression-avatar";
import {
  isExpressionPackUrl,
  refreshExpressionSubscription,
  restoreExpressionFace,
  saveExpressionFaceFile,
  setExpressionFace,
  setExpressionPack,
  subscribeExpressionPack,
  unsubscribeExpressionPack,
  useExpressionFaces,
  useExpressionPack,
  useExpressionSubscription,
} from "../lib/expression-avatar";
import { useI18n } from "../lib/i18n";
import { afterChatNotifyChange } from "../lib/live-notifications";
import type { MobileMe, MobileModel, MobileModelCredential } from "../lib/mobile-types";
import { native, useMobileTokens } from "../lib/native";
import { createQueuedSave } from "../lib/queued-save";
import { loadSessionToken } from "../lib/session";
import { useSideInsets } from "../lib/side-insets";
import { thinkingLevelLabel } from "../lib/thinking-level";
import type { TranslationSourceLanguage, TranslationTargetLanguage } from "../lib/translation";
import {
  isTranslationTargetLanguage,
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  translationSourceLabel,
  translationTargetLabel,
  translationTargetShortLabel,
} from "../lib/translation";
import { errorText } from "../lib/user-error";
import { stopVoicePlayback } from "../lib/voice";

const NativeBotPackageTools = lazy(() =>
  import("../components/bot-package-tools").then((module) => ({
    default: module.NativeBotPackageTools,
  })),
);

/** One media-capability probe: idle until tested, then the inline result. */
type MediaModelTestState =
  | { status: "idle" }
  | { status: "testing"; modelKey: string }
  | {
      status: "done";
      supported: boolean;
      seconds: number;
      detail: string;
      modelKey: string;
      modelId: string;
    };

/** True when two ordered model lists hold the same entries in the same order. */
function sameModelList(
  a: readonly BotModelEntry[] | null | undefined,
  b: readonly BotModelEntry[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return (
    left.length === right.length &&
    left.every((item, i) => item.provider === right[i]?.provider && item.model === right[i]?.model)
  );
}

/** True when two preset lists hold the same names and prompts in the same order. */
function samePresetList(
  a: readonly BotPromptPreset[] | null | undefined,
  b: readonly BotPromptPreset[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return (
    left.length === right.length &&
    left.every((item, i) => item.name === right[i]?.name && item.prompt === right[i]?.prompt)
  );
}

/**
 * One ordered model list: each row shows its rank (primary first, then
 * fallbacks), a test button where one exists, up/down reorder, and remove.
 * The test result stays inline under the tested row, with a one-tap
 * "set as primary" when a tested fallback supports the kind.
 */
function OrderedModelList({
  kind,
  label,
  models,
  onChange,
  addChoices,
  catalog,
  test,
  onTest,
  onApplyPrimary,
  testable,
  labelFor,
}: {
  kind: "video" | "image" | "translation";
  label: string;
  models: BotModelEntry[];
  onChange: (next: BotModelEntry[]) => void;
  addChoices: MenuPickerChoice[];
  catalog: MobileModel[];
  test?: MediaModelTestState;
  onTest?: (entry: BotModelEntry) => void;
  onApplyPrimary?: () => void;
  testable: boolean;
  labelFor: (entry: BotModelEntry) => string;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const move = (index: number, delta: -1 | 1) => {
    const next = [...models];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    onChange(next);
  };
  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Text style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      </View>
      {models.length === 0 ? (
        <Text
          style={{
            color: tokens.mutedForeground,
            fontSize: 13,
            paddingHorizontal: 16,
            paddingTop: 8,
          }}
        >
          {t("Not set")}
        </Text>
      ) : null}
      {models.map((entry, index) => {
        const key = modelOptionKey(entry.provider, entry.model);
        const isPrimary = index === 0;
        const tested = test?.status === "done" && test.modelKey === key;
        const testing = test?.status === "testing" && testable && test.modelKey === key;
        return (
          <View key={key}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  color: isPrimary ? tokens.link : tokens.mutedForeground,
                  fontSize: 13,
                  fontWeight: isPrimary ? "600" : "400",
                  minWidth: 36,
                }}
              >
                {isPrimary ? t("Primary") : `#${index + 1}`}
              </Text>
              <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15 }} numberOfLines={1}>
                {labelFor(entry)}
              </Text>
              {testable ? (
                <NativeActionButton
                  accessibilityLabel={t("Test this model")}
                  busy={testing}
                  label={t("Test")}
                  onPress={() => onTest?.(entry)}
                  prominence="secondary"
                  size="compact"
                />
              ) : null}
              <Pressable
                accessibilityLabel={t("Move up")}
                accessibilityRole="button"
                disabled={index === 0}
                onPress={() => move(index, -1)}
                style={{
                  minWidth: 32,
                  minHeight: 32,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{ color: index === 0 ? tokens.border : tokens.foreground, fontSize: 16 }}
                >
                  ↑
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t("Move down")}
                accessibilityRole="button"
                disabled={index === models.length - 1}
                onPress={() => move(index, 1)}
                style={{
                  minWidth: 32,
                  minHeight: 32,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: index === models.length - 1 ? tokens.border : tokens.foreground,
                    fontSize: 16,
                  }}
                >
                  ↓
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t("Remove this model")}
                accessibilityRole="button"
                onPress={() => onChange(models.filter((item) => item !== entry))}
                style={{
                  minWidth: 32,
                  minHeight: 32,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: tokens.destructive, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
            {tested && test.status === "done" ? (
              <Text
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 8,
                  fontSize: 13,
                  color: test.supported ? tokens.success : tokens.destructive,
                }}
              >
                {test.supported
                  ? kind === "video"
                    ? t("✓ {model} supports video generation · {seconds}s", {
                        model: test.modelId,
                        seconds: test.seconds,
                      })
                    : t("✓ {model} supports image generation · {seconds}s", {
                        model: test.modelId,
                        seconds: test.seconds,
                      })
                  : kind === "video"
                    ? t("✗ Does not support video generation · {reason}", { reason: test.detail })
                    : t("✗ Does not support image generation · {reason}", { reason: test.detail })}
              </Text>
            ) : null}
            {tested && test.status === "done" && test.supported && !isPrimary ? (
              <Pressable
                accessibilityRole="button"
                onPress={onApplyPrimary}
                style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: tokens.link, fontSize: 15 }}>{t("Set as primary")}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {addChoices.length > 0 && models.length < BOT_MODEL_LIST_MAX ? (
        <MenuPickerMenu
          label={
            kind === "video"
              ? t("Add video backup")
              : kind === "image"
                ? t("Add image backup")
                : t("Add backup")
          }
          choices={addChoices}
          value=""
          onChange={(key) => {
            const parsed = parseModelOptionKey(key);
            if (!parsed) return;
            onChange([
              ...models,
              {
                provider: parsed.provider,
                model: resolveSelectableModelId(catalog, parsed.provider, parsed.modelId),
              },
            ]);
          }}
        >
          <View>
            <SettingsRow
              accessibilityLabel={
                kind === "video"
                  ? t("Add video backup")
                  : kind === "image"
                    ? t("Add image backup")
                    : t("Add backup")
              }
              accessibilityRole="button"
              accessible
              title={
                kind === "video"
                  ? t("Add video backup")
                  : kind === "image"
                    ? t("Add image backup")
                    : t("Add backup")
              }
              trailing={
                <NativeSymbol
                  android="chevron-expand"
                  color={native.tertiaryLabel}
                  ios="chevron.up.chevron.down"
                  size={13}
                />
              }
            />
          </View>
        </MenuPickerMenu>
      ) : null}
    </>
  );
}

export default function BotSettingsScreen() {
  const sideInsets = useSideInsets();
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const router = useRouter();
  const {
    botId,
    model: pickedModel,
    focus,
  } = useLocalSearchParams<{ botId: string; model?: string; focus?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const modelY = useRef(0);
  const [bot, setBot] = useState<Bot | null>(null);
  const threadId = useRef<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState<string>(BOT_COLORS[0]);
  const [computerMode, setComputerMode] = useState<ComputerMode>("team");
  const [avatarSet, setAvatarSet] = useState<BotAvatarSet>("organic");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const expressionPack = useExpressionPack(botId);
  const computerFloatEnabled = useComputerFloatEnabled(botId);
  const [advancedOpen, setAdvancedOpen] = useState(focus === "model" || pickedModel !== undefined);
  const [packageOpen, setPackageOpen] = useState(false);
  const [modelKey, setModelKey] = useState("");
  const [translationModels, setTranslationModels] = useState<BotModelEntry[]>([]);
  const [videoModels, setVideoModels] = useState<BotModelEntry[]>([]);
  const [imageModels, setImageModels] = useState<BotModelEntry[]>([]);
  const [videoPresets, setVideoPresets] = useState<BotPromptPreset[]>([]);
  const [activeVideoPreset, setActiveVideoPreset] = useState<string | null>(null);
  const [imagePresets, setImagePresets] = useState<BotPromptPreset[]>([]);
  const [activeImagePreset, setActiveImagePreset] = useState<string | null>(null);
  const [videoTest, setVideoTest] = useState<MediaModelTestState>({ status: "idle" });
  const [imageTest, setImageTest] = useState<MediaModelTestState>({ status: "idle" });
  const [translationSource, setTranslationSource] = useState<TranslationSourceLanguage>("auto");
  const [translationTarget, setTranslationTarget] = useState<TranslationTargetLanguage>("auto");
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [showTranslationActions, setShowTranslationActions] = useState(true);
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [notifyOnFinish, setNotifyOnFinish] = useState(true);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [dailyCheckIns, setDailyCheckIns] = useState(true);
  const [crossSpaceCommunication, setCrossSpaceCommunication] = useState(true);
  const [fleetManagement, setFleetManagement] = useState(true);
  const [replyMode, setReplyMode] = useState<ReplyMode>("chat");
  const [credentials, setCredentials] = useState<MobileModelCredential[]>([]);
  const [catalog, setCatalog] = useState<MobileModel[]>([]);
  const [me, setMe] = useState<MobileMe | null>(null);
  const userId = me?.userId;
  const faces = useExpressionFaces(userId, botId);
  const subscription = useExpressionSubscription(userId, botId);
  const [packUrl, setPackUrl] = useState("");
  const [packError, setPackError] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [modelMetaReady, setModelMetaReady] = useState(false);
  const [modelMetaError, setModelMetaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceVoiceEnabled, setDeviceVoiceEnabled] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string | undefined>();
  const savedVoiceId = useRef<string | undefined>(undefined);
  const voiceChoice = useRef(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const crossSpaceSave = useMemo(
    () =>
      createQueuedSave<boolean>(false, {
        save: async (value) => {
          await rpc("bots/update", { botId, crossSpaceCommunication: value });
        },
        onChange: setCrossSpaceCommunication,
        onError: (err) => setError(errorText(err, t("Could not save bot"))),
      }),
    [botId, t],
  );
  const dailyCheckInsSave = useMemo(
    () =>
      createQueuedSave<boolean>(true, {
        save: async (value) => {
          await rpc("bots/update", { botId, dailyCheckIns: value });
        },
        onChange: setDailyCheckIns,
        onError: (err) => setError(errorText(err, t("Could not save bot"))),
      }),
    [botId, t],
  );

  const fleetSave = useMemo(
    () =>
      createQueuedSave<boolean>(false, {
        save: async (value) => {
          await rpc("bots/update", { botId, fleetManagement: value });
        },
        onChange: setFleetManagement,
        onError: (err) => setError(errorText(err, t("Could not save bot"))),
      }),
    [botId, t],
  );

  const replyModeSave = useMemo(
    () =>
      createQueuedSave<ReplyMode>("chat", {
        save: async (value) => {
          await rpc("bots/update", { botId, replyMode: value });
        },
        onChange: setReplyMode,
        onError: (err) => setError(errorText(err, t("Could not save bot"))),
      }),
    [botId, t],
  );

  const notifySave = useMemo(
    () =>
      createQueuedSave<boolean>(true, {
        save: async (notifyOnFinish) => {
          const next = await rpc("bots/update", { botId, notifyOnFinish });
          threadId.current = next.threadId;
        },
        onChange: setNotifyOnFinish,
        onSaved: async (notify) => {
          try {
            await afterChatNotifyChange(
              currentApiBase(),
              await loadSessionToken(),
              selectedSpaceId() ?? "",
              { botId, threadId: threadId.current, notify },
            );
          } catch {
            // The server save succeeded; device reconciliation can retry later.
          }
        },
        onError: (err) => setError(errorText(err)),
      }),
    [botId],
  );
  const nameSave = useMemo(
    () =>
      createQueuedSave<string>("", {
        save: async (name) => {
          await rpc("bots/update", { botId, name });
        },
        onChange: setName,
        onSaved: async (name) => {
          setBot((prev) => (prev ? { ...prev, name } : prev));
        },
        onError: (err) => setError(errorText(err)),
      }),
    [botId],
  );

  useEffect(() => {
    if (!botId) return;
    void rpc("bots/get", { botId })
      .then((next) => {
        threadId.current = next.threadId;
        setBot(next);
        setName(next.name);
        nameSave.reset(next.name);
        notifySave.reset(next.notifyOnFinish ?? true);
        setDescription(next.description ?? "");
        setInstructions(next.instructions ?? "");
        setColor(next.color);
        setAvatarSet(resolveBotAvatarSet(next.avatarSet));
        setComputerMode(next.computerMode);
        setModelKey(
          next.modelProvider && next.modelId
            ? modelOptionKey(next.modelProvider, next.modelId)
            : "",
        );
        setThinkingLevel(next.thinkingLevel ?? "");
        setTranslationModels(next.translationModels ?? []);
        setVideoModels(next.videoModels ?? []);
        setImageModels(next.imageModels ?? []);
        setVideoPresets(next.videoPromptPresets ?? []);
        setActiveVideoPreset(next.activeVideoPromptPreset ?? null);
        setImagePresets(next.imagePromptPresets ?? []);
        setActiveImagePreset(next.activeImagePromptPreset ?? null);
        setTranslationSource(next.translationSourceLanguage ?? "auto");
        setTranslationTarget(
          next.translationTargetLanguage &&
            isTranslationTargetLanguage(next.translationTargetLanguage)
            ? next.translationTargetLanguage
            : "auto",
        );
        setAutoTranslate(next.autoTranslate ?? false);
        setShowTranslationActions(next.showTranslationActions ?? true);
        setAutoSpeak(next.autoSpeak);
        setNotifyOnFinish(next.notifyOnFinish ?? true);
        setDailyCheckIns(next.dailyCheckIns ?? true);
        dailyCheckInsSave.reset(next.dailyCheckIns ?? true);
        setCrossSpaceCommunication(next.crossSpaceCommunication ?? true);
        crossSpaceSave.reset(next.crossSpaceCommunication ?? true);
        setFleetManagement(next.fleetManagement);
        fleetSave.reset(next.fleetManagement);
        setReplyMode(next.replyMode);
        replyModeSave.reset(next.replyMode);
      })
      .catch((err) => setError(errorText(err, t("Could not load bot"))));
  }, [botId, dailyCheckInsSave, crossSpaceSave, fleetSave, replyModeSave, notifySave, nameSave]);

  useEffect(() => {
    void Promise.all([rpc("me"), rpc("models/list"), rpc("models/credentials")])
      .then(([nextMe, nextCatalog, nextCredentials]) => {
        setMe(nextMe);
        setCatalog(nextCatalog);
        setCredentials(nextCredentials);
        setModelMetaError(null);
        setModelMetaReady(true);
      })
      .catch((err) => {
        setModelMetaReady(false);
        setModelMetaError(errorText(err, t("Could not load model settings")));
      });
  }, [t]);

  const storedModel = modelKey ? parseModelOptionKey(modelKey) : null;
  const selectedModel = storedModel
    ? {
        provider: storedModel.provider,
        modelId: resolveSelectableModelId(catalog, storedModel.provider, storedModel.modelId),
      }
    : null;
  const selectedModelKey = selectedModel
    ? modelOptionKey(selectedModel.provider, selectedModel.modelId)
    : "";

  const effectiveProvider = selectedModel?.provider ?? me?.defaultProvider ?? null;
  const effectiveModelId = selectedModel?.modelId ?? me?.defaultModel ?? null;
  const effectiveEntry =
    effectiveProvider && effectiveModelId
      ? catalog.find(
          (entry) =>
            entry.provider === effectiveProvider &&
            resolveSelectableModelId(catalog, entry.provider, entry.id) === effectiveModelId,
        )
      : undefined;
  const effectiveCredential = credentialForModel(credentials, effectiveProvider, effectiveModelId);
  const thinkingOptions = (
    effectiveCredential?.thinkingLevels ??
    effectiveEntry?.thinkingLevels ??
    []
  ).filter((level) => level !== "off");

  const modelChoices = useMemo(
    () => chatModelPickerChoices(me, catalog, credentials, selectedModelKey, t),
    [catalog, credentials, me, selectedModelKey, t],
  );

  // The "add backup" pickers list detected models not already in the list.
  const addChoices = (models: BotModelEntry[]): MenuPickerChoice[] => {
    const used = new Set<string>();
    for (const entry of models) {
      used.add(modelOptionKey(entry.provider, entry.model));
      used.add(
        modelOptionKey(
          entry.provider,
          resolveSelectableModelId(catalog, entry.provider, entry.model),
        ),
      );
    }
    return modelChoices.slice(1).filter((choice) => !used.has(choice.key));
  };
  const labelForModelEntry = (entry: BotModelEntry): string => {
    const found = catalog.find(
      (item) =>
        item.provider === entry.provider &&
        (item.id === entry.model ||
          resolveSelectableModelId(catalog, item.provider, item.id) === entry.model),
    );
    return found?.label ?? entry.model;
  };
  const translationTargetChoices: MenuPickerChoice[] = useMemo(
    () =>
      TRANSLATION_TARGET_LANGUAGES.map((code) => ({
        key: code,
        label: translationTargetLabel(code),
      })),
    [],
  );

  const thinkingChoices: MenuPickerChoice[] = useMemo(
    () => [
      { key: "", label: t("Default") },
      ...thinkingOptions.map((level) => ({
        key: level,
        label: thinkingLevelLabel(level, t),
      })),
    ],
    [t, thinkingOptions],
  );

  useEffect(() => {
    if (focus === "model") setAdvancedOpen(true);
  }, [focus]);

  function selectModel(key: string) {
    if (key === selectedModelKey) return;
    setModelKey(key);
    setThinkingLevel("");
  }

  // The searchable model list hands its pick back as a one-shot route param.
  useEffect(() => {
    if (pickedModel === undefined) return;
    router.setParams({ model: undefined });
    setAdvancedOpen(true);
    selectModel(pickedModel);
  }, [pickedModel]);

  function applyVoices(available: Voice[], assigned: string | undefined) {
    setVoices(available);
    savedVoiceId.current = assigned;
    setVoiceId(assigned);
    setVoiceError(null);
  }

  function failVoices() {
    setVoices([]);
    setVoiceError(t("Could not load voices"));
  }

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void loadDeviceVoiceEnabled()
        .then((enabled) => {
          if (current) setDeviceVoiceEnabled(enabled);
        })
        .catch(() => {
          if (current) setDeviceVoiceEnabled(false);
        });
      return () => {
        current = false;
      };
    }, []),
  );

  useEffect(() => {
    if (!botId || !deviceVoiceEnabled) return;
    let current = true;
    void Promise.all([deviceVoices(), voiceForBot(botId)])
      .then(([available, assigned]) => {
        if (!current) return;
        applyVoices(available, assigned);
      })
      .catch(() => {
        if (!current) return;
        failVoices();
      });
    return () => {
      current = false;
    };
  }, [botId, deviceVoiceEnabled, t]);

  async function chooseVoice(voice: Voice) {
    if (!botId) return;
    // Picking a voice cuts off a reply in progress before the sample starts.
    stopVoicePlayback();
    const choice = ++voiceChoice.current;
    setVoiceId(voice.identifier);
    setError(null);
    try {
      await setVoiceForBot(botId, voice.identifier);
      savedVoiceId.current = voice.identifier;
    } catch {
      if (choice !== voiceChoice.current) return;
      setVoiceId(savedVoiceId.current);
      setError(t("Could not save that voice"));
      return;
    }
    if (choice !== voiceChoice.current) return;
    try {
      // Native speech loads only when a voice is previewed, as in lib/voice.
      const Speech = await import("expo-speech");
      if (choice !== voiceChoice.current) return;
      await Speech.stop();
      if (choice !== voiceChoice.current) return;
      const sampleName = name.trim();
      Speech.speak(
        sampleName ? t("Hi, I'm {name}.", { name: sampleName }) : t("Hi, this is how I'll sound."),
        { voice: voice.identifier },
      );
    } catch {
      // The choice is already saved. A sample that cannot play is not a failed save.
    }
  }

  const currentVoice = voices.find((voice) => voice.identifier === voiceId);
  const currentVoiceLabel = currentVoice ? voiceLabel(currentVoice) : t("Default");

  async function retryDeviceVoices() {
    if (!botId) return;
    try {
      const [available, assigned] = await Promise.all([deviceVoices(), voiceForBot(botId)]);
      applyVoices(available, assigned);
    } catch {
      failVoices();
    }
  }

  const faceLabels: Record<ExpressionFaceSlot, string> = {
    thinking: t("Thinking"),
    searching: t("Searching"),
    working: t("Working"),
    waiting: t("Waiting"),
    done: t("Done"),
    error: t("Error"),
  };

  async function replaceFace(face: ExpressionFaceSlot) {
    if (!botId || !userId || packBusy) return;
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
    } catch {
      Alert.alert(t("Could not load that file"), t("Try again."));
      return;
    }
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;
    setPackBusy(true);
    try {
      const saved = await saveExpressionFaceFile(
        userId,
        botId,
        face,
        asset.uri,
        asset.fileName ?? "face",
        "local",
      );
      setExpressionFace(userId, botId, face, {
        uri: saved.uri,
        source: "local",
        name: saved.name,
      });
    } catch {
      Alert.alert(t("Could not load that file"), t("Try again."));
    } finally {
      setPackBusy(false);
    }
  }

  function onFacePress(face: ExpressionFaceSlot, customized: boolean) {
    if (!botId || !userId) return;
    Alert.alert(faceLabels[face], undefined, [
      { text: t("Replace"), onPress: () => void replaceFace(face) },
      ...(customized
        ? [
            {
              text: t("Restore built-in"),
              onPress: () => restoreExpressionFace(userId, botId, face),
            },
          ]
        : []),
      { text: t("Cancel"), style: "cancel" },
    ]);
  }

  async function subscribePack() {
    if (!botId || !userId || packBusy) return;
    const trimmed = packUrl.trim();
    if (!isExpressionPackUrl(trimmed)) {
      setPackError(t("Subscription failed. Check the address and try again."));
      return;
    }
    setPackBusy(true);
    setPackError(null);
    const result = await subscribeExpressionPack(userId, botId, trimmed);
    setPackBusy(false);
    if (result.status === "error") {
      setPackError(t("Subscription failed. Check the address and try again."));
      return;
    }
    setPackUrl("");
    setPackError(null);
  }

  async function refreshPack() {
    if (!botId || !userId || packBusy) return;
    setPackBusy(true);
    setPackError(null);
    const result = await refreshExpressionSubscription(userId, botId);
    setPackBusy(false);
    if (result.status === "error") {
      setPackError(t("Subscription failed. Check the address and try again."));
    }
  }

  function cancelPack() {
    if (!botId || !userId || packBusy) return;
    unsubscribeExpressionPack(userId, botId);
    setPackError(null);
  }

  async function testMediaModel(kind: "video" | "image", entry: BotModelEntry) {
    if (!botId) return;
    const selected = {
      provider: entry.provider,
      modelId: resolveSelectableModelId(catalog, entry.provider, entry.model),
    };
    const setTest = kind === "video" ? setVideoTest : setImageTest;
    const started = Date.now();
    const seconds = () => Math.round(((Date.now() - started) / 1000) * 10) / 10;
    setTest({ status: "testing", modelKey: modelOptionKey(entry.provider, entry.model) });
    try {
      // The probe runs with the active preset, so the test reflects real usage.
      const preset =
        kind === "video"
          ? activeBotPromptPreset(videoPresets, activeVideoPreset)
          : activeBotPromptPreset(imagePresets, activeImagePreset);
      const result = await rpc("bots/testMediaModel", {
        botId,
        kind,
        provider: selected.provider,
        modelId: selected.modelId,
        ...(preset ? { presetPrompt: preset.prompt } : {}),
      });
      setTest({
        status: "done",
        supported: result.supported,
        seconds: result.seconds,
        detail: result.detail,
        modelKey: modelOptionKey(selected.provider, selected.modelId),
        modelId: selected.modelId,
      });
    } catch (err) {
      setTest({
        status: "done",
        supported: false,
        seconds: seconds(),
        detail: errorText(err, t("Could not test this model")),
        modelKey: modelOptionKey(selected.provider, selected.modelId),
        modelId: selected.modelId,
      });
    }
  }

  /** Applies a tested model in one tap: it moves to primary, the rest stay as fallbacks. */
  async function applyTestedMediaModel(kind: "video" | "image") {
    if (!botId || !bot) return;
    const test = kind === "video" ? videoTest : imageTest;
    if (test.status !== "done" || !test.supported) return;
    const parsed = parseModelOptionKey(test.modelKey);
    if (!parsed) return;
    const models = kind === "video" ? videoModels : imageModels;
    const next = moveBotModelToFront(models, { provider: parsed.provider, model: parsed.modelId });
    if (kind === "video") setVideoModels(next);
    else setImageModels(next);
    try {
      const updated = await rpc(
        "bots/update",
        kind === "video" ? { botId, videoModels: next } : { botId, imageModels: next },
      );
      setBot((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(errorText(err, t("Could not save bot")));
    }
  }

  async function save() {
    if (!botId || !bot || pending) return;
    setPending(true);
    setError(null);
    try {
      const profile = { description: description.trim() };
      const selected = selectedModel;
      const input: {
        botId: string;
        description?: string;
        instructions?: string;
        expectedInstructions?: string;
        color?: string;
        avatarSet?: BotAvatarSet;
        modelProvider?: string | null;
        modelId?: string | null;
        thinkingLevel?: ThinkingLevel | null;
        autoSpeak?: boolean;
        translationModels?: BotModelEntry[] | null;
        videoModels?: BotModelEntry[] | null;
        imageModels?: BotModelEntry[] | null;
        videoPromptPresets?: BotPromptPreset[] | null;
        activeVideoPromptPreset?: string | null;
        imagePromptPresets?: BotPromptPreset[] | null;
        activeImagePromptPreset?: string | null;
        translationSourceLanguage?: TranslationSourceLanguage;
        translationTargetLanguage?: TranslationTargetLanguage | null;
        autoTranslate?: boolean;
        showTranslationActions?: boolean;
      } = { botId };
      if (profile.description !== (bot.description ?? "")) {
        input.description = profile.description;
      }
      if (instructions !== bot.instructions) {
        input.instructions = instructions;
        input.expectedInstructions = bot.instructions;
      }
      if (color !== bot.color) input.color = color;
      if (avatarSet !== resolveBotAvatarSet(bot.avatarSet)) input.avatarSet = avatarSet;
      const modelChanged =
        (selected?.provider ?? null) !== (bot.modelProvider ?? null) ||
        (selected?.modelId ?? null) !== (bot.modelId ?? null);
      const thinkingChanged = (thinkingLevel || null) !== (bot.thinkingLevel ?? null);
      if (modelChanged) {
        input.modelProvider = selected?.provider ?? null;
        input.modelId = selected?.modelId ?? null;
      }
      if (modelMetaReady && (modelChanged || thinkingChanged)) {
        input.thinkingLevel = thinkingOptions.length
          ? ((thinkingLevel || null) as ThinkingLevel | null)
          : null;
      }
      if (autoSpeak !== bot.autoSpeak) input.autoSpeak = autoSpeak;
      if (!sameModelList(translationModels, bot.translationModels)) {
        input.translationModels = translationModels;
      }
      if (!sameModelList(videoModels, bot.videoModels)) {
        input.videoModels = videoModels;
      }
      if (!sameModelList(imageModels, bot.imageModels)) {
        input.imageModels = imageModels;
      }
      if (!samePresetList(videoPresets, bot.videoPromptPresets)) {
        input.videoPromptPresets = videoPresets;
      }
      if ((activeVideoPreset ?? null) !== (bot.activeVideoPromptPreset ?? null)) {
        input.activeVideoPromptPreset = activeVideoPreset;
      }
      if (!samePresetList(imagePresets, bot.imagePromptPresets)) {
        input.imagePromptPresets = imagePresets;
      }
      if ((activeImagePreset ?? null) !== (bot.activeImagePromptPreset ?? null)) {
        input.activeImagePromptPreset = activeImagePreset;
      }
      if ((translationSource || "auto") !== (bot.translationSourceLanguage ?? "auto")) {
        input.translationSourceLanguage = translationSource || "auto";
      }
      if ((translationTarget || "auto") !== (bot.translationTargetLanguage ?? "auto")) {
        input.translationTargetLanguage = translationTarget || "auto";
      }
      if (autoTranslate !== (bot.autoTranslate ?? false)) input.autoTranslate = autoTranslate;
      if (showTranslationActions !== (bot.showTranslationActions ?? true))
        input.showTranslationActions = showTranslationActions;
      if (computerMode !== bot.computerMode) {
        await rpc(
          "bots/setComputer",
          { botId, mode: computerMode },
          { timeoutMs: COMPUTER_LIFECYCLE_TIMEOUT_MS },
        );
        setBot((prev) => (prev ? { ...prev, computerMode } : prev));
      }
      // Use key presence so clearing description to "" still persists.
      if (Object.keys(input).length > 1) {
        const updated = await rpc("bots/update", input);
        // Saved edits and their history become the baseline, so a retry after a failed switch write
        // does not resend them.
        const { botId: _botId, expectedInstructions: _expected, ...saved } = input;
        setBot((prev) => (prev ? { ...prev, ...saved, ...updated } : prev));
      }
      await Promise.all([
        dailyCheckInsSave.flush(),
        crossSpaceSave.flush(),
        fleetSave.flush(),
        replyModeSave.flush(),
        notifySave.flush(),
        nameSave.flush(),
      ]);
      router.back();
    } catch (err) {
      setError(errorText(err, t("Could not save bot")));
    } finally {
      setPending(false);
    }
  }

  const dirty =
    bot &&
    (description.trim() !== (bot.description ?? "") ||
      instructions !== (bot.instructions ?? "") ||
      color !== bot.color ||
      avatarSet !== resolveBotAvatarSet(bot.avatarSet) ||
      computerMode !== bot.computerMode ||
      autoSpeak !== bot.autoSpeak ||
      (selectedModel?.provider ?? null) !== (bot.modelProvider ?? null) ||
      (selectedModel?.modelId ?? null) !== (bot.modelId ?? null) ||
      (thinkingLevel || null) !== (bot.thinkingLevel ?? null) ||
      !sameModelList(translationModels, bot.translationModels) ||
      !sameModelList(videoModels, bot.videoModels) ||
      !sameModelList(imageModels, bot.imageModels) ||
      !samePresetList(videoPresets, bot.videoPromptPresets) ||
      (activeVideoPreset ?? null) !== (bot.activeVideoPromptPreset ?? null) ||
      !samePresetList(imagePresets, bot.imagePromptPresets) ||
      (activeImagePreset ?? null) !== (bot.activeImagePromptPreset ?? null) ||
      (translationSource || "auto") !== (bot.translationSourceLanguage ?? "auto") ||
      (translationTarget || "auto") !== (bot.translationTargetLanguage ?? "auto") ||
      autoTranslate !== (bot.autoTranslate ?? false) ||
      showTranslationActions !== (bot.showTranslationActions ?? true));

  const hasVoiceMenu = !voiceError && voices.length > 1;
  const voiceRowContent = (
    <SettingsRow
      accessible
      accessibilityLabel={t("Device voice")}
      accessibilityRole={hasVoiceMenu || voiceError ? "button" : undefined}
      accessibilityValue={{ text: voiceError ?? currentVoiceLabel }}
      onPress={voiceError ? () => void retryDeviceVoices() : undefined}
      title={t("Device voice")}
      value={voiceError ? undefined : currentVoiceLabel}
      trailing={
        voiceError ? (
          <Text numberOfLines={1} style={[styles.voiceError, { color: tokens.destructive }]}>
            {voiceError}
          </Text>
        ) : hasVoiceMenu ? (
          <NativeSymbol
            android="chevron-expand"
            color={native.tertiaryLabel}
            ios="chevron.up.chevron.down"
            size={13}
          />
        ) : undefined
      }
    />
  );
  const voiceRow = hasVoiceMenu ? (
    <MenuPickerMenu
      choices={voices.map((voice) => ({ key: voice.identifier, label: voiceLabel(voice) }))}
      label={t("Device voice")}
      onChange={(key) => {
        const voice = voices.find((candidate) => candidate.identifier === key);
        if (voice) void chooseVoice(voice);
      }}
      value={voiceId ?? ""}
    >
      <View>{voiceRowContent}</View>
    </MenuPickerMenu>
  ) : (
    voiceRowContent
  );

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(t("Chat settings"))} />
      <ScrollView
        ref={scrollRef}
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24 }}
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {bot ? (
          <View style={{ alignItems: "center", marginBottom: 24 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Edit avatar")}
              onPress={() => setAvatarOpen(true)}
              style={{ padding: 4 }}
            >
              <BotAvatar
                color={color}
                avatarSet={avatarSet}
                identity={bot.id}
                size={64}
                status={bot.status}
              />
              <View
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  padding: 4,
                  borderRadius: 12,
                  backgroundColor: tokens.card,
                }}
              >
                <NativeSymbol ios="pencil" android="pencil" size={12} color={tokens.foreground} />
              </View>
            </Pressable>
          </View>
        ) : null}
        <View style={{ alignItems: "center", gap: 4, marginTop: -16, marginBottom: -8 }}>
          <ProfileEditDialog
            label={t("Name")}
            editLabel={t("Edit name")}
            value={name}
            maxLength={BOT_NAME_MAX_LENGTH}
            large
            onCommit={async (value) => {
              if (value && botId) nameSave.update(value);
            }}
          />
        </View>
        <View style={{ marginTop: 24 }}>
          <SettingsGroup label={t("Notifications")}>
            <SettingsSwitch
              label={t("When it finishes or needs input")}
              value={notifyOnFinish}
              onChange={(value) => notifySave.update(value)}
            />
          </SettingsGroup>
        </View>
        {botId ? <BotContextCards key={botId} botId={botId} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Advanced")}
          accessibilityState={{ expanded: advancedOpen }}
          onPress={() => setAdvancedOpen((open) => !open)}
          style={{
            marginTop: 24,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: native.secondaryLabel, ...typeScale.caption, paddingStart: 16 }}>
            {t("Advanced")}
          </Text>
          <Chevron expanded={advancedOpen} />
        </Pressable>
        {advancedOpen ? (
          <View
            style={{ gap: 24, marginTop: 24 }}
            onLayout={(event) => {
              modelY.current = event.nativeEvent.layout.y;
              if (focus === "model" || pickedModel !== undefined)
                scrollRef.current?.scrollTo({ y: modelY.current, animated: true });
            }}
          >
            <SettingsGroup label={t("Model")} footer={modelMetaError ?? undefined}>
              <MenuPicker
                choices={modelChoices}
                label={t("Model")}
                showLabel={false}
                onChange={selectModel}
                onPress={
                  modelChoices.length > MODEL_SEARCH_THRESHOLD
                    ? () =>
                        router.push({
                          pathname: "/bot-model",
                          params: { botId, value: selectedModelKey },
                        })
                    : undefined
                }
                value={selectedModelKey}
              />
              {thinkingOptions.length ? (
                <MenuPicker
                  choices={thinkingChoices}
                  label={t("Thinking")}
                  onChange={setThinkingLevel}
                  value={thinkingLevel}
                />
              ) : null}
            </SettingsGroup>
            <SettingsGroup label={t("Media generation")}>
              <OrderedModelList
                kind="video"
                label={t("Video generation model")}
                models={videoModels}
                onChange={(next) => {
                  setVideoModels(next);
                  setVideoTest({ status: "idle" });
                }}
                addChoices={addChoices(videoModels)}
                catalog={catalog}
                test={videoTest}
                onTest={(entry) => void testMediaModel("video", entry)}
                onApplyPrimary={() => void applyTestedMediaModel("video")}
                testable
                labelFor={labelForModelEntry}
              />
              <PromptPresetSection
                label={t("Video prompt presets")}
                presets={videoPresets}
                active={activeVideoPreset}
                onChange={setVideoPresets}
                onActiveChange={setActiveVideoPreset}
              />
              <OrderedModelList
                kind="image"
                label={t("Image generation model")}
                models={imageModels}
                onChange={(next) => {
                  setImageModels(next);
                  setImageTest({ status: "idle" });
                }}
                addChoices={addChoices(imageModels)}
                catalog={catalog}
                test={imageTest}
                onTest={(entry) => void testMediaModel("image", entry)}
                onApplyPrimary={() => void applyTestedMediaModel("image")}
                testable
                labelFor={labelForModelEntry}
              />
              <PromptPresetSection
                label={t("Image prompt presets")}
                presets={imagePresets}
                active={activeImagePreset}
                onChange={setImagePresets}
                onActiveChange={setActiveImagePreset}
              />
            </SettingsGroup>
            <SettingsGroup label={t("Computer")}>
              <View style={styles.cardContent}>
                <ComputerModePicker plain value={computerMode} onChange={setComputerMode} />
              </View>
              <SettingsSwitch
                label={t("Computer operation float window")}
                value={computerFloatEnabled}
                onChange={(value) => {
                  if (!botId) return;
                  setComputerFloatEnabled(botId, value);
                }}
              />
            </SettingsGroup>
            <SettingsGroup label={t("Voice")}>
              <SettingsSwitch
                label={t("Read replies aloud")}
                onChange={setAutoSpeak}
                value={autoSpeak}
              />
              {deviceVoiceEnabled ? voiceRow : null}
            </SettingsGroup>
            <SettingsGroup label={t("Translation settings")}>
              <OrderedModelList
                kind="translation"
                label={t("Translation model")}
                models={translationModels}
                onChange={setTranslationModels}
                addChoices={addChoices(translationModels)}
                catalog={catalog}
                testable={false}
                labelFor={labelForModelEntry}
              />
              <SettingsRow
                title={t("Translation direction")}
                value={`${translationSourceLabel(translationSource)} → ${translationTargetShortLabel(translationTarget)}`}
              />
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                <Text style={{ color: native.secondaryLabel, fontSize: 13 }}>
                  {t("Source language")}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {TRANSLATION_SOURCE_LANGUAGES.map((code) => {
                    const selected = translationSource === code;
                    return (
                      <Pressable
                        key={code}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={translationSourceLabel(code)}
                        onPress={() => setTranslationSource(code)}
                        style={{
                          minHeight: 36,
                          justifyContent: "center",
                          paddingHorizontal: 14,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: selected ? "transparent" : tokens.border,
                          backgroundColor: selected ? tokens.link : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            color: selected ? "#fff" : tokens.foreground,
                            fontSize: 15,
                            fontWeight: selected ? "600" : "400",
                          }}
                        >
                          {translationSourceLabel(code)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <MenuPicker
                choices={translationTargetChoices}
                label={t("Target language")}
                onChange={(key) => {
                  if (isTranslationTargetLanguage(key)) setTranslationTarget(key);
                }}
                value={translationTarget}
              />
              <SettingsSwitch
                label={t("Auto-translate")}
                detail={t("Replies are translated into the target language automatically.")}
                value={autoTranslate}
                onChange={setAutoTranslate}
              />
              <SettingsSwitch
                label={t("Show read-aloud, share, and favorite on translations")}
                value={showTranslationActions}
                onChange={setShowTranslationActions}
              />
            </SettingsGroup>
            <SettingsGroup label={t("Permissions")}>
              <SettingsSwitch
                label={t("Daily check-ins on unfinished work")}
                value={dailyCheckIns}
                onChange={(value) => {
                  if (!botId) return;
                  setError(null);
                  dailyCheckInsSave.update(value);
                }}
              />
              <SettingsSwitch
                label={t("Allow cross-space bot communication")}
                value={crossSpaceCommunication}
                onChange={(value) => {
                  if (!botId) return;
                  setError(null);
                  crossSpaceSave.update(value);
                }}
              />
              <SettingsSwitch
                label={t("Manage other bots")}
                onChange={(value) => {
                  if (!botId) return;
                  setError(null);
                  fleetSave.update(value);
                }}
                value={fleetManagement}
              />
            </SettingsGroup>
            <SettingsGroup label={t("Replies")}>
              <MenuPicker
                choices={[
                  { key: "chat", label: t("Chat") },
                  { key: "messages", label: t("Messages") },
                ]}
                label={t("Replies")}
                showLabel={false}
                onChange={(value) => {
                  if (!botId) return;
                  setError(null);
                  replyModeSave.update(value as ReplyMode);
                }}
                value={replyMode}
              />
            </SettingsGroup>
            <View style={{ gap: 7 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingEnd: 16,
                }}
              >
                <SettingsLabel>{t("Instructions")}</SettingsLabel>
                {bot?.instructionHistory?.length && instructions === bot.instructions ? (
                  <View style={{ width: 44 }}>
                    <MenuPickerMenu
                      label={t("Instruction history")}
                      value=""
                      choices={bot.instructionHistory.map((version) => ({
                        key: version.id,
                        label: `${new Date(version.createdAt).toLocaleString()} (${version.reason})`,
                      }))}
                      onChange={(versionId) => {
                        if (pending || instructions !== bot.instructions) return;
                        const version = bot.instructionHistory?.find(
                          (item) => item.id === versionId,
                        );
                        if (version)
                          Alert.alert(t("Restore"), version.instructions, [
                            { text: t("Cancel"), style: "cancel" },
                            {
                              text: t("Restore"),
                              onPress: () => {
                                void rpc("bots/restoreInstructions", {
                                  botId: bot.id,
                                  versionId,
                                  expectedInstructions: bot.instructions,
                                })
                                  .then((updated) => {
                                    setBot(updated);
                                    setInstructions(updated.instructions ?? "");
                                  })
                                  .catch((err) => setError(errorText(err)));
                              },
                            },
                          ]);
                      }}
                    >
                      <View
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={t("Instruction history")}
                        style={{
                          minHeight: 44,
                          minWidth: 44,
                          alignItems: "flex-end",
                          justifyContent: "center",
                        }}
                      >
                        <NativeSymbol
                          ios="clock.arrow.circlepath"
                          android="time-outline"
                          size={18}
                          color={tokens.mutedForeground}
                        />
                      </View>
                    </MenuPickerMenu>
                  </View>
                ) : null}
              </View>
              <GrowingTextInput
                label={t("Instructions")}
                maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
                value={instructions}
                onChangeText={setInstructions}
                backgroundColor={native.groupedCell}
                fontSize={17}
              />
            </View>
            <SettingsGroup label={t("How other bots see it")}>
              <GrowingTextInput
                label={t("How other bots see it")}
                value={description}
                maxLength={BOT_DESCRIPTION_MAX_LENGTH}
                onChangeText={setDescription}
                placeholder={t("What this bot is for")}
                fontSize={17}
              />
            </SettingsGroup>
            <SettingsGroup>
              <SettingsRow
                accessibilityRole="button"
                title={t("Export")}
                trailing={
                  <NativeSymbol
                    ios="square.and.arrow.down"
                    android="download-outline"
                    size={18}
                    color={native.tertiaryLabel}
                  />
                }
                onPress={() => {
                  void rpc("export/bot", { botId })
                    .then((manifest) => Share.share({ message: JSON.stringify(manifest, null, 2) }))
                    .catch((err) => setError(errorText(err)));
                }}
              />
              <SettingsRow
                accessibilityRole="button"
                destructive
                title={t("Clear conversation")}
                onPress={() =>
                  Alert.alert(t("Clear conversation"), undefined, [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: t("Clear conversation"),
                      style: "destructive",
                      onPress: () => {
                        void rpc("threads/clear", { botId })
                          .then(() => notifyConversationCleared(botId))
                          .then(() => router.back())
                          .catch((err) => setError(errorText(err)));
                      },
                    },
                  ])
                }
              />
            </SettingsGroup>
          </View>
        ) : null}
        {error ? <Text style={{ color: tokens.destructive, marginTop: 16 }}>{error}</Text> : null}
        {dirty ? (
          <NativeActionButton
            disabled={!name.trim() || pending || !bot}
            label={pending ? t("Saving…") : t("Save")}
            onPress={() => void save()}
            style={{ marginTop: 24 }}
          />
        ) : null}
        {bot ? (
          <NativeActionButton
            label={t("Bot package")}
            prominence="secondary"
            onPress={() => setPackageOpen(!packageOpen)}
            style={{ marginTop: 16 }}
          />
        ) : null}
        {packageOpen && bot ? (
          <Suspense fallback={<Text>{t("Loading…")}</Text>}>
            <NativeBotPackageTools botId={bot.id} />
          </Suspense>
        ) : null}
      </ScrollView>
      {avatarOpen ? (
        <Modal
          visible={avatarOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setAvatarOpen(false)}
        >
          <ScrollView
            contentContainerStyle={{ padding: 24, gap: 16 }}
            style={{ backgroundColor: tokens.background }}
          >
            <NativeActionButton label={t("Done")} onPress={() => setAvatarOpen(false)} />
            {bot && isAvatarPhoto(color) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setColor(avatarColor(bot.color))}
                style={{ marginTop: 12 }}
              >
                <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>
                  {t("Remove photo")}
                </Text>
              </Pressable>
            ) : null}
            <MenuPicker
              label={t("Icon set")}
              choices={[
                { key: "organic", label: t("Original") },
                { key: "rakazo", label: t("Rakazo") },
              ]}
              value={avatarSet}
              onChange={(next) => {
                setAvatarSet(resolveBotAvatarSet(next));
                setColor((current) => avatarColor(current));
              }}
              plain
            />
            <MenuPicker
              label={t("Expression pack")}
              choices={[
                { key: "chief", label: t("Chief assistant") },
                { key: "off", label: t("Off") },
              ]}
              value={expressionPack}
              onChange={(next) => setExpressionPack(botId, next === "off" ? "off" : "chief")}
              plain
            />
            {expressionPack === "chief" ? (
              <>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  {faces.map((face) => (
                    <Pressable
                      key={face.id}
                      accessibilityRole="button"
                      accessibilityLabel={faceLabels[face.id]}
                      disabled={packBusy || !userId}
                      onPress={() => onFacePress(face.id, face.customized)}
                      style={{
                        borderRadius: 26,
                        borderWidth: 2,
                        borderColor: face.customized ? tokens.foreground : "transparent",
                      }}
                    >
                      <Image
                        source={face.image}
                        style={{ width: 52, height: 52, borderRadius: 26 }}
                        accessibilityLabel={faceLabels[face.id]}
                      />
                    </Pressable>
                  ))}
                </View>
                {subscription ? (
                  <View style={{ marginTop: 16, gap: 8 }}>
                    <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>
                      {t("Subscribed: {name}", {
                        name: subscription.name ?? subscription.url,
                      })}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Refresh")}
                      disabled={packBusy}
                      onPress={() => void refreshPack()}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 12,
                        ...(pressed ? { opacity: 0.6 } : null),
                      })}
                    >
                      <NativeSymbol
                        ios="arrow.clockwise"
                        android="refresh-outline"
                        size={20}
                        color={tokens.link}
                      />
                      <Text style={{ color: tokens.foreground, fontSize: 16 }}>{t("Refresh")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Unsubscribe")}
                      disabled={packBusy}
                      onPress={cancelPack}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 12,
                        ...(pressed ? { opacity: 0.6 } : null),
                      })}
                    >
                      <NativeSymbol
                        ios="xmark"
                        android="close-outline"
                        size={20}
                        color={tokens.link}
                      />
                      <Text style={{ color: tokens.foreground, fontSize: 16 }}>
                        {t("Unsubscribe")}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ marginTop: 16, gap: 8 }}>
                    <Text style={{ color: tokens.foreground, fontSize: 16 }}>
                      {t("URL subscription")}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TextInput
                        value={packUrl}
                        onChangeText={(next) => {
                          setPackUrl(next);
                          setPackError(null);
                        }}
                        placeholder={t("Paste a pack URL")}
                        placeholderTextColor={tokens.mutedForeground}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        style={{
                          flex: 1,
                          borderWidth: 1,
                          borderColor: tokens.border,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          color: tokens.foreground,
                          fontSize: 15,
                        }}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("Subscribe")}
                        disabled={packBusy || !userId}
                        onPress={() => void subscribePack()}
                        style={{
                          borderRadius: 10,
                          backgroundColor: tokens.accent,
                          paddingHorizontal: 16,
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: tokens.link, fontSize: 15, fontWeight: "600" }}>
                          {t("Subscribe")}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                {packError ? (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: tokens.destructive, fontSize: 13, marginTop: 8 }}
                  >
                    {packError}
                  </Text>
                ) : null}
              </>
            ) : null}
            <Text style={{ color: tokens.mutedForeground, marginTop: 16, fontSize: 14 }}>
              {t("Color")}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingHorizontal: 4 }}
              accessibilityRole="radiogroup"
            >
              {BOT_COLORS.map((option, index) => (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityLabel={t("Color {number}", { number: index + 1 })}
                  accessibilityState={{ checked: avatarColor(color) === option }}
                  onPress={() => setColor((current) => withAvatarColor(current, option))}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: option,
                    borderWidth: 3,
                    borderColor: avatarColor(color) === option ? tokens.foreground : "transparent",
                  }}
                />
              ))}
            </ScrollView>
            {bot && !isAvatarPhoto(color) ? (
              <>
                <Text style={{ color: tokens.mutedForeground, marginTop: 16, fontSize: 14 }}>
                  {t("Shape")}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingHorizontal: 4 }}
                  accessibilityRole="radiogroup"
                >
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={t("Default")}
                    accessibilityState={{
                      checked: avatarSet === "organic" && avatarShape(color) === null,
                    }}
                    onPress={() => {
                      setAvatarSet("organic");
                      setColor((current) => avatarColor(current));
                    }}
                    style={{
                      padding: 4,
                      borderRadius: 14,
                      borderWidth: 2,
                      borderColor:
                        avatarSet === "organic" && avatarShape(color) === null
                          ? tokens.foreground
                          : "transparent",
                    }}
                  >
                    <BotAvatar color={avatarColor(color)} identity={bot.id} size={36} />
                  </Pressable>
                  {Array.from({ length: BOT_AVATAR_SHAPE_COUNT }, (_, shape) => (
                    <Pressable
                      key={shape}
                      accessibilityRole="radio"
                      accessibilityLabel={t("Shape {number}", { number: shape + 1 })}
                      accessibilityState={{ checked: avatarShape(color) === shape }}
                      onPress={() => {
                        setAvatarSet("organic");
                        setColor((current) => withAvatarShape(current, shape));
                      }}
                      style={{
                        padding: 4,
                        borderRadius: 14,
                        borderWidth: 2,
                        borderColor:
                          avatarShape(color) === shape ? tokens.foreground : "transparent",
                      }}
                    >
                      <BotAvatar
                        color={withAvatarShape(color, shape)}
                        identity={bot.id}
                        size={36}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </ScrollView>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  cardContent: { padding: 16 },
  voiceError: { flexShrink: 1, fontSize: 17 },
});
