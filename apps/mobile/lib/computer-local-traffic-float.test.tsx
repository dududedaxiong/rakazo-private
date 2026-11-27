// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secureStoreBox = vi.hoisted(() => ({
  items: new Map<string, string>(),
  sets: [] as Array<[string, string]>,
}));
const panConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const layoutHandlers = vi.hoisted(() => [] as Array<(event: unknown) => void>);

vi.mock("expo-secure-store", () => ({
  default: {
    getItemAsync: async (key: string) => secureStoreBox.items.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      secureStoreBox.items.set(key, value);
      secureStoreBox.sets.push([key, value]);
    },
  },
}));

vi.mock("react-native", () => {
  function flatStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style);
    return (style ?? {}) as Record<string, unknown>;
  }
  function MockView(props: {
    children?: ReactNode;
    style?: unknown;
    onLayout?: (event: unknown) => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: Record<string, unknown>;
    pointerEvents?: string;
  }) {
    if (props.onLayout) layoutHandlers.push(props.onLayout);
    const flat = flatStyle(props.style);
    const attrs: Record<string, unknown> = {};
    if (typeof flat.left === "string" || typeof flat.left === "number") {
      attrs["data-left"] = flat.left;
    }
    if (typeof flat.top === "string" || typeof flat.top === "number") {
      attrs["data-top"] = flat.top;
    }
    if (props.accessibilityLabel) attrs["aria-label"] = props.accessibilityLabel;
    if (props.accessibilityRole) attrs.role = props.accessibilityRole;
    return createElement("div", attrs, props.children);
  }
  function MockText(props: { children?: ReactNode }) {
    return createElement("span", null, props.children);
  }
  return {
    PanResponder: {
      create: (config: Record<string, unknown>) => {
        panConfigs.push(config);
        return { panHandlers: {} };
      },
    },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFillObject: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
      hairlineWidth: 1,
    },
    Text: MockText,
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

vi.mock("../lib/i18n", () => ({
  useI18n: () => ({ t: (message: string) => message }),
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ComputerLocalTrafficFloat", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    secureStoreBox.items.clear();
    secureStoreBox.sets.length = 0;
    panConfigs.length = 0;
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
  });

  async function renderFloat() {
    const { ComputerLocalTrafficFloat } = await import(
      "../components/computer-local-traffic-float"
    );
    await act(async () => {
      root?.render(createElement(ComputerLocalTrafficFloat));
      await flush();
    });
    // Give the wrapper its size so drags can convert pixels to fractions.
    await act(async () => {
      layoutHandlers[0]?.({
        nativeEvent: { layout: { width: 400, height: 300 } },
      });
    });
  }

  function button(): HTMLElement {
    const element = container?.querySelector(
      '[aria-label="Local traffic off"], [aria-label="Local traffic on"]',
    );
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function tap() {
    const config = panConfigs[0] as {
      onPanResponderGrant?: () => void;
      onPanResponderRelease?: () => void;
    };
    act(() => {
      config.onPanResponderGrant?.();
      config.onPanResponderRelease?.();
    });
  }

  it("starts off, top-right, and a tap turns it on with a note", async () => {
    await renderFloat();
    expect(button().getAttribute("aria-label")).toBe("Local traffic off");
    expect(button().querySelector('[data-android="wifi-outline"]')).not.toBeNull();
    expect(button().getAttribute("data-left")).toBe("86%");
    expect(button().getAttribute("data-top")).toBe("12%");

    tap();

    expect(button().getAttribute("aria-label")).toBe("Local traffic on");
    expect(button().querySelector('[data-android="wifi"]')).not.toBeNull();
    expect(container?.textContent).toContain(
      "Saved. Takes effect once the supporting update arrives.",
    );
    await act(async () => {
      await flush();
    });
    expect(
      JSON.parse(secureStoreBox.items.get("rakazo.computer-local-traffic") ?? "{}"),
    ).toMatchObject({
      enabled: true,
    });
  });

  it("a second tap turns it off and hides the note", async () => {
    await renderFloat();
    tap();
    expect(container?.textContent).toContain("Saved. Takes effect");
    tap();
    expect(button().getAttribute("aria-label")).toBe("Local traffic off");
    expect(container?.textContent).not.toContain("Saved. Takes effect");
  });

  it("a drag moves the button and persists the position", async () => {
    await renderFloat();
    const config = panConfigs[0] as {
      onPanResponderGrant?: () => void;
      onPanResponderMove?: (_event: unknown, gesture: { dx: number; dy: number }) => void;
      onPanResponderRelease?: () => void;
    };
    act(() => {
      config.onPanResponderGrant?.();
      config.onPanResponderMove?.(null, {
        dx: 40,
        dy: 30,
      });
    });
    // 0.86 + 40/400 = 0.96, clamped to keep the 44pt button inside a 400pt
    // screen (max 1 - 22/400 = 0.945); 0.12 + 30/300 = 0.22.
    expect(button().getAttribute("data-left")).toBe("94.5%");
    expect(button().getAttribute("data-top")).toBe("22%");
    await act(async () => {
      config.onPanResponderRelease?.();
      await flush();
    });
    expect(
      JSON.parse(secureStoreBox.items.get("rakazo.computer-local-traffic") ?? "{}"),
    ).toMatchObject({
      x: 0.945,
      y: 0.22,
    });
    // Still off: a drag is not a tap.
    expect(button().getAttribute("aria-label")).toBe("Local traffic off");
  });
});
