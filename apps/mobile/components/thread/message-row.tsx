import { markdownCodeBlocks } from "@rakazo/chat-ui/native";
import type {
  BotAvatarSet,
  BotModelEntry,
  LoginFieldInput,
  MessageReaction,
} from "@rakazo/contracts";
import { canReactToThreadMessage, MESSAGE_REACTIONS, primaryBotModel } from "@rakazo/contracts";
import type { ChildBotBlock, PeerExchange } from "@rakazo/core";
import {
  canMarkMessageUnread,
  copyableMessageText,
  isPeerReceiptBlocks,
  liveMessageComposing,
  modelOptionKey,
  selectableMessageText,
} from "@rakazo/core";
import * as Clipboard from "expo-clipboard";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import { Platform, Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import type { MobileArtifactTarget } from "../../lib/artifact-open";
import type { MessageActionId } from "../../lib/custom-settings";
import { useCustomSettings, visibleMessageActions } from "../../lib/custom-settings";
import { canDoubleTapReact } from "../../lib/double-tap";
import { useI18n } from "../../lib/i18n";
import {
  mediaDisplaySettingsFromBot,
  messageHasGeneratedImage,
  messageHasGeneratedMedia,
} from "../../lib/media-display";
import { presentMessageActionSheet } from "../../lib/message-action-sheet";
import {
  buildMessageContextMenu,
  messageMenuReaction,
  shareMessageText,
} from "../../lib/message-context-menu";
import { messageHasInlineControls, quotableMessageSegments } from "../../lib/message-presentation";
import { messageRowLayout } from "../../lib/message-row-layout";
import type { MobileBot, MobileMessage, MobileSnapshot } from "../../lib/mobile-types";
import { blockText } from "../../lib/mobile-types";
import type { ModelSwitchTimeline } from "../../lib/model-switches";
import {
  currentModelBar,
  parseCurrentModelMark,
  stripCurrentModelMarkBlocks,
  translationModelSwitches,
} from "../../lib/model-switches";
import { useMobileTokens, useResolvedAppearance } from "../../lib/native";
import type { OverlaySpeechProgress } from "../../lib/overlay-speech";
import { selectableTextFromMarkdown } from "../../lib/selectable-text";
import { ThreadReadOnlyContext } from "../../lib/thread-read-only";
import { translationSettingsFromBot } from "../../lib/translation";
import type { UserBubble } from "../../lib/user-bubble";
import { BotAvatar } from "../bot-avatar";
import type { ImageArtifactPreviewTarget } from "../image-artifact-viewer";
import { presentMessageMenu } from "../message-action-menu";
import { MessageContextMenu } from "../message-context-menu";
import { ModelSwitchBar, ModelSwitchTimelineSheet } from "../model-switch-timeline-sheet";
import { NativeSymbol } from "../native-symbol";
import { ReplyLine } from "../reply-line";
import { TimeSeparator } from "../time-separator";
import { UnreadDivider } from "../unread-divider";
import type { MessageActionProps } from "./message-bubble";
import { MessageBubble } from "./message-bubble";
import { MessageSelectCheckbox } from "./message-selection-bar";
import {
  MessageTranslationView,
  TranslateButton,
  useMessageTranslation,
} from "./message-translation";
import type { ThreadModelPickerRole } from "./thread-model-picker-sheet";
import { ThreadModelPickerSheet } from "./thread-model-picker-sheet";

export type MessageRowActions = {
  helperToggle: (
    measure: (done: (y: number, cardBottom: number) => void) => void,
    toggle: () => void,
    opening: boolean,
  ) => void;
  reply: (message: MobileMessage) => void;
  quote: (message: MobileMessage) => void;
  select: (text: string) => void;
  /** Enters multi-select with this message picked. */
  enterSelection: (message: MobileMessage) => void;
  speak: (message: MobileMessage) => void;
  /** Reads given text, such as a translation, aloud. Absent where unsupported. */
  speakText?: (message: MobileMessage, text: string, source?: "translation") => void;
  react: (message: MobileMessage, reaction: MessageReaction) => Promise<boolean>;
  /** Toggles this bot reply in the thread's favorites. Absent where unsupported. */
  favorite?: (message: MobileMessage) => void;
  /** Toggles a translation of this bot reply in the thread's favorites. */
  favoriteTranslation?: (message: MobileMessage, translatedText: string) => void;
  /** Resends the user message this bot reply answers. Absent where unsupported. */
  regenerate?: (message: MobileMessage) => void;
  /** Resends this user message's own text. Absent where unsupported. */
  resend?: (message: MobileMessage) => void;
  /** Stops the thread's runs; the stuck row's Cancel uses it. Absent where unsupported. */
  stopStuckRun?: () => void;
  /** Opens the model picker to retry this stuck message on another model. Absent where unsupported. */
  retryStuckRun?: (message: MobileMessage) => void;
  markUnread: (message: MobileMessage) => void;
  answer: (
    message: MobileMessage,
    answer: string,
    fields?: readonly LoginFieldInput[],
    dismiss?: boolean,
    remember?: false,
  ) => Promise<void>;
  openBot: (id: string, name: string) => void;
  openComputer: (id: string, name: string) => void;
  previewFile: (artifactId: string) => void;
  previewImage: (target: ImageArtifactPreviewTarget) => void;
  jump: (messageId: string) => void;
  dismissChoice: (messageId: string, question: string) => void;
  openPeerChat: (peer: { peerBotId: string; peerBotName: string }) => void;
  layout: (messageId: string, y: number, index: number) => void;
};

type MessageRowProps = {
  message: MobileMessage;
  actions: MessageRowActions;
  botId?: string;
  bubbleBotId: string;
  groupId?: string;
  botName?: string;
  showBotSenderName: boolean;
  bots: MobileBot[];
  members?: MobileSnapshot["members"];
  readOnly: boolean;
  onCall: boolean;
  canAnswer: boolean;
  canDismiss: boolean;
  highlighted: boolean;
  separator: boolean;
  headerAdjacent: boolean;
  unreadDivider: boolean;
  markedUnread: boolean;
  /** Someone else in a shared space wrote this message. */
  authorName?: string;
  replyAuthor: string;
  replyFallbackText?: string;
  waitingForUser: boolean;
  /** This message's reply is being read aloud right now. */
  speaking?: boolean;
  /** The utterance sounding now, for read-aloud progress. */
  speechProgress?: OverlaySpeechProgress;
  /** Multi-select is on: the row shows a checkbox instead of actions. */
  selecting?: boolean;
  /** This message is picked while selecting. */
  selected?: boolean;
  /** Toggles this message's checkbox while selecting. */
  onToggleSelect?: () => void;
  /** This bot reply is in the thread's favorites. */
  favorited?: boolean;
  /** This bot reply's translation is in the thread's favorites. */
  translationFavorited?: boolean;
  /** This message matches the open conversation search. */
  searchHit?: boolean;
  /** This user message's run has gone quiet; the row under it offers recovery. */
  stuck?: boolean;
  /** This message is the current search hit. */
  searchCurrent?: boolean;
  messageReactions?: ReadonlyMap<MessageReaction, number>;
  mentions?: readonly ChildBotBlock[];
  /** The adjacent receipts represented by this peer line. */
  peerExchange?: PeerExchange;
  activityBotId?: string;
  activityColor?: string;
  activityAvatarSet?: BotAvatarSet;
  activityStatus?: MobileBot["status"];
  userBubble?: UserBubble;
  inGroup: boolean;
  columnWidth: number;
  enableJump: boolean;
  index: number;
  /** The account whose interface settings style this row's text and actions. */
  userId?: string;
};

export const MessageRow = memo(function MessageRow({
  message,
  actions,
  botId,
  bubbleBotId,
  groupId,
  botName,
  showBotSenderName,
  bots,
  members,
  readOnly,
  onCall,
  canAnswer,
  canDismiss,
  highlighted,
  separator,
  headerAdjacent,
  unreadDivider,
  markedUnread,
  authorName,
  replyAuthor,
  replyFallbackText,
  messageReactions,
  mentions,
  waitingForUser,
  speaking,
  speechProgress,
  selecting,
  selected,
  onToggleSelect,
  favorited,
  translationFavorited,
  searchHit,
  searchCurrent,
  stuck,
  peerExchange,
  activityBotId,
  activityColor,
  activityAvatarSet,
  activityStatus,
  userBubble,
  inGroup,
  columnWidth,
  enableJump,
  index,
  userId,
}: MessageRowProps) {
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const { t, locale } = useI18n();
  const artifactTarget = useMemo<MobileArtifactTarget | undefined>(
    () => (groupId ? { groupId } : botId ? { botId } : undefined),
    [botId, groupId],
  );
  const onChoiceDismissed = useCallback(
    (question: string) => actions.dismissChoice(message.id, question),
    [actions, message.id],
  );
  const onLayout = useMemo(
    () =>
      enableJump
        ? (event: LayoutChangeEvent) =>
            actions.layout(message.id, event.nativeEvent.layout.y, index)
        : undefined,
    [actions, message.id, enableJump, index],
  );
  const [optimisticLike, setOptimisticLike] = useState(false);
  const likeInFlight = useRef(false);
  const [optimisticDislike, setOptimisticDislike] = useState(false);
  const reducedMotion = useReducedMotion();
  const hasLike = messageReactions?.has("👍") ?? false;
  const hasDislike = messageReactions?.has("👎") ?? false;
  useEffect(() => {
    if (hasLike) setOptimisticLike(false);
  }, [hasLike]);
  useEffect(() => {
    if (hasDislike) setOptimisticDislike(false);
  }, [hasDislike]);
  const displayedReactions = new Map(messageReactions);
  if (optimisticLike && !hasLike) displayedReactions.set("👍", 1);
  if (optimisticDislike && !hasDislike) displayedReactions.set("👎", 1);
  // This reply's translation settings come from the bot that wrote it.
  const messageBot =
    bots.find((candidate) => candidate.id === bubbleBotId) ??
    bots.find((candidate) => candidate.id === botId);
  const translationSettings = translationSettingsFromBot(messageBot ?? null);
  // This reply's generated-media actions come from the bot that wrote it.
  const mediaDisplay = mediaDisplaySettingsFromBot(messageBot ?? null);
  const hasGeneratedImage = messageHasGeneratedImage(message);
  const hasGeneratedMedia = messageHasGeneratedMedia(message);
  const {
    actionProps,
    menu,
    onMenuAction,
    likeMessage,
    shareMessage,
    copyMessage,
    regenerateMessage,
    canSpeak,
  } = useMemo<{
    actionProps: MessageActionProps;
    menu: ReturnType<typeof buildMessageContextMenu>;
    onMenuAction: (id: string) => void;
    likeMessage?: () => void;
    shareMessage: () => void;
    copyMessage: () => void;
    regenerateMessage?: () => void;
    canSpeak: boolean;
  }>(() => {
    const messageText = selectableMessageText(message);
    const includeQuote =
      !readOnly &&
      !message.id.startsWith("progress:") &&
      quotableMessageSegments(message.role, message.blocks).length > 0;
    const includeReact = !readOnly && canReactToThreadMessage(message);
    // The call already reads replies aloud; a second voice would talk over it.
    const includeSpeak = message.role === "bot" && !onCall && Boolean(blockText(message));
    const includeSelect = messageText.trim().length > 0;
    // A favorited reply stays favoritable from the row and the long-press menu;
    // favorites are local, so they work in read-only history too. A reply
    // carrying generated media follows the bot's favorite toggle instead.
    const includeFavorite =
      Boolean(actions.favorite) &&
      message.role === "bot" &&
      !message.id.startsWith("progress:") &&
      Boolean(blockText(message).trim()) &&
      (mediaDisplay.showMediaFavorite || !hasGeneratedMedia);
    const favoriteLabel = favorited ? t("Unfavorite") : t("Favorite");
    const toggleFavorite = () => actions.favorite?.(message);
    // Any sent message can be marked unread; the next open starts New at the first reply from it.
    const includeUnread = !readOnly && !markedUnread && canMarkMessageUnread(message);
    const reply = () => actions.reply(message);
    const quote = () => actions.quote(message);
    const speakMessage = () => actions.speak(message);
    const select = () =>
      actions.select(
        message.role === "user" ? messageText : selectableTextFromMarkdown(messageText),
      );
    const copy = () => {
      const text = copyableMessageText(message);
      if (text) void Clipboard.setStringAsync(text).catch(() => undefined);
    };
    const react = (reaction: MessageReaction) => actions.react(message, reaction);
    const share = () => shareMessageText(copyableMessageText(message));
    const regenerateMessage = actions.regenerate ? () => actions.regenerate!(message) : undefined;
    const resendMessage = actions.resend ? () => actions.resend!(message) : undefined;
    // Resend only makes sense for a sent user message with text to send again;
    // an attachment-only message cannot go through the text outbox.
    const includeResend =
      !readOnly && Boolean(actions.resend) && message.role === "user" && includeSelect;
    const markUnread = () => actions.markUnread(message);
    // VoiceOver reads the bubble as one element and can't reach a code block's copy button.
    const codeBlocks = message.role === "user" ? [] : markdownCodeBlocks(blockText(message));
    const copyCode = () => {
      if (codeBlocks[0]) void Clipboard.setStringAsync(codeBlocks[0]).catch(() => undefined);
    };
    const menuActions = [
      ...(!readOnly ? [{ name: "reply", text: t("Reply"), onPress: reply }] : []),
      ...(includeResend
        ? [{ name: "resend", text: t("Resend"), onPress: () => resendMessage?.() }]
        : []),
      ...(includeUnread
        ? [{ name: "unread", text: t("Mark as unread"), onPress: markUnread }]
        : []),
      ...(includeQuote ? [{ name: "quote", text: t("Quote"), onPress: quote }] : []),
      ...(includeReact
        ? [
            {
              name: "react",
              text: t("React"),
              onPress: () =>
                presentMessageActionSheet({
                  cancel: t("Cancel"),
                  more: t("More"),
                  colorScheme,
                  actions: MESSAGE_REACTIONS.map((emoji) => ({
                    text: emoji,
                    onPress: () => react(emoji),
                  })),
                }),
            },
          ]
        : []),
      ...(includeSpeak ? [{ name: "speak", text: t("Speak message"), onPress: speakMessage }] : []),
      ...(includeSelect ? [{ name: "select", text: t("Select text"), onPress: select }] : []),
      { name: "copy", text: t("Copy"), onPress: copy },
      { name: "share", text: t("Share"), onPress: share },
      {
        name: "selectMessages",
        text: t("Select messages"),
        onPress: () => actions.enterSelection(message),
      },
      ...(includeFavorite
        ? [{ name: "favorite", text: favoriteLabel, onPress: toggleFavorite }]
        : []),
      ...(codeBlocks.length === 1
        ? [{ name: "copyCode", text: t("Copy code"), onPress: copyCode }]
        : []),
    ];
    const menu = buildMessageContextMenu({
      labels: {
        reply: t("Reply"),
        resend: t("Resend"),
        copy: t("Copy"),
        share: t("Share"),
        favorite: favoriteLabel,
        react: t("React"),
        quote: t("Quote"),
        speak: t("Speak message"),
        select: t("Select text"),
        unread: t("Mark as unread"),
        selectMessages: t("Select messages"),
      },
      reactions: MESSAGE_REACTIONS,
      include: {
        reply: !readOnly,
        resend: includeResend,
        quote: includeQuote,
        react: includeReact,
        speak: includeSpeak,
        select: includeSelect,
        unread: includeUnread,
        share: includeSelect,
        favorite: includeFavorite,
        selectMessages: true,
      },
    });
    const openSheet = (event: GestureResponderEvent) =>
      presentMessageMenu({
        anchor: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY },
        reactions: includeReact
          ? MESSAGE_REACTIONS.map((emoji) => ({ emoji, onPress: () => react(emoji) }))
          : [],
        groups: [
          [
            ...(!readOnly
              ? [
                  {
                    name: "reply",
                    text: t("Reply"),
                    icon: "arrow-undo-outline" as const,
                    onPress: reply,
                  },
                ]
              : []),
            ...(includeResend
              ? [
                  {
                    name: "resend",
                    text: t("Resend"),
                    icon: "send-outline" as const,
                    onPress: () => resendMessage?.(),
                  },
                ]
              : []),
            ...(includeUnread
              ? [
                  {
                    name: "unread",
                    text: t("Mark as unread"),
                    icon: "mail-unread-outline" as const,
                    onPress: markUnread,
                  },
                ]
              : []),
            ...(includeQuote
              ? [
                  {
                    name: "quote",
                    text: t("Quote"),
                    icon: "chatbox-ellipses-outline" as const,
                    onPress: quote,
                  },
                ]
              : []),
          ],
          [
            { name: "copy", text: t("Copy"), icon: "copy-outline" as const, onPress: copy },
            ...(includeFavorite
              ? [
                  {
                    name: "favorite",
                    text: favoriteLabel,
                    icon: favorited ? ("bookmark" as const) : ("bookmark-outline" as const),
                    onPress: toggleFavorite,
                  },
                ]
              : []),
            ...(includeSelect
              ? [
                  {
                    name: "share",
                    text: t("Share"),
                    icon: "share-outline" as const,
                    onPress: share,
                  },
                ]
              : []),
            ...(includeSelect
              ? [
                  {
                    name: "select",
                    text: t("Select text"),
                    icon: "text-outline" as const,
                    onPress: select,
                  },
                ]
              : []),
            ...(includeSpeak
              ? [
                  {
                    name: "speak",
                    text: t("Speak message"),
                    icon: "volume-high-outline" as const,
                    onPress: speakMessage,
                  },
                ]
              : []),
            {
              name: "selectMessages",
              text: t("Select messages"),
              icon: "checkbox-outline" as const,
              onPress: () => actions.enterSelection(message),
            },
          ],
        ],
      });
    return {
      menu,
      likeMessage: canDoubleTapReact(includeReact, message.blocks, waitingForUser)
        ? () => {
            if (hasLike || optimisticLike || likeInFlight.current) return;
            likeInFlight.current = true;
            setOptimisticLike(true);
            void react("👍")
              .then((success) => {
                if (!success) setOptimisticLike(false);
              })
              .finally(() => {
                likeInFlight.current = false;
              });
          }
        : undefined,
      shareMessage: share,
      copyMessage: copy,
      regenerateMessage,
      canSpeak: includeSpeak,
      onMenuAction: (id) => {
        const reaction = messageMenuReaction(id);
        if (reaction && (MESSAGE_REACTIONS as readonly string[]).includes(reaction)) {
          react(reaction as MessageReaction);
          return;
        }
        if (id === "reply") reply();
        if (id === "resend") resendMessage?.();
        if (id === "copy") copy();
        if (id === "share") share();
        if (id === "favorite") toggleFavorite();
        if (id === "quote") quote();
        if (id === "speak") speakMessage();
        if (id === "select") select();
        if (id === "unread") markUnread();
        if (id === "selectMessages") actions.enterSelection(message);
      },
      actionProps: {
        onLongPress: Platform.OS === "ios" ? undefined : openSheet,
        accessibilityActions: menuActions.map((action) => ({
          name: action.name,
          label: action.text,
        })),
        onAccessibilityAction: (event) => {
          menuActions.find((action) => action.name === event.nativeEvent.actionName)?.onPress();
        },
      },
    };
  }, [
    message,
    actions,
    markedUnread,
    readOnly,
    onCall,
    colorScheme,
    t,
    locale,
    waitingForUser,
    hasLike,
    optimisticLike,
    hasDislike,
    optimisticDislike,
    favorited,
    // The favorite entry follows the bot's toggle; the object itself is fresh
    // every render, so only the boolean it reads goes here.
    mediaDisplay.showMediaFavorite,
  ]);
  const layout = messageRowLayout(message.blocks, { activityBotId, inGroup, columnWidth });
  const canTranslate =
    message.role === "bot" &&
    !message.id.startsWith("progress:") &&
    Boolean(blockText(message).trim());
  const translation = useMessageTranslation({
    botId: messageBot?.id,
    text: blockText(message),
    settings: translationSettings,
    autoTranslate: translationSettings.autoTranslate,
    composing: liveMessageComposing(message.blocks),
    messageId: message.id,
    savedTranslation: message.translation ?? null,
  });
  // A finished translation that is only folded away reopens instead of
  // spending another translation call; anything else translates as before.
  const handleTranslatePress = useCallback(() => {
    if (translation.status === "done" && translation.result && !translation.expanded) {
      translation.expand();
      return;
    }
    translation.translate();
  }, [translation]);
  const [translationPickerOpen, setTranslationPickerOpen] = useState(false);
  // A variable, not a literal: Biome reads a literal role prop as an ARIA
  // role, and "translation" is a picker role, not an ARIA role.
  const translationPickerRole: ThreadModelPickerRole = "translation";
  // The picker marks the bot's primary translation model as selected.
  const translationSelectedKey =
    translationSettings.modelProvider && translationSettings.modelId
      ? modelOptionKey(translationSettings.modelProvider, translationSettings.modelId)
      : "";
  // A bot reply's trailing "当前模型: X" mark leaves the bubble and
  // becomes the tappable bottom bar instead: the switch-history bar when
  // the message carries a timeline, the model-list bar when it only
  // carries the mark. Messages without a mark keep their text as-is.
  const switchMark = useMemo(
    () => (message.role === "bot" ? parseCurrentModelMark(blockText(message)) : null),
    [message],
  );
  const displayMessage = useMemo(
    () =>
      switchMark ? { ...message, blocks: stripCurrentModelMarkBlocks(message.blocks) } : message,
    [message, switchMark],
  );
  const modelBar = useMemo(() => currentModelBar(message, switchMark), [message, switchMark]);
  const mediaKind: "image" | "video" | null = hasGeneratedMedia
    ? message.blocks.some(
        (block) => block.kind === "file" && (block.mimeType ?? "").startsWith("video/"),
      )
      ? "video"
      : "image"
    : null;
  // The timeline opens the list its message belongs to: chat, image, video,
  // or translation. The selected key is the bot's current model for that list.
  const switchRole: ThreadModelPickerRole = mediaKind ?? "main";
  const switchModels =
    mediaKind === "image"
      ? messageBot?.imageModels
      : mediaKind === "video"
        ? messageBot?.videoModels
        : undefined;
  const switchSelectedKey = (() => {
    if (switchRole === "main") {
      return messageBot?.modelProvider && messageBot?.modelId
        ? modelOptionKey(messageBot.modelProvider, messageBot.modelId)
        : "";
    }
    const primary = primaryBotModel(switchModels ?? null);
    return primary ? modelOptionKey(primary.provider, primary.model) : "";
  })();
  const [timeline, setTimeline] = useState<{
    switches: ModelSwitchTimeline;
    role: ThreadModelPickerRole;
    selectedKey: string;
    currentModels?: readonly BotModelEntry[] | null;
  } | null>(null);
  const [locatePicker, setLocatePicker] = useState<{
    role: ThreadModelPickerRole;
    locate: { model: string; provider?: string | null };
    selectedKey: string;
    currentModels?: readonly BotModelEntry[] | null;
  } | null>(null);
  // A search hit tints the row yellow; the current hit is stronger than a plain
  // hit, and both outrank the jump highlight.
  const rowHighlight =
    searchCurrent || searchHit
      ? colorScheme === "dark"
        ? searchCurrent
          ? "rgba(255, 223, 107, 0.28)"
          : "rgba(255, 223, 107, 0.14)"
        : searchCurrent
          ? "#ffdf6b"
          : "#fff3bf"
      : undefined;
  // The bubble, shared by the context menu and the selecting tap-to-toggle:
  // while selecting, previews stay closed so a tap only toggles the checkbox.
  const bubble = (
    <ThreadReadOnlyContext.Provider value={readOnly}>
      <MessageBubble
        mentions={mentions}
        botId={bubbleBotId}
        groupId={groupId}
        message={displayMessage}
        authorName={authorName}
        botName={botName}
        showBotSenderName={showBotSenderName}
        bots={bots}
        members={members}
        canAnswer={canAnswer}
        canDismiss={canDismiss}
        onAnswer={actions.answer}
        onOpenBot={actions.openBot}
        onOpenComputer={actions.openComputer}
        onChoiceDismissed={onChoiceDismissed}
        onPreviewFile={selecting ? () => {} : actions.previewFile}
        onPreviewImage={
          selecting || (hasGeneratedImage && !mediaDisplay.showMediaPreview)
            ? () => {}
            : actions.previewImage
        }
        peerExchange={peerExchange}
        onOpenPeerChat={actions.openPeerChat}
        actionProps={actionProps}
        doubleTapSurface={Boolean(likeMessage)}
        onHelperToggle={actions.helperToggle}
        userBubble={userBubble}
        userId={userId}
      />
    </ThreadReadOnlyContext.Provider>
  );
  // Read-aloud progress reads under what is sounding: the message itself,
  // or the translation panel when the translation is being read.
  const readAloudProgress =
    speaking && speechProgress ? (
      <View style={{ marginTop: 4, gap: 2 }}>
        <Text
          numberOfLines={2}
          style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 18 }}
        >
          {speechProgress.text}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {t("Segment {index} of {total}", {
            index: speechProgress.segmentIndex + 1,
            total: speechProgress.segmentTotal,
          })}
        </Text>
      </View>
    ) : null;
  const translationProgress = speechProgress?.source === "translation" ? readAloudProgress : null;
  const messageProgress = speechProgress?.source === "translation" ? null : readAloudProgress;
  return (
    <View
      key={message.id}
      onLayout={onLayout}
      style={{
        backgroundColor: rowHighlight ?? (highlighted ? tokens.muted : undefined),
        marginTop: headerAdjacent ? 0 : 12,
        width: "100%",
      }}
    >
      {separator ? <TimeSeparator createdAt={message.createdAt} /> : null}
      {unreadDivider ? <UnreadDivider afterSeparator={separator} /> : null}
      <View
        style={{
          width: "100%",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 8,
          justifyContent: message.role === "user" ? "flex-end" : "flex-start",
        }}
      >
        {selecting && onToggleSelect ? (
          <View style={{ paddingTop: 10 }}>
            <MessageSelectCheckbox selected={selected ?? false} onToggle={onToggleSelect} />
          </View>
        ) : null}
        {activityBotId ? (
          <View style={{ paddingTop: 22 }}>
            <BotAvatar
              color={activityColor ?? tokens.mutedForeground}
              avatarSet={activityAvatarSet}
              identity={activityBotId}
              size={inGroup ? 20 : 28}
              status={activityStatus}
              motion="running"
              composing={liveMessageComposing(message.blocks)}
              pokeable
            />
          </View>
        ) : null}
        <View
          style={{
            width: layout.width,
            maxWidth: layout.maxWidth,
            flex: activityBotId ? 1 : undefined,
            flexShrink: 1,
          }}
        >
          {isPeerReceiptBlocks(message.blocks) ? null : (
            <ReplyLine
              threadTarget={artifactTarget}
              targetId={message.replyToMessageId}
              quote={message.replyQuote}
              preview={message.replyPreview}
              author={replyAuthor}
              fallbackText={replyFallbackText}
              onJump={actions.jump}
            />
          )}
          {selecting && onToggleSelect ? (
            <Pressable onPress={onToggleSelect} style={{ maxWidth: "100%", flexShrink: 1 }}>
              {bubble}
            </Pressable>
          ) : (
            <MessageContextMenu
              actions={menu}
              fullWidth={layout.menuFullWidth}
              maxWidth={layout.menuMaxWidth}
              colorScheme={colorScheme}
              onAction={onMenuAction}
              onLongPress={actionProps.onLongPress}
              onDoubleTap={messageHasInlineControls(message.blocks) ? undefined : likeMessage}
            >
              {bubble}
            </MessageContextMenu>
          )}
          {modelBar?.kind === "timeline" ? (
            <ModelSwitchBar
              switches={modelBar.switches}
              presetName={modelBar.presetName}
              onPress={() =>
                setTimeline({
                  switches: modelBar.switches,
                  role: switchRole,
                  selectedKey: switchSelectedKey,
                  currentModels: switchModels,
                })
              }
            />
          ) : modelBar?.kind === "mark" ? (
            <ModelSwitchBar
              model={modelBar.model}
              presetName={modelBar.presetName}
              onPress={() =>
                setLocatePicker({
                  role: switchRole,
                  locate: { model: modelBar.model, provider: null },
                  selectedKey: switchSelectedKey,
                  currentModels: switchModels,
                })
              }
            />
          ) : null}
          {messageProgress}
          {message.role === "bot" &&
          !selecting &&
          !message.id.startsWith("progress:") &&
          blockText(message).trim() ? (
            <MessageActionRow
              userId={userId}
              labels={{
                copy: t("Copy"),
                speak: t("Speak message"),
                favorite: favorited ? t("Unfavorite") : t("Favorite"),
                share: t("Share"),
                regenerate: t("Regenerate"),
                translate: t("Translate"),
              }}
              onCopy={copyMessage}
              // Tapping read-aloud toggles it: the speak action stops a
              // message that is already being read, overlay or single.
              onSpeak={() => actions.speak(message)}
              canSpeak={canSpeak}
              speaking={speaking ?? false}
              reducedMotion={reducedMotion}
              onShare={shareMessage}
              onFavorite={actions.favorite ? () => actions.favorite!(message) : undefined}
              favorited={favorited ?? false}
              onRegenerate={readOnly ? undefined : regenerateMessage}
              onTranslate={canTranslate ? handleTranslatePress : undefined}
            />
          ) : null}
          {canTranslate ? (
            <MessageTranslationView
              translation={translation}
              showActions={translationSettings.showTranslationActions}
              speaking={speaking}
              onSpeakText={
                !onCall && actions.speakText
                  ? (text) => actions.speakText!(message, text, "translation")
                  : undefined
              }
              favorited={translationFavorited}
              onToggleFavorite={
                actions.favoriteTranslation
                  ? () => {
                      const text = translation.result?.translatedText;
                      if (text) actions.favoriteTranslation!(message, text);
                    }
                  : undefined
              }
              onSwitchModel={messageBot?.id ? () => setTranslationPickerOpen(true) : undefined}
              modelProvider={translationSettings.modelProvider}
              onShowTimeline={
                translation.result && messageBot
                  ? () =>
                      setTimeline({
                        switches: translationModelSwitches(
                          translation.result!,
                          translationSettings.modelProvider,
                        ),
                        role: "translation",
                        selectedKey: translationSelectedKey,
                        currentModels: messageBot.translationModels,
                      })
                  : undefined
              }
            />
          ) : null}
          {translationProgress}
          {displayedReactions.size > 0 ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 4,
                marginTop: 4,
                justifyContent: message.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              {[...displayedReactions].map(([emoji, count]) => (
                <Animated.Text
                  entering={
                    emoji === "👍" && optimisticLike && !reducedMotion
                      ? ZoomIn.duration(150).withInitialValues({ transform: [{ scale: 0.9 }] })
                      : undefined
                  }
                  key={emoji}
                  style={{
                    color: tokens.foreground,
                    backgroundColor: tokens.muted,
                    borderRadius: 16,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    fontSize: 13,
                  }}
                >
                  {emoji}
                  {count > 1 ? ` ${count}` : ""}
                </Animated.Text>
              ))}
            </View>
          ) : null}
          {stuck && message.role === "user" && !selecting ? (
            <StuckRunRow
              onCancel={actions.stopStuckRun}
              onRetry={actions.retryStuckRun ? () => actions.retryStuckRun!(message) : undefined}
            />
          ) : null}
        </View>
      </View>
      {translationPickerOpen && messageBot ? (
        <ThreadModelPickerSheet
          visible
          role={translationPickerRole}
          botId={messageBot.id}
          userId={userId ?? ""}
          selectedKey={translationSelectedKey}
          currentModels={messageBot.translationModels}
          onClose={() => setTranslationPickerOpen(false)}
          onSaved={() => {
            // The server translates with the bot's saved list, so
            // re-translating now uses the model just picked.
            translation.translate();
          }}
        />
      ) : null}
      {timeline && messageBot ? (
        <ModelSwitchTimelineSheet
          visible
          switches={timeline.switches}
          onClose={() => setTimeline(null)}
          onLocateModel={(attempt) => {
            // The picker replaces the timeline; closing the timeline first
            // keeps two native sheets from stacking.
            setTimeline(null);
            setLocatePicker({
              role: timeline.role,
              locate: { model: attempt.model, provider: attempt.provider ?? null },
              selectedKey: timeline.selectedKey,
              currentModels: timeline.currentModels,
            });
          }}
        />
      ) : null}
      {locatePicker && messageBot ? (
        <ThreadModelPickerSheet
          visible
          role={locatePicker.role}
          botId={messageBot.id}
          userId={userId ?? ""}
          selectedKey={locatePicker.selectedKey}
          currentModels={locatePicker.currentModels}
          locate={locatePicker.locate}
          onClose={() => setLocatePicker(null)}
          onSaved={() => setLocatePicker(null)}
        />
      ) : null}
    </View>
  );
});

