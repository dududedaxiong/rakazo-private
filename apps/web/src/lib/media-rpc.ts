import type { createSpaceRpc } from "./rpc";

export type SupplementaryPromptResult = {
  supplementaryPrompt: string;
  presetName?: string;
  modelId?: string;
};

export type MediaRegenerateResult = {
  ok: true;
  status: "completed" | "queued";
  artifactId?: string;
};

/** The saved supplementary prompt for an artifact; a failed read is empty. */
export async function getSupplementaryPrompt(
  rpc: ReturnType<typeof createSpaceRpc>,
  artifactId: string,
): Promise<string> {
  try {
    const result = await rpc.media.getSupplementaryPrompt({ artifactId });
    return result?.supplementaryPrompt ?? "";
  } catch {
    return "";
  }
}

export async function setSupplementaryPrompt(
  rpc: ReturnType<typeof createSpaceRpc>,
  artifactId: string,
  supplementaryPrompt: string,
): Promise<void> {
  await rpc.media.setSupplementaryPrompt({ artifactId, supplementaryPrompt });
}

export async function regenerateMedia(
  rpc: ReturnType<typeof createSpaceRpc>,
  artifactId: string,
  options?: { mode?: "edit" | "random"; referenceArtifactId?: string },
): Promise<MediaRegenerateResult> {
  return rpc.media.regenerate({ artifactId, ...options });
}
