import { setTimeout as delay } from "node:timers/promises";
import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaVideoJob,
} from "@rakazo/adapter-kit";
import {
  allMediaModelsFailedError,
  MediaGenerationError,
  mediaGenerationFailureReason,
} from "@rakazo/adapter-kit";
import type { ModelSwitchAttempt } from "@rakazo/contracts";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import {
  buildModelSwitches,
  createModelSwitchAttempt,
  recordModelSwitchAttempt,
} from "@rakazo/core";
import { z } from "zod";
import { FAKE_VIDEO_BASE64 } from "./fake-media-assets.js";
import { sanitizeProviderError } from "./pi-runtime-errors.js";
import type { ResolveHostname } from "./web-ssrf.js";
import { fetchSafeWebBytes } from "./web-ssrf.js";

export const mediaPromptSchema = z.object({ prompt: z.string().trim().min(1).max(4000) });
export function validateGeneratedMedia(
  output: GeneratedMedia,
  mimeType: GeneratedMedia["mimeType"],
) {
  if (output.mimeType !== mimeType || !output.bytes.byteLength) {
    throw new MediaGenerationError("provider_failure");
  }
  if (output.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new MediaGenerationError("output_limit");
  }
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new MediaGenerationError("output_limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MediaGenerationError("provider_failure");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new MediaGenerationError("output_limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

const queueJob = z.object({
  request_id: z.string().min(1),
  status_url: z.string(),
  response_url: z.string(),
});
const savedQueueJob = z.object({ status: z.string(), response: z.string() });
const queueStatus = z.object({
  status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
  error: z.unknown().optional(),
});
const fileResult = z.object({ url: z.string().url() });

/** fal queue HTTP protocol; model-specific parameters stay within this adapter. */
export class FalMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "fal";
  readonly capabilities;
  private readonly baseUrl: string;
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      imageModel?: string;
      videoModel?: string;
      fetch?: typeof fetch;
      resolveHostname?: ResolveHostname;
    },
  ) {
    const url = new URL(options.baseUrl ?? "https://queue.fal.run");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid media generation base URL");
    this.baseUrl = url.href.replace(/\/$/, "");
    for (const model of [options.imageModel, options.videoModel]) {
      if (model && !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)+$/.test(model))
        throw new Error("Invalid media model endpoint");
    }
    this.capabilities = {
      images: Boolean(options.imageModel),
      video: Boolean(options.videoModel),
      offline: false,
    };
  }
  private path(raw: string) {
    const url = new URL(raw, `${this.baseUrl}/`);
    if (
      url.origin !== new URL(this.baseUrl).origin ||
      !url.href.startsWith(`${this.baseUrl}/`) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new MediaGenerationError("provider_failure");
    return url.href;
  }
  private async request(path: string, context: AdapterContext, body?: unknown): Promise<unknown> {
    context.signal.throwIfAborted();
    try {
      const response = await (this.options.fetch ?? fetch)(this.path(path), {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Key ${this.options.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MediaGenerationError(
          response.status === 429
            ? "rate_limit"
            : [401, 403].includes(response.status)
              ? "authentication"
              : "provider_failure",
        );
      }
      return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 100_000)));
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof MediaGenerationError) throw error;
      throw new MediaGenerationError("provider_failure");
    }
  }
  private async submit(input: MediaGenerationInput, video: boolean, context: AdapterContext) {
    const model = video ? this.options.videoModel : this.options.imageModel;
    if (!model) throw new MediaGenerationError("unsupported");
    const parsed = mediaPromptSchema.safeParse(input);
    if (!parsed.success) throw new MediaGenerationError("invalid_input");
    const job = queueJob.safeParse(
      await this.request(`${this.baseUrl}/${model}`, context, {
        prompt: parsed.data.prompt,
        ...(video
          ? { num_frames: 65, frames_per_second: 16, resolution: "480p" }
          : { num_images: 1, image_size: "square", output_format: "png" }),
      }),
    );
    if (!job.success) throw new MediaGenerationError("provider_failure");
    return JSON.stringify({
      status: this.path(job.data.status_url),
      response: this.path(job.data.response_url),
    });
  }
  private async poll(id: string, context: AdapterContext) {
    let job: z.infer<typeof savedQueueJob>;
    try {
      job = savedQueueJob.parse(JSON.parse(id));
    } catch {
      throw new MediaGenerationError("invalid_input");
    }
    const status = queueStatus.safeParse(await this.request(job.status, context));
    if (!status.success) throw new MediaGenerationError("provider_failure");
    if (status.data.error) return { status: "failed" as const };
    if (status.data.status !== "COMPLETED")
      return {
        status: status.data.status === "IN_QUEUE" ? ("queued" as const) : ("running" as const),
      };
    return { status: "completed" as const, value: await this.request(job.response, context) };
  }
  private async download(
    value: unknown,
    video: boolean,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    const parsed = (
      video
        ? z.object({ video: fileResult }).transform((v) => v.video)
        : z.object({ images: z.array(fileResult).length(1) }).transform((v) => v.images[0]!)
    ).safeParse(value);
    if (!parsed.success) throw new MediaGenerationError("provider_failure");
    try {
      // Output URLs are untrusted. Pin public DNS, reject private addresses and redirects;
      // no API credential is ever sent to the output host.
      const result = await fetchSafeWebBytes(parsed.data.url, {
        fetch: this.options.fetch,
        resolveHostname: this.options.resolveHostname,
        signal: context.signal,
        maxBytes: ATTACHMENT_MAX_BYTES,
        maxRedirects: 0,
        timeoutMs: 60_000,
      });
      const mimeType = video ? "video/mp4" : "image/png";
      if (result.contentType?.split(";")[0]?.trim().toLowerCase() !== mimeType)
        throw new MediaGenerationError("provider_failure");
      const output = { bytes: result.body, mimeType } as GeneratedMedia;
      validateGeneratedMedia(output, mimeType);
      return output;
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof MediaGenerationError) throw error;
      throw new MediaGenerationError(
        error instanceof Error && error.message.includes("too large")
          ? "output_limit"
          : "provider_failure",
      );
    }
  }
  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    context = {
      ...context,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(180_000)]),
    };
    const id = await this.submit(input, false, context);
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await this.poll(id, context);
      if (job.status === "completed") return this.download(job.value, false, context);
      if (job.status === "failed") throw new MediaGenerationError("provider_failure");
      await delay(1000, undefined, { signal: context.signal });
    }
    throw new MediaGenerationError("provider_failure");
  }
  async generateVideo(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    return { id: await this.submit(input, true, context), status: "queued" };
  }
  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    const job = await this.poll(id, context);
    return job.status === "completed"
      ? { id, status: "completed", output: await this.download(job.value, true, context) }
      : { id, status: job.status };
  }
}

