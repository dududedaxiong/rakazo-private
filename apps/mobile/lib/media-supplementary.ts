import { rpc } from "./api";

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

export type MediaRegenerateResult = {
  status: "completed" | "queued";
  /** The new artifact when regeneration finished with a new file. */
  artifactId?: string;
};

/**
 * Re-renders one generated artifact with its prompt preset plus
 * supplementary prompt. A completed regeneration may carry a new
 * artifact id; a queued one (video) finishes in the background.
 */
export async function regenerateMedia(artifactId: string): Promise<MediaRegenerateResult> {
  const result = await rpc("media/regenerate", { artifactId });
  return {
    status: result.status,
    ...(result.artifactId ? { artifactId: result.artifactId } : {}),
  };
}
