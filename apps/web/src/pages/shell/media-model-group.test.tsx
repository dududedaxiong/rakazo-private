// @vitest-environment jsdom

import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaModelTestState } from "./bot-settings-sections";
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
  {
    key: "provider-a::video-c",
    label: "Video C",
    provider: "provider-a",
    modelId: "video-c",
    providerLabel: "Provider A",
    images: true,
  },
  {
    key: "provider-a::video-d",
    label: "Video D",
    provider: "provider-a",
    modelId: "video-d",
    images: false,
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
const onAddVideoFallback = vi.fn();
const onMoveVideoFallback = vi.fn();
const onRemoveVideoFallback = vi.fn();
const onReplaceVideoFallback = vi.fn();
const onTestVideoModel = vi.fn();
const onApplyVideoTestedModel = vi.fn();
const onVideoPresetsChange = vi.fn();
const onVideoTriggerWordsChange = vi.fn();
const onImageTriggerWordsChange = vi.fn();
const onAddImageFallback = vi.fn();
const onMoveImageFallback = vi.fn();
const onRemoveImageFallback = vi.fn();
const onReplaceImageFallback = vi.fn();
const onTestImageModel = vi.fn();
const onApplyImageTestedModel = vi.fn();
const onAddVideoEditFallback = vi.fn();
const onMoveVideoEditFallback = vi.fn();
const onRemoveVideoEditFallback = vi.fn();
const onReplaceVideoEditFallback = vi.fn();
const onTestVideoEditModel = vi.fn();
const onApplyVideoEditTestedModel = vi.fn();
const onAddImageEditFallback = vi.fn();
const onMoveImageEditFallback = vi.fn();
const onRemoveImageEditFallback = vi.fn();
const onReplaceImageEditFallback = vi.fn();
const onTestImageEditModel = vi.fn();
const onApplyImageEditTestedModel = vi.fn();
const onImagePresetsChange = vi.fn();
const onVideoPresetChange = vi.fn();
const onImagePresetChange = vi.fn();

async function renderGroup(
  overrides: {
    videoValue?: string;
    imageValue?: string;
    videoMainFallbacks?: { key: string; label: string }[];
    videoBackupFallbacks?: { key: string; label: string }[];
    imageMainFallbacks?: { key: string; label: string }[];
    imageBackupFallbacks?: { key: string; label: string }[];
    locatedKey?: string | null;
    locateKind?:
      | "chat"
      | "translation"
      | "image"
      | "video"
      | "imageEdit"
      | "videoEdit"
      | "computer"
      | null;
    videoTest?: MediaModelTestState;
    imageTest?: MediaModelTestState;
    videoPresets?: { name: string; prompt: string }[];
    imagePresets?: { name: string; prompt: string }[];
    activeVideoPreset?: string | null;
    activeImagePreset?: string | null;
    videoTriggerWords?: string;
    imageTriggerWords?: string;
    videoEditValue?: string;
    imageEditValue?: string;
    videoEditMainFallbacks?: { key: string; label: string }[];
    videoEditBackupFallbacks?: { key: string; label: string }[];
    imageEditMainFallbacks?: { key: string; label: string }[];
    imageEditBackupFallbacks?: { key: string; label: string }[];
    videoEditTest?: MediaModelTestState;
    imageEditTest?: MediaModelTestState;
  } = {},
) {
  await act(async () =>
    root.render(
      <MediaModelGroup
        ids="media"
        locatedKey={overrides.locatedKey ?? null}
        locateKind={overrides.locateKind ?? null}
        videoChoices={videoChoices}
        videoValue={overrides.videoValue ?? ""}
        videoMainFallbacks={overrides.videoMainFallbacks ?? []}
        videoBackupFallbacks={overrides.videoBackupFallbacks ?? []}
        onAddVideoFallback={onAddVideoFallback}
        onMoveVideoFallback={onMoveVideoFallback}
        onRemoveVideoFallback={onRemoveVideoFallback}
        onReplaceVideoFallback={onReplaceVideoFallback}
        videoTest={overrides.videoTest ?? { status: "idle" }}
        onTestVideoModel={onTestVideoModel}
        onApplyVideoTestedModel={onApplyVideoTestedModel}
        imageChoices={imageChoices}
        imageValue={overrides.imageValue ?? ""}
        imageMainFallbacks={overrides.imageMainFallbacks ?? []}
        imageBackupFallbacks={overrides.imageBackupFallbacks ?? []}
        onAddImageFallback={onAddImageFallback}
        onMoveImageFallback={onMoveImageFallback}
        onRemoveImageFallback={onRemoveImageFallback}
        onReplaceImageFallback={onReplaceImageFallback}
        imageTest={overrides.imageTest ?? { status: "idle" }}
        onTestImageModel={onTestImageModel}
        onApplyImageTestedModel={onApplyImageTestedModel}
        videoPresets={overrides.videoPresets ?? []}
        onVideoPresetsChange={onVideoPresetsChange}
        activeVideoPreset={overrides.activeVideoPreset ?? null}
        onVideoPresetChange={onVideoPresetChange}
        imagePresets={overrides.imagePresets ?? []}
        onImagePresetsChange={onImagePresetsChange}
        activeImagePreset={overrides.activeImagePreset ?? null}
        onImagePresetChange={onImagePresetChange}
        videoTriggerWords={overrides.videoTriggerWords ?? ""}
        onVideoTriggerWordsChange={onVideoTriggerWordsChange}
        imageTriggerWords={overrides.imageTriggerWords ?? ""}
        onImageTriggerWordsChange={onImageTriggerWordsChange}
        videoEditChoices={videoChoices}
        videoEditValue={overrides.videoEditValue ?? ""}
        videoEditMainFallbacks={overrides.videoEditMainFallbacks ?? []}
        videoEditBackupFallbacks={overrides.videoEditBackupFallbacks ?? []}
        onAddVideoEditFallback={onAddVideoEditFallback}
        onMoveVideoEditFallback={onMoveVideoEditFallback}
        onRemoveVideoEditFallback={onRemoveVideoEditFallback}
        onReplaceVideoEditFallback={onReplaceVideoEditFallback}
        videoEditTest={overrides.videoEditTest ?? { status: "idle" }}
        onTestVideoEditModel={onTestVideoEditModel}
        onApplyVideoEditTestedModel={onApplyVideoEditTestedModel}
        imageEditChoices={imageChoices}
        imageEditValue={overrides.imageEditValue ?? ""}
        imageEditMainFallbacks={overrides.imageEditMainFallbacks ?? []}
        imageEditBackupFallbacks={overrides.imageEditBackupFallbacks ?? []}
        onAddImageEditFallback={onAddImageEditFallback}
        onMoveImageEditFallback={onMoveImageEditFallback}
        onRemoveImageEditFallback={onRemoveImageEditFallback}
        onReplaceImageEditFallback={onReplaceImageEditFallback}
        imageEditTest={overrides.imageEditTest ?? { status: "idle" }}
        onTestImageEditModel={onTestImageEditModel}
        onApplyImageEditTestedModel={onApplyImageEditTestedModel}
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

function selectByLabel(label: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!select) throw new Error(`Missing select "${label}"`);
  return select;
}

async function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The preset dialog renders in a portal, outside the test container. */
function dialogInputByLabel(label: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  );
  if (!input) throw new Error(`Missing dialog input "${label}"`);
  return input;
}

function dialogButtonByText(text: string) {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === text);
  if (!button) throw new Error(`Missing dialog button "${text}"`);
  return button;
}

function buttonByText(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  if (!button) throw new Error(`Missing button "${text}"`);
  return button;
}

function presetRowButton(name: string) {
  const button = [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(name),
  );
  if (!button) throw new Error(`Missing preset row "${name}"`);
  return button;
}

async function click(button: Element) {
  await act(async () => (button as HTMLButtonElement).click());
}

async function openNewPreset() {
  const add = container.querySelector<HTMLButtonElement>('[aria-label="New preset"]');
  if (!add) throw new Error('Missing "+" preset button');
  await click(add);
  expect(dialogInputByLabel("Preset name")).not.toBeNull();
  expect(dialogInputByLabel("Preset prompt")).not.toBeNull();
}

/** Opens the tag dialog for an existing preset. */
async function openPreset(name: string) {
  await click(presetRowButton(name));
  expect(dialogInputByLabel("Preset name").value).toBe(name);
}

async function fillPreset(name: string, prompt: string) {
  await setInput(dialogInputByLabel("Preset name"), name);
  await setInput(dialogInputByLabel("Preset prompt"), prompt);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
  onAddVideoFallback.mockReset();
  onMoveVideoFallback.mockReset();
  onRemoveVideoFallback.mockReset();
  onReplaceVideoFallback.mockReset();
  onTestVideoModel.mockReset();
  onApplyVideoTestedModel.mockReset();
  onVideoPresetsChange.mockReset();
  onAddImageFallback.mockReset();
  onMoveImageFallback.mockReset();
  onRemoveImageFallback.mockReset();
  onReplaceImageFallback.mockReset();
  onTestImageModel.mockReset();
  onApplyImageTestedModel.mockReset();
  onImagePresetsChange.mockReset();
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
  it("shows Not selected for unpicked roles and adds a model to the main pool", async () => {
    await renderGroup();
    expect(container.textContent).toContain("Media model");
    expect(container.textContent).toContain("Video generation model");
    expect(container.textContent).toContain("Image generation model");
    expect(container.querySelector('[data-model-row="provider-a::video-a"]')).toBeNull();
    const adds = [
      ...container.querySelectorAll<HTMLSelectElement>('select[aria-label="Add main model"]'),
    ];
    expect(adds).toHaveLength(4);
    await setSelect(adds[0]!, "provider-a::video-a");
    expect(onAddVideoFallback).toHaveBeenCalledWith("main", "provider-a::video-a");
    await setSelect(adds[1]!, "provider-a::image-a");
    expect(onAddImageFallback).toHaveBeenCalledWith("main", "provider-a::image-a");
  });

  it("shows the current video and image models as the first main-pool cards", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      imageValue: "provider-a::image-a",
    });
    // The main pool starts open: the primary is visible without expanding.
    const main = [...container.querySelectorAll('[data-testid="fallback-disclosure"]')].find(
      (node) => node.textContent?.includes("Main models"),
    );
    expect(main?.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    const videoRow = container.querySelector('[data-model-row="provider-a::video-a"]');
    expect(videoRow?.children[0]?.textContent).toBe("Video A");
    const imageRow = container.querySelector('[data-model-row="provider-a::image-a"]');
    expect(imageRow?.children[0]?.textContent).toBe("Image A");
  });

  it("shows capability badges only for what the catalog knows", async () => {
    await renderGroup({
      videoValue: "provider-a::video-d",
      videoMainFallbacks: [
        { key: "provider-a::video-c", label: "Video C" },
        { key: "provider-a::video-b", label: "Video B" },
      ],
    });
    // Text-only input: the Text badge, no Image badge.
    const textOnlyRow = container.querySelector('[data-model-row="provider-a::video-d"]');
    expect(textOnlyRow?.textContent).toContain("Text");
    expect(textOnlyRow?.textContent).not.toContain("Image");
    // Image input known: both badges.
    const imageRow = container.querySelector('[data-model-row="provider-a::video-c"]');
    expect(imageRow?.textContent).toContain("Text");
    expect(imageRow?.textContent).toContain("Image");
    // Unknown capability: no badge at all, nothing guessed.
    const unknownRow = container.querySelector('[data-model-row="provider-a::video-b"]');
    expect(unknownRow?.textContent).not.toContain("Text");
    expect(unknownRow?.textContent).not.toContain("Image");
    // Badges sit after the action buttons, never before them.
    const remove = imageRow?.querySelector('[aria-label="Remove fallback model"]');
    const badge = [...(imageRow?.querySelectorAll("span") ?? [])].find(
      (node) => node.textContent === "Image",
    );
    expect(remove).not.toBeNull();
    expect(badge).not.toBeNull();
    expect(remove!.compareDocumentPosition(badge!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("activates a preset on tap and clears it on a second tap", async () => {
    await renderGroup({
      videoPresets: [
        { name: "水彩", prompt: "用水彩风格画" },
        { name: "赛博", prompt: "赛博朋克风格" },
      ],
      activeVideoPreset: "水彩",
    });
    expect(container.textContent).toContain("Video prompt preset");
    expect(container.textContent).toContain("✓ 水彩");
    await click(presetRowButton("赛博"));
    expect(onVideoPresetChange).toHaveBeenCalledWith("赛博");
    await click(presetRowButton("水彩"));
    expect(onVideoPresetChange).toHaveBeenCalledWith(null);
  });

  it("adds a fallback model from the remaining choices", async () => {
    await renderGroup({ videoValue: "provider-a::video-a" });
    const add = selectByLabel("Add fallback model");
    const options = [...add.options].map((option) => option.value);
    expect(options).toContain("provider-a::video-b");
    expect(options).toContain("provider-a::video-c");
    expect(options).not.toContain("provider-a::video-a");
    await setSelect(add, "provider-a::video-b");
    expect(onAddVideoFallback).toHaveBeenCalledWith("backup", "provider-a::video-b");
  });

  it("offers no fallback add when every choice is already used", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [
        { key: "provider-a::video-b", label: "Video B" },
        { key: "provider-a::video-c", label: "Video C" },
        { key: "provider-a::video-d", label: "Video D" },
      ],
      imageValue: "provider-a::image-a",
      videoEditValue: "provider-a::video-a",
      videoEditBackupFallbacks: [
        { key: "provider-a::video-b", label: "Video B" },
        { key: "provider-a::video-c", label: "Video C" },
        { key: "provider-a::video-d", label: "Video D" },
      ],
      imageEditValue: "provider-a::image-a",
      imageEditBackupFallbacks: [
        { key: "provider-a::image-b", label: "Image B" },
        { key: "provider-a::image-c", label: "Image C" },
      ],
    });
    expect(container.textContent).toContain("Fallback models");
    expect(container.querySelector('select[aria-label="Add fallback model"]')).toBeNull();
  });

  it("offers a fallback add before a primary model is picked", async () => {
    await renderGroup();
    const add = selectByLabel("Add main model");
    const options = [...add.options].map((option) => option.value);
    expect(options).toContain("provider-a::video-a");
    expect(options).toContain("provider-a::video-b");
    expect(options).toContain("provider-a::video-c");
    await setSelect(add, "provider-a::video-a");
    expect(onAddVideoFallback).toHaveBeenCalledWith("main", "provider-a::video-a");
  });

  it("shows the main pool and the backup pool as separate sections", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoMainFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
      videoBackupFallbacks: [{ key: "provider-a::video-c", label: "Video C" }],
    });
    expect(container.textContent).toContain("Main models (2)");
    expect(container.textContent).toContain("Fallback models (1)");
    expect(container.textContent).toContain("Video B");
    expect(container.textContent).toContain("Video C");
    // The main pool's add entry offers only models in neither pool.
    const add = selectByLabel("Add main model");
    const options = [...add.options].map((option) => option.value);
    expect(options).not.toContain("provider-a::video-b");
    expect(options).not.toContain("provider-a::video-c");
  });

  it("unfolds the backup pool onto a located fallback row", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-c", label: "Video C" }],
      locatedKey: "provider-a::video-c",
      locateKind: "video",
    });
    const backup = [...container.querySelectorAll('[data-testid="fallback-disclosure"]')].find(
      (node) => node.textContent?.includes("Fallback models"),
    );
    expect(backup?.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Located here");
  });

  it("shows every row as a banner card with the full name on top", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [
        { key: "provider-a::video-b", label: "Video B" },
        { key: "provider-a::video-c", label: "Video C" },
      ],
      locatedKey: "provider-a::video-c",
      locateKind: "video",
    });
    // Every row is a banner card: the full name is the banner header on
    // its own line, untruncated, with the buttons below it — the primary
    // included, since it is the main pool's first card.
    for (const [key, name] of [
      ["provider-a::video-a", "Video A"],
      ["provider-a::video-b", "Video B"],
      ["provider-a::video-c", "Video C"],
    ] as const) {
      const row = container.querySelector(`[data-model-row="${key}"]`);
      expect(row).not.toBeNull();
      expect(row?.children[0]?.textContent).toBe(name);
      expect(row?.children[0]?.className).not.toContain("truncate");
      expect(row?.children[1]?.textContent).toContain("Test");
    }
    // The located card carries the colored border; the plain cards do not.
    expect(container.querySelector('[data-model-row="provider-a::video-c"]')?.className).toContain(
      "border-link",
    );
    expect(container.querySelector('[data-model-row="provider-a::video-b"]')?.className).toContain(
      "border-transparent",
    );
    expect(container.querySelector('[data-model-row="provider-a::video-a"]')?.className).toContain(
      "border-transparent",
    );
  });

  it("expands a card's details from the banner and hides what it does not know", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [
        { key: "provider-a::video-b", label: "Video B" },
        { key: "provider-a::video-c", label: "Video C" },
      ],
    });
    expect(container.querySelector('[data-testid="model-fallback-details"]')).toBeNull();
    const bannerC = container.querySelector('[data-model-row="provider-a::video-c"] button');
    await click(bannerC!);
    const details = container.querySelector('[data-testid="model-fallback-details"]');
    expect(details?.textContent).toContain("Provider A");
    expect(details?.textContent).toContain("video-c");
    expect(details?.textContent).toContain("Supported");
    expect(details?.textContent).toContain("Backup pool #2");
    // Tapping the same banner again closes it; tapping another moves it.
    await click(bannerC!);
    expect(container.querySelector('[data-testid="model-fallback-details"]')).toBeNull();
    const bannerB = container.querySelector('[data-model-row="provider-a::video-b"] button');
    await click(bannerB!);
    const detailsB = container.querySelector('[data-testid="model-fallback-details"]');
    // No provider label or image knowledge for this one: the provider id
    // from the key shows, and the image row is omitted, never guessed.
    expect(detailsB?.textContent).toContain("provider-a");
    expect(detailsB?.textContent).toContain("video-b");
    expect(detailsB?.textContent).not.toContain("Image input");
    expect(detailsB?.textContent).toContain("Backup pool #1");
  });

  it("does not expand a card's details from its action buttons", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
    });
    const row = container.querySelector('[data-model-row="provider-a::video-b"]');
    const testButton = [...row!.querySelectorAll("button")].find(
      (node) => node.textContent === "Test",
    );
    await click(testButton!);
    expect(container.querySelector('[data-testid="model-fallback-details"]')).toBeNull();
    expect(onTestVideoModel).toHaveBeenCalledWith("provider-a::video-b");
  });

  it("replaces a fallback in place from the same choices as add", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [
        { key: "provider-a::video-b", label: "Video B" },
        { key: "provider-a::video-c", label: "Video C" },
      ],
    });
    const row = container.querySelector('[data-model-row="provider-a::video-b"]');
    const replace = row?.querySelector<HTMLSelectElement>('select[aria-label="Replace model"]');
    expect(replace).not.toBeNull();
    // The replace picker offers the same unused choices as the add entry.
    expect([...replace!.options].map((option) => option.value)).toEqual([
      "",
      "provider-a::video-d",
    ]);
    // The buttons run replace, test, up, down, remove — in that order.
    const controls = [...row!.querySelectorAll("select, button")]
      .filter((node) => node.getAttribute("aria-expanded") === null)
      .map((node) => node.getAttribute("aria-label") ?? node.textContent);
    expect(controls).toEqual([
      "Replace model",
      "Test",
      "Move fallback model up",
      "Move fallback model down",
      "Remove fallback model",
    ]);
    await setSelect(replace!, "provider-a::video-d");
    expect(onReplaceVideoFallback).toHaveBeenCalledWith(
      "backup",
      "provider-a::video-b",
      "provider-a::video-d",
    );
  });

  it("moves a fallback up and down", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [
        { key: "provider-a::video-b", label: "Video B" },
        { key: "provider-a::video-c", label: "Video C" },
      ],
    });
    const backup = [...container.querySelectorAll('[data-testid="fallback-disclosure"]')].find(
      (node) => node.textContent?.includes("Fallback models"),
    );
    const upButtons = backup!.querySelectorAll('[aria-label="Move fallback model up"]');
    const downButtons = backup!.querySelectorAll('[aria-label="Move fallback model down"]');
    expect(upButtons).toHaveLength(2);
    await click(upButtons[1]!);
    expect(onMoveVideoFallback).toHaveBeenCalledWith("backup", "provider-a::video-c", -1);
    await click(downButtons[0]!);
    expect(onMoveVideoFallback).toHaveBeenCalledWith("backup", "provider-a::video-b", 1);
    expect((downButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables moving the primary row up and offers replace on it", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoMainFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
    });
    const row = container.querySelector('[data-model-row="provider-a::video-a"]');
    expect(row).not.toBeNull();
    const up = row?.querySelector<HTMLButtonElement>('[aria-label="Move fallback model up"]');
    expect(up?.disabled).toBe(true);
    const down = row?.querySelector<HTMLButtonElement>('[aria-label="Move fallback model down"]');
    expect(down?.disabled).toBe(false);
    expect(row?.querySelector('select[aria-label="Replace model"]')).not.toBeNull();
    await click(down!);
    expect(onMoveVideoFallback).toHaveBeenCalledWith("main", "provider-a::video-a", 1);
  });

  it("focuses the located row when the list opens on it", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-c", label: "Video C" }],
      locatedKey: "provider-a::video-c",
      locateKind: "video",
    });
    expect(document.activeElement).toBe(
      container.querySelector('[data-model-row="provider-a::video-c"] button'),
    );
  });

  it("creates a preset and activates the first one", async () => {
    await renderGroup();
    await openNewPreset();
    await fillPreset("水彩", "用水彩风格画");
    await click(dialogButtonByText("Save"));
    expect(onVideoPresetsChange).toHaveBeenCalledWith([{ name: "水彩", prompt: "用水彩风格画" }]);
    expect(onVideoPresetChange).toHaveBeenCalledWith("水彩");
  });

  it("rejects a preset without a name", async () => {
    await renderGroup();
    await openNewPreset();
    await fillPreset("", "用水彩风格画");
    await click(dialogButtonByText("Save"));
    expect(document.body.textContent).toContain("Enter a preset name");
    expect(onVideoPresetsChange).not.toHaveBeenCalled();
  });

  it("rejects a duplicate preset name", async () => {
    await renderGroup({ videoPresets: [{ name: "水彩", prompt: "用水彩风格画" }] });
    await openNewPreset();
    await fillPreset("水彩", "换个画法");
    await click(dialogButtonByText("Save"));
    expect(document.body.textContent).toContain("A preset with this name already exists");
    expect(onVideoPresetsChange).not.toHaveBeenCalled();
  });

  it("edits a preset and follows an active rename", async () => {
    await renderGroup({
      videoPresets: [
        { name: "水彩", prompt: "用水彩风格画" },
        { name: "赛博", prompt: "赛博朋克风格" },
      ],
      activeVideoPreset: "水彩",
    });
    await openPreset("水彩");
    await fillPreset("水墨", "用水墨风格画");
    await click(dialogButtonByText("Save"));
    expect(onVideoPresetsChange).toHaveBeenCalledWith([
      { name: "水墨", prompt: "用水墨风格画" },
      { name: "赛博", prompt: "赛博朋克风格" },
    ]);
    expect(onVideoPresetChange).toHaveBeenCalledWith("水墨");
  });

  it("deletes a preset and clears the active preset", async () => {
    await renderGroup({
      videoPresets: [
        { name: "水彩", prompt: "用水彩风格画" },
        { name: "赛博", prompt: "赛博朋克风格" },
      ],
      activeVideoPreset: "水彩",
    });
    await openPreset("水彩");
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Delete preset"]');
    if (!remove) throw new Error("Missing Delete preset button");
    await click(remove);
    expect(onVideoPresetsChange).toHaveBeenCalledWith([{ name: "赛博", prompt: "赛博朋克风格" }]);
    expect(onVideoPresetChange).toHaveBeenCalledWith(null);
  });

  it("hides New preset at the preset limit", async () => {
    await renderGroup({
      videoPresets: Array.from({ length: 20 }, (_, index) => ({
        name: `预设${index + 1}`,
        prompt: "提示词",
      })),
    });
    // The video section is at the limit; the image section still offers one.
    expect(container.querySelectorAll('[aria-label="New preset"]')).toHaveLength(1);
  });

  it("tests the primary model and shows the result", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoTest: {
        status: "done",
        supported: true,
        seconds: 1.2,
        detail: "",
        modelKey: "provider-a::video-a",
        modelId: "video-a",
      },
    });
    expect(container.textContent).toContain("video-a supports video generation · 1.2s");
    expect(
      [...container.querySelectorAll("button")].some(
        (node) => node.textContent === "Set as primary",
      ),
    ).toBe(false);
    await click(buttonByText("Test"));
    expect(onTestVideoModel).toHaveBeenCalledWith("provider-a::video-a");
  });

  it("shows Testing… while a model is being tested", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoTest: { status: "testing", modelKey: "provider-a::video-a" },
    });
    const testButton = buttonByText("Testing…");
    expect((testButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("tests a fallback, shows the failure, and offers set as primary on success", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
      videoTest: {
        status: "done",
        supported: false,
        seconds: 0.8,
        detail: "authentication failed",
        modelKey: "provider-a::video-b",
        modelId: "video-b",
      },
    });
    expect(container.textContent).toContain(
      "Does not support video generation · authentication failed",
    );
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
      videoTest: {
        status: "done",
        supported: true,
        seconds: 1.2,
        detail: "",
        modelKey: "provider-a::video-b",
        modelId: "video-b",
      },
    });
    expect(container.textContent).toContain("video-b supports video generation · 1.2s");
    await click(buttonByText("Set as primary"));
    expect(onApplyVideoTestedModel).toHaveBeenCalled();
  });

  it("lists fallback models and removes one", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-b", label: "Video B" }],
    });
    expect(container.textContent).toContain("Fallback models");
    expect(container.textContent).toContain("Video B");
    const remove = container.querySelector<HTMLButtonElement>(
      '[data-model-row="provider-a::video-b"] [aria-label="Remove fallback model"]',
    );
    expect(remove).not.toBeNull();
    await act(async () => remove!.click());
    expect(onRemoveVideoFallback).toHaveBeenCalledWith("backup", "provider-a::video-b");
  });

  it("does not show an opaque fallback name directly", async () => {
    await renderGroup({
      videoValue: "provider-a::video-a",
      videoBackupFallbacks: [{ key: "provider-a::video-b", label: "7C3irl" }],
    });
    expect(container.textContent).not.toContain("7C3irl");
    expect(container.textContent).toContain("Model");
  });
});
