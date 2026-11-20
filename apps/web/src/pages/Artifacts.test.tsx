// @vitest-environment jsdom

import { deflateRawSync } from "node:zlib";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listSpace: vi.fn(), listVersions: vi.fn(), getById: vi.fn() }));
const rpcClient = vi.hoisted(() => ({ artifacts: api, bootstrap: vi.fn() }));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/bootstrap", () => ({
  takeInitialBootstrap: vi.fn().mockResolvedValue({ bots: [] }),
}));
vi.mock("../lib/artifact-open", () => ({
  decodeArtifactBase64: vi.fn(),
  downloadArtifactBytes: vi.fn(),
}));
vi.mock("../lib/relative-time", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("@lingui/react/macro", () => {
  return {
    useLingui: () => ({ t: String.raw }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));
vi.mock("@rakazo_mickvvw/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@rakazo_mickvvw/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: Container,
    AlertDialogAction: Container,
    AlertDialogCancel: Container,
    AlertDialogContent: Container,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogTitle: Container,
    BotAvatar: () => <span />,
    Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
    Button: (props: ComponentProps<"button">) => <button {...props} />,
    buttonVariants: () => "",
    Empty: Container,
    EmptyDescription: Container,
    EmptyHeader: Container,
    EmptyMedia: Container,
    EmptyTitle: Container,
    ListSearchInput: ({
      query,
      setQuery,
      label,
    }: {
      query: string;
      setQuery: (query: string) => void;
      label: string;
    }) => (
      <input aria-label={label} value={query} onChange={(event) => setQuery(event.target.value)} />
    ),
    NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
    OptionSelect: () => null,
    Select: Container,
    SelectContent: Container,
    SelectGroup: Container,
    SelectItem: Container,
    SelectTrigger: Container,
    SelectValue: () => null,
    ToggleGroup: Container,
    ToggleGroupItem: Container,
    Tooltip: Container,
    TooltipContent: () => null,
    TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  };
});

import { decodeArtifactBase64 } from "../lib/artifact-open";
import { ArtifactsPage } from "./Artifacts";

const mockedDecode = vi.mocked(decodeArtifactBase64);

function artifact(name: string, id: string, createdAt = new Date().toISOString()) {
  return {
    id,
    botId: null,
    groupId: null,
    runId: null,
    name,
    description: null,
    mimeType: "text/markdown",
    size: 128,
    version: 1,
    createdAt,
    versionCount: 1,
  };
}

function typeSearch(container: HTMLElement, value: string) {
  const input = container.querySelector("input[aria-label='Search artifacts']");
  if (!(input instanceof HTMLInputElement)) throw new Error("missing search input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

async function renderArtifacts() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app/artifacts"]}>
          <ArtifactsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  // Let query results reach the screen.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("opens the Artifacts screen and lists what listSpace returns", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.listSpace.mockResolvedValue({
    items: [artifact("Q3 Content Calendar", "artifact-1")],
    nextCursor: null,
  });
  const page = await renderArtifacts();
  try {
    expect(page.container.textContent).toContain("Artifacts");
    expect(page.container.textContent).toContain("Q3 Content Calendar");
    expect(page.container.querySelector("a[href='/app']")?.getAttribute("aria-label")).toBe("Back");
    expect(page.container.querySelector("[data-testid='app-rail']")).toBeNull();
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

it("keeps loading later pages when search hides the current snapshot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.listSpace.mockImplementation(async (input: { cursor?: string }) => {
    if (!input.cursor) {
      return { items: [artifact("Alpha notes", "artifact-1")], nextCursor: "artifact-1" };
    }
    return { items: [artifact("Beta report", "artifact-2")], nextCursor: null };
  });
  const page = await renderArtifacts();
  try {
    expect(page.container.textContent).toContain("Alpha notes");
    const search = page.container.querySelector<HTMLButtonElement>('button[aria-label="Search"]');
    expect(search).toBeTruthy();
    await act(async () => {
      search?.click();
    });
    await act(async () => {
      typeSearch(page.container, "Beta");
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(page.container.textContent).toContain("Beta report");
      });
    });
    expect(page.container.textContent).not.toContain("Alpha notes");
    expect(api.listSpace).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "artifact-1" }),
      expect.anything(),
    );
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

it("still offers Load more when filters match nothing on the loaded page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let releaseSecondPage: (() => void) | undefined;
  const secondPage = new Promise<{
    items: ReturnType<typeof artifact>[];
    nextCursor: string | null;
  }>((resolve) => {
    releaseSecondPage = () =>
      resolve({ items: [artifact("Beta report", "artifact-2")], nextCursor: null });
  });
  api.listSpace.mockImplementation(async (input: { cursor?: string }) => {
    if (!input.cursor) {
      return { items: [artifact("Alpha notes", "artifact-1")], nextCursor: "artifact-1" };
    }
    return secondPage;
  });
  const page = await renderArtifacts();
  try {
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('button[aria-label="Search"]')?.click();
    });
    await act(async () => {
      typeSearch(page.container, "Beta");
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(page.container.querySelector('button[aria-label="Load more"]')).not.toBeNull();
      });
    });
    expect(page.container.textContent).not.toContain("Beta report");
    await act(async () => {
      releaseSecondPage?.();
      await secondPage;
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(page.container.textContent).toContain("Beta report");
      });
    });
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

