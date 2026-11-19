import type { AdapterContext } from "@rakazo_mickvvw/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@rakazo_mickvvw/contracts";
import { toolRequiresApproval } from "@rakazo_mickvvw/core";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { describe, expect, it, vi } from "vitest";
import { FakeMediaGenerationProvider } from "./media-generation-provider.js";
import { generateMediaFromTool } from "./media-generation-tools.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const run = { id: "run", threadId: "thread", botId: "bot", spaceId: "space", userId: "owner" };
const context: AdapterContext = {
  ...run,
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
function setup() {
  const provider = new FakeMediaGenerationProvider();
  const row = {
    id: "local-job",
    status: "media_pending",
    result: { provider: "fake", jobId: "remote-job" },
  };
  const externalEffect = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockResolvedValue({ ...row, status: "media_submitting", result: { provider: "fake" } }),
    update: vi.fn().mockResolvedValue(row),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const attach = vi.fn().mockResolvedValue({
    artifactId: "artifact",
    block: { kind: "image", artifactId: "artifact", name: "generated.png" },
  });
  const publish = vi.fn();
  const options = {
    name: "generate_image" as const,
    args: { prompt: "draw" } as Record<string, unknown>,
    executionId: "execution",
    provider,
    prisma: {
      externalEffect,
      artifact: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient,
    context,
    run,
    attach,
    publish,
  };
  return { options, externalEffect, provider, attach, publish, row };
}

describe("bot media tools", () => {
  it("uses existing approval and per-bot disable controls, hidden by default", () => {
    for (const name of ["generate_image", "generate_video"])
      expect(toolRequiresApproval(name, false)).toBe(true);
    const base = {
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "message",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
    };
    const names = (extra = {}) =>
      selectBuiltinToolsForRun({ ...base, ...extra }).map((tool) => tool.name);
    expect(names()).not.toContain("generate_image");
    expect(names()).not.toContain("generate_video");
    expect(names({ mediaImagesEnabled: true })).toContain("generate_image");
    expect(names({ mediaImagesEnabled: true })).not.toContain("generate_video");
    expect(names({ mediaVideoEnabled: true })).toContain("generate_video");
    expect(
      names({ trigger: "tickets", mediaImagesEnabled: true, mediaVideoEnabled: true }),
    ).not.toContain("generate_image");
    expect(
      names({ trigger: "tickets", mediaImagesEnabled: true, mediaVideoEnabled: true }),
    ).not.toContain("generate_video");
    expect(
      names({ mediaVideoEnabled: true, disabledBuiltinTools: ["generate_video"] }),
    ).not.toContain("generate_video");
  });
  it("reserves before generation and posts stored attachments", async () => {
    const { options, provider, attach, publish, externalEffect } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toEqual({
      status: "completed",
      artifactId: "artifact",
    });
    expect(externalEffect.create.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png" }),
      "generated-local-job.png",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid inputs before reserving or billing", async () => {
    const { options, externalEffect } = setup();
    for (const args of [{ prompt: " " }, { prompt: "draw", jobId: "job" }, { jobId: 42 }]) {
      expect(await generateMediaFromTool({ ...options, args })).toHaveProperty("error");
    }
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("enforces durable two-submission limit", async () => {
    const { options, externalEffect, provider } = setup();
    externalEffect.create.mockRejectedValue({ code: "P2002" });
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toMatchObject({
      error: expect.stringContaining("limit reached"),
    });
    expect(externalEffect.create).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not rebill a replayed execution", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(generate).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("submits and persists async jobs without posting a pending result as a message", async () => {
    const { options, externalEffect, publish } = setup();
    expect(await generateMediaFromTool({ ...options, name: "generate_video" })).toMatchObject({
      status: "queued",
      jobId: "local-job",
    });
    expect(externalEffect.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "media_pending", result: { provider: "fake", jobId: "fake-video" } },
      }),
    );
    expect(publish).not.toHaveBeenCalled();
  });
  it("scopes polling to the owner, bot and thread and never accepts arbitrary provider IDs", async () => {
    const { options, externalEffect, provider } = setup();
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({
        ...options,
        name: "generate_video",
        args: { jobId: "foreign" },
      }),
    ).toHaveProperty("error");
    expect(externalEffect.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign",
        kind: "media_generation_job",
        spaceId: "space",
        run: { userId: "owner", botId: "bot", threadId: "thread" },
      },
    });
    expect(poll).not.toHaveBeenCalled();
  });
  it("resumes a saved job and posts completed video once", async () => {
    const { options, externalEffect, row, provider, publish, attach } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toMatchObject({ status: "completed", artifactId: "artifact" });
    expect(poll).toHaveBeenCalledWith("remote-job", context);
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "video/mp4" }),
      "generated-local-job.mp4",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    externalEffect.findFirst.mockResolvedValue({
      ...row,
      result: { provider: "fake", artifactId: "artifact" },
    });
    await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it.each(["generate_image", "generate_video"] as const)(
    "recovers %s after storage succeeds and publication fails without generating again",
    async (name) => {
      const { options, externalEffect, row, provider, attach, publish } = setup();
      externalEffect.findFirst.mockResolvedValue({
        ...row,
        result: { ...row.result, artifactId: "artifact" },
      });
      const artifact = {
        id: "artifact",
        name: "generated.png",
        mimeType: "image/png",
        size: 4,
      };
      vi.mocked(options.prisma.artifact.findFirst).mockResolvedValue(artifact as never);
      const image = vi.spyOn(provider, "generateImage");
      const poll = vi.spyOn(provider, "pollVideo");
      publish.mockRejectedValueOnce(new Error("publication failed"));
      expect(
        await generateMediaFromTool({
          ...options,
          name,
          args: name === "generate_video" ? { jobId: row.id } : { prompt: "draw" },
        }),
      ).toHaveProperty("error");
      expect(
        await generateMediaFromTool({
          ...options,
          name,
          args: name === "generate_video" ? { jobId: row.id } : { prompt: "draw" },
        }),
      ).toEqual({ status: "completed", artifactId: artifact.id });
      expect(image).not.toHaveBeenCalled();
      expect(poll).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(
        [expect.objectContaining({ artifactId: artifact.id })],
        row.id,
        artifact.id,
        undefined,
        undefined,
      );
    },
  );
  it("recovers the model and preset mark from the saved job", async () => {
    const { options, externalEffect, row, publish } = setup();
    externalEffect.findFirst.mockResolvedValue({
      ...row,
      result: { ...row.result, artifactId: "artifact", modelId: "model-a", presetName: "水彩" },
    });
    const artifact = {
      id: "artifact",
      name: "generated.png",
      mimeType: "image/png",
      size: 4,
    };
    vi.mocked(options.prisma.artifact.findFirst).mockResolvedValue(artifact as never);
    expect(
      await generateMediaFromTool({ ...options, name: "generate_image", args: { prompt: "draw" } }),
    ).toEqual({ status: "completed", artifactId: "artifact", modelId: "model-a" });
    expect(publish).toHaveBeenCalledWith(
      [
        expect.objectContaining({ artifactId: artifact.id }),
        { kind: "text", text: "当前模型: model-a · 水彩" },
      ],
      row.id,
      artifact.id,
      "model-a",
      "水彩",
    );
  });
  it("never submits or reserves new work in recovery-only mode", async () => {
    const { options, externalEffect, provider } = setup();
    const submit = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool({ ...options, recoverOnly: true })).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("returns the existing running job when an interrupted poll is still claimed", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    externalEffect.updateMany.mockResolvedValue({ count: 0 });
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({
        ...options,
        name: "generate_video",
        args: { jobId: row.id },
        recoverOnly: true,
      }),
    ).toEqual({ jobId: row.id, status: "running" });
    expect(poll).not.toHaveBeenCalled();
  });
  it("does not concurrently poll a claimed job", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    externalEffect.updateMany.mockResolvedValue({ count: 0 });
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toHaveProperty("error");
    expect(poll).not.toHaveBeenCalled();
  });
  it("releases failed polling claims without resubmitting", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    vi.spyOn(provider, "pollVideo").mockRejectedValue(new Error("private provider failure"));
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toMatchObject({ error: expect.not.stringContaining("private") });
    expect(externalEffect.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, status: "media_polling" },
      data: { status: "media_pending" },
    });
  });
  it("rejects oversized or wrong-MIME adapter output before storage", async () => {
    const { options, provider, attach } = setup();
    vi.spyOn(provider, "generateImage")
      .mockResolvedValueOnce({
        bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1),
        mimeType: "image/png",
      })
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), mimeType: "video/mp4" });
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(attach).not.toHaveBeenCalled();
  });
  it("submitOnly reserves without calling the provider and replays the same job id", async () => {
    const { options, externalEffect, provider } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    const submit = { ...options, submitOnly: true, mode: "random" as const };
    expect(await generateMediaFromTool(submit)).toEqual({
      jobId: "local-job",
      status: "queued",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(externalEffect.create).toHaveBeenCalledTimes(1);
    expect(externalEffect.create.mock.calls[0]?.[0]?.data.request).toMatchObject({
      tool: "generate_image",
      prompt: "draw",
      executionId: "execution",
      mode: "random",
    });
    // The same execution id replays the reservation instead of reserving twice.
    externalEffect.findFirst.mockResolvedValue({
      id: "local-job",
      status: "media_submitting",
      result: { provider: "fake" },
    });
    expect(await generateMediaFromTool(submit)).toEqual({
      jobId: "local-job",
      status: "queued",
    });
    expect(externalEffect.create).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
  it("resume runs a reserved generation once and a racing worker sees it running", async () => {
    const { options, externalEffect, provider, attach, publish } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    const reserved = {
      id: "local-job",
      status: "media_submitting",
      result: { provider: "fake" },
    };
    externalEffect.findFirst.mockResolvedValue(reserved);
    expect(await generateMediaFromTool({ ...options, resume: true })).toEqual({
      status: "completed",
      artifactId: "artifact",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(externalEffect.updateMany).toHaveBeenCalledWith({
      where: { id: "local-job", status: "media_submitting" },
      data: { status: "media_polling" },
    });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    // The claim is gone: a second worker does not generate again.
    externalEffect.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await generateMediaFromTool({ ...options, resume: true })).toEqual({
      jobId: "local-job",
      status: "running",
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
