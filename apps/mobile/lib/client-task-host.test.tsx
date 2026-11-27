// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  generation: 1,
  enabled: true,
  onTask: undefined as undefined | ((frame: unknown) => void),
  prefListeners: new Set<() => void>(),
  rpc: vi.fn(),
  webview: undefined as
    | undefined
    | {
        source?: { uri?: string };
        onLoad?: () => void;
        onMessage?: (event: { nativeEvent: { data: string } }) => void;
        onError?: () => void;
        sharedCookiesEnabled?: boolean;
        domStorageEnabled?: boolean;
        thirdPartyCookiesEnabled?: boolean;
        cacheEnabled?: boolean;
      },
  injected: [] as string[],
}));
vi.mock("./api", () => ({ rpc: fake.rpc }));
vi.mock("./api-live", () => ({
  subscribeClientTaskEvents: async (onTask: (frame: unknown) => void, signal: AbortSignal) => {
    fake.onTask = onTask;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  },
}));
vi.mock("./computer-local-traffic", () => ({
  localTrafficEnabled: () => fake.enabled,
  subscribeLocalTraffic: (listener: () => void) => {
    fake.prefListeners.add(listener);
    return () => {
      fake.prefListeners.delete(listener);
    };
  },
}));
vi.mock("./session", () => ({
  currentSessionGeneration: () => fake.generation,
  registerSessionDiskCache: vi.fn(),
}));
vi.mock("./i18n", () => {
  const t = (text: string, values?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? key);
  return { t, useI18n: () => ({ t, locale: "en" }) };
});
vi.mock("./native", () => ({
  useMobileTokens: () => ({
    card: "#ffffff",
    border: "#000000",
    foreground: "#111111",
    mutedForeground: "#666666",
    destructive: "#cc0000",
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 10, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native", () => ({
  Pressable: (props: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    hitSlop?: number;
  }) =>
    createElement(
      "button",
      { type: "button", "aria-label": props.accessibilityLabel, onClick: props.onPress },
      props.children,
    ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: (props: { children?: ReactNode }) => createElement("span", null, props.children),
  View: (props: { children?: ReactNode; style?: unknown; pointerEvents?: string }) =>
    createElement("div", null, props.children),
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: {
    source?: { uri?: string };
    onLoad?: () => void;
    onMessage?: (event: { nativeEvent: { data: string } }) => void;
    onError?: () => void;
    sharedCookiesEnabled?: boolean;
    domStorageEnabled?: boolean;
    thirdPartyCookiesEnabled?: boolean;
    cacheEnabled?: boolean;
    ref?: (view: unknown) => void;
  }) => {
    fake.webview = {
      source: props.source,
      onLoad: props.onLoad,
      onMessage: props.onMessage,
      onError: props.onError,
      sharedCookiesEnabled: props.sharedCookiesEnabled,
      domStorageEnabled: props.domStorageEnabled,
      thirdPartyCookiesEnabled: props.thirdPartyCookiesEnabled,
      cacheEnabled: props.cacheEnabled,
    };
    props.ref?.({ injectJavaScript: (js: string) => fake.injected.push(js) });
    return createElement("iframe", { title: "task" });
  },
}));

import { ClientTaskHost } from "../components/client-task-host";
import {
  CLIENT_TASK_SETTLE_MS,
  startClientTaskRunner,
  stopClientTaskRunner,
} from "./client-task-runner";

const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe("mobile client task host", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fake.generation = 1;
    fake.enabled = true;
    fake.onTask = undefined;
    fake.prefListeners.clear();
    fake.webview = undefined;
    fake.injected.length = 0;
    vi.clearAllMocks();
    fake.rpc.mockImplementation(async () => ({ ok: true }));
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
    stop?.();
    stop = undefined;
    stopClientTaskRunner();
    vi.useRealTimers();
  });

  async function renderHost() {
    await act(async () => {
      root?.render(createElement(ClientTaskHost));
    });
  }

  async function startTask() {
    stop = startClientTaskRunner();
    await tick();
    await act(async () => {
      fake.onTask?.({
        type: "client.task.requested",
        taskId: "task-1",
        url: "https://example.test/page",
        kind: "fetch",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      await tick();
    });
  }

  it("renders nothing with no task", async () => {
    await renderHost();
    expect(container?.textContent).toBe("");
  });

  it("shows the banner and a clean hidden WebView while a task runs", async () => {
    await renderHost();
    await startTask();
    expect(container?.textContent).toContain("Robot is using your phone's network");
    expect(container?.textContent).toContain("example.test");
    expect(fake.webview?.source).toEqual({ uri: "https://example.test/page" });
    expect(fake.webview?.sharedCookiesEnabled).toBe(false);
    expect(fake.webview?.domStorageEnabled).toBe(false);
    expect(fake.webview?.thirdPartyCookiesEnabled).toBe(false);
    expect(fake.webview?.cacheEnabled).toBe(false);
  });

  it("injects the extraction script after load plus settle", async () => {
    await renderHost();
    await startTask();
    await act(async () => {
      fake.webview?.onLoad?.();
    });
    expect(fake.injected).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIENT_TASK_SETTLE_MS);
    });
    expect(fake.injected).toHaveLength(1);
    expect(fake.injected[0]).toContain("ReactNativeWebView.postMessage");
  });

  it("hides the banner once the page reports its result", async () => {
    await renderHost();
    await startTask();
    await act(async () => {
      fake.webview?.onLoad?.();
      await vi.advanceTimersByTimeAsync(CLIENT_TASK_SETTLE_MS);
      fake.webview?.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: "result",
            url: "https://example.test/page",
            title: "Example",
            text: "hello",
            truncated: false,
          }),
        },
      });
      await tick();
    });
    expect(container?.textContent).toBe("");
    expect(fake.rpc.mock.calls.filter(([proc]) => proc === "clientTasks/complete")).toHaveLength(1);
  });

  it("stops the task from the banner Stop button", async () => {
    await renderHost();
    await startTask();
    const button = container?.querySelector('button[aria-label="Stop"]') as HTMLElement | null;
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
      await tick();
    });
    expect(container?.textContent).toBe("");
    const complete = fake.rpc.mock.calls.filter(([proc]) => proc === "clientTasks/complete");
    expect(complete).toHaveLength(1);
    expect(complete[0]?.[1]).toMatchObject({ status: "declined" });
    expect(complete[0]?.[1].result.error).toBe("stopped");
  });
});
