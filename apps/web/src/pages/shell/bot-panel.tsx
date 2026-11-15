import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AgentSkillCatalogEntry,
  Bot,
  BotAvatarSet,
  BotModelEntry,
  BotPromptPreset,
  ComputerMode,
  ModelCatalogEntry,
  ReplyMode,
  ThinkingLevel,
} from "@rakazo/contracts";
import {
  activeBotPromptPreset,
  BOT_MODEL_LIST_MAX,
  BOT_NAME_MAX_LENGTH,
  isBuiltinToolName,
  moveBotModelToFront,
  primaryBotModel,
  resolveBotAvatarSet,
} from "@rakazo/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  credentialForModel,
  modelOptionKey,
  parseModelOptionKey,
  resolveSelectableModelId,
} from "@rakazo/core";
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { BotEmailAddressField } from "../../components/BotEmailAddressField";
import { ErrorBoundary, SectionLoadFailed } from "../../components/ErrorBoundary";
import { InstructionSettings } from "../../components/InstructionSettings";
import { PagesList } from "../../components/pages/PagesList";
import { BotPersonaSection } from "../../components/prompt-templates/BotPersonaSection";
import { botProfilePatch } from "../../lib/bot-profile-patch";
import type { ModelLocateRequest } from "../../lib/model-locate";
import { modelLocateRowMatches } from "../../lib/model-locate";
import { modelStatusFromProbe, recordModelStatus } from "../../lib/model-status";
import { lazyComponent } from "../../lib/preload-recovery";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import type { TranslationSourceLanguage, TranslationTargetLanguage } from "../../lib/translation";
import {
  botTranslationSettings,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  translationModelKey,
} from "../../lib/translation";
import { errorText } from "../../lib/user-error";
import { AvatarStudioPopover } from "./avatar-studio-popover";
import type { MediaModelFallback, MediaModelTestState } from "./bot-settings-sections";
import {
  ComputerGroup,
  DescriptionGroup,
  ExportAndClear,
  MediaModelGroup,
  ModelSection,
  NotificationsSection,
  PermissionsGroup,
  RepliesGroup,
  ToolsGroup,
  TranslationGroup,
  VoiceGroup,
} from "./bot-settings-sections";

const ScratchpadSection = lazyComponent(() =>
  import("../ScratchpadSection").then((module) => module.ScratchpadSection),
);

const KnowledgeSection = lazyComponent(() =>
  import("../KnowledgeSection").then((module) => module.KnowledgeSection),
);

/** The advanced fields one Save sends, in the order their saved snapshot keeps them. */
function advancedValues(bot: Bot) {
  const translation = botTranslationSettings(bot);
  return [
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
    bot.thinkingLevel ?? "",
    bot.computerMode,
    bot.memoryScope,
    bot.autoSpeak,
    bot.voiceId ?? "",
    translationModelKey(translation),
    translation.translationSourceLanguage,
    translation.translationTargetLanguage ?? DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    translation.autoTranslate,
    translation.showTranslationActions,
    JSON.stringify(bot.videoModels ?? []),
    JSON.stringify(bot.imageModels ?? []),
    bot.activeVideoPromptPreset ?? "",
    bot.activeImagePromptPreset ?? "",
    JSON.stringify(bot.videoPromptPresets ?? []),
    JSON.stringify(bot.imagePromptPresets ?? []),
  ] as const;
}

export type BotPanelTab = "computer" | "routines" | "pages" | "settings" | "persona";

