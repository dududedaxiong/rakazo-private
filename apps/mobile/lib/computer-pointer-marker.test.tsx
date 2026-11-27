// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const layoutHandlers = vi.hoisted(() => [] as Array<(event: unknown) => void>);

vi.mock("react-native", () => {
  function flatStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style);
    return (style ?? {}) as Record<string, unknown>;
  }
  function MockView(props: {
    children?: ReactNode;
    style?: unknown;
    onLayout?: (event: unknown) => void;
    pointerEvents?: string;
  }) {
    if (props.onLayout) layoutHandlers.push(props.onLayout);
    const flat = flatStyle(props.style);
    const attrs: Record<string, unknown> = {};
    for (const key of ["left", "top", "width", "height"]) {
      if (typeof flat[key] === "number") attrs[`data-${key}`] = flat[key];
    }
    return createElement("div", attrs, props.children);
  }
  class MockAnimatedValue {
    _value: number;
    constructor(value: number) {
      this._value = value;
    }
    setValue(value: number) {
      this._value = value;
    }
  }
  const timing = (
    value: MockAnimatedValue,
    config: { toValue: number; duration?: number; delay?: number },
  ) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        timer = setTimeout(
          () => {
            value.setValue(config.toValue);
            callback?.({ finished: true });
          },
          (config.delay ?? 0) + (config.duration ?? 0),
        );
      },
      stop: () => {
        if (timer !== undefined) clearTimeout(timer);
      },
    };
  };
  return {
    Animated: { View: MockView, Value: MockAnimatedValue, timing },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFillObject: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
      hairlineWidth: 1,
    },
    View: MockView,
  };
});

vi.mock("../components/native-symbol", () => ({
  NativeSymbol: (props: { ios: string; android: string; color?: string }) =>
    createElement("span", {
      "data-ios": props.ios,
      "data-android": props.android,
      "data-color": props.color,
    }),
}));

vi.mock("../lib/appearance", () => ({
  mobileTokens: () => ({
    primary: "#111111",
    primaryForeground: "#ffffff",
    card: "#eeeeee",
    mutedForeground: "#888888",
    border: "#cccccc",
  }),
}));

vi.mock("../lib/native", () => ({
  useThemedStyles: (factory: () => unknown) => factory(),
}));

describe("ComputerPointerMarker", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    layoutHandlers.length = 0;
    vi.resetModules();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  async function renderMarker(
    botId: string,
    pointer?: { botId: string; x: number; y: number; width: number; height: number },
  ) {
    const mod = await import("./computer-pointer");
    if (pointer) mod.setComputerPointer(pointer);
    const { ComputerPointerMarker } = await import("../components/computer-pointer-marker");
    await act(async () => {
      root?.render(createElement(ComputerPointerMarker, { botId }));
    });
    // Give the wrapper its size so the pointer maps onto the screen.
    await act(async () => {
      layoutHandlers[0]?.({
        nativeEvent: { layout: { width: 400, height: 300 } },
      });
    });
  }

  it("renders nothing without a pointer", async () => {
    await renderMarker("bot-1");
    expect(container?.querySelector("div")).toBeNull();
  });

  it("renders nothing for another bot's pointer", async () => {
    await renderMarker("bot-2", { botId: "bot-1", x: 640, y: 360, width: 1280, height: 720 });
    expect(container?.querySelector("div")).toBeNull();
  });

  it("marks the exact point, letterbox-corrected, with a cursor arrow", async () => {
    await renderMarker("bot-1", { botId: "bot-1", x: 640, y: 360, width: 1280, height: 720 });
    // 16:9 frame in a 400x300 view: fills the width, bars top and bottom, so
    // the centre (640, 360) lands at (200, 150).
    const dot = container?.querySelector('[data-width="10"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("data-left")).toBe("200");
    expect(dot?.getAttribute("data-top")).toBe("150");
    const ring = container?.querySelector('[data-width="64"]');
    expect(ring?.getAttribute("data-left")).toBe("200");
    expect(ring?.getAttribute("data-top")).toBe("150");
    expect(container?.querySelector('[data-ios="cursorarrow"]')).not.toBeNull();
  });

  it("fades out after a few seconds", async () => {
    vi.useFakeTimers();
    await renderMarker("bot-1", { botId: "bot-1", x: 640, y: 360, width: 1280, height: 720 });
    expect(container?.querySelector('[data-width="10"]')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(5200);
    });
    expect(container?.querySelector('[data-width="10"]')).toBeNull();
  });
});