/**
 * The recovery row under a user message whose run has gone quiet: the run
 * produced no reply for over three minutes, so the system offers to stop it
 * or switch model and retry, instead of leaving the message hanging.
 */
function StuckRunRow({ onCancel, onRetry }: { onCancel?: () => void; onRetry?: () => void }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  return (
    <View
      testID="stuck-run-actions"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        marginTop: 4,
        justifyContent: "flex-end",
      }}
    >
      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{t("It seems stuck")}</Text>
      {onCancel ? (
        <Pressable onPress={onCancel} accessibilityRole="button">
          <Text style={{ color: tokens.link, fontSize: 13 }}>{t("Cancel")}</Text>
        </Pressable>
      ) : null}
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={{ color: tokens.link, fontSize: 13 }}>{t("Switch model and retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The action buttons under an AI reply: 36×36 tiles with a 10pt radius,
 * 6pt apart, 10pt below the bubble and 20pt below the row; copy, speak,
 * share and favorite on blue-soft tiles, a spacer, then regenerate alone on
 * a plain tile. The order and which tiles show come from the interface
 * settings, intersected with what this message can do. A favorited reply
 * shows its bookmark tile filled in accent blue. The read-aloud tile pulses
 * while this reply is speaking. Light colors are the mockup's own palette;
 * dark mode falls back to the shared tokens, which the mockup does not define.
 */
export function MessageActionRow({
  userId,
  labels,
  onCopy,
  onSpeak,
  canSpeak,
  speaking,
  reducedMotion,
  onShare,
  onFavorite,
  favorited = false,
  onRegenerate,
  onTranslate,
}: {
  /** The account whose interface settings order and hide these tiles. */
  userId?: string;
  labels: {
    copy: string;
    speak: string;
    favorite: string;
    share: string;
    regenerate: string;
    /** Absent where the row has no translate action (e.g. voice chat). */
    translate?: string;
  };
  onCopy: () => void;
  onSpeak: () => void;
  canSpeak: boolean;
  /** This message is being read aloud; its speaker icon pulses. */
  speaking: boolean;
  reducedMotion: boolean;
  onShare: () => void;
  onFavorite?: () => void;
  favorited?: boolean;
  onRegenerate?: () => void;
  /** Absent where this reply cannot be translated. */
  onTranslate?: () => void;
}) {
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const customSettings = useCustomSettings(userId ?? "");
  // The user's order and hidden tiles, intersected with what this message can do.
  const visible = visibleMessageActions(customSettings, {
    copy: true,
    speak: canSpeak,
    share: true,
    favorite: onFavorite !== undefined,
    regenerate: onRegenerate !== undefined,
  });
  const tile =
    colorScheme === "dark"
      ? { background: tokens.accent, icon: tokens.link }
      : { background: "#e8efff", icon: "#2f6bff" };
  const plain =
    colorScheme === "dark"
      ? { background: tokens.muted, icon: tokens.mutedForeground }
      : { background: "#f4f5f7", icon: "#5b6470" };
  const favoriteTile = favorited
    ? { background: colorScheme === "dark" ? tokens.link : "#2f6bff", icon: "#fff" }
    : tile;
  // The translate action is a wide blue pill, not a 36px tile: it sits next
  // to the favorite tile, or before regenerate when favorite is hidden.
  const translatePill =
    onTranslate && labels.translate ? (
      <TranslateButton label={labels.translate} onPress={onTranslate} />
    ) : null;
  const tiles: Record<MessageActionId, ReactNode> = {
    copy: (
      <ActionTile
        label={labels.copy}
        ios="doc.on.doc"
        android="copy-outline"
        background={tile.background}
        color={tile.icon}
        onPress={onCopy}
      />
    ),
    speak: (
      <ActionTile
        label={labels.speak}
        ios="speaker.wave.2"
        android="volume-high-outline"
        background={tile.background}
        color={tile.icon}
        onPress={onSpeak}
        pulse={speaking}
        reducedMotion={reducedMotion}
      />
    ),
    share: (
      <ActionTile
        label={labels.share}
        ios="paperplane"
        android="paper-plane-outline"
        background={tile.background}
        color={tile.icon}
        onPress={onShare}
      />
    ),
    favorite: (
      <ActionTile
        label={labels.favorite}
        ios={favorited ? "bookmark.fill" : "bookmark"}
        android={favorited ? "bookmark" : "bookmark-outline"}
        background={favoriteTile.background}
        color={favoriteTile.icon}
        onPress={onFavorite!}
      />
    ),
    regenerate: (
      <ActionTile
        label={labels.regenerate}
        ios="arrow.clockwise"
        android="refresh-outline"
        background={plain.background}
        color={plain.icon}
        onPress={onRegenerate!}
      />
    ),
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 10,
        marginBottom: 20,
      }}
    >
      {visible.map((id, index) => (
        <Fragment key={id}>
          {id === "regenerate" && index > 0 ? <View style={{ flex: 1 }} /> : null}
          {id === "regenerate" && translatePill && !visible.includes("favorite")
            ? translatePill
            : null}
          {tiles[id]}
          {id === "favorite" && translatePill ? translatePill : null}
        </Fragment>
      ))}
      {translatePill && !visible.includes("favorite") && !visible.includes("regenerate")
        ? translatePill
        : null}
    </View>
  );
}

function ActionTile({
  label,
  ios,
  android,
  background,
  color,
  onPress,
  pulse = false,
  reducedMotion = false,
}: {
  label: string;
  ios: string;
  android: ComponentProps<typeof NativeSymbol>["android"];
  background: string;
  color: string;
  onPress: () => void;
  /** Loop the icon's opacity while this tile's action is live; static otherwise. */
  pulse?: boolean;
  reducedMotion?: boolean;
}) {
  // The loop starts and stops with the pulse, and always cleans up: ending,
  // switching messages, and unmounting all restore the static icon.
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useEffect(() => {
    if (!pulse || reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(withTiming(0.5, { duration: 450 }), withTiming(1, { duration: 450 })),
      -1,
      true,
    );
    return () => {
      cancelAnimation(opacity);
      opacity.value = 1;
    };
  }, [pulse, reducedMotion, opacity]);
  const icon = <NativeSymbol ios={ios} android={android} size={19} color={color} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
        ...(pressed ? { transform: [{ scale: 0.94 }] } : null),
      })}
    >
      {pulse && !reducedMotion ? <Animated.View style={animatedStyle}>{icon}</Animated.View> : icon}
    </Pressable>
  );
}
