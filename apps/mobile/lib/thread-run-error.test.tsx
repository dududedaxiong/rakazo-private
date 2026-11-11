// @vitest-environment jsdom

import type { ModelHealthReport } from "@rakazo/contracts";
import { modelFallbackFailure } from "@rakazo/core";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadRunError } from "../components/thread/thread-run-error";
import type { MobileSnapshot } from "./mobile-types";

const routerPush = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const openModelSettings = vi.hoisted(() => vi.fn());

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

function report(provider: string, ok: string[], label = provider): ModelHealthReport {
  return {
    label,
    provider,
    total: ok.length,
    truncated: false,
    ok,
    results: ok.map((model) => ({ model, state: "ok" as const, detail: "2", seconds: 1 })),
    summary: {
      ok: ok.length,
      empty: 0,
      limited: 0,
      auth: 0,
      notfound: 0,
      badreq: 0,
      servererr: 0,
      timeout: 0,
      neterr: 0,
    },
  };
}

const authDetails = modelFallbackFailure(
  '401: {"error": {"message": "Incorrect API key provided"}}',
  [{ provider: "anthropic", modelId: "claude-sonnet", status: "failed", reason: "401" }],
);

function failedRun(error: string): MobileSnapshot["run"] {
  return { id: "run-1", status: "failed", botId: "bot-1", error } as MobileSnapshot["run"];
}

type HookResult = ReturnType<typeof useThreadRunError>;

describe("useThreadRunError model probe", () => {
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
    rpcMock.mockImplementation(async (proc: string, body?: { credentialId?: string }) => {
      switch (proc) {
        case "models/credentials":
          return [
            { id: "cred-main", provider: "openai-compatible", label: "Main", hasKey: true },
            { id: "cred-backup", provider: "anthropic", label: "Backup", hasKey: true },
          ];
        case "models/list":
          return [
            { provider: "anthropic", id: "claude-sonnet", label: "Claude Sonnet", billing: "api" },
          ];
        case "models/testProvider":
          return body?.credentialId === "cred-main"
            ? report("openai-compatible", [])
            : report("anthropic", ["claude-sonnet"]);
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
    rpcMock.mockReset();
    routerPush.mockReset();
  });

  it("offers the probe for a provider auth failure", async () => {
    const result = await renderHook(failedRun(authDetails));
    expect(result.modelProbe.available).toBe(true);
    expect(result.modelProbe.status).toBe("idle");
    expect(result.runErrorAction?.label).toBe("Replace key");
  });

  it("offers no probe for a failure without provider recovery", async () => {
    const result = await renderHook(failedRun("boom"));
    expect(result.modelProbe.available).toBe(false);
  });

  it("tests the main and fallback providers and lists the models that answered", async () => {
    let resolveTest: ((value: ModelHealthReport) => void) | null = null;
    rpcMock.mockImplementation(async (proc: string, body?: { credentialId?: string }) => {
      if (proc === "models/credentials")
        return [
          { id: "cred-main", provider: "openai-compatible", label: "Main", hasKey: true },
          { id: "cred-backup", provider: "anthropic", label: "Backup", hasKey: true },
        ];
      if (proc === "models/list")
        return [
          { provider: "anthropic", id: "claude-sonnet", label: "Claude Sonnet", billing: "api" },
        ];
      if (proc === "models/testProvider") {
        if (body?.credentialId === "cred-main") return report("openai-compatible", []);
        return new Promise<ModelHealthReport>((resolve) => {
          resolveTest = resolve;
        });
      }
      throw new Error(`unexpected rpc ${proc}`);
    });
    let result = await renderHook(failedRun(authDetails));
    await act(async () => {
      result.modelProbe.onTest();
    });
    result = latest!;
    expect(result.modelProbe.status).toBe("testing");
    await act(async () => {
      resolveTest!(report("anthropic", ["claude-sonnet"]));
    });
    await flush();
    result = latest!;
    expect(result.modelProbe.status).toBe("done");
    expect(result.modelProbe.models).toEqual([
      { provider: "anthropic", modelId: "claude-sonnet", label: "Claude Sonnet" },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("models/credentials");
    expect(rpcMock).toHaveBeenCalledWith("models/list");
    expect(rpcMock).toHaveBeenCalledWith(
      "models/testProvider",
      { credentialId: "cred-main" },
      { timeoutMs: 120_000 },
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "models/testProvider",
      { credentialId: "cred-backup" },
      { timeoutMs: 120_000 },
    );
  });

  it("switches to a tapped model and dismisses the failure", async () => {
    let result = await renderHook(failedRun(authDetails));
    await act(async () => {
      result.modelProbe.onTest();
    });
    await flush();
    result = latest!;
    const [model] = result.modelProbe.models;
    await act(async () => {
      result.modelProbe.onSelect(model!);
    });
    await flush();
    result = latest!;
    expect(rpcMock).toHaveBeenCalledWith("bots/update", {
      botId: "bot-1",
      modelProvider: "anthropic",
      modelId: "claude-sonnet",
    });
    expect(result.handled).toBe(true);
  });

  it("keeps the failure when the switch fails", async () => {
    rpcMock.mockImplementation(async (proc: string) => {
      if (proc === "bots/update") throw new Error("denied");
      if (proc === "models/credentials")
        return [{ id: "cred-main", provider: "openai-compatible", label: "Main", hasKey: true }];
      if (proc === "models/list") return [];
      if (proc === "models/testProvider") return report("openai-compatible", ["kimi-k2"]);
      throw new Error(`unexpected rpc ${proc}`);
    });
    let result = await renderHook(failedRun(authDetails));
    await act(async () => {
      result.modelProbe.onTest();
    });
    await flush();
    result = latest!;
    expect(result.modelProbe.models).toEqual([
      { provider: "openai-compatible", modelId: "kimi-k2", label: "kimi-k2" },
    ]);
    await act(async () => {
      result.modelProbe.onSelect(result.modelProbe.models[0]!);
    });
    await flush();
    result = latest!;
    expect(result.handled).toBe(false);
    expect(result.modelProbe.switchingKey).toBeNull();
  });

  it("reports a failed probe when every test fails", async () => {
    rpcMock.mockImplementation(async (proc: string) => {
      if (proc === "models/credentials")
        return [{ id: "cred-main", provider: "openai-compatible", label: "Main", hasKey: true }];
      if (proc === "models/list") return [];
      if (proc === "models/testProvider") throw new Error("unreachable");
      throw new Error(`unexpected rpc ${proc}`);
    });
    let result = await renderHook(failedRun(authDetails));
    await act(async () => {
      result.modelProbe.onTest();
    });
    await flush();
    result = latest!;
    expect(result.modelProbe.status).toBe("failed");
    expect(result.modelProbe.models).toEqual([]);
  });
});