/** A bot's profile above its Computer, Routines, Pages and Advanced tabs. */
export function BotSettings({
  bot,
  tab = "settings",
  onTabChange,
  computer,
  routines,
  packageTools,
  memoryProviderConfigured,
  onSave,
  onExport,
  onClear,
  focusModel = 0,
  locateModel,
  onOpenConnections,
  onBotUpdated,
  onOpenTemplateLibrary,
}: {
  bot: Bot;
  tab?: BotPanelTab;
  onTabChange?: (tab: BotPanelTab) => void;
  computer?: ReactNode;
  routines?: ReactNode;
  packageTools?: ReactNode;
  focusModel?: number;
  /** A timeline model name asking for its row in these settings. */
  locateModel?: ModelLocateRequest | null;
  onOpenConnections?: () => void;
  /** After a persona switch, so the roster and the header follow the updated bot. */
  onBotUpdated?: (bot: Bot) => void;
  /** Opens the prompt template library in settings. */
  onOpenTemplateLibrary?: () => void;
  /** Unused: the skill sections read and save the shared cached skill list. */
  onSkillsChange?: (skills: AgentSkillCatalogEntry[]) => void;
  memoryProviderConfigured: boolean;
  onSave: (patch: {
    name?: string;
    description?: string;
    instructions?: string;
    color?: string;
    avatarSet?: BotAvatarSet;
    notifyOnFinish?: boolean;
    computerMode?: ComputerMode;
    memoryScope?: "isolated" | "shared" | null;
    autoSpeak?: boolean;
    fleetManagement?: boolean;
    replyMode?: ReplyMode;
    crossSpaceCommunication?: boolean;
    dailyCheckIns?: boolean;
    voiceId?: string | null;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel | null;
    translationModelProvider?: string | null;
    translationModelId?: string | null;
    translationSourceLanguage?: TranslationSourceLanguage;
    translationTargetLanguage?: TranslationTargetLanguage | null;
    autoTranslate?: boolean;
    videoModels?: BotModelEntry[] | null;
    imageModels?: BotModelEntry[] | null;
    videoPromptPresets?: BotPromptPreset[] | null;
    imagePromptPresets?: BotPromptPreset[] | null;
    activeVideoPromptPreset?: string | null;
    activeImagePromptPreset?: string | null;
    disabledBuiltinTools?: string[];
  }) => Promise<void>;
  onExport: () => Promise<void>;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const modelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusModel && tab === "settings") {
      modelRef.current?.scrollIntoView?.({ block: "nearest" });
      modelRef.current?.querySelector<HTMLElement>('[id$="-model"]')?.focus();
    }
  }, [tab, focusModel]);
  // A located model row, highlighted with a tag until the next request.
  const [locatedKey, setLocatedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!locateModel || tab !== "settings") {
      if (!locateModel) setLocatedKey(null);
      return;
    }
    // The settings tab is the only panel in the DOM with this test id.
    const root = document.querySelector<HTMLElement>('[data-testid="bot-settings-advanced"]');
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-model-row]")];
    const row = rows.find((el) => modelLocateRowMatches(el.dataset.modelRow ?? "", locateModel));
    const target =
      row ?? root.querySelector<HTMLElement>(`[data-model-section="${locateModel.kind}"]`);
    if (target) {
      setLocatedKey(
        row?.dataset.modelRow ??
          target.getAttribute("data-model-row") ??
          target.querySelector("[data-model-row]")?.getAttribute("data-model-row") ??
          null,
      );
      target.scrollIntoView?.({ block: "nearest" });
    }
  }, [locateModel, tab]);
  const [name, setName] = useState(bot.name);
  const savedNameRef = useRef(bot.name);
  const [description, setDescription] = useState(bot.description);
  // A roster refresh can skip replacing bots while a reorder is in flight, so
  // this prop keeps the description from when the panel opened. Later saves
  // compare against the description last saved here; otherwise a model or
  // voice change treats that stale text as an edit and overwrites instructions.
  const savedDescriptionRef = useRef(bot.description ?? "");
  const [color, setColor] = useState(bot.color);
  const [avatarSet, setAvatarSet] = useState(() => resolveBotAvatarSet(bot.avatarSet));
  const [notifyOnFinish, setNotifyOnFinish] = useState(bot.notifyOnFinish ?? true);
  const acceptedAutomatic = useRef({
    color: bot.color,
    avatarSet: resolveBotAvatarSet(bot.avatarSet),
    notifyOnFinish: bot.notifyOnFinish ?? true,
  });
  const automaticRevision = useRef({ color: 0, avatarSet: 0, notifyOnFinish: 0 });
  const [computerMode, setComputerMode] = useState(bot.computerMode);
  const [memoryScope, setMemoryScope] = useState(bot.memoryScope);
  const [autoSpeak, setAutoSpeak] = useState(bot.autoSpeak);
  const [crossSpaceCommunication, setCrossSpaceCommunication] = useState(
    bot.crossSpaceCommunication ?? true,
  );
  useEffect(
    () => setCrossSpaceCommunication(bot.crossSpaceCommunication ?? true),
    [bot.crossSpaceCommunication],
  );
  const [dailyCheckIns, setDailyCheckIns] = useState(bot.dailyCheckIns ?? true);
  useEffect(() => setDailyCheckIns(bot.dailyCheckIns ?? true), [bot.dailyCheckIns]);
  const [fleetManagement, setFleetManagement] = useState(bot.fleetManagement);
  useEffect(() => setFleetManagement(bot.fleetManagement), [bot.fleetManagement]);
  const [replyMode, setReplyMode] = useState(bot.replyMode);
  useEffect(() => setReplyMode(bot.replyMode), [bot.replyMode]);
  const [voiceId, setVoiceId] = useState(bot.voiceId ?? "");
  const [modelKey, setModelKey] = useState(
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
  );
  const [thinkingLevel, setThinkingLevel] = useState(bot.thinkingLevel ?? "");
  const [translationModel, setTranslationModel] = useState(() =>
    translationModelKey(botTranslationSettings(bot)),
  );
  const [translationSourceLanguage, setTranslationSourceLanguage] =
    useState<TranslationSourceLanguage>(
      () => botTranslationSettings(bot).translationSourceLanguage,
    );
  const [translationTargetLanguage, setTranslationTargetLanguage] =
    useState<TranslationTargetLanguage>(
      () =>
        botTranslationSettings(bot).translationTargetLanguage ??
        DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    );
  const [autoTranslate, setAutoTranslate] = useState(
    () => botTranslationSettings(bot).autoTranslate,
  );
  const [showTranslationActions, setShowTranslationActions] = useState(
    () => botTranslationSettings(bot).showTranslationActions,
  );
  const [videoModels, setVideoModels] = useState<BotModelEntry[]>(() => bot.videoModels ?? []);
  const [imageModels, setImageModels] = useState<BotModelEntry[]>(() => bot.imageModels ?? []);
  const [activeVideoPreset, setActiveVideoPreset] = useState<string | null>(
    () => bot.activeVideoPromptPreset ?? null,
  );
  const [activeImagePreset, setActiveImagePreset] = useState<string | null>(
    () => bot.activeImagePromptPreset ?? null,
  );
  const [videoPresets, setVideoPresets] = useState<BotPromptPreset[]>(
    () => bot.videoPromptPresets ?? [],
  );
  const [imagePresets, setImagePresets] = useState<BotPromptPreset[]>(
    () => bot.imagePromptPresets ?? [],
  );
  const [videoTest, setVideoTest] = useState<MediaModelTestState>({ status: "idle" });
  const [imageTest, setImageTest] = useState<MediaModelTestState>({ status: "idle" });
  const [disabledBuiltinTools, setDisabledBuiltinTools] = useState<string[]>(
    bot.disabledBuiltinTools ?? [],
  );
  // The list on screen is updated before the save returns. This stays on the
  // last list the server accepted so a rejection can undo that preview.
  const persistedDisabledToolsRef = useRef(disabledBuiltinTools);
  const serverDisabledToolsRef = useRef(disabledBuiltinTools);
  const pendingSavesRef = useRef(0);
  useEffect(() => {
    const next = bot.disabledBuiltinTools ?? [];
    if (serverDisabledToolsRef.current === next) return;
    serverDisabledToolsRef.current = next;
    persistedDisabledToolsRef.current = next;
    if (pendingSavesRef.current === 0) setDisabledBuiltinTools(next);
  }, [bot.disabledBuiltinTools]);
  // Shared with the model and voice settings, so a revisit paints at once and refreshes behind.
  const queries = useSpaceQueries();
  const refresh = { refetchOnMount: "always" } as const;
  const voices = useQuery({ ...queries.voice.voices.queryOptions({ input: {} }), ...refresh }).data;
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), ...refresh });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), ...refresh });
  const meQuery = useQuery({ ...queries.me.queryOptions(), ...refresh });
  const credentials = credentialsQuery.data ?? NO_CREDENTIALS;
  const catalog = catalogQuery.data ?? NO_CATALOG;
  const me = meQuery.data ?? null;
  // A failed catalog load must not clear an existing thinkingLevel override on save.
  const modelMetaReady =
    credentialsQuery.data !== undefined &&
    catalogQuery.data !== undefined &&
    meQuery.data !== undefined;
  const [saving, setSaving] = useState(false);
  const [savedAdvanced, setSavedAdvanced] = useState(() => JSON.stringify(advancedValues(bot)));
  const advancedSnapshot = JSON.stringify([
    modelKey,
    thinkingLevel,
    computerMode,
    memoryScope,
    autoSpeak,
    voiceId,
    translationModel,
    translationSourceLanguage,
    translationTargetLanguage,
    autoTranslate,
    showTranslationActions,
    JSON.stringify(videoModels),
    JSON.stringify(imageModels),
    activeVideoPreset ?? "",
    activeImagePreset ?? "",
    JSON.stringify(videoPresets),
    JSON.stringify(imagePresets),
  ]);
  const dirty =
    name.trim() !== savedNameRef.current.trim() ||
    advancedSnapshot !== savedAdvanced ||
    description.trim() !== savedDescriptionRef.current;
  const [error, setError] = useState<string | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const executeSaveRef = useRef<
    (
      patchOverrides?: {
        name?: string;
        description?: string;
        color?: string;
        avatarSet?: BotAvatarSet;
        notifyOnFinish?: boolean;
        fleetManagement?: boolean;
        replyMode?: ReplyMode;
        crossSpaceCommunication?: boolean;
        dailyCheckIns?: boolean;
        disabledBuiltinTools?: string[];
        baseDisabledBuiltinTools?: string[];
      },
      revisions?: { color: number; avatarSet: number; notifyOnFinish: number },
    ) => Promise<void>
  >(async () => undefined);
  // The panel can open on a cached bot. When a newer copy arrives, every field not edited since
  // follows it, so a later save does not send the cached values back over it. A copy that is not
  // newer (a roster read from before a save) is ignored.
  const shownBotRef = useRef(bot);
  useEffect(() => {
    if (bot.updatedAt <= shownBotRef.current.updatedAt) return;
    shownBotRef.current = bot;
    if (name.trim() === savedNameRef.current.trim()) setName(bot.name);
    savedNameRef.current = bot.name;
    if (description.trim() === savedDescriptionRef.current) setDescription(bot.description);
    savedDescriptionRef.current = bot.description ?? "";
    const accepted = acceptedAutomatic.current;
    const nextNotify = bot.notifyOnFinish ?? true;
    if (color === accepted.color) setColor(bot.color);
    const nextAvatarSet = resolveBotAvatarSet(bot.avatarSet);
    if (avatarSet === accepted.avatarSet) setAvatarSet(nextAvatarSet);
    if (notifyOnFinish === accepted.notifyOnFinish) setNotifyOnFinish(nextNotify);
    acceptedAutomatic.current = {
      color: bot.color,
      avatarSet: nextAvatarSet,
      notifyOnFinish: nextNotify,
    };
    const saved = JSON.parse(savedAdvanced) as unknown[];
    const next = advancedValues(bot);
    if (modelKey === saved[0]) setModelKey(next[0]);
    if (thinkingLevel === saved[1]) setThinkingLevel(next[1]);
    if (computerMode === saved[2]) setComputerMode(next[2]);
    if (memoryScope === saved[3]) setMemoryScope(next[3]);
    if (autoSpeak === saved[4]) setAutoSpeak(next[4]);
    if (voiceId === saved[5]) setVoiceId(next[5]);
    if (translationModel === saved[6]) setTranslationModel(next[6]);
    if (translationSourceLanguage === saved[7])
      setTranslationSourceLanguage(next[7] as TranslationSourceLanguage);
    if (translationTargetLanguage === saved[8])
      setTranslationTargetLanguage(next[8] as TranslationTargetLanguage);
    if (autoTranslate === saved[9]) setAutoTranslate(next[9] as boolean);
    if (showTranslationActions === saved[10]) setShowTranslationActions(next[10] as boolean);
    if (JSON.stringify(videoModels) === saved[11])
      setVideoModels(JSON.parse(next[11] as string) as BotModelEntry[]);
    if (JSON.stringify(imageModels) === saved[12])
      setImageModels(JSON.parse(next[12] as string) as BotModelEntry[]);
    if ((activeVideoPreset ?? "") === saved[13]) setActiveVideoPreset((next[13] as string) || null);
    if ((activeImagePreset ?? "") === saved[14]) setActiveImagePreset((next[14] as string) || null);
    if (JSON.stringify(videoPresets) === saved[15])
      setVideoPresets(JSON.parse(next[15] as string) as BotPromptPreset[]);
    if (JSON.stringify(imagePresets) === saved[16])
      setImagePresets(JSON.parse(next[16] as string) as BotPromptPreset[]);
    setSavedAdvanced(JSON.stringify(next));
  }, [bot]);

  const connectedOptions = connectedModelChoices(credentials, catalog);
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

  const storedTranslationModel = translationModel ? parseModelOptionKey(translationModel) : null;
  const selectedTranslationModel = storedTranslationModel
    ? {
        provider: storedTranslationModel.provider,
        modelId: resolveSelectableModelId(
          catalog,
          storedTranslationModel.provider,
          storedTranslationModel.modelId,
        ),
      }
    : null;
  const selectedTranslationModelKey = selectedTranslationModel
    ? modelOptionKey(selectedTranslationModel.provider, selectedTranslationModel.modelId)
    : "";
  const translationModelChoices = chatModelChoices(
    connectedOptions,
    selectedTranslationModelKey,
    t`Not selected`,
  );

  const videoPrimary = primaryBotModel(videoModels);
  const videoValue = videoPrimary
    ? modelOptionKey(
        videoPrimary.provider,
        resolveSelectableModelId(catalog, videoPrimary.provider, videoPrimary.model),
      )
    : "";
  const videoChoices = chatModelChoices(connectedOptions, videoValue, t`Not selected`);
  const videoFallbacks: MediaModelFallback[] = videoModels.slice(1).map((entry) => {
    const key = modelOptionKey(
      entry.provider,
      resolveSelectableModelId(catalog, entry.provider, entry.model),
    );
    return {
      key,
      label: videoChoices.find((choice) => choice.key === key)?.label ?? entry.model,
    };
  });
  const imagePrimary = primaryBotModel(imageModels);
  const imageValue = imagePrimary
    ? modelOptionKey(
        imagePrimary.provider,
        resolveSelectableModelId(catalog, imagePrimary.provider, imagePrimary.model),
      )
    : "";
  const imageChoices = chatModelChoices(connectedOptions, imageValue, t`Not selected`);
  const imageFallbacks: MediaModelFallback[] = imageModels.slice(1).map((entry) => {
    const key = modelOptionKey(
      entry.provider,
      resolveSelectableModelId(catalog, entry.provider, entry.model),
    );
    return {
      key,
      label: imageChoices.find((choice) => choice.key === key)?.label ?? entry.model,
    };
  });

  /** Picking a media model moves it to the front of that role's list; the rest stay as fallbacks. */
  function changeMediaModel(role: "video" | "image", key: string) {
    const setList = role === "video" ? setVideoModels : setImageModels;
    if (!key) {
      setList([]);
      return;
    }
    const parsed = parseModelOptionKey(key);
    if (!parsed) return;
    const entry: BotModelEntry = { provider: parsed.provider, model: parsed.modelId };
    setList((current) => moveBotModelToFront(current, entry));
  }

  function removeMediaFallback(role: "video" | "image", key: string) {
    const setList = role === "video" ? setVideoModels : setImageModels;
    setList((current) =>
      current.filter(
        (entry) =>
          modelOptionKey(
            entry.provider,
            resolveSelectableModelId(catalog, entry.provider, entry.model),
          ) !== key,
      ),
    );
  }

  function addMediaFallback(role: "video" | "image", key: string) {
    const setList = role === "video" ? setVideoModels : setImageModels;
    const parsed = parseModelOptionKey(key);
    if (!parsed) return;
    const entry: BotModelEntry = { provider: parsed.provider, model: parsed.modelId };
    setList((current) => {
      if (
        current.length >= BOT_MODEL_LIST_MAX ||
        current.some((item) => item.provider === entry.provider && item.model === entry.model)
      )
        return current;
      return [...current, entry];
    });
  }

  function moveMediaFallback(role: "video" | "image", key: string, delta: -1 | 1) {
    const setList = role === "video" ? setVideoModels : setImageModels;
    setList((current) => {
      const index = current.findIndex(
        (entry) =>
          modelOptionKey(
            entry.provider,
            resolveSelectableModelId(catalog, entry.provider, entry.model),
          ) === key,
      );
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const item = next[index]!;
      next[index] = next[target]!;
      next[target] = item;
      return next;
    });
  }

  /** Probes one media model with the role's active preset, so the test reflects real usage. */
  async function testMediaModel(role: "video" | "image", key: string) {
    const parsed = parseModelOptionKey(key);
    if (!parsed) return;
    const setTest = role === "video" ? setVideoTest : setImageTest;
    const started = Date.now();
    const seconds = () => Math.round(((Date.now() - started) / 1000) * 10) / 10;
    setTest({ status: "testing", modelKey: key });
    try {
      const preset =
        role === "video"
          ? activeBotPromptPreset(videoPresets, activeVideoPreset)
          : activeBotPromptPreset(imagePresets, activeImagePreset);
      const result = await rpc.bots.testMediaModel({
        botId: bot.id,
        kind: role,
        provider: parsed.provider,
        modelId: resolveSelectableModelId(catalog, parsed.provider, parsed.modelId),
        ...(preset?.prompt.trim() ? { presetPrompt: preset.prompt } : {}),
      });
      recordModelStatus(key, modelStatusFromProbe(result));
      setTest({
        status: "done",
        supported: result.supported,
        seconds: result.seconds,
        detail: result.detail,
        modelKey: key,
        modelId: parsed.modelId,
      });
    } catch (err) {
      recordModelStatus(key, { state: "unavailable", seconds: seconds() });
      setTest({
        status: "done",
        supported: false,
        seconds: seconds(),
        detail: errorText(err, t`Could not test this model`),
        modelKey: key,
        modelId: parsed.modelId,
      });
    }
  }

  /** Applies a tested model in one tap: it moves to primary, the rest stay as fallbacks. */
  function applyTestedMediaModel(role: "video" | "image") {
    const test = role === "video" ? videoTest : imageTest;
    if (test.status !== "done" || !test.supported) return;
    const parsed = parseModelOptionKey(test.modelKey);
    if (!parsed) return;
    const setList = role === "video" ? setVideoModels : setImageModels;
    const list = role === "video" ? videoModels : imageModels;
    setList(moveBotModelToFront(list, { provider: parsed.provider, model: parsed.modelId }));
  }

  const defaultEntry = me?.defaultModel
    ? catalogEntry(catalog, me.defaultProvider, me.defaultModel)
    : undefined;
  const modelChoices = chatModelChoices(
    connectedOptions,
    selectedModelKey,
    t`Space default`,
    defaultEntry?.images,
  );

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
  const defaultThinkingLevel = effectiveCredential?.thinkingLevel ?? "medium";

  async function executeSave(
    patchOverrides?: {
      name?: string;
      description?: string;
      color?: string;
      avatarSet?: BotAvatarSet;
      notifyOnFinish?: boolean;
      fleetManagement?: boolean;
      replyMode?: ReplyMode;
      crossSpaceCommunication?: boolean;
      dailyCheckIns?: boolean;
      disabledBuiltinTools?: string[];
      baseDisabledBuiltinTools?: string[];
    },
    revisions?: { color: number; avatarSet: number; notifyOnFinish: number },
  ) {
    try {
      setSaving(true);
      setError(null);
      if (patchOverrides?.crossSpaceCommunication !== undefined) {
        await onSave({ crossSpaceCommunication: patchOverrides.crossSpaceCommunication });
        return;
      }
      if (patchOverrides?.dailyCheckIns !== undefined) {
        await onSave({ dailyCheckIns: patchOverrides.dailyCheckIns });
        return;
      }
      if (patchOverrides?.fleetManagement !== undefined) {
        await onSave({ fleetManagement: patchOverrides.fleetManagement });
        return;
      }
      if (patchOverrides?.replyMode !== undefined) {
        await onSave({ replyMode: patchOverrides.replyMode });
        return;
      }
      const selected = selectedModel;
      const selectedTranslation = selectedTranslationModel;
      const nextName = (patchOverrides?.name !== undefined ? patchOverrides.name : name).trim();
      const nextDescription = (
        patchOverrides?.description !== undefined ? patchOverrides.description : description
      ).trim();
      const nextColor = patchOverrides?.color !== undefined ? patchOverrides.color : color;
      const nextAvatarSet = patchOverrides?.avatarSet ?? avatarSet;
      const nextNotify =
        patchOverrides?.notifyOnFinish !== undefined
          ? patchOverrides.notifyOnFinish
          : notifyOnFinish;

      if (nextName) setName(nextName);
      setDescription(nextDescription);
      const patch = {
        ...(nextName && nextName !== savedNameRef.current.trim() ? { name: nextName } : {}),
        // Keep untouched profile fields off the wire.
        ...botProfilePatch(savedDescriptionRef.current, nextDescription),
        // Unchanged color stays off the wire so a legacy named value cannot fail a name save.
        ...(nextColor !== acceptedAutomatic.current.color ? { color: nextColor } : {}),
        ...(patchOverrides?.avatarSet !== undefined ||
        nextAvatarSet !== acceptedAutomatic.current.avatarSet
          ? { avatarSet: nextAvatarSet }
          : {}),
        notifyOnFinish: nextNotify,
        computerMode,
        memoryScope,
        autoSpeak,
        voiceId: voiceId || null,
        modelProvider: selected?.provider ?? null,
        modelId: selected?.modelId ?? null,
        translationModelProvider: selectedTranslation?.provider ?? null,
        translationModelId: selectedTranslation?.modelId ?? null,
        translationSourceLanguage,
        translationTargetLanguage,
        autoTranslate,
        showTranslationActions,
        videoModels,
        imageModels,
        videoPromptPresets: videoPresets,
        imagePromptPresets: imagePresets,
        activeVideoPromptPreset: activeVideoPreset,
        activeImagePromptPreset: activeImagePreset,
        ...(modelMetaReady &&
        (thinkingOptions.length > 0 ||
          (selected?.provider ?? null) !== bot.modelProvider ||
          (selected?.modelId ?? null) !== bot.modelId)
          ? {
              thinkingLevel: thinkingOptions.length
                ? ((thinkingLevel || null) as ThinkingLevel | null)
                : null,
            }
          : {}),
      };
      const requestedTools = patchOverrides?.disabledBuiltinTools;
      const baseTools = patchOverrides?.baseDisabledBuiltinTools ?? [];
      // Preserve this edit's additions/removals against any refreshed server list.
      // Retry if a refresh arrives while the request is in flight.
      for (;;) {
        const serverTools = serverDisabledToolsRef.current;
        const nextTools =
          requestedTools === undefined
            ? undefined
            : [
                ...persistedDisabledToolsRef.current.filter(
                  (name) => !baseTools.includes(name) || requestedTools.includes(name),
                ),
                ...requestedTools.filter(
                  (name) =>
                    !baseTools.includes(name) && !persistedDisabledToolsRef.current.includes(name),
                ),
              ];
        // Unrelated saves omit the list, preserving changes from other sessions.
        await onSave({
          ...patch,
          ...(nextTools !== undefined ? { disabledBuiltinTools: nextTools } : {}),
        });
        if (nextTools === undefined) break;
        if (
          serverTools !== serverDisabledToolsRef.current &&
          !sameStringList(nextTools, serverDisabledToolsRef.current)
        )
          continue;
        persistedDisabledToolsRef.current = nextTools;
        break;
      }
      acceptedAutomatic.current = {
        color: nextColor,
        avatarSet: nextAvatarSet,
        notifyOnFinish: nextNotify,
      };
      if (nextName) savedNameRef.current = nextName;
      savedDescriptionRef.current = nextDescription;
      setSavedAdvanced(
        JSON.stringify([
          modelKey,
          thinkingLevel,
          computerMode,
          memoryScope,
          autoSpeak,
          voiceId,
          translationModel,
          translationSourceLanguage,
          translationTargetLanguage,
          autoTranslate,
          showTranslationActions,
          JSON.stringify(videoModels),
          JSON.stringify(imageModels),
          activeVideoPreset ?? "",
          activeImagePreset ?? "",
          JSON.stringify(videoPresets),
          JSON.stringify(imagePresets),
        ]),
      );
    } catch (err) {
      if (
        patchOverrides?.color !== undefined &&
        revisions?.color === automaticRevision.current.color
      )
        setColor(acceptedAutomatic.current.color);
      if (
        patchOverrides?.avatarSet !== undefined &&
        revisions?.avatarSet === automaticRevision.current.avatarSet
      )
        setAvatarSet(acceptedAutomatic.current.avatarSet);
      if (
        patchOverrides?.notifyOnFinish !== undefined &&
        revisions?.notifyOnFinish === automaticRevision.current.notifyOnFinish
      )
        setNotifyOnFinish(acceptedAutomatic.current.notifyOnFinish);
      if (patchOverrides?.crossSpaceCommunication !== undefined)
        setCrossSpaceCommunication(!patchOverrides.crossSpaceCommunication);
      if (patchOverrides?.dailyCheckIns !== undefined)
        setDailyCheckIns(!patchOverrides.dailyCheckIns);
      if (patchOverrides?.fleetManagement !== undefined)
        setFleetManagement(!patchOverrides.fleetManagement);
      if (patchOverrides?.replyMode !== undefined) setReplyMode(bot.replyMode);
      setError(errorText(err, t`Could not save`));
    } finally {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) {
        setDisabledBuiltinTools([...persistedDisabledToolsRef.current]);
      }
      setSaving(pendingSavesRef.current > 0);
    }
  }
  executeSaveRef.current = executeSave;

  function disableBuiltinTool(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (!isBuiltinToolName(name)) return;
    setError(null);
    if (disabledBuiltinTools.includes(name)) return;
    const next = [...disabledBuiltinTools, name];
    setDisabledBuiltinTools(next);
    void enqueueSave({ disabledBuiltinTools: next });
  }

  function enqueueSave(patchOverrides?: {
    name?: string;
    description?: string;
    color?: string;
    avatarSet?: BotAvatarSet;
    notifyOnFinish?: boolean;
    fleetManagement?: boolean;
    replyMode?: ReplyMode;
    crossSpaceCommunication?: boolean;
    dailyCheckIns?: boolean;
    disabledBuiltinTools?: string[];
  }) {
    // Serialize full-object auto-saves so an older in-flight request cannot
    // finish after a newer one and clobber fields. Always call through a ref so
    // queued work reads the latest field values, not a stale render closure.
    pendingSavesRef.current += 1;
    if (patchOverrides?.color !== undefined) automaticRevision.current.color += 1;
    if (patchOverrides?.avatarSet !== undefined) automaticRevision.current.avatarSet += 1;
    if (patchOverrides?.notifyOnFinish !== undefined) automaticRevision.current.notifyOnFinish += 1;
    const revisions = { ...automaticRevision.current };
    const queuedPatch =
      patchOverrides?.disabledBuiltinTools === undefined
        ? patchOverrides
        : {
            ...patchOverrides,
            baseDisabledBuiltinTools: [...persistedDisabledToolsRef.current],
          };
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => executeSaveRef.current(queuedPatch, revisions));
    return saveQueueRef.current;
  }

  return (
    <div data-testid="bot-settings">
      <div data-testid="bot-profile-header" className="flex flex-col items-center pb-5 text-center">
        <div className="flex justify-center pb-4">
          <AvatarStudioPopover
            value={color}
            identity={bot.id}
            status={bot.status}
            size={76}
            avatarSet={avatarSet}
            onChange={(newColor, nextAvatarSet) => {
              setColor(newColor);
              if (nextAvatarSet !== undefined) setAvatarSet(nextAvatarSet);
              void enqueueSave({
                color: newColor,
                ...(nextAvatarSet !== undefined ? { avatarSet: nextAvatarSet } : {}),
              });
            }}
          />
        </div>
        <InlineProfileField
          label={t`Name`}
          editLabel={t`Edit name`}
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          className="text-heading2 font-semibold"
          onCommit={(value) => {
            if (!value.trim()) return;
            setName(value.trim());
            void enqueueSave({ name: value });
          }}
        />
        <BotEmail bot={{ id: bot.id, name }} />
      </div>
      <Tabs value={tab} onValueChange={(next) => onTabChange?.(next as BotPanelTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="computer">
            <Trans>Computer</Trans>
          </TabsTrigger>
          <TabsTrigger value="routines">
            <Trans>Routines</Trans>
          </TabsTrigger>
          <TabsTrigger value="pages">
            <Trans>Pages</Trans>
          </TabsTrigger>
          <TabsTrigger value="persona">
            <Trans>Persona</Trans>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Trans>Advanced</Trans>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="computer" className="pt-4">
          {computer}
        </TabsContent>
        <TabsContent value="routines" className="pt-4">
          {routines}
        </TabsContent>
        <TabsContent value="pages" className="pt-4">
          {tab === "pages" ? <PagesList botId={bot.id} /> : null}
        </TabsContent>
        <TabsContent value="persona" className="pt-4">
          {tab === "persona" ? (
            <BotPersonaSection
              bot={bot}
              onBotUpdated={(updated) => onBotUpdated?.(updated)}
              onManageTemplates={() => onOpenTemplateLibrary?.()}
            />
          ) : null}
        </TabsContent>
        {/* Stays mounted so scratchpad and knowledge drafts survive a tab switch. */}
        <TabsContent value="settings" keepMounted data-testid="bot-settings-advanced">
          <NotificationsSection
            ids={ids}
            notifyOnFinish={notifyOnFinish}
            onNotifyOnFinishChange={(checked) => {
              setNotifyOnFinish(checked);
              void enqueueSave({ notifyOnFinish: checked });
            }}
          />
          <ErrorBoundary fallback={<SectionLoadFailed />}>
            <Suspense fallback={null}>
              <ScratchpadSection botId={bot.id} />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary fallback={<SectionLoadFailed />}>
            <Suspense fallback={null}>
              <KnowledgeSection botId={bot.id} />
            </Suspense>
          </ErrorBoundary>
          <div className="space-y-6 pt-6">
            <ModelSection
              ids={ids}
              containerRef={modelRef}
              onOpenConnections={onOpenConnections}
              choices={modelChoices}
              value={selectedModelKey}
              locatedKey={locatedKey}
              onModelChange={(key) => {
                setModelKey(key);
                setThinkingLevel("");
              }}
              thinkingOptions={thinkingOptions}
              thinkingLevel={thinkingLevel}
              defaultThinkingLevel={defaultThinkingLevel}
              onThinkingLevelChange={setThinkingLevel}
            />
            <ComputerGroup
              computerMode={computerMode}
              onComputerModeChange={setComputerMode}
              memoryProviderConfigured={memoryProviderConfigured}
              memoryScope={memoryScope}
              onMemoryScopeChange={setMemoryScope}
            />
            <VoiceGroup
              ids={ids}
              autoSpeak={autoSpeak}
              onAutoSpeakChange={setAutoSpeak}
              voices={voices}
              voiceId={voiceId}
              onVoiceIdChange={setVoiceId}
            />
            <MediaModelGroup
              ids={ids}
              locatedKey={locatedKey}
              videoChoices={videoChoices}
              videoValue={videoValue}
              onVideoModelChange={(key) => changeMediaModel("video", key)}
              videoFallbacks={videoFallbacks}
              onAddVideoFallback={(key) => addMediaFallback("video", key)}
              onMoveVideoFallback={(key, delta) => moveMediaFallback("video", key, delta)}
              onRemoveVideoFallback={(key) => removeMediaFallback("video", key)}
              videoTest={videoTest}
              onTestVideoModel={(key) => void testMediaModel("video", key)}
              onApplyVideoTestedModel={() => applyTestedMediaModel("video")}
              imageChoices={imageChoices}
              imageValue={imageValue}
              onImageModelChange={(key) => changeMediaModel("image", key)}
              imageFallbacks={imageFallbacks}
              onAddImageFallback={(key) => addMediaFallback("image", key)}
              onMoveImageFallback={(key, delta) => moveMediaFallback("image", key, delta)}
              onRemoveImageFallback={(key) => removeMediaFallback("image", key)}
              imageTest={imageTest}
              onTestImageModel={(key) => void testMediaModel("image", key)}
              onApplyImageTestedModel={() => applyTestedMediaModel("image")}
              videoPresets={videoPresets}
              onVideoPresetsChange={setVideoPresets}
              activeVideoPreset={activeVideoPreset}
              onVideoPresetChange={setActiveVideoPreset}
              imagePresets={imagePresets}
              onImagePresetsChange={setImagePresets}
              activeImagePreset={activeImagePreset}
              onImagePresetChange={setActiveImagePreset}
            />
            <TranslationGroup
              ids={ids}
              locatedKey={locatedKey}
              choices={translationModelChoices}
              value={selectedTranslationModelKey}
              onModelChange={setTranslationModel}
              sourceLanguage={translationSourceLanguage}
              onSourceLanguageChange={setTranslationSourceLanguage}
              targetLanguage={translationTargetLanguage}
              onTargetLanguageChange={setTranslationTargetLanguage}
              autoTranslate={autoTranslate}
              onAutoTranslateChange={setAutoTranslate}
              showTranslationActions={showTranslationActions}
              onShowTranslationActionsChange={setShowTranslationActions}
            />
            <PermissionsGroup
              ids={ids}
              saving={saving}
              dailyCheckIns={dailyCheckIns}
              onDailyCheckInsChange={(checked) => {
                setDailyCheckIns(checked);
                void enqueueSave({ dailyCheckIns: checked });
              }}
              crossSpaceCommunication={crossSpaceCommunication}
              onCrossSpaceCommunicationChange={(checked) => {
                setCrossSpaceCommunication(checked);
                void enqueueSave({ crossSpaceCommunication: checked });
              }}
              fleetManagement={fleetManagement}
              onFleetManagementChange={(checked) => {
                setFleetManagement(checked);
                void enqueueSave({ fleetManagement: checked });
              }}
            />
            <RepliesGroup
              ids={ids}
              saving={saving}
              replyMode={replyMode}
              onReplyModeChange={(next) => {
                setReplyMode(next);
                void enqueueSave({ replyMode: next });
              }}
            />
            <InstructionSettings key={bot.id} bot={bot} />
            <DescriptionGroup
              ids={ids}
              description={description}
              onDescriptionChange={setDescription}
              onCommit={() => void enqueueSave()}
            />
            <ToolsGroup
              ids={ids}
              disabledBuiltinTools={disabledBuiltinTools}
              onDisable={disableBuiltinTool}
              onEnable={(toolName) => {
                const next = disabledBuiltinTools.filter((entry) => entry !== toolName);
                setDisabledBuiltinTools(next);
                void enqueueSave({ disabledBuiltinTools: next });
              }}
            />
            <ExportAndClear
              onExport={() => {
                setError(null);
                onExport().catch((err: unknown) => setError(errorText(err)));
              }}
              onClear={onClear}
            />
            {packageTools}
          </div>
          {dirty ? (
            <Button
              className="sticky bottom-0 mt-5 w-full"
              disabled={saving}
              onClick={() => {
                void enqueueSave({
                  name,
                  description,
                  color,
                  notifyOnFinish,
                });
              }}
            >
              <Trans>Save</Trans>
            </Button>
          ) : null}
        </TabsContent>
      </Tabs>
      {error ? <p className="mt-2 text-body-sm text-destructive">{error}</p> : null}
    </div>
  );
}

const NO_CREDENTIALS: never[] = [];
const NO_CATALOG: ModelCatalogEntry[] = [];

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function catalogEntry(
  catalog: ModelCatalogEntry[],
  provider: string | null | undefined,
  modelId: string,
) {
  if (!provider) return undefined;
  return catalog.find((entry) => entry.provider === provider && entry.id === modelId);
}

function InlineProfileField({
  label,
  editLabel,
  value,
  maxLength,
  className,
  onCommit,
}: {
  label: string;
  editLabel: string;
  value: string;
  maxLength: number;
  className: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) return;
    setEditing(false);
    if (draft.trim() !== value.trim()) onCommit(draft);
  }
  return editing ? (
    <Input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      className={`h-auto border-transparent bg-transparent p-0 text-center shadow-none ${className}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === "Escape") event.stopPropagation();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <button
      type="button"
      aria-label={editLabel}
      className={`min-w-0 max-w-full cursor-text break-words rounded px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      onClick={() => {
        cancelled.current = false;
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </button>
  );
}

/** The bot's address under its name; on a server that receives email, offered until claimed. */
function BotEmail({ bot }: { bot: { id: string; name: string } }) {
  const queries = useSpaceQueries();
  const email = useQuery(queries.bots.emailAddress.queryOptions({ input: { botId: bot.id } })).data;
  const [claiming, setClaiming] = useState(false);
  if (!email) return null;
  if (!email.address && !claiming) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="mt-1 text-muted-foreground"
        onClick={() => setClaiming(true)}
      >
        <Mail />
        <Trans>Get an email address</Trans>
      </Button>
    );
  }
  return (
    <div data-testid="bot-email" className="mt-2 w-full max-w-sm text-left">
      <BotEmailAddressField bot={bot} domain={email.domain} address={email.address} />
    </div>
  );
}
