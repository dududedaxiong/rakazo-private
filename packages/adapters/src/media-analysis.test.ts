import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo_mickvvw/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { MediaAnalyzerDeps, TurnMediaVideo } from "./media-analysis.js";
import {
  analyzeTurnMedia,
  compressImageForAnalysis,
  extractVideoKeyframes,
  selectVideoKeyframeTimestamps,
} from "./media-analysis.js";

const execFileAsync = promisify(execFile);

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer(),
  );
}

describe("compressImageForAnalysis", () => {
  it("shrinks the long edge to 1024px and emits JPEG quality 80", async () => {
    const data = await makePng(2048, 512);
    const compressed = await compressImageForAnalysis({
      name: "wide.png",
      mimeType: "image/png",
      data,
    });
    expect(compressed.mimeType).toBe("image/jpeg");
    expect(compressed.name).toBe("wide.png");
    // JPEG magic.
    expect([compressed.data[0], compressed.data[1]]).toEqual([0xff, 0xd8]);
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(compressed.data).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(256);
  });

  it("does not enlarge small images", async () => {
    const data = await makePng(100, 50);
    const compressed = await compressImageForAnalysis({
      name: "small.png",
      mimeType: "image/png",
      data,
    });
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(compressed.data).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(50);
  });
});

describe("selectVideoKeyframeTimestamps", () => {
  it("samples about one frame per 10 seconds, capped at 8", () => {
    expect(selectVideoKeyframeTimestamps(65).length).toBe(6);
    expect(selectVideoKeyframeTimestamps(25).length).toBe(2);
    expect(selectVideoKeyframeTimestamps(100).length).toBe(8);
    expect(selectVideoKeyframeTimestamps(5).length).toBe(1);
    expect(selectVideoKeyframeTimestamps(0)).toEqual([0]);
    expect(selectVideoKeyframeTimestamps(Number.NaN)).toEqual([0]);
  });

  it("spreads frames evenly across the clip, in order", () => {
    const stamps = selectVideoKeyframeTimestamps(65);
    expect(stamps[0]).toBeGreaterThan(0);
    expect(stamps.at(-1)).toBeLessThan(65);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });
});

