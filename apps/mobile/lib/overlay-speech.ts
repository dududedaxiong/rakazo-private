import type { OnDeviceSpeechPlayback } from "./on-device-speech";
import {
  onDeviceSpeechAvailable,
  onDeviceTtsReady,
  speakOnDeviceSpeech,
  TtsChineseVoiceMissingError,
} from "./on-device-speech";
import { loadVoiceSource, serverProviderOf } from "./voice-direction";

export interface OverlaySpeechItem {
  text: string;
  botId?: string;
  messageId: string;
  /** Which utterance of its message this is, for read-aloud progress. */
  segmentIndex?: number;
  /** How many utterances its message splits into. */
  segmentTotal?: number;
}

/** The utterance sounding now, for read-aloud progress under its message. */
export interface OverlaySpeechProgress {
  messageId: string;
  segmentIndex: number;
  segmentTotal: number;
  text: string;
}

interface OverlayChain {
  id: number;
  messageIds: string[];
  currentMessageId: string | undefined;
  currentItem: OverlaySpeechItem | undefined;
  stop: () => void;
}

const chains = new Map<number, OverlayChain>();
let nextChainId = 1;
const listeners = new Set<() => void>();

// useSyncExternalStore needs a stable snapshot: the sets below are rebuilt
// only when a chain starts, advances, or ends.
let cachedChainMessageIds: ReadonlySet<string> = new Set();
let cachedSpeakingMessageIds: ReadonlySet<string> = new Set();
let cachedProgress: OverlaySpeechProgress | null = null;

function rebuildCaches() {
  cachedChainMessageIds = new Set([...chains.values()].flatMap((chain) => chain.messageIds));
  cachedSpeakingMessageIds = new Set(
    [...chains.values()]
      .map((chain) => chain.currentMessageId)
      .filter((id): id is string => id !== undefined),
  );
  const current = [...chains.values()].find((chain) => chain.currentItem !== undefined);
  const item = current?.currentItem;
  cachedProgress =
    item && item.segmentTotal !== undefined && item.segmentTotal > 1
      ? {
          messageId: item.messageId,
          segmentIndex: item.segmentIndex ?? 0,
          segmentTotal: item.segmentTotal,
          text: item.text,
        }
      : null;
}

function notify() {
  rebuildCaches();
  for (const listener of listeners) listener();
}

export function subscribeOverlaySpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The message ids in every overlay chain, for the tap-to-stop check. */
export function getOverlayChainMessageIds(): ReadonlySet<string> {
  return cachedChainMessageIds;
}

/** The message sounding now in each overlay chain, for the speaker icon. */
export function getOverlaySpeakingMessageIds(): ReadonlySet<string> {
  return cachedSpeakingMessageIds;
}

/** The utterance sounding now, for read-aloud progress; null when none. */
export function getOverlaySpeechProgress(): OverlaySpeechProgress | null {
  return cachedProgress;
}

/** Stops the overlay chain containing this message, if any. */
export function stopOverlayChainForMessage(messageId: string): boolean {
  for (const chain of chains.values()) {
    if (chain.messageIds.includes(messageId)) {
      chain.stop();
      return true;
    }
  }
  return false;
}

/** Stops every overlay chain; the global stop calls this too. */
export function stopAllOverlaySpeech(): void {
  for (const chain of [...chains.values()]) chain.stop();
}

/**
 * Whether a manual read-aloud would use the on-device voice, the only engine
 * that can play two chains at once (each utterance gets its own player).
 * Mirrors speakPrepared's read-aloud choice; anything else falls back to the
 * single playback. The system engine is one queue and hosted speech is one
 * session, so neither can overlap.
 */
export async function readAloudUsesOnDevice(): Promise<boolean> {
  const readAloud = await loadVoiceSource("readAloud").catch(() => "auto");
  if (readAloud === "on-device") return onDeviceTtsReady();
  if (readAloud === "system") return false;
  if (serverProviderOf(readAloud)) return false;
  return onDeviceSpeechAvailable();
}

/**
 * Reads a chain of messages aloud on the on-device voice, independently of
 * the single playback: starting another chain neither stops this one nor is
 * stopped by it. Resolves true when anything was spoken, false when nothing
 * was (the caller shows the voice-setup hint); a stop resolves true, like
 * the single playback, so stopping never looks like a missing voice. A
 * missing Chinese lexicon aborts the chain and throws, like the single
 * playback does.
 */
export async function speakOverlayChain(items: OverlaySpeechItem[]): Promise<boolean> {
  const messageIds = items.map((item) => item.messageId);
  if (messageIds.length === 0) return false;
  const abort = new AbortController();
  let currentPlayback: OnDeviceSpeechPlayback | null = null;
  const chain: OverlayChain = {
    id: nextChainId++,
    messageIds,
    currentMessageId: undefined,
    currentItem: undefined,
    stop: () => {
      abort.abort();
      currentPlayback?.stop();
    },
  };
  chains.set(chain.id, chain);
  notify();
  let spoken = false;
  try {
    for (const item of items) {
      if (abort.signal.aborted) return true;
      chain.currentMessageId = item.messageId;
      chain.currentItem = item;
      notify();
      try {
        spoken =
          (await speakOnDeviceSpeech(item.text, {
            signal: abort.signal,
            onPlayback: (playback) => {
              currentPlayback = playback;
            },
          })) || spoken;
      } catch (error) {
        // A missing Chinese lexicon fails every message the same way; abort
        // the chain and let the caller show the voice-setup hint. Any other
        // message that will not speak must not end the chain; the next
        // message still gets its turn.
        if (error instanceof TtsChineseVoiceMissingError) throw error;
      }
      currentPlayback = null;
      // A stop mid-chain resolves true, like the single playback: stopping
      // never looks like a missing voice.
      if (abort.signal.aborted) return true;
    }
    return spoken;
  } finally {
    chains.delete(chain.id);
    chain.currentMessageId = undefined;
    chain.currentItem = undefined;
    notify();
  }
}
