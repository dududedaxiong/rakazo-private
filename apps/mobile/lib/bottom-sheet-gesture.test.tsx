// @vitest-environment jsdom

import type { CSSProperties, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sheet's swipeable rows only receive gestures inside a
// GestureHandlerRootView. The app root has one, but a bottom sheet lives in a
// separate native window (a Modal or a native bottom-sheet dialog), so each
// sheet path must provide its own root around its content.
vi.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children, style }: { children?: ReactNode; style?: CSSProperties }) =>
    createElement("div", { "data-testid": "gesture-handler-root-view", style }, children),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Modal: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Platform: { OS: "android" },
  Keyboard: { addListener: () => ({ remove: () => undefined }) },
  useWindowDimensions: () => ({ height: 800, width: 400 }),
}));
vi.mock("../lib/appearance", () => ({
  mobileTokens: () => ({ card: "#ffffff" }),
}));
vi.mock("../lib/native", () => ({
  useMobileTokens: () => ({ card: "#ffffff", mutedForeground: "#666666" }),
}));
vi.mock("../lib/compose-available", () => ({
  // No native sheet is available, so the shell takes its Modal fallback.
  isComposeViewAvailable: () => false,
}));
vi.mock("../components/sheet-close-button", () => ({
  SheetCloseButton: () => createElement("button", { type: "button" }, "Close"),
}));

import { BottomSheetShell } from "../components/bottom-sheet-shell";
import { NativeSheet } from "../components/native-sheet";

function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

describe("bottom sheet gesture root", () => {
  let rendered: { container: HTMLDivElement; root: Root } | null = null;

  afterEach(() => {
    if (rendered) {
      act(() => {
        rendered?.root.unmount();
      });
      rendered.container.remove();
      rendered = null;
    }
  });

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps the fallback Modal content in a gesture root", () => {
    rendered = render(
      createElement(
        BottomSheetShell,
        { visible: true, label: "Other models", onClose: () => undefined },
        createElement("div", { "data-testid": "sheet-content" }, "content"),
      ),
    );
    const root = rendered.container.querySelector('[data-testid="gesture-handler-root-view"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector('[data-testid="sheet-content"]')).not.toBeNull();
  });

  it("wraps the native sheet content in a gesture root", () => {
    const FakeSheet = ({ children }: { children?: ReactNode }) =>
      createElement("div", { "data-testid": "fake-sheet" }, children);
    rendered = render(
      createElement(
        NativeSheet,
        { Sheet: FakeSheet, onClose: () => undefined, label: "Other models" },
        createElement("div", { "data-testid": "sheet-content" }, "content"),
      ),
    );
    const root = rendered.container.querySelector('[data-testid="gesture-handler-root-view"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector('[data-testid="sheet-content"]')).not.toBeNull();
  });

  it("sizes the native sheet gesture root by content, not by flex: 1", () => {
    const FakeSheet = ({ children }: { children?: ReactNode }) =>
      createElement("div", { "data-testid": "fake-sheet" }, children);
    rendered = render(
      <NativeSheet Sheet={FakeSheet} onClose={() => undefined} label="Other models">
        <div data-testid="sheet-content">content</div>
      </NativeSheet>,
    );
    const root = rendered.container.querySelector(
      '[data-testid="gesture-handler-root-view"]',
    ) as HTMLElement | null;
    expect(root).not.toBeNull();
    // The root's default flex: 1 means flexBasis 0%; inside a parent whose
    // height is unmeasured, the content measures 0 high and
    // enableDynamicSizing pins the sheet at handle height. flexGrow: 0
    // replaces the default, leaving flexBasis at auto so the sheet sizes by
    // content. flex: 0 would set flexBasis 0% again and break the same way.
    expect(root?.style.flexGrow).toBe("0");
    expect(root?.style.flexBasis).toBe("");
  });
});
