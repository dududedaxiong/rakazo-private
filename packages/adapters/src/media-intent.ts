import { DEFAULT_IMAGE_TRIGGERS, DEFAULT_VIDEO_TRIGGERS } from "@rakazo_mickvvw/contracts";

export type MediaToolName = "generate_image" | "generate_video";

/** The default trigger words in storage form, for settings screens to show. */
export const DEFAULT_VIDEO_TRIGGER_WORDS = DEFAULT_VIDEO_TRIGGERS.join("|");
/** The default trigger words in storage form, for settings screens to show. */
export const DEFAULT_IMAGE_TRIGGER_WORDS = DEFAULT_IMAGE_TRIGGERS.join("|");

/**
 * Split a stored "|" trigger list, dropping blanks. An empty or missing value
 * falls back to the defaults: clearing the field never disables routing.
 */
export function parseTriggerWords(
  value: string | null | undefined,
  fallback: readonly string[],
): string[] {
  const words = (value ?? "")
    .split("|")
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  return words.length > 0 ? words : [...fallback];
}

export interface MediaTriggerMatch {
  readonly tool: MediaToolName;
  readonly trigger: string;
  /** The message with the trigger's first occurrence removed, trimmed. */
  readonly prompt: string;
}

/**
 * A message that contains a media trigger word, or null. The match is a plain
 * substring: the earliest occurrence wins, the longest trigger wins at the
 * same position, and video wins an exact tie. A message that is only the
 * trigger word, with nothing left to generate from, does not route.
 */
export function matchMediaTrigger(
  text: string,
  videoWords: readonly string[],
  imageWords: readonly string[],
): MediaTriggerMatch | null {
  if (!text) return null;
  const haystack = text.toLowerCase();
  const candidates: Array<{ index: number; trigger: string; tool: MediaToolName }> = [];
  const collect = (words: readonly string[], tool: MediaToolName) => {
    for (const trigger of words) {
      if (!trigger) continue;
      const index = haystack.indexOf(trigger.toLowerCase());
      if (index >= 0) candidates.push({ index, trigger, tool });
    }
  };
  // Video first, so an exact tie keeps video under a stable sort.
  collect(videoWords, "generate_video");
  collect(imageWords, "generate_image");
  candidates.sort(
    (a, b) =>
      a.index - b.index ||
      b.trigger.length - a.trigger.length ||
      (a.tool === "generate_video" ? -1 : b.tool === "generate_video" ? 1 : 0),
  );
  const best = candidates[0];
  if (!best) return null;
  const prompt = (text.slice(0, best.index) + text.slice(best.index + best.trigger.length)).trim();
  if (!prompt) return null;
  return { tool: best.tool, trigger: best.trigger, prompt };
}

/** The trigger match for a bot's stored trigger words, or null. */
export function matchBotMediaTrigger(
  text: string,
  bot: { videoTriggerWords?: string | null; imageTriggerWords?: string | null },
): MediaTriggerMatch | null {
  return matchMediaTrigger(
    text,
    parseTriggerWords(bot.videoTriggerWords, DEFAULT_VIDEO_TRIGGERS),
    parseTriggerWords(bot.imageTriggerWords, DEFAULT_IMAGE_TRIGGERS),
  );
}
