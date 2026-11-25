// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomSheetShell } from "../components/bottom-sheet-shell";

const mocks = vi.hoisted(() => ({ sheet: undefined as unknown }));

vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 402, height: 800, fontScale: 1 }),
  StyleSheet: { create: (styles: unknown) => styles },
  Modal: ({ children }: { children: ReactNode }) =>
    createElement("dialog", { open: true }, children),
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("p", null, children),
  Platform: { OS: "android" },
}));
vi.mock("../components/native-sheet", () => ({
  useNativeSheet: () => mocks.sheet,
  NativeSheet: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-native-sheet": true }, children),
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({ card: "token-card", background: "token-background" }),
}));
// react-native-gesture-handler ships syntax the jsdom runner cannot parse.
vi.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
// Only used by SheetHeader, never by the shell itself; keep its native
// imports (expo-symbols, vector icons) out of this test.
vi.mock("../components/sheet-close-button", () => ({
  SheetCloseButton: () => createElement("button", { type: "button" }, "Close"),
}));

const roots: ReturnType<typeof createRoot>[] = [];
function mount(element: ReactNode) {
  const node = document.createElement("div");
  const root = createRoot(node);
  roots.push(root);
  act(() => root.render(element));
  return node;
}
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

function FakeSheet({ children }: { children?: ReactNode }) {
  return createElement("div", { "data-fake-sheet": true }, children);
}

function body() {
  return createElement(View, null, createElement(Text, null, "Other models body"));
}

function shell(visible = true) {
  return (
    <BottomSheetShell visible={visible} label="Other models" onClose={() => {}}>
      {body()}
    </BottomSheetShell>
  );
}

describe("BottomSheetShell", () => {
  it("shows the content in a modal while the native sheet is still loading", () => {
    mocks.sheet = undefined;
    const node = mount(shell());
    expect(node.textContent).toContain("Other models body");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("shows the content in a modal when the build has no native sheet", () => {
    mocks.sheet = null;
    const node = mount(shell());
    expect(node.textContent).toContain("Other models body");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("uses the native sheet once it is available", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(shell());
    expect(node.textContent).toContain("Other models body");
    expect(node.querySelector("[data-native-sheet]")).not.toBeNull();
    expect(node.querySelector("dialog")).toBeNull();
  });

  it("renders nothing when hidden", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(shell(false));
    expect(node.textContent).toBe("");
  });
});
