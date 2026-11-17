// @vitest-environment jsdom
//
// The error box lists models a same-day test run already proved usable,
// without re-testing every connection. This file seeds SecureStore with such
// a run; it lives apart from thread-run-error.test.tsx because the test-run
// store is a module singleton, and a seeded run must not leak into the live
// probe tests there.

import { modelFallbackFailure } from "@rakazo_mickvvw/core";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadRunError } from "../components/thread/thread-run-error";
import type { MobileSnapshot } from "./mobile-types";
import { getModelTestRunStore } from "./model-test-run";

const routerPush = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const openModelSettings = vi.hoisted(() => vi.fn());
const storedRunJson = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("expo-router", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("./api", () => ({ rpc: rpcMock }));
vi.mock("./model-settings", () => ({ openModelSettings }));
vi.mock("./i18n", () => ({
  useI18n: () => ({ t: (message: string) => message, locale: "en" }),
}));
vi.mock("./native", () => ({
  useMobileTokens: () => ({ mutedForeground: "#888" }),
  native: {},
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => storedRunJson.value,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    Platform: { OS: "ios" },
    StyleSheet: { create: <T,>(styles: T) => styles },
    View: ({ children }: { children?: ReactNode }) => h("div", null, children),
    Text: ({ children }: { children?: ReactNode }) => h("span", null, children),
    Pressable: ({ children }: { children?: ReactNode }) => h("div", null, children),
    ScrollView: ({ children }: { children?: ReactNode }) => h("div", null, children),
    Modal: ({ children }: { children?: ReactNode }) => h("div", null, children),
    ActivityIndicator: () => h("span", null, "busy"),
    useWindowDimensions: () => ({ fontScale: 1, height: 800, width: 400 }),
  };
});
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/native-action-button", async () => {
  const { createElement: h } = await import("react");
  return {
    NativeActionButton: ({
      label,
      onPress,
      disabled,
      busy,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
      busy?: boolean;
    }) => h("button", { disabled: disabled || busy, onClick: () => onPress() }, label),
  };
});
vi.mock("../components/run-error-sheet-container", () => ({
  RunErrorSheetContainer: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("../components/sheet-close-button", () => ({
  SheetCloseButton: () => null,
}));

function localDateString(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function seedStoredRun() {
  const now = Date.now();
  const rows = [
    { provider: "anthropic", modelId: "claude-sonnet", state: "ok" },
    { provider: "openai-compatible", modelId: "deepseek-v4.1-flash", state: "ok" },
    { provider: "anthropic", modelId: "old-model", state: "auth" },
    { provider: "other", modelId: "some-model", state: "ok" },
  ];
  storedRunJson.value = JSON.stringify({
    version: 1,
    date: localDateString(now),
    status: "done",
    total: rows.length,
    results: rows.map((row) => ({
      key: `${row.provider}::${row.modelId}`,
      provider: row.provider,
      modelId: row.modelId,
      state: row.state,
      detail: "",
      seconds: 1,
      testedAt: now,
    })),
    queuedKeys: [],
    interruptedAt: null,
    savedAt: now,
    items: rows.map((row) => ({
      key: `${row.provider}::${row.modelId}`,
      provider: row.provider,
      modelId: row.modelId,
      label: row.modelId,
      credentialId: `cred-${row.provider}`,
    })),
  });
}

const authDetails = modelFallbackFailure(
  '401: {"error": {"message": "Incorrect API key provided"}}',
  [{ provider: "anthropic", modelId: "claude-sonnet", status: "failed", reason: "401" }],
);

function failedRun(error: string): MobileSnapshot["run"] {
  return { id: "run-1", status: "failed", botId: "bot-1", error } as MobileSnapshot["run"];
}

type HookResult = ReturnType<typeof useThreadRunError>;

describe("useThreadRunError stored test results", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let latest: HookResult | null = null;

  function HookProbe({
    run,
    botId,
    mainProvider,
  }: {
    run: MobileSnapshot["run"] | undefined;
    botId?: string;
    mainProvider?: string | null;
  }) {
    latest = useThreadRunError(run, botId, mainProvider);
    return null;
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function waitForStored() {
    for (let i = 0; i < 20; i++) {
      if (getModelTestRunStore().getSnapshot().results.size > 0) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    throw new Error("stored test results never hydrated");
  }

  async function renderHook(
    run: MobileSnapshot["run"] | undefined,
    mainProvider: string | null = "openai-compatible",
  ) {
    latest = null;
    await act(async () => {
      root!.render(createElement(HookProbe, { run, botId: "bot-1", mainProvider }));
    });
    return latest!;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    seedStoredRun();
    rpcMock.mockImplementation(async (proc: string) => {
      switch (proc) {
        case "models/list":
          return [
            { provider: "anthropic", id: "claude-sonnet", label: "Claude Sonnet", billing: "api" },
            {
              provider: "openai-compatible",
              id: "deepseek-v4.1-flash",
              label: "DeepSeek V4.1 Flash",
              billing: "api",
            },
          ];
        case "bots/update":
          return { id: "bot-1" };
        default:
          throw new Error(`unexpected rpc ${proc}`);
      }
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    latest = null;
    storedRunJson.value = null;
    rpcMock.mockReset();
    routerPush.mockReset();
  });

  it("lists stored usable models without re-testing any connection", async () => {
    let result = await renderHook(failedRun(authDetails));
    expect(result.modelProbe.available).toBe(true);
    await waitForStored();
    result = latest!;
    await act(async () => {
      result.modelProbe.onTest();
    });
    result = latest!;
    await flush();
    result = latest!;
    expect(result.modelProbe.status).toBe("done");
    expect(result.modelProbe.models).toEqual([
      { provider: "anthropic", modelId: "claude-sonnet", label: "Claude Sonnet" },
      {
        provider: "openai-compatible",
        modelId: "deepseek-v4.1-flash",
        label: "DeepSeek V4.1 Flash",
      },
    ]);
    expect(rpcMock.mock.calls.map((call) => call[0])).not.toContain("models/testProvider");
    expect(rpcMock.mock.calls.map((call) => call[0])).toContain("models/list");
  });

  it("switches to a stored model in one tap", async () => {
    let result = await renderHook(failedRun(authDetails));
    await waitForStored();
    result = latest!;
    await act(async () => {
      result.modelProbe.onTest();
    });
    await flush();
    result = latest!;
    expect(result.modelProbe.status).toBe("done");
    await act(async () => {
      result.modelProbe.onSelect(result.modelProbe.models[0]!);
    });
    await flush();
    expect(rpcMock).toHaveBeenCalledWith("bots/update", {
      botId: "bot-1",
      modelProvider: "anthropic",
      modelId: "claude-sonnet",
    });
    expect(latest!.handled).toBe(true);
  });
});
