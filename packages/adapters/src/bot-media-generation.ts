import type { MediaGenerationProvider } from "@rakazo_mickvvw/adapter-kit";
import type { BotModelEntry, BotPromptPreset } from "@rakazo_mickvvw/contracts";
import {
  activeBotPromptPreset,
  parseBotModelList,
  parseBotPromptPresets,
  withPromptPreset,
} from "@rakazo_mickvvw/contracts";
import { splitBotModelPools } from "@rakazo_mickvvw/core";
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
  // Explicit pool fields on the mapped Bot view; absent on Prisma rows,
  // which carry the stored columns instead (main pool in XModels, backup
  // pool in XBackupModels).
  imageMainModels?: BotModelEntry[] | null;
  videoMainModels?: BotModelEntry[] | null;
  imageEditMainModels?: BotModelEntry[] | null;
  videoEditMainModels?: BotModelEntry[] | null;
  imageBackupModels?: Bot["imageBackupModels"];
  videoBackupModels?: Bot["videoBackupModels"];
  imageEditBackupModels?: Bot["imageEditBackupModels"];
  videoEditBackupModels?: Bot["videoEditBackupModels"];
};

/**
 * One family's models in chain order — the whole main pool first, then the
 * backup pool — each tagged with its pool. Works from the mapped Bot view
 * (explicit pool fields) or a Prisma row (stored columns).
 *
 * Each pool falls back on its own: a view field that is missing or null
 * (a raw Prisma row carries the backup column but no main view field, so an
 * all-or-nothing view check would read the main pool as empty) reads from
 * the stored split, while an explicitly emptied pool (an empty array)
 * parses to no list and stays empty — it must never resurrect the old
 * stored list.
 */
function botModelPoolEntries(
  bot: BotMediaFields,
  keys: {
    mainView: "imageMainModels" | "videoMainModels" | "imageEditMainModels" | "videoEditMainModels";
    backupView:
      | "imageBackupModels"
      | "videoBackupModels"
      | "imageEditBackupModels"
      | "videoEditBackupModels";
    mainStored: "imageModels" | "videoModels" | "imageEditModels" | "videoEditModels";
    backupStored:
      | "imageBackupModels"
      | "videoBackupModels"
      | "imageEditBackupModels"
      | "videoEditBackupModels";
  },
): Array<BotModelEntry & { pool: "main" | "backup" }> {
  const stored = splitBotModelPools(bot[keys.mainStored], bot[keys.backupStored]);
  const mainRaw = bot[keys.mainView];
  const backupRaw = bot[keys.backupView];
  const pools = {
    mainPool: mainRaw == null ? stored.mainPool : parseBotModelList(mainRaw),
    backupPool: backupRaw == null ? stored.backupPool : parseBotModelList(backupRaw),
  };
  return [
    ...(pools.mainPool ?? []).map((entry) => ({ ...entry, pool: "main" as const })),
    ...(pools.backupPool ?? []).map((entry) => ({ ...entry, pool: "backup" as const })),
  ];
}

/**
 * Resolves one bot media kind's ordered list into the calls to try, in order.
 * An entry whose model no longer resolves is skipped and recorded, so the
 * all-fail error can name it; a failed resolution never breaks the run on its
 * own — the bot's media setting is a preference, not a requirement.
 */
async function resolveBotMediaKind(
  deps: ConnectedModelKeyDeps,
  scope: { userId: string; spaceId: string },
  entries: readonly (BotModelEntry & { pool: "main" | "backup" })[] | null,
  kind: "image" | "video",
  preset: BotPromptPreset | null,
): Promise<BotMediaKindCalls> {
  const calls: BotMediaCallEntry[] = [];
  const failures: {
    modelId: string;
    reason: string;
    providerLabel?: string;
    pool?: "main" | "backup";
  }[] = [];
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
          pool: entry.pool,
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
        pool: entry.pool,
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
      failures.push({ modelId: entry.model, reason: "not connected", pool: entry.pool });
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
  const imageEntries = botModelPoolEntries(bot, {
    mainView: "imageMainModels",
    backupView: "imageBackupModels",
    mainStored: "imageModels",
    backupStored: "imageBackupModels",
  });
  const videoEntries = botModelPoolEntries(bot, {
    mainView: "videoMainModels",
    backupView: "videoBackupModels",
    mainStored: "videoModels",
    backupStored: "videoBackupModels",
  });
  const imageEditEntries = botModelPoolEntries(bot, {
    mainView: "imageEditMainModels",
    backupView: "imageEditBackupModels",
    mainStored: "imageEditModels",
    backupStored: "imageEditBackupModels",
  });
  const videoEditEntries = botModelPoolEntries(bot, {
    mainView: "videoEditMainModels",
    backupView: "videoEditBackupModels",
    mainStored: "videoEditModels",
    backupStored: "videoEditBackupModels",
  });
  if (
    imageEntries.length === 0 &&
    videoEntries.length === 0 &&
    imageEditEntries.length === 0 &&
    videoEditEntries.length === 0
  )
    return fallback;
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
