import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AgentInputImage,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo_mickvvw/adapter-kit";
import type { MessageBlock, ModelRole } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { appliedModelRole, recordUsage } from "@rakazo_mickvvw/db";
import { getLogger } from "@rakazo_mickvvw/logging";
import type { ExecutorDeps } from "./executor-deps.js";

/** One vision call may run this long; the main turn waits for it. */
export const MEDIA_ANALYSIS_TIMEOUT_MS = 30_000;
/** Images are shrunk to this long edge before the vision model sees them. */
export const IMAGE_ANALYSIS_LONG_EDGE = 1024;
/** JPEG quality for images sent to the vision model. */
export const IMAGE_ANALYSIS_JPEG_QUALITY = 80;
/** Video frames are sampled about this often. */
export const VIDEO_KEYFRAME_INTERVAL_SECONDS = 10;
/** No video sends more frames than this. */
export const VIDEO_KEYFRAME_MAX_FRAMES = 8;

const execFileAsync = promisify(execFile);

type UsageEvent = Extract<AgentRuntimeEvent, { type: "usage" }>;

export type TurnMediaImage = {
  name: string;
  mimeType: AgentInputImage["mimeType"];
  data: Uint8Array;
};
export type TurnMediaVideo = { name: string; mimeType: string; data: Uint8Array };

/** A command runner: the production one shells out, tests substitute a fake. */
export type MediaCommandRunner = (command: string, args: string[]) => Promise<string>;

async function runCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { timeout: MEDIA_ANALYSIS_TIMEOUT_MS });
  return stdout;
}

function isMissingCommandError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      /ENOENT/.test(error instanceof Error ? error.message : String(error)))
  );
}

/** One line of a failure listing: the model and why it failed, kept short. */
function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  return message ? message.replace(/\s+/g, " ").slice(0, 80) : "failed";
}

/**
 * Shrink an image for the vision model: long edge 1024px, JPEG quality 80.
 * GIFs lose animation; recognition only needs one still.
 */
export async function compressImageForAnalysis(
  image: TurnMediaImage,
): Promise<{ name: string; mimeType: "image/jpeg"; data: Uint8Array }> {
  // sharp is a native addon; load it only when an image is processed.
  const { default: sharp } = await import("sharp");
  const data = await sharp(image.data)
    .rotate()
    .resize(IMAGE_ANALYSIS_LONG_EDGE, IMAGE_ANALYSIS_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: IMAGE_ANALYSIS_JPEG_QUALITY })
    .toBuffer();
  return { name: image.name, mimeType: "image/jpeg", data: new Uint8Array(data) };
}

/**
 * Frame timestamps for a video of `durationSeconds`: about one per 10 seconds,
 * at most 8, spread evenly so the summary covers the whole clip.
 */
export function selectVideoKeyframeTimestamps(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  const count = Math.min(
    VIDEO_KEYFRAME_MAX_FRAMES,
    Math.max(1, Math.floor(durationSeconds / VIDEO_KEYFRAME_INTERVAL_SECONDS)),
  );
  return Array.from({ length: count }, (_, index) => durationSeconds * ((index + 0.5) / count));
}

function videoExtension(mimeType: string): string {
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  return "mp4";
}

