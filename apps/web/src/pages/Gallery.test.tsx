// @vitest-environment jsdom

import type { Bot } from "@rakazo_mickvvw/contracts";
import { formatFileSize } from "@rakazo_mickvvw/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadArtifact } from "../lib/artifact-open";
import { GalleryPage } from "./Gallery";

const BOT = { id: "bot-1", name: "New Bot" } as unknown as Bot;

function isoTodayAt(hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function isoYesterdayAt(hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function mediaItem(overrides: Record<string, unknown>) {
  return {
    id: "family-img-1",
    botId: "bot-1",
    groupId: null,
    runId: "run-1",
    name: "generated-img-1.png",
    description: null,
    mimeType: "image/png",
    size: 59273,
    version: 1,
    versionCount: 1,
    createdAt: isoTodayAt(14, 32),
    ...overrides,
  };
}

const DEFAULT_PAGE = {
  items: [
    mediaItem({}),
    mediaItem({
      id: "family-img-2",
      name: "generated-img-2.png",
      size: 128000,
      createdAt: isoYesterdayAt(23, 5),
    }),
    mediaItem({
      id: "family-vid-1",
      name: "generated-vid-1.mp4",
      mimeType: "video/mp4",
      size: 1400000,
      createdAt: isoTodayAt(11, 39),
    }),
  ],
  nextCursor: null,
};

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  rename: vi.fn(),
  fetchBytes: vi.fn(),
  zipFiles: vi.fn(),
  downloadBytes: vi.fn(),
  listInputs: [] as Array<Record<string, unknown>>,
  page: { items: [], nextCursor: null } as {
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
  },
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ i18n: { locale: "en" }, t: String.raw }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    bootstrap: { queryKey: () => ["bootstrap"] },
    artifacts: {
      listSpace: {
        key: () => ["artifacts", "listSpace"],
        infiniteOptions: (options: {
          input: (cursor: string | undefined) => Record<string, unknown>;
          getNextPageParam: (page: { nextCursor: string | null }) => string | undefined;
        }) => {
          const firstInput = options.input(undefined);
          mocks.listInputs.push(firstInput);
          return {
            queryKey: ["artifacts", "listSpace", firstInput],
            queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
              pageParam ? { items: [], nextCursor: null } : mocks.page,
            initialPageParam: undefined,
            getNextPageParam: options.getNextPageParam,
          };
        },
      },
    },
  }),
}));
vi.mock("../lib/bootstrap", () => ({
  takeInitialBootstrap: async () => ({ bots: [BOT] }),
}));
vi.mock("../lib/artifact-open", () => ({
  fetchArtifactBytes: mocks.fetchBytes,
  downloadArtifact: vi.fn(),
  downloadArtifactBytes: mocks.downloadBytes,
}));
vi.mock("../lib/use-artifact-image", () => ({
  useArtifactImage: () => null,
}));
vi.mock("../lib/rpc", () => ({
  rpc: { artifacts: { remove: mocks.remove, rename: mocks.rename } },
}));
vi.mock("../components/ArtifactFileCard", () => ({
  VideoPreview: () => null,
}));
vi.mock("@rakazo_mickvvw/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rakazo_mickvvw/core")>();
  return { ...actual, zipFiles: mocks.zipFiles };
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Real-time wait: the long-press timer is a plain setTimeout, so fake timers are not used. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function longPressTile(name: string) {
  pressTile(name, "pointerdown", { button: 0 });
  await act(async () => {
    await wait(600);
  });
}

async function renderGallery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GalleryPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
  // The list query settles asynchronously; wait for the first tile.
  await vi.waitFor(() => expect(container.textContent).toContain("generated-"));
  return { client };
}

async function waitForGrid() {
  await vi.waitFor(() => expect(container.textContent).toContain("generated-"));
}

