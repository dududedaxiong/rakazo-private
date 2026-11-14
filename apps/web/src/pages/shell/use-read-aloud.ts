import type { Bot, ThreadMessage, ThreadSnapshot } from "@rakazo/contracts";
import { speechFromBlocks } from "@rakazo/core";
import { toast } from "@rakazo/ui-web";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { speaker } from "../../lib/tts";

const READ_ALOUD_TOAST = "read-aloud-error";
const LIVE_RUN_STATUSES = ["running", "queued", "leased"];

/**
 * Chat read-aloud has no caption to carry a failure, so it surfaces as a
 * toast. Resolves with the failure text when nothing could be read.
 */
function readAloud(
  text: string,
  opts: { botId: string; messageId: string },
  full: boolean,
): Promise<string | undefined> {
  return speaker.speak(text, { ...opts, full }).then((error) => {
    if (error) toast.error(error, { id: READ_ALOUD_TOAST });
    return error;
  });
}

/** Where a read-aloud is: the message sounding, its current segment, and how many there are. */
export interface SpeakingProgress {
  messageId: string;
  caption: string;
  index: number;
  total: number;
}

/** Reads bot replies aloud: on request, and automatically for bots that speak their replies. */
export function useReadAloud({
  active,
  snapshot,
  callBotId,
  activeBotId,
}: {
  active: Bot | undefined;
  snapshot: ThreadSnapshot | null;
  callBotId: string | undefined;
  activeBotId: RefObject<string | undefined>;
}) {
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [speakingProgress, setSpeakingProgress] = useState<SpeakingProgress | null>(null);
  const [readingConversation, setReadingConversation] = useState(false);
  const autoSpoken = useRef<string | null>(null);
  const autoSpokenBotId = useRef<string | null>(null);
  const conversationRun = useRef(0);
  const readingConversationRef = useRef(false);

  useEffect(() => {
    const unsubSpeech = speaker.subscribe((state) => {
      setSpeakingMessageId(state.status === "idle" ? null : (state.messageId ?? null));
      setSpeakingProgress(
        state.status === "speaking" &&
          state.messageId !== undefined &&
          state.caption !== undefined &&
          state.segmentIndex !== undefined &&
          state.segmentTotal !== undefined
          ? {
              messageId: state.messageId,
              caption: state.caption,
              index: state.segmentIndex,
              total: state.segmentTotal,
            }
          : null,
      );
    });
    return () => {
      unsubSpeech();
    };
  }, []);

  /** Ends a conversation read without touching any other read. */
  const cancelConversation = useCallback(() => {
    conversationRun.current += 1;
    if (readingConversationRef.current) {
      readingConversationRef.current = false;
      setReadingConversation(false);
    }
  }, []);

  const stopConversation = useCallback(() => {
    cancelConversation();
    speaker.stop();
  }, [cancelConversation]);

  // Leaving the chat stops a conversation read; the captured list belongs to the old chat.
  useEffect(() => {
    return () => {
      cancelConversation();
      speaker.stop();
    };
  }, [active?.id, cancelConversation]);

  useEffect(() => {
    if (!active || !snapshot || snapshot.botId !== active.id) return;
    // A conversation read owns the speaker; a reply that arrives mid-read
    // waits until it ends instead of cutting in.
    if (readingConversationRef.current) return;
    const lastBot = [...snapshot.messages].reverse().find((message) => message.role === "bot");
    if (autoSpokenBotId.current !== active.id) {
      autoSpokenBotId.current = active.id;
      autoSpoken.current = lastBot?.id ?? null;
      return;
    }
    // An active call owns the speaker; another chat's replies must not cut into it.
    if (callBotId !== undefined || !active.autoSpeak) {
      autoSpoken.current = lastBot?.id ?? null;
      return;
    }
    if (snapshot.run && LIVE_RUN_STATUSES.includes(snapshot.run.status)) return;
    if (!lastBot || lastBot.id === autoSpoken.current) return;
    const text = speechFromBlocks(lastBot.blocks);
    if (!text) return;
    autoSpoken.current = lastBot.id;
    void readAloud(text, { botId: active.id, messageId: lastBot.id }, false);
  }, [
    snapshot?.messages,
    snapshot?.run?.status,
    snapshot?.botId,
    active?.autoSpeak,
    active?.id,
    callBotId,
    readingConversation,
  ]);

  const speakingMessageIdRef = useRef(speakingMessageId);
  speakingMessageIdRef.current = speakingMessageId;
  const callBotIdRef = useRef(callBotId);
  callBotIdRef.current = callBotId;
  /**
   * Reads any text in a bot's voice: a translation reads its own words, not
   * the message it came from. Tapping the text already sounding stops it.
   * A manual read always reads the whole text, never a spoken summary.
   */
  const speakText = useCallback(
    (text: string, opts: { botId: string; messageId: string }) => {
      // A manual read takes the speaker; a conversation read in progress ends here.
      cancelConversation();
      if (speakingMessageIdRef.current === opts.messageId) {
        speaker.stop();
        return;
      }
      // An active call owns the speaker; a manual read must not cut into it.
      if (callBotIdRef.current !== undefined) return;
      if (text) void readAloud(text, opts, true);
    },
    [cancelConversation],
  );
  const speakMessage = useCallback(
    (message: ThreadMessage) => {
      const text = speechFromBlocks(message.blocks);
      const id = message.botId ?? activeBotId.current;
      if (text && id) speakText(text, { botId: id, messageId: message.id });
    },
    [speakText],
  );

  /**
   * Reads the whole conversation in order, user and bot messages alike, each
   * in full. Tapping again stops it; so does a manual read or leaving the chat.
   */
  const readConversation = useCallback(() => {
    if (readingConversationRef.current) {
      stopConversation();
      return Promise.resolve();
    }
    if (callBotIdRef.current !== undefined) return Promise.resolve();
    const botId = active?.id;
    if (!botId || !snapshot) return Promise.resolve();
    const live = snapshot.run && LIVE_RUN_STATUSES.includes(snapshot.run.status);
    const items = snapshot.messages
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: speechFromBlocks(message.blocks),
      }))
      .filter((item) => item.text);
    // A reply still streaming has only a partial text; leave it for the next read.
    if (live && items.length > 0 && items[items.length - 1]?.role === "bot") items.pop();
    if (!items.length) return Promise.resolve();
    const mine = ++conversationRun.current;
    readingConversationRef.current = true;
    setReadingConversation(true);
    return (async () => {
      for (const item of items) {
        if (conversationRun.current !== mine) return;
        const error = await readAloud(item.text, { botId, messageId: item.id }, true);
        // A read that failed outright stops the queue; the toast already says why.
        if (error) break;
      }
      if (conversationRun.current === mine) {
        readingConversationRef.current = false;
        setReadingConversation(false);
      }
    })();
  }, [active?.id, snapshot, stopConversation]);

  return {
    speakingMessageId,
    speakingProgress,
    speakMessage,
    speakText,
    callHoldsSpeaker: callBotId !== undefined,
    readingConversation,
    readConversation,
  };
}
