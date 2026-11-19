import type { Bot } from "@rakazo_mickvvw/contracts";
import { rpc } from "./api";
import { errorText } from "./user-error";

export type SupplementaryPrompt = {
  supplementaryPrompt: string;
  presetName?: string;
  modelId?: string;
};

/** The saved supplementary prompt for one generated artifact; "" when none was saved. */
export async function getSupplementaryPrompt(artifactId: string): Promise<SupplementaryPrompt> {
  const result = await rpc("media/getSupplementaryPrompt", { artifactId });
  return {
    supplementaryPrompt: result.supplementaryPrompt,
    ...(result.presetName ? { presetName: result.presetName } : {}),
    ...(result.modelId ? { modelId: result.modelId } : {}),
  };
}

/** Saves the supplementary prompt for one generated artifact. */
export async function setSupplementaryPrompt(
  artifactId: string,
  supplementaryPrompt: string,
): Promise<void> {
  await rpc("media/setSupplementaryPrompt", { artifactId, supplementaryPrompt });
}

export type MediaRegenerateMode = "edit" | "random";

export type MediaRegenerateResult = {
  status: "completed" | "queued";
  /** The new artifact when regeneration finished with a new file. */
  artifactId?: string;
};

/**
 * Re-renders one generated artifact. "random" (the default) replays the
 * original prompt plus preset plus supplementary prompt through the preset
 * model; "edit" reworks the original from the supplementary prompt alone
 * through the edit model, never falling back to a redraw. A completed
 * regeneration may carry a new artifact id; a queued one finishes in the
 * background and the new file arrives as its own message.
 */
export async function regenerateMedia(
  artifactId: string,
  options?: { mode?: MediaRegenerateMode; referenceArtifactId?: string },
): Promise<MediaRegenerateResult> {
  const result = await rpc("media/regenerate", {
    artifactId,
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.referenceArtifactId ? { referenceArtifactId: options.referenceArtifactId } : {}),
  });
  return {
    status: result.status,
    ...(result.artifactId ? { artifactId: result.artifactId } : {}),
  };
}

/** True when the bot has an edit model for this kind; null or empty means none. */
export function hasEditModels(
  bot: Pick<Bot, "imageEditModels" | "videoEditModels"> | null | undefined,
  kind: "image" | "video",
): boolean {
  const models = kind === "image" ? bot?.imageEditModels : bot?.videoEditModels;
  return (models?.length ?? 0) > 0;
}

/**
 * Whether tapping Edit details must open the edit dialog first: a video
 * always needs a reference image; an image only when there is no saved
 * supplementary prompt to edit from.
 */
export function needsEditDialog(
  kind: "image" | "video",
  supplementaryPrompt: string | null | undefined,
): boolean {
  return kind === "video" || !supplementaryPrompt?.trim();
}

/** The server's "no edit model configured" refusal, which prompts to configure one. */
export function isNoEditModelError(error: unknown): boolean {
  return errorText(error).includes("还没有配置编辑模型");
}

let fallbackNonce = 0;

/** Uploads a picked image as the video edit's first-frame reference. */
export async function uploadReferenceImage(
  botId: string,
  artifactId: string,
  file: { name: string; mimeType: string; contentBase64: string },
): Promise<string> {
  const nonce =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${++fallbackNonce}-${Math.random().toString(36).slice(2)}`;
  const reference = await rpc("artifacts/create", {
    botId,
    name: file.name,
    mimeType: file.mimeType,
    contentBase64: file.contentBase64,
    clientNonce: `reference:${artifactId}:${nonce}`,
  });
  return reference.id;
}
