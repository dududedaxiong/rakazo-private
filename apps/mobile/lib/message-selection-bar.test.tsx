// @vitest-environment jsdom

import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSelectionBar } from "../components/thread/message-selection-bar";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const styleData = (style: unknown) =>
    JSON.stringify(typeof style === "function" ? style({ pressed: false }) : style);
  return {
    Platform: { OS: "ios", select: (options: { ios?: unknown }) => options.ios },
    View: ({ children, style }: { children?: unknown; style?: unknown }) =>
      createElement("div", { "data-style": styleData(style) }, children as never),
    Text: ({ children, style }: { children?: unknown; style?: unknown }) =>
      createElement("span", { "data-style": styleData(style) }, children as never),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
      disabled,
      style,
    }: {
      children?: unknown;
      onPress?: () => void;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      accessibilityState?: { checked?: boolean };
      disabled?: boolean;
      style?: unknown;
    }) =>
      createElement(
        "button",
        {
          "aria-label": accessibilityLabel,
          role: accessibilityRole,
          "aria-checked": accessibilityState?.checked,
          disabled,
          "data-style": styleData(style),
          onClick: onPress,
        },
        children as never,
      ),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (styles: unknown) => (Array.isArray(styles) ? Object.assign({}, ...styles) : styles),
      hairlineWidth: 1,
    },
  };
});

vi.mock("../lib/i18n", () => ({
  t: (text: string, params?: Record<string, string | number>) =>
    params
      ? Object.entries(params).reduce(
          (result, [key, value]) => result.replace(`{${key}}`, String(value)),
          text,
        )
      : text,
  useI18n: () => ({
    t: (text: string, params?: Record<string, string | number>) =>
      params
        ? Object.entries(params).reduce(
            (result, [key, value]) => result.replace(`{${key}}`, String(value)),
            text,
          )
        : text,
  }),
}));
vi.mock("../lib/native", () => ({
  useMobileTokens: () => ({ mutedForeground: "#666", link: "#06c", destructive: "#c00" }),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) =>
    createElement("button", { type: "button", disabled, onClick: onPress }, label),
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

function renderBar(props: {
  count: number;
  busy?: boolean;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  const onDelete = props.onDelete ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  act(() =>
    root?.render(
      createElement(MessageSelectionBar, {
        count: props.count,
        busy: props.busy ?? false,
        onDelete,
        onCancel,
      }),
    ),
  );
  return { onDelete, onCancel };
}

function button(label: string) {
  return Array.from(container!.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  );
}

describe("MessageSelectionBar", () => {
  it("shows the count and deletes only when something is picked", () => {
    const { onDelete } = renderBar({ count: 3 });
    expect(container!.textContent).toContain("3 selected");
    expect(button("Delete")?.disabled).toBe(false);
    act(() => button("Delete")?.click());
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("disables Delete when nothing is picked", () => {
    renderBar({ count: 0 });
    expect(container!.textContent).toContain("0 selected");
    expect(button("Delete")?.disabled).toBe(true);
    expect(button("Cancel")?.disabled).toBe(false);
  });

  it("disables both actions while a batch delete runs", () => {
    renderBar({ count: 2, busy: true });
    expect(button("Delete")?.disabled).toBe(true);
    expect(button("Cancel")?.disabled).toBe(true);
  });

  it("cancels selection", () => {
    const { onCancel } = renderBar({ count: 1 });
    act(() => button("Cancel")?.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
