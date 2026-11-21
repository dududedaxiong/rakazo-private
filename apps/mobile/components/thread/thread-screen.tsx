import type {
  AgentSkillCatalogEntry,
  BotModelEntry,
  ModelRoleChoice,
} from "@rakazo_mickvvw/contracts";
import { primaryBotModel } from "@rakazo_mickvvw/contracts";
import type { ShareCardTextOverride } from "@rakazo_mickvvw/core";
import {
  activeThreadRuns,
  buildComposerMentionOptions,
  channelMessageSender,
  chatUserBubbleColors,
  isRunWaitingOnUser,
  isRunWorking,
  liveActivityLine,
  liveMessageComposing,
  memberName,
  modelOptionKey,
  newClientId,
  newestPageCards,
  noReplyMessageIds,
  otherAuthor,
  ReplyWatchdog,
  displayName as safeDisplayName,
  selectableMessageText,
  workingRoutineName,
} from "@rakazo_mickvvw/core";
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, I18nManager, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readableGutters } from "../../lib/adaptive-layout";
import { rpc } from "../../lib/api";
import { useAppForeground } from "../../lib/app-foreground";
import { mobileTokens } from "../../lib/appearance";
import type { MobileArtifactTarget } from "../../lib/artifact-open";
import { useCallSession } from "../../lib/call-session";
import { useChatBackground } from "../../lib/chat-background";
import { composerDraftScope } from "../../lib/composer-draft";
import { useComposerThinkingLevel } from "../../lib/composer-thinking-level";
import { useComputerFloatEnabled } from "../../lib/computer-float-settings";
import { cronLabels } from "../../lib/cron";
import { heroBackgroundHeightFor, useCustomSettings } from "../../lib/custom-settings";
import { useI18n } from "../../lib/i18n";
import type { MobileMessage, MobileModel, MobileModelCredential } from "../../lib/mobile-types";
import { blockText } from "../../lib/mobile-types";
import { useThemedStyles } from "../../lib/native";
import {
  getOverlaySpeakingMessageIds,
  getOverlaySpeechProgress,
  subscribeOverlaySpeech,
} from "../../lib/overlay-speech";
import { useChatOnScreen } from "../../lib/page-card-detail";
import { currentPersonaName } from "../../lib/prompt-template-display";
import { usePromptTemplates } from "../../lib/prompt-templates";
import { useInboxBot } from "../../lib/search-inbox";
import { useSplitView } from "../../lib/split-view";
import { useIncomingShareImport, useThreadAttachments } from "../../lib/thread-attachments";
import { useThreadBots } from "../../lib/thread-bots";
import { threadColumnPadding, threadHeaderFloats } from "../../lib/thread-edges";
import {
  favoriteSnippet,
  toggleThreadFavorite,
  translationFavoriteId,
  useThreadFavorites,
} from "../../lib/thread-favorites";
import { useThreadFeedback } from "../../lib/thread-feedback";
import { useThreadFocus } from "../../lib/thread-focus";
import { useThreadSnapshot } from "../../lib/thread-history";
import { threadKeyboardAvoidance } from "../../lib/thread-keyboard-offset";
import { useThreadListScroll } from "../../lib/thread-list-scroll";
import { useThreadMentionCatalog } from "../../lib/thread-mention-catalog";
import { useThreadPaging } from "../../lib/thread-paging";
import { useThreadRead } from "../../lib/thread-read";
import { buildRegeneratePayload, previousUserMessageText } from "../../lib/thread-regenerate";
import {
  isOwnThreadMessage,
  latestArrivalMessage,
  latestThreadRowKey,
} from "../../lib/thread-scroll";
import { searchThreadMessages, stepSearchIndex } from "../../lib/thread-search";
import { useThreadSend } from "../../lib/thread-send";
import { threadGroupMembers } from "../../lib/thread-snapshot";
import { useThreadSync } from "../../lib/thread-sync";
import { useThreadTranscript } from "../../lib/thread-transcript";
import {
  useAutoSpeakReply,
  useSpeakMessages,
  useSpeakText,
  useThreadVoiceCall,
} from "../../lib/thread-voice";
import { liveEndRunError } from "../../lib/thread-window";
import { translationSettingsFromBot } from "../../lib/translation";
import { getVoicePlaybackState, stopVoicePlayback, subscribeVoicePlayback } from "../../lib/voice";
import { ChatTitleHero, chatTitleHeroHeight } from "../chat-title-hero";
import { FailedSendBubble } from "../failed-send-bubble";
import { NativeSymbol } from "../native-symbol";
import { NewestPageCards } from "../pages/page-card";
import { RunErrorSheet } from "../run-error-sheet";
import { ShareCardSheet } from "../ShareCardSheet";
import { ShareConversationSheet } from "../ShareConversationSheet";
import { SelectTextSheet } from "../select-text-sheet";
import { ThreadComposer } from "../thread-composer";
import { ThreadErrorNotice, ThreadFetchErrorNotice } from "../thread-error-notice";
import { createThreadHeaderStyles } from "../thread-header-styles";
import { ChatBackgroundLayer } from "./chat-background-layer";
import { ComputerFloatWindow } from "./computer-float-window";
import { HeroBackgroundLayer } from "./hero-background-layer";
import { MessageSelectionBar } from "./message-selection-bar";
import { QuoteSheet } from "./quote-sheet";
import { ThreadBackgroundSheet } from "./thread-background-sheet";
import { ThreadBackupSheet } from "./thread-backup-sheet";
import { ThreadBotMenuSheet } from "./thread-bot-menu-sheet";
import { ThreadComposerChips } from "./thread-composer-chips";
import { ThreadComposerDock } from "./thread-composer-dock";
import { ThreadCustomSettingsSheet } from "./thread-custom-settings-sheet";
import { ThreadFavoritesSheet } from "./thread-favorites-sheet";
import { useThreadHeader } from "./thread-header";
import { LoadEarlierButton, ThreadWorkingFooter } from "./thread-list-controls";
import type { MediaModelListKey } from "./thread-media-model-sheet";
import { ThreadMediaModelSheet } from "./thread-media-model-sheet";
import { ThreadMessageList } from "./thread-message-list";
import type { ThreadModelPickerRole, ThreadModelSave } from "./thread-model-picker-sheet";
import { ThreadModelPickerSheet } from "./thread-model-picker-sheet";
import { ThreadPersonaSheet } from "./thread-persona-sheet";
import { useLatestRowActions, useThreadRows } from "./thread-rows";
import { useThreadRunError } from "./thread-run-error";

function isActiveStatus(status: string | undefined): boolean {
  return isRunWorking(status) || isRunWaitingOnUser(status);
}

/**
 * The chat screen. Hook order is effect order: the snapshot, scroll, sync and send hooks run their
 * effects at the positions the screen ran them before they were split out.
 */
