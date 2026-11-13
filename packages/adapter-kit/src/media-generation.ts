import type { AdapterContext } from "./types.js";

export type MediaGenerationInput = { prompt: string };
export type GeneratedMedia = {
  bytes: Uint8Array;
  mimeType: "image/png" | "video/mp4";
  /** The bot-configured model that produced this media; absent for the global provider. */
  modelId?: string;
  /** The prompt preset applied to this media; absent when no preset was active. */
  presetName?: string;
};
export type MediaVideoJob =
  | { id: string; status: "queued" | "running"; progress?: number }
  | { id: string; status: "completed"; output: GeneratedMedia }
  | { id: string; status: "failed" };
export interface MediaGenerationProvider {
  readonly id: string;
  readonly capabilities: { images: boolean; video: boolean; offline: boolean };
  generateImage(input: MediaGenerationInput, context: AdapterContext): Promise<GeneratedMedia>;
  generateVideo(input: MediaGenerationInput, context: AdapterContext): Promise<MediaVideoJob>;
  pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob>;
}
export type MediaGenerationErrorCode =
  | "invalid_input"
  | "unsupported"
  | "authentication"
  | "rate_limit"
  | "provider_failure"
  | "output_limit"
  | "timeout";
export class MediaGenerationError extends Error {
  constructor(
    public readonly code: MediaGenerationErrorCode,
    /**
     * What the caller may show: for a fallback list that all failed, the
     * per-model reasons, e.g. "gpt-image-1 (rate limited), dall-e-3
     * (authentication failed)". Absent, the message is just the code.
     */
    public readonly detail?: string,
  ) {
    super(detail ? `Media generation: ${code} — ${detail}` : `Media generation: ${code}`);
    this.name = "MediaGenerationError";
  }
}

/** Short human reason for a media generation failure, for an all-fail listing. */
export function mediaGenerationFailureReason(error: unknown): string {
  if (!(error instanceof MediaGenerationError)) return "provider error";
  switch (error.code) {
    case "authentication":
      return "authentication failed";
    case "rate_limit":
      return "rate limited";
    case "output_limit":
      return "output too large";
    case "invalid_input":
      return "invalid input";
    case "unsupported":
      return "unsupported";
    case "timeout":
      return "timed out";
    default:
      return "provider error";
  }
}

/**
 * The error a fallback list throws when every model failed: it names each
 * model tried and why it failed, so the person sees what happened instead of
 * a bare failure.
 */
export function allMediaModelsFailedError(
  failures: readonly { modelId: string; reason: string }[],
): MediaGenerationError {
  const detail = failures.map((f) => `${f.modelId} (${f.reason})`);
  return new MediaGenerationError("provider_failure", detail.join(", "));
}
