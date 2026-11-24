// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunErrorSheetContainer } from "../components/run-error-sheet-container";

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
vi.mock("../lib/native", () => ({
  native: { fill: "native-fill" },
  useMobileTokens: () => ({ card: "token-card", background: "token-background" }),
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
  return createElement(View, null, createElement(Text, null, "Technical details body"));
}

describe("RunErrorSheetContainer", () => {
  it("shows the details in a modal while the native sheet is still loading", () => {
    mocks.sheet = undefined;
    const node = mount(
      createElement(
        RunErrorSheetContainer,
        {
          onClose: () => {},
          expanded: false,
          label: "Anthropic 响应超时。请重试。",
          children: body(),
        },
      ),
    );
    expect(node.textContent).toContain("Technical details body");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("shows the details in a modal when the build has no native sheet", () => {
    mocks.sheet = null;
    const node = mount(
      createElement(
        RunErrorSheetContainer,
        {
          onClose: () => {},
          expanded: false,
          label: "Anthropic 响应超时。请重试。",
          children: body(),
        },
      ),
    );
    expect(node.textContent).toContain("Technical details body");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("uses the native sheet once it is available", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(
      createElement(
        RunErrorSheetContainer,
        {
          onClose: () => {},
          expanded: false,
          label: "Anthropic 响应超时。请重试。",
          children: body(),
        },
      ),
    );
    expect(node.textContent).toContain("Technical details body");
    expect(node.querySelector("[data-native-sheet]")).not.toBeNull();
    expect(node.querySelector("dialog")).toBeNull();
  });
});
