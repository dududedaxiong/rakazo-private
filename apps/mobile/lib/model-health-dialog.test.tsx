// @vitest-environment jsdom

import type { ModelHealthReport } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  function MockView(props: { children?: ReactNode; testID?: string }) {
    return createElement("div", { "data-testid": props.testID }, props.children);
  }
  function MockText(props: { children?: ReactNode }) {
    return createElement("span", null, props.children);
  }
  function MockScrollView(props: { children?: ReactNode }) {
    return createElement("div", null, props.children);
  }
  function MockModal(props: { children?: ReactNode; visible?: boolean }) {
    return props.visible ? createElement("div", null, props.children) : null;
  }
  return {
    Modal: MockModal,
    ScrollView: MockScrollView,
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: MockText,
    View: MockView,
  };
});

vi.mock("./i18n", () => ({
  useI18n: () => ({
    t: (id: string, vars?: Record<string, string | number>) =>
      vars
        ? Object.entries(vars).reduce(
            (text, [key, value]) => text.replace(`{${key}}`, String(value)),
            id,
          )
        : id,
  }),
}));

vi.mock("./native", () => ({
  useMobileTokens: () => ({
    background: "background",
    destructive: "destructive",
    foreground: "foreground",
    mutedForeground: "muted",
    success: "success",
    warning: "warning",
  }),
}));

vi.mock("../components/native-action-button", () => ({
  NativeActionButton: (props: { label: string; disabled?: boolean; onPress: () => void }) =>
    createElement(
      "button",
      { type: "button", disabled: props.disabled, onClick: props.onPress },
      props.label,
    ),
}));

import { ModelHealthDialog } from "../components/model-health-dialog";

const report: ModelHealthReport = {
  label: "Test Relay",
  provider: "openai-compatible",
  total: 3,
  truncated: false,
  ok: ["model-a"],
  results: [
    { model: "model-a", state: "ok", detail: "2", seconds: 1.2 },
    { model: "model-b", state: "limited", detail: "Rate limit exceeded", seconds: 0.5 },
    { model: "model-c", state: "auth", detail: "No permission for this model", seconds: 0.5 },
  ],
  summary: {
    ok: 1,
    empty: 0,
    limited: 1,
    auth: 1,
    notfound: 0,
    badreq: 0,
    servererr: 0,
    timeout: 0,
    neterr: 0,
  },
};

describe("ModelHealthDialog", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  function renderDialog(overrides: Partial<ModelHealthReport> = {}) {
    const onClose = vi.fn();
    const onKeepUsable = vi.fn();
    act(() => {
      root?.render(
        <ModelHealthDialog
          result={{ ...report, ...overrides }}
          keeping={false}
          onClose={onClose}
          onKeepUsable={onKeepUsable}
        />,
      );
    });
    return { onClose, onKeepUsable };
  }

  function buttonNamed(name: string) {
    return [...(container?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes(name),
    );
  }

  it("shows the summary and one row per model, with the failure reason", () => {
    renderDialog();
    const dialog = container?.querySelector('[data-testid="model-health-dialog"]');
    expect(dialog?.textContent).toContain("Test results · Test Relay");
    expect(dialog?.textContent).toContain("1 of 3 models work");
    expect(dialog?.textContent).toContain("Rate limited 1");
    expect(dialog?.textContent).toContain("No permission 1");
    expect(dialog?.textContent).toContain("model-b");
    expect(dialog?.textContent).toContain("Rate limit exceeded");
    expect(dialog?.textContent).toContain("No permission for this model");
    // The ok reply is proof, not a failure reason: the usable row shows only name and badge.
    expect(dialog?.textContent).not.toContain("model-a2");
  });

  it("keeps only the usable models when asked", () => {
    const { onKeepUsable } = renderDialog();
    const keep = buttonNamed("Keep only usable models");
    expect(keep?.disabled).toBe(false);
    act(() => {
      keep?.click();
    });
    expect(onKeepUsable).toHaveBeenCalledOnce();
  });

  it("closes without keeping", () => {
    const { onClose } = renderDialog();
    act(() => {
      buttonNamed("Close")?.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables keeping when every model works", () => {
    renderDialog({
      total: 1,
      ok: ["model-a"],
      results: [{ model: "model-a", state: "ok", detail: "2", seconds: 1 }],
      summary: {
        ok: 1,
        empty: 0,
        limited: 0,
        auth: 0,
        notfound: 0,
        badreq: 0,
        servererr: 0,
        timeout: 0,
        neterr: 0,
      },
    });
    expect(buttonNamed("Keep only usable models")?.disabled).toBe(true);
  });

  it("says when the run stopped at the cap", () => {
    renderDialog({ truncated: true, total: 55 });
    const dialog = container?.querySelector('[data-testid="model-health-dialog"]');
    expect(dialog?.textContent).toContain("Only the first 50 models were tested.");
    expect(buttonNamed("Keep only usable models")?.disabled).toBe(true);
  });
});
