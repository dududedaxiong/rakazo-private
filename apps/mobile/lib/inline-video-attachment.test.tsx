// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  videoView: vi.fn(),
  pressable: vi.fn(),
  uri: vi.fn(async () => "file:///cache/clip.mp4"),
  open: vi.fn(),
  listeners: {} as Record<string, (payload: Record<string, unknown>) => void>,
  player: null as unknown as {
    play: () => void;
    currentTime: number;
    duration: number;
    addListener: (
      event: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => { remove: () => void };
  },
}));
mocks.player = {
  play: mocks.play,
  currentTime: 0,
  duration: 5,
  addListener: (event: string, handler: (payload: Record<string, unknown>) => void) => {
    mocks.listeners[event] = handler;
    return { remove: () => undefined };
  },
};

vi.mock("react-native", () => ({
  Pressable: (props: {
    children?: ReactNode;
    onPress?: () => void;
    onLongPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    style?: unknown;
  }) => {
    mocks.pressable(props);
    return createElement(
      "button",
      {
        type: "button",
        "aria-label": props.accessibilityLabel,
        role: props.accessibilityRole,
        onClick: props.onPress,
      },
      props.children,
    );
  },
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
vi.mock("expo", () => ({ requireOptionalNativeModule: () => ({}) }));
vi.mock("expo-video", () => ({
  useVideoPlayer: (_uri: string, setup?: (player: unknown) => void) => {
    setup?.(mocks.player);
    return mocks.player;
  },
  VideoView: (props: { accessibilityLabel?: string }) => {
    mocks.videoView(props);
    return createElement("div", { "data-testid": "video-view" });
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

import { beforeEach } from "vitest";
import { InlineVideoAttachment } from "../components/inline-video-attachment";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners = {};
  mocks.player.currentTime = 0;
});

async function waitForPlayer(container: HTMLElement) {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (container.querySelector('[data-testid="video-view"]')) return;
  }
  expect(container.querySelector('[data-testid="video-view"]')).not.toBeNull();
}

async function waitForText(container: HTMLElement, text: string) {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (container.textContent?.includes(text)) return;
  }
  expect(container.textContent).toContain(text);
}

it("shows the player once the video URI resolves", async () => {
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
    await waitForPlayer(container);
    expect(mocks.uri).toHaveBeenCalledWith({ botId: "bot-1" }, "vid-1", "video/mp4");
    expect(container.querySelector('[data-testid="video-view"]')).not.toBeNull();
    expect(container.textContent).toContain("clip.mp4");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows the duration once the player is ready, and plays in place on tap", async () => {
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
    await waitForPlayer(container);
    expect(container.textContent).not.toContain("0:05");
    await act(async () => mocks.listeners.statusChange?.({ status: "readyToPlay" }));
    expect(container.textContent).toContain("0:05");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Play"]')?.click(),
    );
    expect(mocks.play).toHaveBeenCalledTimes(1);
    await act(async () => mocks.listeners.playingChange?.({ isPlaying: true }));
    expect(container.querySelector('button[aria-label="Play"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("brings the play overlay back at the end, and restarts from the start", async () => {
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
    await waitForPlayer(container);
    await act(async () => mocks.listeners.statusChange?.({ status: "readyToPlay" }));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Play"]')?.click(),
    );
    await act(async () => mocks.listeners.playingChange?.({ isPlaying: true }));
    await act(async () => mocks.listeners.playToEnd?.({}));
    expect(container.querySelector('button[aria-label="Play"]')).not.toBeNull();
    mocks.player.currentTime = 5;
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Play"]')?.click(),
    );
    expect(mocks.player.currentTime).toBe(0);
    expect(mocks.play).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("opens the detail player when the video cannot be fetched", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.uri.mockRejectedValueOnce(new Error("no network"));
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
    expect(container.querySelector('[data-testid="video-view"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(mocks.open).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps the message long-press on the paused cover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onLongPress = vi.fn();
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
          pressableProps={{ onLongPress }}
          onOpen={mocks.open}
        />,
      ),
    );
    await waitForPlayer(container);
    const playButton = mocks.pressable.mock.calls
      .map(([props]) => props)
      .find((props) => props.accessibilityLabel === "Play");
    expect(playButton?.onLongPress).toBe(onLongPress);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