it("reopens with cached artifacts and refreshes them in the background", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.listSpace.mockReset().mockResolvedValue({
    items: [artifact("Cached notes", "artifact-1")],
    nextCursor: null,
  });
  const first = await renderArtifacts();
  expect(first.container.textContent).toContain("Cached notes");
  await first.cleanup();
  await queryClient.invalidateQueries();

  let finish: (page: { items: ReturnType<typeof artifact>[]; nextCursor: null }) => void = () =>
    undefined;
  api.listSpace.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const page = await renderArtifacts();
  try {
    // Painted from the cache while the refresh is still out, with no spinner.
    expect(page.container.textContent).toContain("Cached notes");
    expect(page.container.querySelector('[aria-label="Loading…"]')).toBeNull();
    await act(async () =>
      finish({ items: [artifact("Fresh report", "artifact-2")], nextCursor: null }),
    );
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("Fresh report"));
    });
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffff_ffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
}

/** Stored hello.txt, an empty docs/ folder, and a deflated docs/readme.md. */
function buildTestZip(): Uint8Array {
  const encoder = new TextEncoder();
  const entries = [
    { name: "hello.txt", original: encoder.encode("hello zip"), stored: null, method: 0 },
    { name: "docs/", original: new Uint8Array(0), stored: null, method: 0 },
    {
      name: "docs/readme.md",
      original: encoder.encode("# readme"),
      stored: deflateRawSync(encoder.encode("# readme")),
      method: 8,
    },
  ] as const;
  const bytes: number[] = [];
  const push = (...values: number[]) => bytes.push(...values);
  const pushU16 = (value: number) => push(value & 0xff, (value >> 8) & 0xff);
  const pushU32 = (value: number) =>
    push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
  const centrals: number[][] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const stored = entry.stored ?? entry.original;
    const localOffset = offset;
    pushU32(0x04034b50);
    pushU16(20);
    pushU16(0);
    pushU16(entry.method);
    pushU16(0);
    pushU16(0x21);
    pushU32(crc32(entry.original));
    pushU32(stored.length);
    pushU32(entry.original.length);
    pushU16(name.length);
    pushU16(0);
    push(...name, ...stored);
    offset = bytes.length;
    const central: number[] = [];
    const cpush = (...values: number[]) => central.push(...values);
    const cpushU16 = (value: number) => cpush(value & 0xff, (value >> 8) & 0xff);
    const cpushU32 = (value: number) =>
      cpush(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
    cpushU32(0x02014b50);
    cpushU16(20);
    cpushU16(20);
    cpushU16(0);
    cpushU16(entry.method);
    cpushU16(0);
    cpushU16(0x21);
    cpushU32(crc32(entry.original));
    cpushU32(stored.length);
    cpushU32(entry.original.length);
    cpushU16(name.length);
    cpushU16(0);
    cpushU16(0);
    cpushU16(0);
    cpushU16(0);
    cpushU32(0);
    cpushU32(localOffset);
    cpush(...name);
    centrals.push(central);
  }
  const centralOffset = bytes.length;
  let centralSize = 0;
  for (const central of centrals) {
    push(...central);
    centralSize += central.length;
  }
  pushU32(0x06054b50);
  pushU16(0);
  pushU16(0);
  pushU16(entries.length);
  pushU16(entries.length);
  pushU32(centralSize);
  pushU32(centralOffset);
  pushU16(0);
  return Uint8Array.from(bytes);
}

async function renderArtifactDetail() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app/artifacts/artifact-zip"]}>
          <Routes>
            <Route path="/app/artifacts" element={<ArtifactsPage />} />
            <Route path="/app/artifacts/:artifactId" element={<ArtifactsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function mockZipArtifact() {
  const zipBytes = buildTestZip();
  mockedDecode.mockReturnValue(zipBytes);
  api.listSpace.mockResolvedValue({
    items: [{ ...artifact("bundle.zip", "artifact-zip"), mimeType: "application/zip" }],
    nextCursor: null,
  });
  api.listVersions.mockResolvedValue([
    { id: "artifact-zip", version: 1, createdAt: new Date().toISOString() },
  ]);
  api.getById.mockResolvedValue({
    ...artifact("bundle.zip", "artifact-zip"),
    mimeType: "application/zip",
    description: null,
    contentBase64: "AAAA",
  });
}

it("lists a zip archive's contents and opens a text entry inside it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockZipArtifact();
  const page = await renderArtifactDetail();
  try {
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("hello.txt"));
    });
    // The header counts every file in the archive (2 here), not just the
    // rows visible at the current folder (hello.txt + docs).
    expect(page.container.textContent).toContain("共 2 files");
    expect(page.container.textContent).toContain("docs");
    await act(async () => {
      page.container
        .querySelector<HTMLButtonElement>("button[aria-label='Open folder docs']")
        ?.click();
    });
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("readme.md"));
    });
    await act(async () => {
      page.container
        .querySelector<HTMLButtonElement>("button[aria-label='Back to parent folder']")
        ?.click();
    });
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("hello.txt"));
    });
    await act(async () => {
      page.container
        .querySelector<HTMLButtonElement>("button[aria-label='Preview hello.txt']")
        ?.click();
    });
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("hello zip"));
    });
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

it("returns to the artifact list from the preview's back button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockZipArtifact();
  const page = await renderArtifactDetail();
  try {
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("Download"));
    });
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>("button[aria-label='Back']")?.click();
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(page.container.querySelector("button[aria-label='Back']")).toBeNull(),
      );
    });
    expect(page.container.textContent).toContain("bundle.zip");
    expect(page.container.textContent).not.toContain("Download");
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});
