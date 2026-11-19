import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("./api", () => ({ rpc: mocks.rpc }));

beforeEach(() => {
  mocks.rpc.mockClear();
});

import {
  getSupplementaryPrompt,
  hasEditModels,
  isNoEditModelError,
  needsEditDialog,
  regenerateMedia,
  setSupplementaryPrompt,
  uploadReferenceImage,
} from "./media-supplementary";

describe("media supplementary prompt RPC", () => {
  it("returns the saved prompt and optional preset and model", async () => {
    mocks.rpc.mockResolvedValue({
      supplementaryPrompt: "让天空更蓝一些",
      presetName: "卡通",
      modelId: "model-a",
    });
    await expect(getSupplementaryPrompt("artifact-1")).resolves.toEqual({
      supplementaryPrompt: "让天空更蓝一些",
      presetName: "卡通",
      modelId: "model-a",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("media/getSupplementaryPrompt", {
      artifactId: "artifact-1",
    });
  });

  it("saves a prompt", async () => {
    mocks.rpc.mockResolvedValue({ ok: true });
    await expect(setSupplementaryPrompt("artifact-1", "更蓝一些")).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("media/setSupplementaryPrompt", {
      artifactId: "artifact-1",
      supplementaryPrompt: "更蓝一些",
    });
  });
});

describe("media regenerate RPC", () => {
  it("returns completed with a new artifact id, and queued without one", async () => {
    mocks.rpc.mockResolvedValue({ ok: true, status: "completed", artifactId: "artifact-2" });
    await expect(regenerateMedia("artifact-1")).resolves.toEqual({
      status: "completed",
      artifactId: "artifact-2",
    });
    mocks.rpc.mockResolvedValue({ ok: true, status: "queued" });
    await expect(regenerateMedia("artifact-1")).resolves.toEqual({ status: "queued" });
    expect(mocks.rpc).toHaveBeenCalledWith("media/regenerate", { artifactId: "artifact-1" });
  });

  it("sends mode edit alone for an image edit, and edit plus reference for a video edit", async () => {
    mocks.rpc.mockResolvedValue({ ok: true, status: "queued" });
    await regenerateMedia("artifact-1", { mode: "edit" });
    expect(mocks.rpc).toHaveBeenCalledWith("media/regenerate", {
      artifactId: "artifact-1",
      mode: "edit",
    });
    mocks.rpc.mockResolvedValue({ ok: true, status: "queued" });
    await regenerateMedia("artifact-2", { mode: "edit", referenceArtifactId: "ref-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("media/regenerate", {
      artifactId: "artifact-2",
      mode: "edit",
      referenceArtifactId: "ref-1",
    });
  });

  it("sends mode random explicitly", async () => {
    mocks.rpc.mockResolvedValue({ ok: true, status: "completed", artifactId: "artifact-9" });
    await expect(regenerateMedia("artifact-1", { mode: "random" })).resolves.toEqual({
      status: "completed",
      artifactId: "artifact-9",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("media/regenerate", {
      artifactId: "artifact-1",
      mode: "random",
    });
  });
});

describe("hasEditModels", () => {
  const bot = (overrides: {
    imageEditModels?: { provider: string; model: string }[] | null;
    videoEditModels?: { provider: string; model: string }[] | null;
  }) => ({ imageEditModels: null, videoEditModels: null, ...overrides });

  it("is false without a bot or with empty lists", () => {
    expect(hasEditModels(null, "image")).toBe(false);
    expect(hasEditModels(undefined, "video")).toBe(false);
    expect(hasEditModels(bot({}), "image")).toBe(false);
    expect(hasEditModels(bot({ imageEditModels: [] }), "image")).toBe(false);
  });

  it("reads each kind from its own list", () => {
    const entry = { provider: "zhipu", model: "glm-image" };
    expect(hasEditModels(bot({ imageEditModels: [entry] }), "image")).toBe(true);
    expect(hasEditModels(bot({ imageEditModels: [entry] }), "video")).toBe(false);
    expect(hasEditModels(bot({ videoEditModels: [entry] }), "video")).toBe(true);
    expect(hasEditModels(bot({ videoEditModels: [entry] }), "image")).toBe(false);
  });
});

describe("needsEditDialog", () => {
  it("always opens the dialog for a video, to collect a reference image", () => {
    expect(needsEditDialog("video", "make it dreamy")).toBe(true);
    expect(needsEditDialog("video", "")).toBe(true);
  });

  it("opens the dialog for an image only when the prompt is empty", () => {
    expect(needsEditDialog("image", "make it dreamy")).toBe(false);
    expect(needsEditDialog("image", "")).toBe(true);
    expect(needsEditDialog("image", "   ")).toBe(true);
    expect(needsEditDialog("image", null)).toBe(true);
  });
});

describe("isNoEditModelError", () => {
  it("matches the server's no-edit-model refusal", () => {
    expect(
      isNoEditModelError(new Error("这个机器人还没有配置编辑模型，请先在影图模型设置里添加")),
    ).toBe(true);
    expect(isNoEditModelError(new Error("rate limited"))).toBe(false);
    expect(isNoEditModelError("boom")).toBe(false);
  });
});

describe("uploadReferenceImage", () => {
  it("creates an artifact under the bot and returns its id", async () => {
    mocks.rpc.mockResolvedValue({ id: "ref-1" });
    const id = await uploadReferenceImage("bot-1", "artifact-1", {
      name: "reference.jpg",
      mimeType: "image/jpeg",
      contentBase64: "aGVsbG8=",
    });
    expect(id).toBe("ref-1");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "artifacts/create",
      expect.objectContaining({
        botId: "bot-1",
        name: "reference.jpg",
        mimeType: "image/jpeg",
        contentBase64: "aGVsbG8=",
      }),
    );
    const input = mocks.rpc.mock.calls[0]?.[1] as { clientNonce?: string };
    expect(input.clientNonce).toMatch(/^reference:artifact-1:/);
  });
});
