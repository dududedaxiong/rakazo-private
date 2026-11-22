// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uri: vi.fn(async () => "file:///cache/clip.mp4"),
  open: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("react-native", () => ({
  Pressable: (props: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    style?: unknown;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": props.accessibilityLabel,
        role: props.accessibilityRole,
        onClick: props.onPress,
      },
      props.children,
    ),
  View: ({ children, style }: { children?: ReactNode; style?: unknown }) =>
    createElement("div", { "data-style": JSON.stringify(style) }, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  ActivityIndicator: () => null,
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    flatten: (styles: unknown) => (Array.isArray(styles) ? Object.assign({}, ...styles) : styles),
    absoluteFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
    hairlineWidth: 1,
  },
  useWindowDimensions: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }),
}));
// An over-the-air update on a build made before the player: no native module.
vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => {
    throw new Error("player must not load without the native module");
  },
  VideoView: () => {
    throw new Error("player must not load without the native module");
  },
}));
vi.mock("../lib/appearance", () => ({
  mobileTokens: () => ({
    foreground: "token-foreground",
    muted: "token-muted",
    mutedForeground: "token-muted-foreground",
  }),
}));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("../lib/artifact-open", () => ({ videoArtifactUri: mocks.uri }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));

import { InlineVideoAttachment } from "../components/inline-video-attachment";

async function waitForText(container: HTMLElement, text: string) {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (container.textContent?.includes(text)) return;
  }
  expect(container.textContent).toContain(text);
}

it("falls back to the file card and opens the detail player on tap", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <InlineVideoAttachment
          threadTarget={{ botId: "bot-1" }}
          artifactId="vid-1"
          name="clip.mp4"
          mimeType="video/mp4"
          labelColor="token-foreground"
          onOpen={mocks.open}
        />,
      ),
    );
    await waitForText(container, "Tap to open");
    expect(container.textContent).toContain("clip.mp4");
    expect(container.textContent).toContain("Tap to open");
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(mocks.open).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