function tile(name: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label$="${name}"]`);
}

function buttonByName(name: string): HTMLButtonElement | null {
  return (
    ([...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === name,
    ) as HTMLButtonElement | undefined) ?? null
  );
}

/** The preview dialog renders in a portal under document.body, not the grid container. */
function documentButtonByName(name: string): HTMLButtonElement | null {
  return (
    ([...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === name,
    ) as HTMLButtonElement | undefined) ?? null
  );
}

function pressTile(name: string, event: string, init: Record<string, unknown> = {}) {
  const element = tile(name);
  expect(element).not.toBeNull();
  const dispatched = new Event(event, { bubbles: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(dispatched, key, { value });
  }
  act(() => {
    element!.dispatchEvent(dispatched);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = () => {};
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
  mocks.rename.mockReset().mockImplementation(async ({ name }: { name: string }) => ({
    ok: true,
    name: name.endsWith(".png") || name.endsWith(".mp4") ? name : `${name}.png`,
  }));
  mocks.fetchBytes
    .mockReset()
    .mockImplementation(async (_target: unknown, artifactId: string) =>
      new TextEncoder().encode(`bytes:${artifactId}`),
    );
  mocks.zipFiles.mockReset().mockReturnValue(new Uint8Array([9, 9, 9]));
  mocks.downloadBytes.mockReset();
  mocks.listInputs.length = 0;
  mocks.page = DEFAULT_PAGE;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GalleryPage", () => {
  it("groups generated media by day with the time under each tile", async () => {
    await renderGallery();
    expect(tile("generated-img-1.png")).not.toBeNull();
    expect(tile("generated-img-2.png")).not.toBeNull();
    expect(tile("generated-vid-1.mp4")).not.toBeNull();
    const today = new Date().toLocaleDateString("en", { month: "numeric", day: "numeric" });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en", {
      month: "numeric",
      day: "numeric",
    });
    expect(container.textContent).toContain(`Today · ${today} · 2 items`);
    expect(container.textContent).toContain(`Yesterday · ${yesterday} · 1 item`);
    expect(container.textContent).toContain("New Bot · 14:32");
    expect(container.textContent).toContain("New Bot · 11:39");
  });

  it("filters to videos on the Videos tab", async () => {
    await renderGallery();
    await act(async () => buttonByName("Videos")?.click());
    expect(tile("generated-vid-1.mp4")).not.toBeNull();
    expect(tile("generated-img-1.png")).toBeNull();
    expect(tile("generated-img-2.png")).toBeNull();
    await act(async () => buttonByName("Images")?.click());
    expect(tile("generated-img-1.png")).not.toBeNull();
    expect(tile("generated-vid-1.mp4")).toBeNull();
  });

  it("cycles the sort button through date and size orders", async () => {
    await renderGallery();
    const sortButton = buttonByName("Date ↓");
    expect(sortButton).not.toBeNull();
    expect(mocks.listInputs.at(-1)?.sort).toBe("date-desc");

    await act(async () => sortButton?.click());
    await waitForGrid();
    expect(buttonByName("Date ↑")).not.toBeNull();
    expect(mocks.listInputs.at(-1)?.sort).toBe("date-asc");
    expect(container.textContent).toContain("Today · ");

    await act(async () => buttonByName("Date ↑")?.click());
    await waitForGrid();
    expect(buttonByName("Size ↓")).not.toBeNull();
    expect(mocks.listInputs.at(-1)?.sort).toBe("size-desc");
    // Size order drops the day sections and shows sizes instead of times.
    expect(container.textContent).not.toContain("Today · ");
    expect(container.textContent).toContain(`${formatFileSize(1400000)} · New Bot`);
    expect(container.textContent).toContain(`${formatFileSize(59273)} · New Bot`);

    await act(async () => buttonByName("Size ↓")?.click());
    await waitForGrid();
    expect(buttonByName("Size ↑")).not.toBeNull();
    expect(mocks.listInputs.at(-1)?.sort).toBe("size-asc");

    await act(async () => buttonByName("Size ↑")?.click());
    await waitForGrid();
    expect(buttonByName("Date ↓")).not.toBeNull();
    expect(mocks.listInputs.at(-1)?.sort).toBe("date-desc");
  });

  it("opens the preview on a short tap instead of selecting", async () => {
    await renderGallery();
    pressTile("generated-img-1.png", "pointerdown", { button: 0 });
    await act(async () => {
      await wait(100);
    });
    pressTile("generated-img-1.png", "pointerup");
    await act(async () => tile("generated-img-1.png")?.click());
    expect(container.textContent).not.toContain("item selected");
    expect(
      document.querySelector('button[aria-label="Rename generated-img-1.png"]'),
    ).not.toBeNull();
  });

  it("long-press enters selection, tapping toggles, Cancel exits", async () => {
    await renderGallery();
    await longPressTile("generated-img-1.png");
    expect(container.textContent).toContain("1 item selected");
    expect(tile("generated-img-1.png")?.getAttribute("aria-pressed")).toBe("true");
    // The click after the long press must not open the preview.
    await act(async () => tile("generated-img-1.png")?.click());
    expect(document.querySelector('button[aria-label="Rename generated-img-1.png"]')).toBeNull();

    await act(async () => tile("generated-img-2.png")?.click());
    expect(container.textContent).toContain("2 items selected");
    await act(async () => tile("generated-img-1.png")?.click());
    expect(container.textContent).toContain("1 item selected");

    await act(async () => buttonByName("Cancel")?.click());
    expect(container.textContent).not.toContain("item selected");
    expect(tile("generated-img-1.png")?.getAttribute("aria-pressed")).toBeNull();
  });

  it("deletes the selection after confirming", async () => {
    await renderGallery();
    await longPressTile("generated-img-1.png");
    await act(async () => tile("generated-vid-1.mp4")?.click());
    expect(container.textContent).toContain("2 items selected");

    await act(async () => buttonByName("Delete")?.click());
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Delete 2 items?");
    expect(dialog?.textContent).toContain(
      "Deleted files can't be recovered. Save them to your device first.",
    );
    const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Delete",
    );
    await act(async () => confirm?.click());
    await flush();
    expect(mocks.remove).toHaveBeenCalledWith({ artifactId: "family-img-1" });
    expect(mocks.remove).toHaveBeenCalledWith({ artifactId: "family-vid-1" });
    expect(tile("generated-img-1.png")).toBeNull();
    expect(tile("generated-vid-1.mp4")).toBeNull();
    expect(tile("generated-img-2.png")).not.toBeNull();
    expect(container.textContent).not.toContain("item selected");
  });

  it("reports the item that failed to delete and keeps it", async () => {
    mocks.remove.mockImplementation(async ({ artifactId }: { artifactId: string }) => {
      if (artifactId === "family-vid-1") throw new Error("gone");
      return { ok: true };
    });
    await renderGallery();
    await longPressTile("generated-img-1.png");
    await act(async () => tile("generated-vid-1.mp4")?.click());
    await act(async () => buttonByName("Delete")?.click());
    const dialog = document.querySelector('[role="alertdialog"]');
    const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Delete",
    );
    await act(async () => confirm?.click());
    await flush();
    expect(tile("generated-img-1.png")).toBeNull();
    expect(tile("generated-vid-1.mp4")).not.toBeNull();
    expect(container.textContent).toContain("Could not delete generated-vid-1.mp4. Try again.");
  });

  it("saves the selection as one zip on this device", async () => {
    await renderGallery();
    await longPressTile("generated-img-1.png");
    await act(async () => tile("generated-img-2.png")?.click());
    await act(async () => buttonByName("Save to device")?.click());
    await flush();
    expect(mocks.zipFiles).toHaveBeenCalledTimes(1);
    const entries = mocks.zipFiles.mock.calls[0]?.[0] as Array<{
      name: string;
      data: Uint8Array;
    }>;
    expect(entries.map((entry) => entry.name)).toEqual([
      "generated-img-1.png",
      "generated-img-2.png",
    ]);
    expect(new TextDecoder().decode(entries[0]?.data)).toBe("bytes:family-img-1");
    const [fileName, mimeType, bytes] = mocks.downloadBytes.mock.calls[0] ?? [];
    expect(fileName).toMatch(/^rakazo-gallery-\d{8}\.zip$/);
    expect(mimeType).toBe("application/zip");
    expect(bytes).toEqual(new Uint8Array([9, 9, 9]));
    // Saving keeps the selection, so the files can be deleted right after.
    expect(container.textContent).toContain("2 items selected");
  });

  it("refuses a selection over 500 MB instead of starting a download", async () => {
    mocks.page = {
      items: [
        mediaItem({
          id: "family-vid-big",
          name: "generated-big.mp4",
          mimeType: "video/mp4",
          size: 600 * 1024 * 1024,
        }),
      ],
      nextCursor: null,
    };
    await renderGallery();
    await longPressTile("generated-big.mp4");
    await act(async () => buttonByName("Save to device")?.click());
    expect(mocks.zipFiles).not.toHaveBeenCalled();
    expect(mocks.downloadBytes).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Selected files are over 500 MB. Save them in smaller batches.",
    );
  });

  it("downloads one tile without opening the preview", async () => {
    const download = vi.mocked(downloadArtifact).mockReset().mockResolvedValue(undefined);
    await renderGallery();
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Download generated-img-1.png"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    await flush();
    expect(download).toHaveBeenCalledWith(
      { botId: "bot-1" },
      "family-img-1",
      "generated-img-1.png",
      "image/png",
    );
    expect(document.querySelector('button[aria-label="Rename generated-img-1.png"]')).toBeNull();
  });

  it("reports a tile download that failed", async () => {
    vi.mocked(downloadArtifact).mockReset().mockRejectedValueOnce(new Error("offline"));
    await renderGallery();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Download generated-vid-1.mp4"]')
        ?.click();
    });
    await flush();
    expect(container.textContent).toContain("Could not download generated-vid-1.mp4. Try again.");
  });

  it("renames from the preview and the list uses the new name", async () => {
    await renderGallery();
    await act(async () => tile("generated-img-1.png")?.click());
    const renameButton = document.querySelector(
      'button[aria-label="Rename generated-img-1.png"]',
    ) as HTMLButtonElement | null;
    expect(renameButton).not.toBeNull();
    await act(async () => renameButton?.click());
    const input = document.querySelector('input[aria-label="Rename generated-img-1.png"]');
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!
      .set!;
    await act(async () => {
      setter.call(input, "generated-sunset");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => documentButtonByName("Save")?.click());
    expect(mocks.rename).toHaveBeenCalledWith({
      artifactId: "family-img-1",
      name: "generated-sunset",
    });
    await vi.waitFor(() => expect(tile("generated-sunset.png")).not.toBeNull());
    expect(tile("generated-img-1.png")).toBeNull();
  });
});
