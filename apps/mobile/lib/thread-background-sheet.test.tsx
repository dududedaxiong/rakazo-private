// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadBackgroundSheet } from "../components/thread/thread-background-sheet";

const mocks = vi.hoisted(() => ({ sheet: undefined as unknown }));

vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 402, height: 800, fontScale: 1 }),
  StyleSheet: { create: (styles: unknown) => styles },
  Modal: ({ children }: { children: ReactNode }) =>
    createElement("dialog", { open: true }, children),
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("p", null, children),
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
  TextInput: () => createElement("input", { type: "text" }),
  Image: () => null,
  Alert: { alert: vi.fn() },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Platform: { OS: "android" },
}));
vi.mock("../components/native-sheet", () => ({
  useNativeSheet: () => mocks.sheet,
  NativeSheet: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-native-sheet": true }, children),
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    card: "token-card",
    background: "token-background",
    foreground: "token-foreground",
    mutedForeground: "token-muted",
    border: "token-border",
  }),
}));
vi.mock("./i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("./chat-background", () => ({
  CHAT_BACKGROUND_DEFAULT_OPACITY: 0.8,
  chatBackgroundOpacityFromRatio: (ratio: number) => ratio,
  deleteChatBackgroundFile: vi.fn(),
  isChatBackgroundUrl: () => false,
  saveChatBackgroundFile: vi.fn(),
  setChatBackground: vi.fn(),
  setChatBackgroundOpacity: vi.fn(),
  useChatBackground: () => null,
}));
vi.mock("./hero-background", () => ({
  deleteHeroBackgroundFile: vi.fn(),
  saveHeroBackgroundFile: vi.fn(),
  setHeroBackground: vi.fn(),
  setHeroBackgroundOpacity: vi.fn(),
  useHeroBackground: () => null,
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
}));
vi.mock("../components/native-symbol", () => ({
  NativeSymbol: () => null,
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

function sheet(visible = true) {
  return createElement(ThreadBackgroundSheet, {
    visible,
    threadKey: "thread-1",
    heroVisible: true,
    onClose: () => {},
  });
}

describe("ThreadBackgroundSheet", () => {
  it("shows the background settings in a modal while the native sheet is still loading", () => {
    mocks.sheet = undefined;
    const node = mount(sheet());
    expect(node.textContent).toContain("Chat background");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("shows the background settings in a modal when the build has no native sheet", () => {
    mocks.sheet = null;
    const node = mount(sheet());
    expect(node.textContent).toContain("Chat background");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("uses the native sheet once it is available", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(sheet());
    expect(node.textContent).toContain("Chat background");
    expect(node.querySelector("[data-native-sheet]")).not.toBeNull();
    expect(node.querySelector("dialog")).toBeNull();
  });

  it("renders nothing when hidden", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(sheet(false));
    expect(node.textContent).toBe("");
  });
});
