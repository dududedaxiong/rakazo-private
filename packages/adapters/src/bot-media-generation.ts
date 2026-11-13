import type { MediaGenerationProvider } from "@rakazo/adapter-kit";
import type { BotModelEntry } from "@rakazo/contracts";
import {
  activeBotPromptPreset,
  parseBotModelList,
  parseBotPromptPresets,
  withPromptPreset,
} from "@rakazo/contracts";
import type { Bot } from "@rakazo/db";
import type { ExecutorDeps } from "./executor-deps.js";
import type { BotMediaCallEntry, BotMediaKindCalls } from "./media-generation-provider.js";
import { BotMediaGenerationProvider } from "./media-generation-provider.js";
import { generateMediaWithChatModel } from "./pi-openai-compatible-provider.js";
import { resolveConnectedModelKey } from "./run-model.js";

type BotMediaFields = Pick<
  Bot,
  | "videoModels"
  | "imageModels"
  | "videoPromptPresets"
  | "activeVideoPromptPreset"
  | "imagePromptPresets"
  | "activeImagePromptPreset"
>;

/**
 * Resolves one bot media kind's ordered list into the calls to try, in order.
 * An entry whose model no longer resolves is skipped and recorded, so the
 * all-fail error can name it; a failed resolution never breaks the run on its
 * own — the bot's media setting is a preference, not a requirement.
 */
async function resolveBotMediaKind(
  deps: ExecutorDeps,
  scope: { userId: string; spaceId: string },
  entries: readonly BotModelEntry[] | null,
  kind: "image" | "video",
  presetPrompt: string | null,
): Promise<BotMediaKindCalls> {
  const calls: BotMediaCallEntry[] = [];
  const failures: { modelId: string; reason: string }[] = [];
  for (const entry of entries ?? []) {
    try {
      const { resolved } = await resolveConnectedModelKey(deps, scope, entry.provider, entry.model);
      const baseUrl = resolved.baseUrl;
      if (!baseUrl) {
        failures.push({ modelId: entry.model, reason: "not connected" });
        continue;
      }
      calls.push({
        modelId: entry.model,
        call: (prompt, signal) =>
          generateMediaWithChatModel(
            {
              baseUrl,
              apiKey: resolved.apiKey,
              headers: resolved.headers,
              apiProtocol: resolved.apiProtocol,
              authMode: resolved.authMode,
              model: entry.model,
              kind,
              prompt: withPromptPreset(presetPrompt, prompt),
            },
            undefined,
            signal,
            { allowPrivate: resolved.allowPrivateEndpoint ?? false },
          ),
      });
    } catch {
      failures.push({ modelId: entry.model, reason: "not connected" });
    }
  }
  return { calls, failures };
}

/**
 * The media provider for one run: each kind answers from the bot's configured
 * media models, tried in order, and otherwise from the global provider. A bot
 * with no media models gets the global provider unchanged, so its chats
 * behave exactly as before.
 */
export async function resolveBotMediaGenerationProvider(
  deps: ExecutorDeps,
  scope: { userId: string; spaceId: string },
  bot: BotMediaFields,
  fallback?: MediaGenerationProvider,
): Promise<MediaGenerationProvider | undefined> {
  const imageEntries = parseBotModelList(bot.imageModels);
  const videoEntries = parseBotModelList(bot.videoModels);
  if (!imageEntries && !videoEntries) return fallback;
  const imagePreset =
    activeBotPromptPreset(
      parseBotPromptPresets(bot.imagePromptPresets),
      bot.activeImagePromptPreset,
    )?.prompt ?? null;
  const videoPreset =
    activeBotPromptPreset(
      parseBotPromptPresets(bot.videoPromptPresets),
      bot.activeVideoPromptPreset,
    )?.prompt ?? null;
  const [image, video] = await Promise.all([
    resolveBotMediaKind(deps, scope, imageEntries, "image", imagePreset),
    resolveBotMediaKind(deps, scope, videoEntries, "video", videoPreset),
  ]);
  if (image.calls.length === 0 && video.calls.length === 0) return fallback;
  return new BotMediaGenerationProvider(image, video, fallback);
}
