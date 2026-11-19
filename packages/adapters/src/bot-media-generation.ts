import type { MediaGenerationProvider } from "@rakazo_mickvvw/adapter-kit";
import type { BotModelEntry, BotPromptPreset } from "@rakazo_mickvvw/contracts";
import {
  activeBotPromptPreset,
  parseBotModelList,
  parseBotPromptPresets,
  withPromptPreset,
} from "@rakazo_mickvvw/contracts";
import type { Bot } from "@rakazo_mickvvw/db";
import type { BotMediaCallEntry, BotMediaKindCalls } from "./media-generation-provider.js";
import { BotMediaGenerationProvider } from "./media-generation-provider.js";
import {
  downloadAsyncVideoUrl,
  generateMediaWithChatModel,
  pollAsyncVideo,
  submitAsyncVideo,
} from "./pi-openai-compatible-provider.js";
import type { ConnectedModelKeyDeps } from "./run-model.js";
import { resolveConnectedModelKey } from "./run-model.js";

type BotMediaFields = Pick<
  Bot,
  | "videoModels"
  | "imageModels"
  | "videoPromptPresets"
  | "activeVideoPromptPreset"
  | "imagePromptPresets"
  | "activeImagePromptPreset"
> & {
  // Bots created before the edit lists existed carry no edit fields.
  imageEditModels?: Bot["imageEditModels"];
  videoEditModels?: Bot["videoEditModels"];
};

/**
 * Resolves one bot media kind's ordered list into the calls to try, in order.
 * An entry whose model no longer resolves is skipped and recorded, so the
 * all-fail error can name it; a failed resolution never breaks the run on its
 * own — the bot's media setting is a preference, not a requirement.
 */
async function resolveBotMediaKind(
  deps: ConnectedModelKeyDeps,
  scope: { userId: string; spaceId: string },
  entries: readonly BotModelEntry[] | null,
  kind: "image" | "video",
  preset: BotPromptPreset | null,
): Promise<BotMediaKindCalls> {
  const calls: BotMediaCallEntry[] = [];
  const failures: { modelId: string; reason: string; providerLabel?: string }[] = [];
  for (const entry of entries ?? []) {
    try {
      const { resolved, credential } = await resolveConnectedModelKey(
        deps,
        scope,
        entry.provider,
        entry.model,
      );
      const baseUrl = resolved.baseUrl;
      if (!baseUrl) {
        failures.push({
          modelId: entry.model,
          reason: "not connected",
          ...(credential?.label ? { providerLabel: credential.label } : {}),
        });
        continue;
      }
      const connection = {
        baseUrl,
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        apiProtocol: resolved.apiProtocol,
        authMode: resolved.authMode,
        model: entry.model,
      };
      // The async video endpoint only exists on the chat-completions protocol;
      // other protocols keep the synchronous call alone.
      const asyncVideo =
        kind === "video" && (!resolved.apiProtocol || resolved.apiProtocol === "chat-completions");
      calls.push({
        modelId: entry.model,
        provider: entry.provider,
        ...(credential?.label ? { providerLabel: credential.label } : {}),
        ...(preset ? { presetName: preset.name } : {}),
        call: (prompt, signal, references) =>
          generateMediaWithChatModel(
            {
              ...connection,
              kind,
              prompt: withPromptPreset(preset?.prompt ?? null, prompt),
              ...(references?.length ? { references } : {}),
            },
            undefined,
            signal,
            { allowPrivate: resolved.allowPrivateEndpoint ?? false },
          ),
        ...(asyncVideo
          ? {
              submitVideo: async (prompt, signal, references) => {
                const { taskId } = await submitAsyncVideo(
                  {
                    ...connection,
                    prompt: withPromptPreset(preset?.prompt ?? null, prompt),
                    ...(references?.length
                      ? {
                          firstFrame:
                            references.find((reference) => reference.role === "first") ??
                            references[0],
                        }
                      : {}),
                  },
                  undefined,
                  signal,
                  { allowPrivate: resolved.allowPrivateEndpoint ?? false },
                );
                return taskId;
              },
              pollVideo: async (taskId, signal) => {
                const polled = await pollAsyncVideo({ ...connection, taskId }, undefined, signal, {
                  allowPrivate: resolved.allowPrivateEndpoint ?? false,
                });
                if (polled.status === "completed" && polled.url) {
                  return {
                    status: "completed" as const,
                    output: await downloadAsyncVideoUrl(polled.url, signal),
                  };
                }
                if (polled.status === "failed") return { status: "failed" as const };
                if (polled.status === "queued") return { status: "queued" as const };
                return { status: "running" as const };
              },
            }
          : {}),
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
  deps: ConnectedModelKeyDeps,
  scope: { userId: string; spaceId: string },
  bot: BotMediaFields,
  fallback?: MediaGenerationProvider,
): Promise<MediaGenerationProvider | undefined> {
  const imageEntries = parseBotModelList(bot.imageModels);
  const videoEntries = parseBotModelList(bot.videoModels);
  const imageEditEntries = parseBotModelList(bot.imageEditModels);
  const videoEditEntries = parseBotModelList(bot.videoEditModels);
  if (!imageEntries && !videoEntries && !imageEditEntries && !videoEditEntries) return fallback;
  const imagePreset = activeBotPromptPreset(
    parseBotPromptPresets(bot.imagePromptPresets),
    bot.activeImagePromptPreset,
  );
  const videoPreset = activeBotPromptPreset(
    parseBotPromptPresets(bot.videoPromptPresets),
    bot.activeVideoPromptPreset,
  );
  // Edit calls never apply a prompt preset: the reference already carries the
  // content, and the supplementary prompt is the edit instruction.
  const [image, video, imageEdit, videoEdit] = await Promise.all([
    resolveBotMediaKind(deps, scope, imageEntries, "image", imagePreset),
    resolveBotMediaKind(deps, scope, videoEntries, "video", videoPreset),
    resolveBotMediaKind(deps, scope, imageEditEntries, "image", null),
    resolveBotMediaKind(deps, scope, videoEditEntries, "video", null),
  ]);
  if (
    image.calls.length === 0 &&
    video.calls.length === 0 &&
    imageEdit.calls.length === 0 &&
    videoEdit.calls.length === 0
  )
    return fallback;
  return new BotMediaGenerationProvider(image, video, fallback, imageEdit, videoEdit);
}
