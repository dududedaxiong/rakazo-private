import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("./api", () => ({ rpc: mocks.rpc }));

beforeEach(() => {
  mocks.rpc.mockClear();
});

import {
  getSupplementaryPrompt,
  regenerateMedia,
  setSupplementaryPrompt,
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
});
