// @vitest-environment jsdom

import type { ChatModelChoice } from "@rakazo/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaModelGroup } from "./bot-settings-sections";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

const videoChoices: ChatModelChoice[] = [
  { key: "", label: "Not selected" },
  {
    key: "provider-a::video-a",
    label: "Video A",
    provider: "provider-a",
    modelId: "video-a",
  },
  {
    key: "provider-a::video-b",
    label: "Video B",
    provider: "provider-a",
    modelId: "video-b",
  },
];
const imageChoices: ChatModelChoice[] = [
  { key: "", label: "Not selected" },
  {
    key: "provider-a::image-a",
    label: "Image A",
    provider: "provider-a",
    modelId: "image-a",
  },
];

let root: Root;
let container: HTMLDivElement;
const onVideoModelChange = vi.fn();
const onRemoveVideoFallback = vi.fn();
const onImageModelChange = vi.fn();
const onRemoveImageFallback = vi.fn();
const onVideoPresetChange = vi.fn();
const onImagePresetChange = vi.fn();

async function renderGroup(
  overrides: {
    videoValue?: string;
    imageValue?: string;
    videoFallbacks?: { key: string; label: string }[];
    imageFallbacks?: { key: string; label: string }[];
    videoPresets?: { name: string; prompt: string }[];
    imagePresets?: { name: string; prompt: string }[];
    activeVideoPreset?: string | null;
    activeImagePreset?: string | null;
  } = {},
) {
  await act(async () =>
    root.render(
      <MediaModelGroup
        ids="media"
        videoChoices={videoChoices}
        videoValue={overrides.videoValue ?? ""}
        onVideoModelChange={onVideoModelChange}
        videoFallbacks={overrides.videoFallbacks ?? []}
        onRemoveVideoFallback={onRemoveVideoFallback}
        imageChoices={imageChoices}
        imageValue={overrides.imageValue ?? ""}
        onImageModelChange={onImageModelChange}
        imageFallbacks={overrides.imageFallbacks ?? []}
        onRemoveImageFallback={onRemoveImageFallback}
        videoPresets={overrides.videoPresets ?? []}
        activeVideoPreset={overrides.activeVideoPreset ?? null}
        onVideoPresetChange={onVideoPresetChange}
        imagePresets={overrides.imagePresets ?? []}
        activeImagePreset={overrides.activeImagePreset ?? null}
        onImagePresetChange={onImagePresetChange}
      />,
    ),
  );
}

async function setSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function selectById(id: string) {
  const select = container.querySelector<HTMLSelectElement>(`#${id}`);
  if (!select) throw new Error(`Missing select #${id}`);
  return select;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
  onVideoModelChange.mockReset();
  onRemoveVideoFallback.mockReset();
  onImageModelChange.mockReset();
  onRemoveImageFallback.mockReset();
  onVideoPresetChange.mockReset();
  onImagePresetChange.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MediaModelGroup", () => {
  it("shows Not selected for unpicked roles and picks a model on change", async () => {
    await renderGroup();
    expect(container.textContent).toContain("Media model");
    expect(container.textContent).toContain("Video generation model");
    expect(container.textContent).toContain("Image generation model");
    expect(selectById("media-video-model").value).toBe("");
    expect(selectById("media-image-model").value).toBe("");
    await setSelect(selectById("media-video-model"), "provider-a::video-a");
    expect(onVideoModelChange).toHaveBeenCalledWith("provider-a::video-a");
    await setSelect(selectById("media-image-model"), "provider-a::image-a");
    expect(onImageModelChange).toHaveBeenCalledWith("provider-a::image-a");
  });

  it("shows the current video and image models", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      imageValue: "provider-a::image-a",
    });
    expect(selectById("media-video-model").value).toBe("provider-a::video-a");
    expect(selectById("media-video-model").selectedOptions[0]?.textContent).toContain("Video A");
    expect(selectById("media-image-model").value).toBe("provider-a::image-a");
    expect(selectById("media-image-model").selectedOptions[0]?.textContent).toContain("Image A");
  });

  it("shows the active preset, picks another, and clears it", async () => {
    await renderGroup({
      videoPresets: [
        { name: "水彩", prompt: "用水彩风格画" },
        { name: "赛博", prompt: "赛博朋克风格" },
      ],
      activeVideoPreset: "水彩",
    });
    expect(container.textContent).toContain("Video prompt preset");
    // No preset row for image: it has no presets.
    expect(container.textContent).not.toContain("Image prompt preset");
    expect(selectById("media-video-preset").value).toBe("水彩");
    await setSelect(selectById("media-video-preset"), "赛博");
    expect(onVideoPresetChange).toHaveBeenCalledWith("赛博");
    await setSelect(selectById("media-video-preset"), "");
    expect(onVideoPresetChange).toHaveBeenCalledWith(null);
  });

  it("lists fallback models and removes one", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
    });
    expect(container.textContent).toContain("Fallback models");
    expect(container.textContent).toContain("Video B");
    const remove = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove fallback model"]',
    );
    expect(remove).not.toBeNull();
    await act(async () => remove!.click());
    expect(onRemoveVideoFallback).toHaveBeenCalledWith("provider-a::video-b");
  });

  it("does not show an opaque fallback name directly", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoFallbacks: [{ key: "provider-a::video-b", label: "7C3irl" }],
    });
    expect(container.textContent).not.toContain("7C3irl");
    expect(container.textContent).toContain("Model");
  });
});
