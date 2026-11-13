import type { MediaGenerationProvider } from "@rakazo/adapter-kit";
import type { Bot } from "@rakazo/db";
import type { ExecutorDeps } from "./executor-deps.js";
import { BotMediaGenerationProvider } from "./media-generation-provider.js";
import { generateMediaWithChatModel } from "./pi-openai-compatible-provider.js";
import { resolveConnectedModelKey } from "./run-model.js";

type BotMediaFields = Pick<
  Bot,
  "videoModelProvider" | "videoModelId" | "imageModelProvider" | "imageModelId"
>;

type MediaCall = (
  prompt: string,
  signal: AbortSignal,
) => Promise<{
  bytes: Uint8Array;
  mimeType: "image/png" | "video/mp4";
}>;

/**
 * Resolves one bot media kind to a chat-model call, or null when the bot has
 * nothing configured for it or the configured model no longer resolves. A
 * failed resolution falls back to the global provider instead of breaking
 * the run: the bot's media setting is a preference, not a requirement.
 */
async function resolveBotMediaCall(
  deps: ExecutorDeps,
  scope: { userId: string; spaceId: string },
  provider: string | null,
  modelId: string | null,
  kind: "image" | "video",
): Promise<MediaCall | null> {
  if (!provider || !modelId) return null;
  try {
    const { resolved } = await resolveConnectedModelKey(deps, scope, provider, modelId);
    const baseUrl = resolved.baseUrl;
    if (!baseUrl) return null;
    return (prompt, signal) =>
      generateMediaWithChatModel(
        {
          baseUrl,
          apiKey: resolved.apiKey,
          headers: resolved.headers,
          apiProtocol: resolved.apiProtocol,
          authMode: resolved.authMode,
          model: modelId,
          kind,
          prompt,
        },
        undefined,
        signal,
        { allowPrivate: resolved.allowPrivateEndpoint ?? false },
      );
  } catch {
    return null;
  }
}

/**
 * The media provider for one run: each kind answers from the bot's configured
 * media model when it resolves, and otherwise from the global provider. A bot
 * with no media models gets the global provider unchanged, so its chats
 * behave exactly as before.
 */
export async function resolveBotMediaGenerationProvider(
  deps: ExecutorDeps,
  scope: { userId: string; spaceId: string },
  bot: BotMediaFields,
  fallback?: MediaGenerationProvider,
): Promise<MediaGenerationProvider | undefined> {
  const hasImage = Boolean(bot.imageModelProvider && bot.imageModelId);
  const hasVideo = Boolean(bot.videoModelProvider && bot.videoModelId);
  if (!hasImage && !hasVideo) return fallback;
  const [imageCall, videoCall] = await Promise.all([
    resolveBotMediaCall(deps, scope, bot.imageModelProvider, bot.imageModelId, "image"),
    resolveBotMediaCall(deps, scope, bot.videoModelProvider, bot.videoModelId, "video"),
  ]);
  if (!imageCall && !videoCall) return fallback;
  return new BotMediaGenerationProvider(imageCall, videoCall, fallback);
}
