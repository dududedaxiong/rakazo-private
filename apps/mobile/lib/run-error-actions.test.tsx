// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelProbeActions } from "../components/run-error-actions";
import type { AvailableModel, AvailableModelProbe } from "./available-model-probe";

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    Platform: { OS: "ios" },
    StyleSheet: { create: <T,>(styles: T) => styles },
    View: ({ children }: { children?: ReactNode }) => h("div", null, children),
    Text: ({ children }: { children?: ReactNode }) => h("span", null, children),
    Pressable: ({ children }: { children?: ReactNode }) => h("div", null, children),
    useWindowDimensions: () => ({ fontScale: 1 }),
    ActivityIndicator: () => h("span", null, "busy"),
  };
});

vi.mock("./i18n", () => ({
  useI18n: () => ({ t: (message: string) => message, locale: "en" }),
}));

vi.mock("./native", () => ({
  useMobileTokens: () => ({ mutedForeground: "#888" }),
  native: {},
}));

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
    }) =>
      h(
        "button",
        {
          disabled: disabled || busy,
          "data-busy": busy ? "true" : undefined,
          onClick: () => onPress(),
        },
        label,
      ),
  };
});

function probe(overrides: Partial<AvailableModelProbe> = {}): AvailableModelProbe {
  return {
    available: true,
    status: "idle",
    models: [],
    switchingKey: null,
    onTest: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
}

const kimi: AvailableModel = {
  provider: "openai-compatible",
  modelId: "kimi-k2",
  label: "Kimi K2",
};
const claude: AvailableModel = {
  provider: "anthropic",
  modelId: "claude-sonnet",
  label: "Claude Sonnet",
};

describe("ModelProbeActions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  function renderProbe(next: AvailableModelProbe) {
    act(() => {
      root!.render(createElement(ModelProbeActions, { probe: next }));
    });
    return container!;
  }

  function buttons(node: HTMLDivElement) {
    return [...node.querySelectorAll("button")];
  }

  it("renders nothing when the failure is not a provider or model error", () => {
    const node = renderProbe(probe({ available: false }));
    expect(buttons(node)).toEqual([]);
    expect(node.textContent).toBe("");
  });

  it("offers the test and runs it on tap", () => {
    const onTest = vi.fn();
    const node = renderProbe(probe({ onTest }));
    expect(buttons(node).map((button) => button.textContent)).toEqual(["Test available models"]);
    act(() => {
      buttons(node)[0]!.click();
    });
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it("shows the testing state while the probe runs", () => {
    const node = renderProbe(probe({ status: "testing" }));
    const [button] = buttons(node);
    expect(button?.textContent).toBe("Testing…");
    expect(button?.disabled).toBe(true);
  });

  it("lists the available models as buttons and switches on tap", () => {
    const onSelect = vi.fn();
    const node = renderProbe(probe({ status: "done", models: [kimi, claude], onSelect }));
    expect(buttons(node).map((button) => button.textContent)).toEqual(["Kimi K2", "Claude Sonnet"]);
    act(() => {
      buttons(node)[1]!.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(claude);
  });

  it("disables the model buttons while a switch runs", () => {
    const node = renderProbe(
      probe({ status: "done", models: [kimi, claude], switchingKey: "anthropic:claude-sonnet" }),
    );
    const [first, second] = buttons(node);
    expect(first?.disabled).toBe(true);
    expect(second?.disabled).toBe(true);
    expect(second?.getAttribute("data-busy")).toBe("true");
  });

  it("shows no buttons when no model answered", () => {
    const node = renderProbe(probe({ status: "done", models: [] }));
    expect(buttons(node)).toEqual([]);
    expect(node.textContent).toContain("No available models.");
  });

  it("reports a failed probe and offers to test again", () => {
    const onTest = vi.fn();
    const node = renderProbe(probe({ status: "failed", onTest }));
    expect(node.textContent).toContain("Could not test these models");
    expect(buttons(node).map((button) => button.textContent)).toEqual(["Test available models"]);
    act(() => {
      buttons(node)[0]!.click();
    });
    expect(onTest).toHaveBeenCalledTimes(1);
  });
});
