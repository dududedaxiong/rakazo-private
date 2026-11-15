// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { getSupplementaryPrompt, regenerateMedia, setSupplementaryPrompt } from "./media-rpc";

function mediaRpc(result: Record<string, unknown>) {
  return { media: result } as never;
}

describe("media rpc", () => {
  it("returns the saved supplementary prompt", async () => {
    const rpc = mediaRpc({
      getSupplementaryPrompt: vi.fn(async () => ({
        supplementaryPrompt: "bluer sky",
        presetName: "Cartoon",
      })),
    });
    await expect(getSupplementaryPrompt(rpc, "art-1")).resolves.toBe("bluer sky");
  });

  it("treats a failed supplementary prompt read as empty", async () => {
    const rpc = mediaRpc({
      getSupplementaryPrompt: vi.fn(async () => {
        throw new Error("gone");
      }),
    });
    await expect(getSupplementaryPrompt(rpc, "art-1")).resolves.toBe("");
  });

  it("saves and regenerates through the media namespace", async () => {
    const set = vi.fn(async () => ({ ok: true as const }));
    const regenerate = vi.fn(async () => ({
      ok: true as const,
      status: "queued" as const,
    }));
    const rpc = mediaRpc({ setSupplementaryPrompt: set, regenerate });
    await setSupplementaryPrompt(rpc, "art-1", "bluer sky");
    expect(set).toHaveBeenCalledExactlyOnceWith({
      artifactId: "art-1",
      supplementaryPrompt: "bluer sky",
    });
    await expect(regenerateMedia(rpc, "art-1")).resolves.toEqual({
      ok: true,
      status: "queued",
    });
    expect(regenerate).toHaveBeenCalledExactlyOnceWith({ artifactId: "art-1" });
  });
});
