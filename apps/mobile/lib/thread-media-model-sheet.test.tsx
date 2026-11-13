// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const picked = vi.hoisted(() => ({ role: null as string | null }));

vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    foreground: "#111111",
    mutedForeground: "#666666",
  }),
}));
vi.mock("./i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) =>
    createElement(
      "button",
      { type: "button", "aria-label": accessibilityLabel, onClick: onPress },
      children,
    ),
}));
vi.mock("../components/bottom-sheet-shell", () => ({
  BottomSheetShell: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-testid": "media-sheet" }, children),
  SheetHeader: ({ title }: { title: string }) => createElement("div", null, title),
}));
vi.mock("../components/row-accessories", () => ({
  Chevron: () => createElement("span", null, "›"),
}));

import { ThreadMediaModelSheet } from "../components/thread/thread-media-model-sheet";

const catalog = [
  { provider: "provider-a", id: "video-a", label: "Video A", billing: "metered" },
  { provider: "provider-a", id: "image-a", label: "Image A", billing: "metered" },
];

let root: Root;
let node: HTMLDivElement;

async function mountSheet(
  video: { provider: string | null; modelId: string | null },
  image: { provider: string | null; modelId: string | null },
) {
  await act(async () =>
    root.render(
      <ThreadMediaModelSheet
        visible
        catalog={catalog as never}
        video={video}
        image={image}
        onPickRole={(role) => {
          picked.role = role;
        }}
        onClose={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  picked.role = null;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("ThreadMediaModelSheet", () => {
  it("shows the current video and image models", async () => {
    await mountSheet(
      { provider: "provider-a", modelId: "video-a" },
      { provider: "provider-a", modelId: "image-a" },
    );
    expect(node.textContent).toContain("Video generation model");
    expect(node.textContent).toContain("Video A");
    expect(node.textContent).toContain("Image generation model");
    expect(node.textContent).toContain("Image A");
  });

  it("shows Not set for an unpicked role and opens its picker on tap", async () => {
    await mountSheet(
      { provider: null, modelId: null },
      { provider: "provider-a", modelId: "image-a" },
    );
    expect(node.textContent).toContain("Not set");
    const videoRow = node.querySelector<HTMLButtonElement>(
      '[aria-label="Video generation model: Not set"]',
    );
    expect(videoRow).not.toBeNull();
    await act(async () => videoRow!.click());
    expect(picked.role).toBe("video");
  });

  it("renders nothing when hidden", async () => {
    await act(async () =>
      root.render(
        <ThreadMediaModelSheet
          visible={false}
          catalog={catalog as never}
          video={{ provider: null, modelId: null }}
          image={{ provider: null, modelId: null }}
          onPickRole={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    expect(node.textContent).toBe("");
  });
});