describe("extractVideoKeyframes", () => {
  it("extracts keyframes from a real video with ffmpeg", async () => {
    const dir = join(tmpdir(), "rakazo-media-test");
    await execFileAsync("mkdir", ["-p", dir]);
    const inputPath = join(dir, "clip.mp4");
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=25:size=320x240:rate=10",
      "-c:v",
      "mpeg4",
      "-pix_fmt",
      "yuv420p",
      "-y",
      inputPath,
    ]);
    const data = await readFile(inputPath);
    const frames = await extractVideoKeyframes({ name: "clip.mp4", mimeType: "video/mp4", data });
    expect(frames.length).toBe(2);
    for (const frame of frames) {
      expect(frame.mimeType).toBe("image/jpeg");
      expect([frame.data[0], frame.data[1]]).toEqual([0xff, 0xd8]);
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("reports a missing ffmpeg instead of crashing", async () => {
    const missing = async () => {
      const error = new Error("spawn ffmpeg ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    };
    await expect(
      extractVideoKeyframes(
        { name: "clip.mp4", mimeType: "video/mp4", data: new Uint8Array([1, 2, 3]) },
        missing,
      ),
    ).rejects.toThrow("ffmpeg is not installed");
  });
});

type RoleRow = {
  userId: string;
  spaceId: string | null;
  role: string;
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
  credentialId: string | null;
};

function stubPrisma(rows: RoleRow[]) {
  return {
    userModelRoleChoice: {
      findMany: vi.fn(async ({ where }: { where: { userId: string; role: string } }) =>
        rows.filter((row) => row.userId === where.userId && row.role === where.role),
      ),
    },
    spaceModelRoleChoice: { findMany: vi.fn(async () => []) },
    spaceSettingOverride: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  };
}

function fakeRuntime(
  calls: AgentRunRequest[],
  answer: (request: AgentRunRequest) => string,
): AgentRuntime {
  return {
    describe: () => ({
      id: "fake",
      name: "fake",
      capabilities: { streaming: true, compaction: false, tools: false, scripted: false },
    }),
    run: async function* (request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
      calls.push(request);
      yield { type: "done", text: answer(request) };
    },
    abort: async () => undefined,
  } as unknown as AgentRuntime;
}

function analyzerDeps(overrides: Partial<MediaAnalyzerDeps> & { rows?: RoleRow[] }): {
  deps: MediaAnalyzerDeps;
  calls: AgentRunRequest[];
} {
  const calls: AgentRunRequest[] = [];
  const deps: MediaAnalyzerDeps = {
    prisma: stubPrisma(overrides.rows ?? []) as never,
    runtime: fakeRuntime(calls, () => "A red square on a white background."),
    resolveConnectedModel: async (_scope, _provider, modelId) => ({
      provider: "openai-compatible",
      id: modelId,
      label: modelId,
      apiKey: "secret",
    }),
    ...overrides,
  };
  return { deps, calls };
}

const scope = { userId: "user-one", spaceId: "space-one" };
const visionRows: RoleRow[] = [
  {
    userId: "user-one",
    spaceId: null,
    role: "image",
    provider: "openai-compatible",
    modelId: "vision-a",
    thinkingLevel: null,
    credentialId: null,
  },
  {
    userId: "user-one",
    spaceId: null,
    role: "image",
    provider: "openai-compatible",
    modelId: "vision-b",
    thinkingLevel: null,
    credentialId: null,
  },
];

describe("analyzeTurnMedia", () => {
  it("returns undefined when the turn had no media", async () => {
    const { deps } = analyzerDeps({});
    await expect(
      analyzeTurnMedia(deps, {
        scope,
        botId: "bot-one",
        operationId: "run-one",
        media: { images: [], imageNames: [], videos: [], videoNames: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it("analyzes images with the image role and labels the context", async () => {
    const { deps, calls } = analyzerDeps({ rows: visionRows });
    const data = await makePng(800, 600);
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: {
        images: [{ name: "photo.png", mimeType: "image/png", data }],
        imageNames: ["photo.png"],
        videos: [],
        videoNames: [],
      },
    });
    expect(context).toContain("[Media analysis — photo.png]");
    expect(context).toContain("A red square on a white background.");
    // The vision call got the compressed image, never the raw PNG.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.currentTurnImages?.[0]?.mimeType).toBe("image/jpeg");
    expect(calls[0]?.model.id).toBe("vision-a");
    expect(calls[0]?.tools).toEqual([]);
    expect(calls[0]?.history).toEqual([]);
  });

  it("falls back to the next model when the first fails", async () => {
    const { deps, calls } = analyzerDeps({
      rows: visionRows,
      resolveConnectedModel: async (_scope, _provider, modelId) => {
        if (modelId === "vision-a") throw new Error("connection refused");
        return {
          provider: "openai-compatible",
          id: modelId,
          label: modelId,
          apiKey: "secret",
        };
      },
    });
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: {
        images: [{ name: "photo.png", mimeType: "image/png", data: await makePng(100, 100) }],
        imageNames: ["photo.png"],
        videos: [],
        videoNames: [],
      },
    });
    expect(context).toContain("A red square on a white background.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model.id).toBe("vision-b");
  });

  it("injects a short note and continues when every vision model fails", async () => {
    const { deps, calls } = analyzerDeps({
      rows: visionRows,
      resolveConnectedModel: async () => {
        throw new Error("connection refused");
      },
    });
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: {
        images: [{ name: "photo.png", mimeType: "image/png", data: await makePng(100, 100) }],
        imageNames: ["photo.png"],
        videos: [],
        videoNames: [],
      },
    });
    expect(context).toContain('The attached image "photo.png" could not be analyzed:');
    expect(context).toContain("not connected");
    expect(calls).toHaveLength(0);
  });

  it("injects a note when no vision model is configured", async () => {
    const { deps } = analyzerDeps({ rows: [] });
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: {
        images: [{ name: "photo.png", mimeType: "image/png", data: await makePng(100, 100) }],
        imageNames: ["photo.png"],
        videos: [],
        videoNames: [],
      },
    });
    expect(context).toContain(
      'The attached image "photo.png" could not be analyzed: no vision model is configured.',
    );
  });

  it("notes images whose bytes could not be loaded", async () => {
    const { deps } = analyzerDeps({ rows: visionRows });
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: { images: [], imageNames: ["photo.png"], videos: [], videoNames: [] },
    });
    expect(context).toContain(
      'The attached image "photo.png" could not be analyzed: the attachment could not be loaded.',
    );
  });

  it("analyzes video frames through the video role, in time order", async () => {
    const videoRows: RoleRow[] = [
      {
        userId: "user-one",
        spaceId: null,
        role: "video",
        provider: "openai-compatible",
        modelId: "vision-video",
        thinkingLevel: null,
        credentialId: null,
      },
    ];
    const { deps, calls } = analyzerDeps({
      rows: videoRows,
      extractFrames: async (video: TurnMediaVideo) => [
        {
          name: `${video.name} (frame 1 at 5s)`,
          mimeType: "image/jpeg",
          data: await makePng(100, 100),
        },
        {
          name: `${video.name} (frame 2 at 15s)`,
          mimeType: "image/jpeg",
          data: await makePng(100, 100),
        },
      ],
    });
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: {
        images: [],
        imageNames: [],
        videos: [{ name: "clip.mp4", mimeType: "video/mp4", data: new Uint8Array([1, 2, 3]) }],
        videoNames: ["clip.mp4"],
      },
    });
    expect(context).toContain("[Media analysis — clip.mp4 (video)]");
    expect(context).toContain("A red square on a white background.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model.id).toBe("vision-video");
    expect(calls[0]?.currentTurnImages).toHaveLength(2);
  });

  it("notes a video when ffmpeg is missing, and the run continues", async () => {
    const { deps } = analyzerDeps({
      rows: [
        {
          userId: "user-one",
          spaceId: null,
          role: "video",
          provider: "openai-compatible",
          modelId: "vision-video",
          thinkingLevel: null,
          credentialId: null,
        },
      ],
      extractFrames: async () => {
        throw new Error("ffmpeg is not installed");
      },
    });
    const context = await analyzeTurnMedia(deps, {
      scope,
      botId: "bot-one",
      operationId: "run-one",
      media: {
        images: [],
        imageNames: [],
        videos: [{ name: "clip.mp4", mimeType: "video/mp4", data: new Uint8Array([1, 2, 3]) }],
        videoNames: ["clip.mp4"],
      },
    });
    expect(context).toContain(
      'The attached video "clip.mp4" could not be analyzed: ffmpeg is not installed.',
    );
  });
});