export function Thread({ sessionEpoch, userId }: { sessionEpoch: number; userId: string }) {
  useChatOnScreen();
  const tokens = mobileTokens();
  const styles = useThemedStyles(createThreadHeaderStyles);
  const { t, locale } = useI18n();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const router = useRouter();
  // Beside the chat list on a wide window, the chat has only the width the list leaves.
  const { inboxShown, contentWidth: windowWidth } = useSplitView();
  const nativeHeaderHeight = useHeaderHeight();
  const headerHeight = threadHeaderFloats() ? nativeHeaderHeight : 0;
  // The hero sits flush against the native header's bottom edge, zero gap: on Android
  // the screen content already starts below the solid header, so top 0 is flush; on iOS
  // the header floats over the content, so the hero starts at the header's bottom edge.
  // Any gap here lets the scrolling conversation show through above the avatar, and the
  // hollowed-out hero (transparent, no white box) has nothing to hide it behind.
  const heroTop = threadHeaderFloats() ? nativeHeaderHeight : 0;
  // The conversation search bar, a 48pt pill under the native header: the hero
  // and the list's top clearance shift down while it is open.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  // Multi-select batch delete: the picked message ids, and whether a batch
  // delete is running. The selection bar replaces the composer while on.
  const [selecting, setSelecting] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectionBusy, setSelectionBusy] = useState(false);
  const searchBarHeight = searchOpen ? 48 : 0;
  // The interface settings, live: a slider moves the chat at once, so the hero
  // background's height follows the settings without a reload.
  const customSettings = useCustomSettings(userId);
  // The list's top clearance always reserves the hero's full height, so the
  // oldest message starts below the hero instead of scrolling underneath it. The
  // height follows the title font size, never measured, so the clearance and the
  // hero can never disagree and leave a gap for the conversation to show through.
  const heroHeight = chatTitleHeroHeight(customSettings.font.title.size);
  const listClearance = {
    padding: heroTop + heroHeight + searchBarHeight,
    anchor: heroTop + 20,
    minHeight: heroTop,
  };
  // The model catalog and connections, shared by the shortcut row and the
  // composer's reasoning control; the shortcut row used to fetch them itself.
  const [modelCatalog, setModelCatalog] = useState<MobileModel[] | null>(null);
  const [modelCredentials, setModelCredentials] = useState<MobileModelCredential[] | null>(null);
  // The model saved from the sheet, until the chat's bot list catches up with it.
  const [mainOverride, setMainOverride] = useState<ThreadModelSave | null>(null);
  // The media models saved from the sheet, until the chat's bot list catches up with it.
  const [videoOverride, setVideoOverride] = useState<ThreadModelSave | null>(null);
  const [imageOverride, setImageOverride] = useState<ThreadModelSave | null>(null);
  // The media edit models saved from the sheet, until the chat's bot list catches up with it.
  const [videoEditOverride, setVideoEditOverride] = useState<ThreadModelSave | null>(null);
  const [imageEditOverride, setImageEditOverride] = useState<ThreadModelSave | null>(null);
  // The translation model saved from the sheet, until the chat's bot list catches up with it.
  const [translationOverride, setTranslationOverride] = useState<ThreadModelSave | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  // The computer model, fetched here so the shortcut row and the bot menu share one picker.
  const [computerChoice, setComputerChoice] = useState<ModelRoleChoice | null>(null);
  const [sheetRole, setSheetRole] = useState<ThreadModelPickerRole | null>(null);
  // The stuck message waiting for a model pick: [换模型重试] stops its run and
  // opens the main-model sheet; saving a model re-runs it. Cleared when the
  // sheet closes without a pick, so a later pick does not retry a stale message.
  const stuckRetryMessageRef = useRef<MobileMessage | null>(null);
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [customSettingsOpen, setCustomSettingsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [shareCardTarget, setShareCardTarget] = useState<MobileMessage | null>(null);
  const [shareCardQuestion, setShareCardQuestion] = useState("");
  const [shareCardTextOverride, setShareCardTextOverride] = useState<ShareCardTextOverride | null>(
    null,
  );
  const [shareConversationOpen, setShareConversationOpen] = useState(false);
  const insets = useSafeAreaInsets();
  // An unfolded or tablet window keeps messages and the composer in a centred reading column.
  const columnInsets = readableGutters(windowWidth, {
    left: inboxShown ? 0 : insets.left,
    right: insets.right,
  });
  const columnWidth = windowWidth - columnInsets.left - columnInsets.right;
  const columnPadding = useMemo(
    () => threadColumnPadding(columnInsets, I18nManager.isRTL),
    [columnInsets.left, columnInsets.right],
  );
  const {
    botId,
    groupId,
    name,
    messageId,
    threadId,
    readOnly: readOnlyParam,
  } = useLocalSearchParams<{
    botId?: string;
    groupId?: string;
    name?: string;
    messageId?: string;
    threadId?: string;
    readOnly?: string;
  }>();
  const readOnly = readOnlyParam === "1";
  const requestedThreadId = typeof threadId === "string" && threadId ? threadId : undefined;
  const inGroup = Boolean(groupId);
  const call = useCallSession();
  const onCall = Boolean(botId) && call?.botId === botId;
  // The composer floats over the list, which scrolls underneath; this keeps the newest message
  // clear of it. A read-only chat has no composer.
  const [dockHeight, setDockHeight] = useState(0);
  const bottomInset = Math.max(dockHeight, readOnly ? insets.bottom : 0);
  const activeBotId = useRef(botId);
  activeBotId.current = botId;
  const activeGroupId = useRef(groupId);
  activeGroupId.current = groupId;
  const {
    threadKey,
    activeThreadId,
    readVisit,
    readVisibleTarget,
    readBoundary,
    setReadBoundary,
    markedUnreadMessageId,
    markUnreadFrom,
    markReadIfVisible,
  } = useThreadRead({ botId, groupId, focused, readOnly });
  const markCaughtUp = () => setReadBoundary({ visit: readVisit.current.visit, seq: null });
  const artifactTarget: MobileArtifactTarget | undefined = groupId
    ? { groupId }
    : botId
      ? { botId }
      : undefined;
  const history = useThreadSnapshot();
  const { snap, composingBots, showingSaved } = history;
  const [agentSkills, setAgentSkills] = useState<AgentSkillCatalogEntry[]>([]);
  const [uploadConfig, setUploadConfig] = useState<{
    maxUploadSizeBytes?: number;
    maxAttachmentsPerMessage?: number;
  }>();
  const [needsModel, setNeedsModel] = useState<boolean>();
  // Re-read on focus so returning from Models settings updates unsent missing-model messages.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void rpc("me")
        .then((me) => {
          if (cancelled) return;
          setUploadConfig(me);
          setNeedsModel(me.needsModel);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const { mentionBots, mentionBotsRef, mentionGroups, refreshMentionBots } = useThreadBots({
    botId,
    groupId,
    name,
    activeBotId,
  });
  const {
    routines: mentionRoutines,
    connectors: mentionConnectors,
    onMentionRequested,
  } = useThreadMentionCatalog(
    JSON.stringify([userId, sessionEpoch, botId, groupId, requestedThreadId]),
    mentionBots,
  );
  const draftScope = useMemo(
    () => composerDraftScope(userId, botId, groupId),
    [userId, botId, groupId],
  );
  const attachments = useThreadAttachments({ botId, groupId, readOnly, uploadConfig, draftScope });
  const echoed = useMemo(
    () =>
      snap && (snap.groupId ?? snap.botId) === threadKey
        ? new Set(
            snap.messages.flatMap((message) =>
              message.role === "user" && message.seq !== undefined ? [message.seq] : [],
            ),
          )
        : undefined,
    [snap, threadKey],
  );
  const feedback = useThreadFeedback(threadKey, newClientId, echoed);
  const { error, setError } = feedback;
  const [selectableText, setSelectableText] = useState<string | null>(null);
  const transcript = useThreadTranscript(snap?.messages, inGroup);
  const { reactionView, peerTranscript, setExpandedPeerMarkers } = transcript;
  const visibleMessages = transcript.visibleMessages;
  // The thread's favorites and background, both local to the device; the
  // search matches only the loaded window.
  const favorites = useThreadFavorites(threadKey);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.messageId)), [favorites]);
  const background = useChatBackground(threadKey);
  const searchMatches = useMemo(
    () => (searchQuery.trim() ? searchThreadMessages(visibleMessages, searchQuery) : []),
    [visibleMessages, searchQuery],
  );
  const searchHitIds = useMemo(
    () => new Set(searchMatches.map((message) => message.id)),
    [searchMatches],
  );
  const searchCurrentId = searchMatches[searchIndex]?.id ?? null;
  const newestPages = useMemo(() => newestPageCards(visibleMessages), [visibleMessages]);
  const latestMessage = latestArrivalMessage(reactionView.visibleMessages, peerTranscript.markerOf);
  const composerMentionTargets = useMemo(
    () =>
      buildComposerMentionOptions({
        query: "",
        includeEveryone: inGroup,
        currentGroupId: groupId,
        bots: mentionBots.map((bot) => ({
          id: bot.id,
          name: bot.name,
          color: bot.color,
          avatarSet: bot.avatarSet,
        })),
        groups: mentionGroups.map((group) => ({ id: group.id, name: group.name })),
        routines: mentionRoutines.map((routine) => ({
          id: routine.id,
          name: routine.name,
          crons: routine.crons,
          botId: routine.botId,
          botName: routine.botName,
        })),
        connectors: mentionConnectors,
        cronLabels: cronLabels(locale),
      }),
    [groupId, inGroup, locale, mentionBots, mentionConnectors, mentionGroups, mentionRoutines],
  );
  const currentBot = botId ? mentionBots.find((bot) => bot.id === botId) : undefined;
  /**
   * Drops one fallback from one of the media sheet's ordered lists; the
   * connection keeps the model, so it stays pickable elsewhere.
   */
  const removeBotModel = (list: MediaModelListKey, entry: BotModelEntry) => {
    if (!botId) return;
    const field =
      list === "video"
        ? "videoModels"
        : list === "image"
          ? "imageModels"
          : list === "videoEdit"
            ? "videoEditModels"
            : list === "imageEdit"
              ? "imageEditModels"
              : "translationModels";
    const current = currentBot?.[field] ?? [];
    const next = current.filter(
      (item) => !(item.provider === entry.provider && item.model === entry.model),
    );
    if (next.length === current.length) return;
    void rpc("bots/update", {
      botId,
      ...(list === "video"
        ? { videoModels: next }
        : list === "image"
          ? { imageModels: next }
          : list === "videoEdit"
            ? { videoEditModels: next }
            : list === "imageEdit"
              ? { imageEditModels: next }
              : { translationModels: next }),
    })
      .then(() => refreshMentionBots())
      .catch(() => undefined);
  };
  const templatesQuery = usePromptTemplates();
  const personaName = currentPersonaName(currentBot, templatesQuery.data);
  useEffect(() => {
    setMainOverride(null);
  }, [currentBot?.modelProvider, currentBot?.modelId]);
  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    void Promise.all([rpc("models/list"), rpc("models/credentials")])
      .then(([list, credentials]) => {
        if (cancelled) return;
        setModelCatalog(list as MobileModel[]);
        setModelCredentials(credentials as MobileModelCredential[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [botId]);
  useEffect(() => {
    if (!botId) return;
    let cancelled = false;
    void rpc("models/role", { role: "computer", expectedUserId: userId, scope: "account" })
      .then((view: { primary?: ModelRoleChoice | null }) => {
        if (cancelled) return;
        setComputerChoice(view.primary ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [botId, userId]);
  const thinkingLevel = useComposerThinkingLevel({
    botId,
    bot: currentBot,
    mainOverride,
    catalog: modelCatalog,
    credentials: modelCredentials,
  });
  // Until the chat's own roster arrives, the bot as the inbox last loaded it.
  const inboxBot = useInboxBot(botId);
  const titleBot = currentBot ?? inboxBot;
  // Without a name yet (a notification can leave it out), the title shows a placeholder.
  const titleName = currentBot?.name ?? name ?? inboxBot?.name;
  const displayName = safeDisplayName(titleName, inGroup ? t("Group") : t("Bot"));
  const composerPrompt = t("Message or hold to talk…");
  const notificationThreadId = snap?.threadId ?? requestedThreadId ?? currentBot?.threadId;
  activeThreadId.current = notificationThreadId;
  const currentBotStatus =
    snap && (!showingSaved || error)
      ? snap.run?.status
      : (titleBot?.threadStatus ?? snap?.run?.status);
  // The group's members in its order, once the chat or its group list has loaded them; the
  // title seats the inbox's copy until then.
  const groupMembers = threadGroupMembers(groupId, snap, mentionGroups);
  const activityLine = liveActivityLine(snap?.messages ?? []);
  const workingRoutine = workingRoutineName(snap?.activeRuns ?? (snap?.run ? [snap.run] : []));
  const userBubble = useMemo(
    () =>
      !inGroup && currentBot ? chatUserBubbleColors(currentBot.color, currentBot.id) : undefined,
    [inGroup, currentBot?.color, currentBot?.id],
  );
  const activeGroupBots = useMemo(() => {
    if (!inGroup) return [];
    const seen = new Set<string>();
    const active = snap?.activeRuns ?? (snap?.run ? [snap.run] : []);
    return active.flatMap((run) => {
      if (!run.botId || seen.has(run.botId) || !isActiveStatus(run.status)) return [];
      const member = snap?.members?.find((candidate) => candidate.botId === run.botId);
      if (!member) return [];
      seen.add(run.botId);
      return [{ ...member, status: run.status }];
    });
  }, [inGroup, snap?.activeRuns, snap?.members, snap?.run]);
  // A bot waiting on the user (an ask card, a computer takeover) can still be stopped, but its
  // card is the state: no typing dots under it.
  const workingGroupBots = activeGroupBots.filter((bot) => isRunWorking(bot.status));
  const working = inGroup ? activeGroupBots.length > 0 : isActiveStatus(currentBotStatus);
  // A reply still being worked on, so a new send waits. A run waiting on the
  // user (an ask card, a takeover) does not block sending.
  const runWorking = inGroup ? workingGroupBots.length > 0 : isRunWorking(currentBotStatus);

  const speakFinishedReplyRef = useAutoSpeakReply({
    botId,
    inGroup,
    currentBot,
    snap,
    showingSaved,
  });

  useEffect(() => {
    void rpc("agentSkills/list")
      .then(setAgentSkills)
      .catch(() => setAgentSkills([]));
  }, []);

  const scroll = useThreadListScroll({
    history,
    threadKey,
    botId,
    groupId,
    anchor: listClearance.anchor,
    visibleBottomInset: bottomInset,
    latestRowKey: latestThreadRowKey(
      latestMessage?.id ?? null,
      feedback.unsentSends.map((attempt) => attempt.clientNonce),
      isOwnThreadMessage(latestMessage, userId),
    ),
  });

  // Header auto-read toggle: flips this bot's autoSpeak and refreshes the roster so the
  // header re-renders. A failed save leaves the toggle where it was. Turning auto-read
  // off stops a reply that is being read aloud right now.
  const toggleAutoSpeak = useCallback(() => {
    if (!botId || !currentBot || inGroup || readOnly) return;
    const next = !currentBot.autoSpeak;
    if (currentBot.autoSpeak) stopVoicePlayback();
    void rpc("bots/update", { botId, autoSpeak: next })
      .then(() => refreshMentionBots())
      .catch(() => undefined);
  }, [botId, currentBot, inGroup, readOnly, refreshMentionBots]);

  // The computer screen float opens only from its header entry, never on its own. The
  // settings switch gates it per bot; off means no entry and no window, even mid-run.
  // The header entry opens the system popup: the live screen pops out to the system
  // floating window, which the phone can enlarge and operate; the in-app float is
  // only the fallback when the system window cannot show.
  const computerFloatEnabled = useComputerFloatEnabled(botId);
  const [computerFloatOpen, setComputerFloatOpen] = useState(false);
  const [computerFloatSystemOnly, setComputerFloatSystemOnly] = useState(false);

  useThreadHeader({
    botId,
    groupId,
    inGroup,
    readOnly,
    displayName,
    titleBot,
    titleName,
    groupMembers,
    currentBotStatus,
    composingBots,
    onCleared: history.clear,
    autoSpeak: !inGroup ? currentBot?.autoSpeak : undefined,
    onToggleAutoSpeak: !inGroup && !readOnly && botId && currentBot ? toggleAutoSpeak : undefined,
    onOpenSearch: () => setSearchOpen(true),
    computerFloatEnabled,
    onOpenComputerFloat:
      !inGroup && !readOnly && botId && computerFloatEnabled
        ? () => {
            setComputerFloatSystemOnly(true);
            setComputerFloatOpen(true);
          }
        : undefined,
    userId,
  });

  useThreadFocus({
    botId,
    readOnly,
    notificationThreadId,
    refreshMentionBots,
    markReadIfVisible,
    speakFinishedReplyRef,
  });

  // One watchdog per open chat: the last live event per bot, so a run whose
  // events stopped arriving is treated as stalled.
  const replyWatchdog = useRef(new ReplyWatchdog()).current;

  const { isCurrentTarget, refresh, applyMessageJump, showLatest } = useThreadSync({
    history,
    scroll,
    botId,
    groupId,
    messageId,
    readOnly,
    foreground,
    focused,
    sessionEpoch,
    activeBotId,
    activeGroupId,
    readVisibleTarget,
    setExpandedPeerMarkers,
    setError,
    onRefreshed: feedback.refreshed,
    refreshMentionBots,
    markReadIfVisible,
    replyWatchdog,
  });

  // The search steps only on an explicit prev/next tap, never per keystroke: a
  // jump per keystroke would re-page the conversation on every character.
  const stepSearch = (delta: 1 | -1) => {
    const next = stepSearchIndex(searchIndex, searchMatches.length, delta);
    setSearchIndex(next);
    const hit = searchMatches[next];
    if (hit) void applyMessageJump({ botId, groupId, messageId: hit.id }).catch(() => undefined);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchIndex(0);
    showLatest();
  };

  const paging = useThreadPaging({
    history,
    scroll,
    botId,
    groupId,
    visibleMessages,
    anchor: listClearance.anchor,
    setError,
    showLatest,
  });

  const composer = useThreadSend({
    botId,
    groupId,
    readOnly,
    threadKey,
    history,
    scroll,
    feedback,
    attachments,
    mentionBotsRef,
    activeBotId,
    activeGroupId,
    isCurrentTarget,
    refresh,
    showLatest,
    markCaughtUp,
    // The voice hook below owns bot switching; a send only switches after this render.
    openBotChat: (target, ring) => openBotChat(target, ring),
  });
  const { replyTarget, setReplyTarget, replyQuote, setReplyQuote, quoteTarget, setQuoteTarget } =
    composer;
  // A reply tapped on one of this chat's pages, full screen, lands in the composer unsent.
  useFocusEffect(composer.receivePageReply);
  useIncomingShareImport({
    attachments,
    composerRef: composer.composerRef,
    readOnly,
    threadKey,
    uploadConfig,
  });

  const openBot = useCallback(
    (id: string, botName: string) =>
      router.push({ pathname: "/thread", params: { botId: id, name: botName } }),
    [router],
  );

  const openComputer = useCallback(
    (id: string, botName: string) =>
      router.push({ pathname: "/computer", params: { botId: id, name: botName } }),
    [router],
  );

  const speak = useSpeakMessages({
    visibleMessages,
    botId,
    members: snap?.members,
    displayName,
    mentionBots,
  });

  const speakTranslation = useSpeakText({
    botId,
    members: snap?.members,
    displayName,
    mentionBots,
  });

  const { openBotChat } = useThreadVoiceCall({
    botId,
    readOnly,
    displayName,
    mentionBots,
    mentionBotsRef,
    activeBotId,
  });

  const {
    runError,
    normalizedRunError,
    runErrorAction,
    runErrorExtraActions,
    runErrorDismissAction,
    detailsOpen,
    setDetailsOpen,
    handled: runErrorHandled,
    modelProbe,
  } = useThreadRunError(snap?.run, botId, currentBot?.modelProvider);

  // Event actions read the latest committed screen state without invalidating settled rows.
  /** Multi-select: toggles one message's checkbox. */
  const toggleSelectMessage = useCallback((messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedMessageIds(new Set());
  }, []);
  /** Enters selection from the long-press menu, with that message picked. */
  const enterSelection = useCallback((message: MobileMessage) => {
    setSelecting(true);
    setSelectedMessageIds(new Set([message.id]));
  }, []);
  /** Deletes the selected messages one by one, then reports which failed. */
  const deleteSelected = useCallback(async () => {
    if (selectedMessageIds.size === 0 || selectionBusy) return;
    const target = groupId ? { groupId } : botId ? { botId } : null;
    if (!target) return;
    const messages = (snap?.messages ?? []).filter((message) => selectedMessageIds.has(message.id));
    setSelectionBusy(true);
    try {
      const failures: string[] = [];
      for (const [index, message] of messages.entries()) {
        try {
          await rpc("threads/deleteMessage", { ...target, messageId: message.id });
        } catch {
          const snippet = blockText(message).split("\n")[0]?.trim().slice(0, 40);
          failures.push(
            snippet ||
              t("message {index} of {total}", { index: index + 1, total: messages.length }),
          );
        }
      }
      exitSelection();
      void refresh();
      if (failures.length > 0) {
        Alert.alert(
          t("Could not delete {count} messages", { count: failures.length }),
          failures.join("\n"),
        );
      }
    } finally {
      setSelectionBusy(false);
    }
  }, [
    selectedMessageIds,
    selectionBusy,
    groupId,
    botId,
    snap?.messages,
    exitSelection,
    refresh,
    t,
  ]);
  const confirmDeleteSelected = useCallback(() => {
    if (selectedMessageIds.size === 0 || selectionBusy) return;
    const count = selectedMessageIds.size;
    Alert.alert(
      count === 1 ? t("Delete 1 message?") : t("Delete {count} messages?", { count }),
      t("This can't be undone."),
      [
        { text: t("Cancel"), style: "cancel" },
        { text: t("Delete"), style: "destructive", onPress: () => void deleteSelected() },
      ],
    );
  }, [selectedMessageIds, selectionBusy, deleteSelected, t]);

  /**
   * Sends a user message's text again through the normal outbox, so a message
   * that got no usable reply can be retried without retyping it. A regenerate
   * adds a second copy of the message to the thread.
   */
  const sendUserTextAgain = (text: string) => {
    if (readOnly) return;
    const originThreadKey = groupId ?? botId;
    if (!originThreadKey) return;
    if (!text) return;
    try {
      composer.retry(
        feedback.sendAttempt(
          buildRegeneratePayload({
            text,
            originThreadKey,
            botTarget: botId,
            groupTarget: groupId,
          }),
        ),
      );
    } catch {
      feedback.setError(t("Failed to send message"));
      return;
    }
  };

  /**
   * Re-runs the AI on one user message that got no reply, without adding a
   * second copy of the message to the thread. The reply lands after the
   * existing message.
   */
  const resendMessage = useCallback(
    async (message: MobileMessage) => {
      if (readOnly) return;
      const target = groupId ? { groupId } : botId ? { botId } : null;
      if (!target) return;
      try {
        await rpc("threads/resend", { ...target, messageId: message.id });
      } catch {
        feedback.setError(t("Failed to send message"));
        return;
      }
      void refresh();
    },
    [readOnly, groupId, botId, refresh, feedback, t],
  );

  /**
   * Retries a stuck message on another model: stops the quiet run first (a
   * resend refuses while a run is active), then opens the main-model sheet;
   * saving a model there re-runs the message on it.
   */
  const retryStuckRun = useCallback(
    (message: MobileMessage) => {
      if (readOnly) return;
      stuckRetryMessageRef.current = message;
      void composer.stop();
      setSheetRole("main");
    },
    [readOnly, composer],
  );

  const rowActions = useLatestRowActions({
    helperToggle: scroll.helperToggle,
    reply: (message) => {
      setReplyTarget(message);
      setReplyQuote(null);
    },
    quote: setQuoteTarget,
    select: setSelectableText,
    enterSelection,
    speak,
    speakText: speakTranslation,
    react: composer.react,
    favorite: (message) => {
      if (!threadKey) return;
      toggleThreadFavorite(threadKey, {
        messageId: message.id,
        snippet: favoriteSnippet(selectableMessageText(message)),
        text: selectableMessageText(message),
        createdAt: Date.now(),
      });
    },
    favoriteTranslation: (message, translatedText) => {
      if (!threadKey) return;
      toggleThreadFavorite(threadKey, {
        messageId: translationFavoriteId(message.id),
        snippet: favoriteSnippet(translatedText),
        text: translatedText,
        createdAt: Date.now(),
      });
    },
    regenerate: (message) => {
      sendUserTextAgain(
        previousUserMessageText(history.snapRef.current?.messages ?? [], message.id) ?? "",
      );
    },
    resend: resendMessage,
    shareCard: (message, textOverride) => {
      setShareCardTarget(message);
      setShareCardTextOverride(textOverride ?? null);
      setShareCardQuestion(
        previousUserMessageText(history.snapRef.current?.messages ?? [], message.id) ?? "",
      );
    },
    stopStuckRun: () => void composer.stop(),
    retryStuckRun,
    markUnread: markUnreadFrom,
    answer: composer.answer,
    openBot,
    openComputer,
    // A chat attachment opens the version it was sent with, not the newest.
    previewFile: (artifactId) =>
      router.push({
        pathname: "/artifact",
        params: {
          artifactId,
          exact: "1",
          ...(currentBot?.imageSaveDirectory
            ? { imageSaveDirectory: currentBot.imageSaveDirectory }
            : {}),
          ...(currentBot?.videoSaveDirectory
            ? { videoSaveDirectory: currentBot.videoSaveDirectory }
            : {}),
          showDownload: currentBot?.showMediaDownload === false ? "0" : "1",
          showShare: currentBot?.showMediaShare === false ? "0" : "1",
        },
      }),
    previewImage: (target) =>
      router.push({
        pathname: "/image",
        params: {
          ...target,
          ...(groupId ? { groupId } : { botId }),
          ...(currentBot?.imageSaveDirectory
            ? { imageSaveDirectory: currentBot.imageSaveDirectory }
            : {}),
          showDownload: currentBot?.showMediaDownload === false ? "0" : "1",
          showShare: currentBot?.showMediaShare === false ? "0" : "1",
        },
      }),
    jump: (messageId) => {
      void applyMessageJump({
        botId,
        groupId,
        messageId: reactionView.foldedInto.get(messageId) ?? messageId,
      }).catch(() => undefined);
    },
    dismissChoice: transcript.dismissChoice,
    openPeerChat: (peer) => {
      if (!botId) return;
      router.push({
        pathname: "/peer-chat",
        params: {
          botId,
          botName: displayName,
          botColor: currentBot?.color,
          peerBotColor: mentionBots.find((bot) => bot.id === peer.peerBotId)?.color,
          ...peer,
        },
      });
    },
    layout: scroll.layoutJumpRow,
  });

  // The player bar reads the same state; a row's speaker icon pulses only
  // while its own message is the one playing.
  const playback = useSyncExternalStore(subscribeVoicePlayback, getVoicePlaybackState);
  const overlaySpeakingMessageIds = useSyncExternalStore(
    subscribeOverlaySpeech,
    getOverlaySpeakingMessageIds,
  );
  const overlayProgress = useSyncExternalStore(subscribeOverlaySpeech, getOverlaySpeechProgress);
  // Read-aloud progress comes from whichever engine is sounding: the
  // on-device chain, or the single playback. Only a multi-utterance read
  // shows progress; a single utterance has nothing to count.
  const speechProgress =
    overlayProgress ??
    (playback.status === "playing" &&
    playback.messageId !== undefined &&
    playback.segmentTotal !== undefined &&
    playback.segmentTotal > 1 &&
    playback.caption !== undefined
      ? {
          messageId: playback.messageId,
          segmentIndex: playback.segmentIndex ?? 0,
          segmentTotal: playback.segmentTotal,
          text: playback.caption,
          ...(playback.source ? { source: playback.source } : {}),
        }
      : null);

  const { liveItems, renderMessageRow, renderItem, stuckRunIds, stuckBotIds } = useThreadRows({
    snap,
    userId,
    transcript,
    rowActions,
    botId,
    groupId,
    inGroup,
    readOnly,
    onCall,
    displayName,
    mentionBots,
    currentBot,
    currentBotStatus,
    userBubble,
    columnWidth,
    readSeq: readBoundary?.visit === readVisit.current.visit ? readBoundary.seq : null,
    markedUnreadMessageId,
    highlightedMessageId: scroll.highlightedMessageId,
    speakingMessageId: playback.status === "playing" ? playback.messageId : undefined,
    overlaySpeakingMessageIds,
    speechProgress,
    selecting,
    selectedMessageIds,
    onToggleSelectMessage: toggleSelectMessage,
    favoriteIds,
    searchHitIds,
    searchCurrentId,
    replyWatchdog,
  });

  // Only reply text being written replaces the footer; earlier sentences above a tool call don't.
  // A stuck run's frozen progress line does not count as live.
  const hasLiveProgress = visibleMessages.some(
    (message) =>
      message.id.startsWith("progress:") &&
      (!message.runId || !stuckRunIds.has(message.runId)) &&
      liveMessageComposing(message.blocks),
  );

  const workingBots =
    !inGroup &&
    titleBot &&
    isRunWorking(currentBotStatus) &&
    !hasLiveProgress &&
    !stuckBotIds.has(titleBot.id)
      ? [
          {
            id: titleBot.id,
            name: titleBot.name,
            color: titleBot.color,
            avatarSet: titleBot.avatarSet,
            status: currentBotStatus,
          },
        ]
      : inGroup
        ? workingGroupBots
            .filter((bot) => !stuckBotIds.has(bot.botId))
            .map((bot) => ({
              id: bot.botId,
              name: bot.name,
              color: bot.color,
              avatarSet: bot.avatarSet,
              status: bot.status,
            }))
        : [];
  const workingFooter = (
    <ThreadWorkingFooter
      bots={workingBots.map((bot) => ({
        ...bot,
        composing: composingBots.split(",").includes(bot.id),
      }))}
      atBottom={!scroll.state.detached}
      label={
        activityLine ??
        (workingRoutine ? t("Running {name}…", { name: workingRoutine }) : t("Working…"))
      }
    />
  );

  const loadEarlierControl =
    snap?.olderCursor != null ? (
      <LoadEarlierButton
        loading={paging.loadingOlder}
        onPress={() => void paging.loadOlderMessages()}
      />
    ) : null;

  // The big title hero, at the top of a one-to-one chat: the 88pt state-linked avatar with
  // the bot's persona under it. Groups keep only their native title. It floats above the message list
  // instead of scrolling with it, so it stays visible; the list's top clearance makes room
  // for it, and the capsule in the native bar stays as the title when scrolled. No live
  // process line here — the top bar shows no real-time process. Tapping the avatar opens
  // the bot menu; tapping the persona name opens the persona switcher.
  const titleComposing = Boolean(botId) && composingBots.split(",").includes(botId ?? "");
  const chatHero =
    !inGroup && botId ? (
      <ChatTitleHero
        bot={titleBot}
        status={currentBotStatus}
        composing={titleComposing}
        name={titleName}
        personaName={personaName}
        onAvatarPress={() => setBotMenuOpen(true)}
        onNamePress={() => setPersonaOpen(true)}
        userId={userId}
      />
    ) : null;
  // The hero background's height by this thread's setting, centred in the hero
  // area: at 100% it fills the hero, lower it covers a middle band, higher it
  // is clipped to the hero by the wrapper's overflow.
  const heroBackgroundHeight =
    (heroHeight * heroBackgroundHeightFor(customSettings, threadKey)) / 100;
  const heroBackgroundTop = Math.max(0, (heroHeight - heroBackgroundHeight) / 2);

  const failedSendBubbles = feedback.unsentSends.map((attempt) => (
    <FailedSendBubble
      key={attempt.clientNonce}
      attempt={attempt}
      needsModel={needsModel}
      onRetry={() => composer.retry(attempt)}
      onDelete={() => feedback.discard(attempt)}
      userBubble={userBubble}
      userId={userId}
    />
  ));

  // Fetch failures stay visible at either paging edge; provider recovery belongs to the live end.
  // Once the user switches to a working model, the old failure stops showing.
  const visibleRunError = runErrorHandled
    ? null
    : liveEndRunError(normalizedRunError, scroll.pinnedNewerCursor);
  /** The failed run's message was delivered but never answered: check before resending. */
  const runNoReply = useMemo(() => {
    const run = snap?.run;
    if (run?.status !== "failed" || !visibleRunError) return false;
    const ids = noReplyMessageIds(snap?.messages ?? [], activeThreadRuns(snap));
    return (snap?.messages ?? []).some(
      (message) => message.role === "user" && message.runId === run.id && ids.has(message.id),
    );
  }, [snap, visibleRunError]);

  const errorNotice = (
    <ThreadErrorNotice
      error={null}
      summary={visibleRunError?.summary ?? null}
      resetAt={visibleRunError?.resetAt}
      onDetails={() => setDetailsOpen(true)}
      action={visibleRunError ? runErrorAction : null}
      extraActions={visibleRunError ? runErrorExtraActions : null}
      modelProbe={visibleRunError ? modelProbe : null}
      userId={userId}
      noReply={runNoReply}
    />
  );

  const mainProvider = mainOverride !== null ? mainOverride.provider : currentBot?.modelProvider;
  const mainModelId = mainOverride !== null ? mainOverride.modelId : currentBot?.modelId;
  const videoPrimary = primaryBotModel(currentBot?.videoModels);
  const videoProvider = videoOverride !== null ? videoOverride.provider : videoPrimary?.provider;
  const videoModelId = videoOverride !== null ? videoOverride.modelId : videoPrimary?.model;
  const imagePrimary = primaryBotModel(currentBot?.imageModels);
  const imageProvider = imageOverride !== null ? imageOverride.provider : imagePrimary?.provider;
  const imageModelId = imageOverride !== null ? imageOverride.modelId : imagePrimary?.model;
  const videoEditPrimary = primaryBotModel(currentBot?.videoEditModels);
  const videoEditProvider =
    videoEditOverride !== null ? videoEditOverride.provider : videoEditPrimary?.provider;
  const videoEditModelId =
    videoEditOverride !== null ? videoEditOverride.modelId : videoEditPrimary?.model;
  const imageEditPrimary = primaryBotModel(currentBot?.imageEditModels);
  const imageEditProvider =
    imageEditOverride !== null ? imageEditOverride.provider : imageEditPrimary?.provider;
  const imageEditModelId =
    imageEditOverride !== null ? imageEditOverride.modelId : imageEditPrimary?.model;
  const translationSettings = translationSettingsFromBot(currentBot);
  const translationProvider =
    translationOverride !== null ? translationOverride.provider : translationSettings.modelProvider;
  const translationModelId =
    translationOverride !== null ? translationOverride.modelId : translationSettings.modelId;
  const sheetKey =
    sheetRole === "main"
      ? mainProvider && mainModelId
        ? modelOptionKey(mainProvider, mainModelId)
        : ""
      : sheetRole === "video"
        ? videoProvider && videoModelId
          ? modelOptionKey(videoProvider, videoModelId)
          : ""
        : sheetRole === "videoEdit"
          ? videoEditProvider && videoEditModelId
            ? modelOptionKey(videoEditProvider, videoEditModelId)
            : ""
          : sheetRole === "image"
            ? imageProvider && imageModelId
              ? modelOptionKey(imageProvider, imageModelId)
              : ""
            : sheetRole === "imageEdit"
              ? imageEditProvider && imageEditModelId
                ? modelOptionKey(imageEditProvider, imageEditModelId)
                : ""
              : sheetRole === "translation"
                ? translationProvider && translationModelId
                  ? modelOptionKey(translationProvider, translationModelId)
                  : ""
                : computerChoice
                  ? modelOptionKey(computerChoice.provider, computerChoice.modelId)
                  : "";

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView
        // Padding always settles to zero. "height" stays shrunk when the keyboard hides without
        // move frames, such as when a pushed screen closes with its own keyboard up.
        behavior="padding"
        {...threadKeyboardAvoidance({
          os: Platform.OS,
          floatingHeader: threadHeaderFloats(),
          nativeHeaderHeight,
        })}
        style={{
          flex: 1,
          backgroundColor: tokens.background,
        }}
      >
        {/* The keyboard's padding shrinks this, so the floating composer rides above it. */}
        <View style={{ flex: 1, position: "relative" }}>
          <ChatBackgroundLayer threadKey={threadKey} />
          <NewestPageCards.Provider value={newestPages}>
            <ThreadMessageList
              scroll={scroll}
              pinnedListHandlers={paging.pinnedListHandlers}
              threadKey={threadKey}
              headerClearance={listClearance}
              bottomInset={bottomInset}
              columnPadding={columnPadding}
              visibleMessages={visibleMessages}
              liveItems={liveItems}
              renderItem={renderItem}
              renderMessageRow={renderMessageRow}
              loadEarlierControl={loadEarlierControl}
              failedSendBubbles={failedSendBubbles}
              errorNotice={errorNotice}
              workingFooter={workingFooter}
              loadingNewer={paging.loadingNewer}
              showLatest={showLatest}
            />
          </NewestPageCards.Provider>
          {/* The title hero floats above the list, flush against the native header with
              zero gap, and never scrolls away; it paints a solid background, so the
              scrolling conversation can never show through it. The hero's own
              background, when set, blends over that solid base at its opacity —
              it is independent of the chat background behind the list. Only the avatar
              intercepts touches, so the list still scrolls under the hero. */}
          {chatHero ? (
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                top: heroTop + searchBarHeight,
                left: 0,
                right: 0,
                overflow: "hidden",
                backgroundColor: tokens.background,
              }}
            >
              <HeroBackgroundLayer
                threadKey={threadKey}
                height={heroBackgroundHeight}
                top={heroBackgroundTop}
              />
              {chatHero}
            </View>
          ) : null}
          {searchOpen ? (
            <View
              style={{
                position: "absolute",
                top: heroTop,
                left: 0,
                right: 0,
                height: 48,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                backgroundColor: tokens.background,
              }}
            >
              <NativeSymbol
                ios="magnifyingglass"
                android="search-outline"
                size={18}
                color={tokens.mutedForeground}
              />
              <TextInput
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  setSearchIndex(0);
                }}
                placeholder={t("Search conversation…")}
                placeholderTextColor={tokens.mutedForeground}
                autoFocus
                returnKeyType="search"
                onSubmitEditing={() => stepSearch(1)}
                style={{ flex: 1, fontSize: 16, color: tokens.foreground }}
              />
              {searchQuery.trim() ? (
                <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                  {searchMatches.length > 0
                    ? t("Result {current} of {total}", {
                        current: searchIndex + 1,
                        total: searchMatches.length,
                      })
                    : t("No results")}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Previous result")}
                disabled={searchMatches.length === 0}
                hitSlop={8}
                onPress={() => stepSearch(-1)}
              >
                <NativeSymbol
                  ios="chevron.up"
                  android="chevron-up-outline"
                  size={18}
                  color={tokens.foreground}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Next result")}
                disabled={searchMatches.length === 0}
                hitSlop={8}
                onPress={() => stepSearch(1)}
              >
                <NativeSymbol
                  ios="chevron.down"
                  android="chevron-down-outline"
                  size={18}
                  color={tokens.foreground}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Close search")}
                hitSlop={8}
                onPress={closeSearch}
              >
                <NativeSymbol
                  ios="xmark"
                  android="close-outline"
                  size={18}
                  color={tokens.foreground}
                />
              </Pressable>
            </View>
          ) : null}
          {/* Shrinks (the suggestion lists scroll) so the input and Send stay above the keyboard. */}
          {selecting ? (
            <MessageSelectionBar
              count={selectedMessageIds.size}
              busy={selectionBusy}
              onDelete={confirmDeleteSelected}
              onCancel={exitSelection}
            />
          ) : (
            <ThreadComposerDock
              hidden={readOnly}
              columnPadding={columnPadding}
              notice={<ThreadFetchErrorNotice error={error} showingSaved={showingSaved} />}
              onHeight={setDockHeight}
              replyTarget={replyTarget}
              replyAuthor={
                replyTarget?.role === "user"
                  ? (otherAuthor(replyTarget.author, userId)?.name ??
                    channelMessageSender(replyTarget.blocks) ??
                    t("You"))
                  : (memberName(snap?.members, replyTarget?.botId) ?? displayName ?? t("Bot"))
              }
              replyQuote={replyQuote}
              threadTarget={artifactTarget}
              onDismissReply={() => {
                setReplyTarget(null);
                setReplyQuote(null);
              }}
              attachmentNotice={attachments.attachmentNotice}
              attachments={attachments.activePendingAttachments}
              onRemoveAttachment={(id) =>
                attachments.setPendingAttachments((current) =>
                  current.filter((item) => item.id !== id),
                )
              }
            >
              <ThreadComposerChips
                botId={botId}
                currentBot={currentBot}
                userId={userId}
                catalog={modelCatalog}
                mainOverride={mainOverride}
                videoOverride={videoOverride}
                imageOverride={imageOverride}
                computerChoice={computerChoice}
                onPickModel={setSheetRole}
                onPickMediaModel={() => setMediaOpen(true)}
                favoriteCount={favorites.length}
                onOpenFavorites={() => setFavoritesOpen(true)}
                backgroundLabel={
                  !background
                    ? t("Default")
                    : background.kind === "image"
                      ? t("Local image")
                      : background.kind === "video"
                        ? t("Video")
                        : t("URL subscription")
                }
                onOpenBackground={() => setBackgroundOpen(true)}
                onOpenBackup={() => setBackupOpen(true)}
              />
              <ThreadComposer
                key={threadKey}
                ref={composer.composerRef}
                draftScope={draftScope}
                agentSkills={agentSkills}
                composerMentionTargets={composerMentionTargets}
                onMentionRequested={onMentionRequested}
                composerPrompt={composerPrompt}
                thinkingLevel={thinkingLevel}
                replyTargetId={replyTarget?.id}
                replyQuote={replyQuote}
                attachmentIds={attachments.activePendingAttachments.map(
                  (attachment) => attachment.id,
                )}
                botId={botId}
                onCall={onCall}
                working={working}
                runWorking={runWorking}
                sending={composer.sending || attachments.shareImporting}
                styles={styles}
                attachActions={attachments.attachActions}
                attachFrom={attachments.attachFrom}
                send={composer.send}
                stop={composer.stop}
                onSlashAction={composer.runSlashAction}
                onEmptied={composer.composerEmptied}
              />
            </ThreadComposerDock>
          )}
        </View>
        {selectableText !== null ? (
          <SelectTextSheet text={selectableText} onClose={() => setSelectableText(null)} />
        ) : null}
        {sheetRole ? (
          <ThreadModelPickerSheet
            visible
            role={sheetRole}
            botId={botId ?? ""}
            userId={userId}
            selectedKey={sheetKey}
            currentModels={
              sheetRole === "video"
                ? currentBot?.videoModels
                : sheetRole === "videoEdit"
                  ? currentBot?.videoEditModels
                  : sheetRole === "image"
                    ? currentBot?.imageModels
                    : sheetRole === "imageEdit"
                      ? currentBot?.imageEditModels
                      : sheetRole === "translation"
                        ? currentBot?.translationModels
                        : undefined
            }
            onClose={() => {
              setSheetRole(null);
              stuckRetryMessageRef.current = null;
            }}
            onSaved={(choice) => {
              if (sheetRole === "main") {
                setMainOverride(choice);
                // A stuck retry armed this sheet: the model is saved, so
                // re-run the waiting message on it.
                const pending = stuckRetryMessageRef.current;
                stuckRetryMessageRef.current = null;
                if (pending) void resendMessage(pending);
              } else if (sheetRole === "video") {
                setVideoOverride(choice);
              } else if (sheetRole === "videoEdit") {
                setVideoEditOverride(choice);
              } else if (sheetRole === "image") {
                setImageOverride(choice);
              } else if (sheetRole === "imageEdit") {
                setImageEditOverride(choice);
              } else if (sheetRole === "translation") {
                setTranslationOverride(choice);
              } else {
                setComputerChoice(
                  choice.provider && choice.modelId
                    ? { provider: choice.provider, modelId: choice.modelId }
                    : null,
                );
              }
            }}
          />
        ) : null}
        {mediaOpen ? (
          <ThreadMediaModelSheet
            visible
            catalog={modelCatalog}
            video={{ provider: videoProvider ?? null, modelId: videoModelId ?? null }}
            image={{ provider: imageProvider ?? null, modelId: imageModelId ?? null }}
            videoModels={currentBot?.videoModels ?? null}
            imageModels={currentBot?.imageModels ?? null}
            videoEdit={{ provider: videoEditProvider ?? null, modelId: videoEditModelId ?? null }}
            imageEdit={{ provider: imageEditProvider ?? null, modelId: imageEditModelId ?? null }}
            videoEditModels={currentBot?.videoEditModels ?? null}
            imageEditModels={currentBot?.imageEditModels ?? null}
            videoPresets={currentBot?.videoPromptPresets ?? null}
            imagePresets={currentBot?.imagePromptPresets ?? null}
            activeVideoPreset={currentBot?.activeVideoPromptPreset ?? null}
            activeImagePreset={currentBot?.activeImagePromptPreset ?? null}
            videoSaveDirectory={currentBot?.videoSaveDirectory ?? null}
            imageSaveDirectory={currentBot?.imageSaveDirectory ?? null}
            translation={{
              provider: translationProvider ?? null,
              modelId: translationModelId ?? null,
            }}
            translationModels={currentBot?.translationModels ?? null}
            translationSource={translationSettings.sourceLanguage}
            translationTarget={translationSettings.targetLanguage}
            autoTranslate={translationSettings.autoTranslate}
            showTranslationActions={translationSettings.showTranslationActions}
            showMediaFavorite={currentBot?.showMediaFavorite ?? true}
            showMediaShare={currentBot?.showMediaShare ?? true}
            showMediaPreview={currentBot?.showMediaPreview ?? true}
            showMediaDownload={currentBot?.showMediaDownload ?? true}
            onPickRole={(role) => {
              setMediaOpen(false);
              setSheetRole(role);
            }}
            onPickEditRole={(role) => {
              setMediaOpen(false);
              setSheetRole(role === "video" ? "videoEdit" : "imageEdit");
            }}
            onPickTranslation={() => {
              setMediaOpen(false);
              setSheetRole("translation");
            }}
            onRemoveModel={removeBotModel}
            onTranslationSourceChange={(source) => {
              if (!botId) return;
              void rpc("bots/update", { botId, translationSourceLanguage: source })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onTranslationTargetChange={(target) => {
              if (!botId) return;
              void rpc("bots/update", { botId, translationTargetLanguage: target })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onToggleAutoTranslate={(value) => {
              if (!botId) return;
              void rpc("bots/update", { botId, autoTranslate: value })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onToggleTranslationActions={(value) => {
              if (!botId) return;
              void rpc("bots/update", { botId, showTranslationActions: value })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onPickPreset={(role, name) => {
              if (!botId) return;
              void rpc("bots/update", {
                botId,
                ...(role === "video"
                  ? { activeVideoPromptPreset: name }
                  : { activeImagePromptPreset: name }),
              })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onPresetsChange={(role, next) => {
              if (!botId) return;
              void rpc("bots/update", {
                botId,
                ...(role === "video" ? { videoPromptPresets: next } : { imagePromptPresets: next }),
              })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onSaveDirectory={(role, value) => {
              if (!botId) return;
              void rpc("bots/update", {
                botId,
                ...(role === "video"
                  ? { videoSaveDirectory: value }
                  : { imageSaveDirectory: value }),
              })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onToggleMediaAction={(action, value) => {
              if (!botId) return;
              const patch =
                action === "favorite"
                  ? { showMediaFavorite: value }
                  : action === "share"
                    ? { showMediaShare: value }
                    : action === "preview"
                      ? { showMediaPreview: value }
                      : { showMediaDownload: value };
              void rpc("bots/update", { botId, ...patch })
                .then(() => refreshMentionBots())
                .catch(() => undefined);
            }}
            onClose={() => setMediaOpen(false)}
          />
        ) : null}
        <ThreadBotMenuSheet
          visible={botMenuOpen}
          botId={botId}
          onClose={() => setBotMenuOpen(false)}
          onPickModel={setSheetRole}
          onShareConversation={() => setShareConversationOpen(true)}
        />
        {shareCardTarget && artifactTarget ? (
          <ShareCardSheet
            visible
            message={shareCardTarget}
            previousUserMessageText={shareCardQuestion}
            textOverride={shareCardTextOverride ?? undefined}
            target={artifactTarget}
            onClose={() => setShareCardTarget(null)}
          />
        ) : null}
        {artifactTarget ? (
          <ShareConversationSheet
            visible={shareConversationOpen}
            target={artifactTarget}
            onClose={() => setShareConversationOpen(false)}
          />
        ) : null}
        {botId ? (
          <ThreadPersonaSheet
            visible={personaOpen}
            botId={botId}
            currentTemplateId={currentBot?.promptTemplateId ?? null}
            onClose={() => setPersonaOpen(false)}
            onManageTemplates={() =>
              router.push({ pathname: "/prompt-templates", params: { botId } })
            }
            onApplied={() => void refreshMentionBots()}
          />
        ) : null}
        <ThreadFavoritesSheet
          visible={favoritesOpen}
          threadKey={threadKey}
          bot={currentBot}
          onClose={() => setFavoritesOpen(false)}
          onJump={(messageId) => {
            void applyMessageJump({ botId, groupId, messageId }).catch(() => undefined);
          }}
        />
        <ThreadBackgroundSheet
          visible={backgroundOpen}
          threadKey={threadKey}
          heroVisible={!inGroup}
          onClose={() => setBackgroundOpen(false)}
          onOpenCustomSettings={() => {
            setBackgroundOpen(false);
            setCustomSettingsOpen(true);
          }}
        />
        <ThreadCustomSettingsSheet
          visible={customSettingsOpen}
          userId={userId}
          threadKey={threadKey}
          heroVisible={!inGroup}
          onClose={() => setCustomSettingsOpen(false)}
        />
        <ThreadBackupSheet
          visible={backupOpen}
          userId={userId}
          botId={botId}
          onClose={() => setBackupOpen(false)}
        />
        <RunErrorSheet
          details={detailsOpen ? runError : null}
          onClose={() => setDetailsOpen(false)}
          action={runErrorAction}
          extraActions={runErrorExtraActions}
          dismissAction={runErrorDismissAction}
          modelProbe={modelProbe}
        />
        {quoteTarget ? (
          <QuoteSheet
            message={quoteTarget}
            onCancel={() => setQuoteTarget(null)}
            onQuote={(excerpt) => {
              setReplyTarget(quoteTarget);
              setReplyQuote(excerpt);
              setQuoteTarget(null);
            }}
          />
        ) : null}
        {/* The header buttons float over the chat; only the clock gets a soft backdrop. */}
        {headerHeight > 0 ? (
          <View pointerEvents="none" style={[styles.statusBarFade, { height: insets.top }]} />
        ) : null}
      </KeyboardAvoidingView>
      <ComputerFloatWindow
        botId={botId}
        open={computerFloatOpen && computerFloatEnabled}
        systemOnly={computerFloatSystemOnly}
        onClose={() => {
          setComputerFloatOpen(false);
          setComputerFloatSystemOnly(false);
        }}
      />
    </View>
  );
}