/** Deterministic provider; no network or billing. */
export class FakeMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "fake";
  readonly capabilities = { images: true, video: true, offline: true };
  async generateImage(
    _input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    context.signal.throwIfAborted();
    return {
      mimeType: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
        "base64",
      ),
    };
  }
  async generateVideo(
    _input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    context.signal.throwIfAborted();
    return { id: "fake-video", status: "queued", progress: 0 };
  }
  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    context.signal.throwIfAborted();
    return {
      id,
      status: "completed",
      output: {
        mimeType: "video/mp4",
        bytes: Buffer.from(FAKE_VIDEO_BASE64, "base64"),
      },
    };
  }
}

/** The job id of a video a chat model returned inline; there is nothing to poll. */
export const CHAT_MEDIA_VIDEO_JOB_ID = "chat-media-video";

/** One bot-configured model to try, in list order. */
export type BotMediaCallEntry = {
  modelId: string;
  /** The provider id this model runs on, for error sanitizing; absent in older callers. */
  provider?: string;
  /** The connection display name the model runs on; absent when unknown. */
  providerLabel?: string;
  /** The prompt preset applied by this call; absent when no preset was active. */
  presetName?: string;
  call: (prompt: string, signal: AbortSignal) => Promise<GeneratedMedia>;
};

/** One bot-configured model that could not even be reached, with why. */
export type BotMediaFailure = {
  modelId: string;
  reason: string;
  /** The connection display name the model runs on; absent when unknown. */
  providerLabel?: string;
  /** Short failure class for the timeline label (e.g. rate_limit, connection). */
  errorCode?: string;
  /** Sanitized failure detail, truncated to 300 characters; never contains secrets. */
  errorMessage?: string;
};

/** One tried model that failed, and the next model the chain will try, if any. */
export type BotMediaModelFailure = BotMediaFailure & { nextModelId?: string };

/** One kind's ordered tries: the calls that resolved, plus the entries that did not. */
export type BotMediaKindCalls = {
  calls: BotMediaCallEntry[];
  failures: BotMediaFailure[];
};