async function probeVideoDurationSeconds(
  inputPath: string,
  run: MediaCommandRunner,
): Promise<number | null> {
  try {
    const stdout = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      inputPath,
    ]);
    const parsed = JSON.parse(stdout) as { format?: { duration?: unknown } };
    const duration = Number(parsed.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

/**
 * Pull keyframes out of a video with ffmpeg, compressed for the vision model.
 * Throws when ffmpeg is missing or the video cannot be read; the caller turns
 * that into a "could not be analyzed" note, never a failed run.
 */
export async function extractVideoKeyframes(
  video: TurnMediaVideo,
  run: MediaCommandRunner = runCommand,
): Promise<AgentInputImage[]> {
  const dir = await mkdtemp(join(tmpdir(), "rakazo-media-"));
  try {
    const inputPath = join(dir, `input.${videoExtension(video.mimeType)}`);
    await writeFile(inputPath, video.data);
    const duration = await probeVideoDurationSeconds(inputPath, run);
    const timestamps = selectVideoKeyframeTimestamps(duration ?? 0);
    const frames: AgentInputImage[] = [];
    if (duration === null) {
      // No duration: one ffmpeg pass with an fps filter instead of timestamps.
      const pattern = join(dir, "frame-%02d.jpg");
      await run("ffmpeg", [
        "-v",
        "error",
        "-i",
        inputPath,
        "-vf",
        `fps=1/${VIDEO_KEYFRAME_INTERVAL_SECONDS}`,
        "-frames:v",
        String(VIDEO_KEYFRAME_MAX_FRAMES),
        pattern,
      ]);
      for (let index = 1; index <= VIDEO_KEYFRAME_MAX_FRAMES; index += 1) {
        const path = join(dir, `frame-${String(index).padStart(2, "0")}.jpg`);
        const data = await readFile(path).catch(() => null);
        if (!data) break;
        frames.push(
          await compressImageForAnalysis({
            name: `${video.name} (frame ${index})`,
            mimeType: "image/jpeg",
            data,
          }),
        );
      }
      return frames;
    }
    for (const [index, timestamp] of timestamps.entries()) {
      const path = join(dir, `frame-${index}.jpg`);
      await run("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(timestamp),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        path,
      ]);
      const data = await readFile(path);
      frames.push(
        await compressImageForAnalysis({
          name: `${video.name} (frame ${index + 1} at ${Math.round(timestamp)}s)`,
          mimeType: "image/jpeg",
          data,
        }),
      );
    }
    return frames;
  } catch (error) {
    if (isMissingCommandError(error)) throw new Error("ffmpeg is not installed");
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The video file blocks of this turn, with their bytes read from the artifact store. */
export async function loadCurrentTurnVideos(
  deps: Pick<ExecutorDeps, "prisma" | "artifacts">,
  blocks: MessageBlock[] | undefined,
  context: {
    operationId: string;
    traceId: string;
    spaceId: string;
    userId: string;
    botId: string;
    runId: string;
    signal: AbortSignal;
  },
): Promise<TurnMediaVideo[] | undefined> {
  if (!deps.artifacts || !blocks?.length) return undefined;
  const videoBlocks = blocks.filter(
    (block): block is Extract<MessageBlock, { kind: "file" }> =>
      block.kind === "file" && block.mimeType.startsWith("video/"),
  );
  if (!videoBlocks.length) return undefined;
  const rows = await deps.prisma.artifact.findMany({
    where: {
      id: { in: videoBlocks.map((block) => block.artifactId) },
      spaceId: context.spaceId,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const videos: TurnMediaVideo[] = [];
  for (const block of videoBlocks) {
    const row = byId.get(block.artifactId);
    if (!row) continue;
    try {
      const bytes = await deps.artifacts.get(row.storageKey, context);
      videos.push({ name: block.name, mimeType: block.mimeType, data: bytes });
    } catch (error) {
      if (context.signal.aborted) throw error;
    }
  }
  return videos.length ? videos : undefined;
}

export type MediaAnalyzerDeps = {
  prisma: Pick<
    PrismaClient,
    "spaceModelRoleChoice" | "userModelRoleChoice" | "spaceSettingOverride" | "$transaction"
  >;
  runtime: AgentRuntime;
  /** Same seam the executor resolves fallback models with. */
  resolveConnectedModel: (
    scope: { userId: string; spaceId: string },
    provider: string,
    modelId: string,
    registerSecrets?: (values: string[]) => void,
    requireStoredSecret?: boolean,
    thinkingLevel?: string | null,
    credentialId?: string,
  ) => Promise<AgentRunRequest["model"]>;
  /** Secrets the vision call reveals, so the main run redacts them too. */
  registerSecrets?: (values: string[]) => void;
  /** Test seam; production calls time out after 30 seconds. */
  timeoutMs?: number;
  /** Test seam; production shells out to ffmpeg. */
  extractFrames?: (video: TurnMediaVideo) => Promise<AgentInputImage[]>;
};

export type TurnMediaInput = {
  /** Images whose bytes loaded; names cover every image block, loaded or not. */
  images: TurnMediaImage[];
  imageNames: string[];
  /** Videos whose bytes loaded; names cover every video block, loaded or not. */
  videos: TurnMediaVideo[];
  videoNames: string[];
};

/** The analysis of one attachment kind, as a labeled context block or a short failure note. */
function mediaContextBlock(label: string, text: string): string {
  return `[Media analysis — ${label}]\n${text}`;
}

function mediaFailureNote(kind: string, label: string, reason: string): string {
  return `The attached ${kind} "${label}" could not be analyzed: ${reason}.`;
}

/**
 * Analyze this turn's attachments with the preset vision models and return the
 * context the main model reads. Every attachment is analyzed: images through
 * the image role, videos through the video role, each walking its main pool
 * then its backup pool. A failure never fails the run — the note says so and
 * the turn continues. Undefined only when the turn had no media at all.
 */
export async function analyzeTurnMedia(
  deps: MediaAnalyzerDeps,
  input: {
    scope: { userId: string; spaceId: string };
    botId: string;
    operationId: string;
    media: TurnMediaInput;
    signal?: AbortSignal;
  },
): Promise<string | undefined> {
  const { media } = input;
  if (!media.imageNames.length && !media.videoNames.length) return undefined;
  const parts: string[] = [];
  if (media.imageNames.length) {
    parts.push(await analyzeImages(deps, input, media));
  }
  for (const video of media.videos) {
    parts.push(await analyzeVideo(deps, input, video));
  }
  for (const name of media.videoNames) {
    if (!media.videos.some((video) => video.name === name)) {
      parts.push(mediaFailureNote("video", name, "the attachment could not be loaded"));
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

async function analyzeImages(
  deps: MediaAnalyzerDeps,
  input: {
    scope: { userId: string; spaceId: string };
    botId: string;
    operationId: string;
    signal?: AbortSignal;
  },
  media: TurnMediaInput,
): Promise<string> {
  const label = media.imageNames.join(", ");
  const loadedNames = new Set(media.images.map((image) => image.name));
  const missing = media.imageNames.filter((name) => !loadedNames.has(name));
  const compressed: AgentInputImage[] = [];
  for (const image of media.images) {
    try {
      compressed.push(await compressImageForAnalysis(image));
    } catch (error) {
      // Compression is best-effort: the vision model can still try the raw
      // bytes. The file name is never logged; attachment names stay private.
      getLogger().warn("media image did not compress", {
        reason: error instanceof Error ? error.message : String(error),
      });
      compressed.push(image);
    }
  }
  const notes: string[] = [];
  if (missing.length) {
    notes.push(
      ...missing.map((name) =>
        mediaFailureNote("image", name, "the attachment could not be loaded"),
      ),
    );
  }
  if (!compressed.length) {
    if (!notes.length) {
      notes.push(mediaFailureNote("image", label, "the attachment could not be loaded"));
    }
    return notes.join("\n");
  }
  const result = await analyzeWithRole(deps, input, "image", compressed, {
    prompt:
      "Describe the attached image(s) in detail: what is shown, any text visible, and anything notable.",
    instructions:
      "Describe the attached image(s) in detail: what is shown, any text visible, and anything notable. Be factual; do not guess what is not visible. Reply with the description only.",
  });
  if (result.ok) {
    return [mediaContextBlock(label, result.text), ...notes].filter(Boolean).join("\n");
  }
  const kind = media.imageNames.length > 1 ? "images" : "image";
  return [mediaFailureNote(kind, label, result.reason), ...notes].filter(Boolean).join("\n");
}

async function analyzeVideo(
  deps: MediaAnalyzerDeps,
  input: {
    scope: { userId: string; spaceId: string };
    botId: string;
    operationId: string;
    signal?: AbortSignal;
  },
  video: TurnMediaVideo,
): Promise<string> {
  let frames: AgentInputImage[];
  try {
    frames = deps.extractFrames
      ? await deps.extractFrames(video)
      : await extractVideoKeyframes(video);
  } catch (error) {
    return mediaFailureNote("video", video.name, shortReason(error));
  }
  if (!frames.length) {
    return mediaFailureNote("video", video.name, "no frames could be extracted");
  }
  const result = await analyzeWithRole(deps, input, "video", frames, {
    prompt: `These frames were taken from the video "${video.name}" in time order. Summarize what happens in the video, in sequence, and note any text visible.`,
    instructions:
      "Summarize the attached video frames in time order: what happens, in sequence, and any text visible. Be factual; do not guess what is not visible. Reply with the summary only.",
  });
  if (result.ok) return mediaContextBlock(`${video.name} (video)`, result.text);
  return mediaFailureNote("video", video.name, result.reason);
}

/**
 * One vision call per model, main pool first then backup pool. The first model
 * that answers with text wins; anything else moves to the next.
 */
async function analyzeWithRole(
  deps: MediaAnalyzerDeps,
  input: {
    scope: { userId: string; spaceId: string };
    botId: string;
    operationId: string;
    signal?: AbortSignal;
  },
  role: Extract<ModelRole, "image" | "video">,
  images: AgentInputImage[],
  prompts: { prompt: string; instructions: string },
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const { scope } = input;
  let settings: Awaited<ReturnType<typeof appliedModelRole>>;
  try {
    settings = await appliedModelRole(deps.prisma, scope, role);
  } catch {
    return { ok: false, reason: "the vision model could not be loaded" };
  }
  const choices = [...settings.mainPool, ...settings.backupPool];
  if (!choices.length) return { ok: false, reason: "no vision model is configured" };
  const failures: string[] = [];
  for (const choice of choices) {
    if (input.signal?.aborted) return { ok: false, reason: "cancelled" };
    let model: AgentRunRequest["model"];
    try {
      model = await deps.resolveConnectedModel(
        scope,
        choice.provider,
        choice.modelId,
        deps.registerSecrets,
        true,
        choice.thinkingLevel ?? null,
        choice.credentialId,
      );
    } catch {
      failures.push(`${choice.modelId} (not connected)`);
      continue;
    }
    try {
      const text = await analyzeOnce(deps, input, model, images, prompts);
      if (text) return { ok: true, text };
      failures.push(`${choice.modelId} (no text)`);
    } catch (error) {
      if (input.signal?.aborted) return { ok: false, reason: "cancelled" };
      failures.push(`${choice.modelId} (${shortReason(error)})`);
    }
  }
  getLogger().warn("media analysis failed", { role, reason: failures.join(", ") });
  return { ok: false, reason: failures.join(", ") };
}

/** One vision call with one model, through the same runtime the main run uses. */
async function analyzeOnce(
  deps: MediaAnalyzerDeps,
  input: {
    scope: { userId: string; spaceId: string };
    botId: string;
    operationId: string;
    signal?: AbortSignal;
  },
  model: AgentRunRequest["model"],
  images: AgentInputImage[],
  prompts: { prompt: string; instructions: string },
): Promise<string> {
  const timeoutMs = deps.timeoutMs ?? MEDIA_ANALYSIS_TIMEOUT_MS;
  const operationId = `${input.operationId}:media-analysis`;
  const record = async (event: UsageEvent) => {
    await recordUsage(deps.prisma, event, {
      ...input.scope,
      botId: input.botId,
      operationId,
      operationKind: "setup",
    });
  };
  let text = "";
  for await (const event of deps.runtime.run(
    {
      botId: input.botId,
      threadId: operationId,
      runId: operationId,
      usageOperationKind: "setup",
      onUsage: record,
      prompt: prompts.prompt,
      instructions: prompts.instructions,
      history: [],
      tools: [],
      model: { ...model, thinkingLevel: "off" },
      currentTurnImages: images,
      allowSilentEmpty: true,
    },
    {
      operationId,
      traceId: operationId,
      userId: input.scope.userId,
      spaceId: input.scope.spaceId,
      botId: input.botId,
      signal: AbortSignal.any(
        [input.signal, AbortSignal.timeout(timeoutMs)].filter((value): value is AbortSignal =>
          Boolean(value),
        ),
      ),
    },
  )) {
    if (event.type === "usage" && !event.accounted) await record(event);
    if (event.type === "done" && event.text) text = event.text;
  }
  return text.trim();
}