/**
 * A media provider that answers each kind from a bot's configured models,
 * tried in order, or the global provider when the bot has none for that kind.
 * The chat model returns the finished media inline, so its video is already
 * complete and never needs polling. The id stays the fallback's so a job the
 * fallback submitted still polls under the provider that saved it.
 */
export class BotMediaGenerationProvider implements MediaGenerationProvider {
  readonly id: string;
  readonly capabilities: { images: boolean; video: boolean; offline: boolean };
  /** Called for each tried model that fails; never breaks the fallback chain. */
  onModelFailed?: (failure: BotMediaModelFailure) => void;
  constructor(
    private readonly image: BotMediaKindCalls,
    private readonly video: BotMediaKindCalls,
    private readonly fallback?: MediaGenerationProvider,
  ) {
    this.id = fallback?.id ?? "bot-media";
    this.capabilities = {
      images: Boolean(image.calls.length > 0 || fallback?.capabilities.images),
      video: Boolean(video.calls.length > 0 || fallback?.capabilities.video),
      offline: fallback?.capabilities.offline ?? false,
    };
  }
  private async tryCalls(
    kind: BotMediaKindCalls,
    input: MediaGenerationInput,
    signal: AbortSignal,
  ): Promise<GeneratedMedia> {
    const failures: BotMediaFailure[] = [...kind.failures];
    // The timeline, in try order: models that never resolved were skipped,
    // each call that failed is a failed attempt, and the model that answered
    // closes it. Only a real switch is kept on the finished media.
    const attempts: ModelSwitchAttempt[] = kind.failures.map((failure) =>
      createModelSwitchAttempt({
        model: failure.modelId,
        provider: failure.providerLabel,
        outcome: "skipped",
        error: failure.reason,
      }),
    );
    for (let index = 0; index < kind.calls.length; index++) {
      const entry = kind.calls[index]!;
      try {
        const output = await entry.call(input.prompt, signal);
        recordModelSwitchAttempt(
          attempts,
          createModelSwitchAttempt({
            model: entry.modelId,
            provider: entry.providerLabel,
            outcome: "succeeded",
          }),
        );
        const modelSwitches = buildModelSwitches(attempts);
        return {
          ...output,
          modelId: entry.modelId,
          ...(entry.presetName ? { presetName: entry.presetName } : {}),
          ...(modelSwitches ? { modelSwitches } : {}),
        };
      } catch (error) {
        signal.throwIfAborted();
        const raw = error instanceof Error ? error.message : String(error);
        // A coded provider error names its class directly; an uncoded one is
        // classified from its message instead.
        const errorCode =
          error instanceof MediaGenerationError && error.code !== "provider_failure"
            ? error.code
            : undefined;
        const attempt = createModelSwitchAttempt({
          model: entry.modelId,
          provider: entry.providerLabel,
          outcome: "failed",
          error: sanitizeProviderError(entry.provider ?? "", raw),
          ...(errorCode ? { errorCode } : {}),
        });
        recordModelSwitchAttempt(attempts, attempt);
        const failure: BotMediaFailure = {
          modelId: entry.modelId,
          reason: mediaGenerationFailureReason(error),
          ...(entry.providerLabel ? { providerLabel: entry.providerLabel } : {}),
          ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}),
          ...(attempt.errorMessage ? { errorMessage: attempt.errorMessage } : {}),
        };
        failures.push(failure);
        try {
          this.onModelFailed?.({ ...failure, nextModelId: kind.calls[index + 1]?.modelId });
        } catch {
          // A failing notifier must never break the fallback chain.
        }
      }
    }
    throw allMediaModelsFailedError(failures);
  }
  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    if (this.image.calls.length > 0) return this.tryCalls(this.image, input, context.signal);
    if (this.fallback) return this.fallback.generateImage(input, context);
    throw new MediaGenerationError("unsupported");
  }
  async generateVideo(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    if (this.video.calls.length > 0) {
      const output = await this.tryCalls(this.video, input, context.signal);
      return { id: CHAT_MEDIA_VIDEO_JOB_ID, status: "completed", output };
    }
    if (this.fallback) return this.fallback.generateVideo(input, context);
    throw new MediaGenerationError("unsupported");
  }
  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    if (id === CHAT_MEDIA_VIDEO_JOB_ID) return { id, status: "failed" };
    if (this.fallback) return this.fallback.pollVideo(id, context);
    throw new MediaGenerationError("unsupported");
  }
}
