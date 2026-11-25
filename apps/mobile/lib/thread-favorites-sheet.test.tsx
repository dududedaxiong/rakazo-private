// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadFavoritesSheet } from "../components/thread/thread-favorites-sheet";

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
vi.mock("./thread-favorites", () => ({
  favoriteMessageId: (item: { messageId: string }) => item.messageId,
  removeThreadFavorite: vi.fn(),
  useThreadFavorites: () => [],
}));
// The favorite cards (with translation) only render when favorites exist;
// the empty state under test never reaches them.
vi.mock("../components/thread/message-translation", () => ({
  MessageTranslationView: () => null,
  TranslateButton: () => null,
  useMessageTranslation: () => ({
    status: "idle",
    expanded: false,
    result: null,
    translate: () => {},
    expand: () => {},
  }),
}));
vi.mock("./translation", () => ({
  translationSettingsFromBot: () => ({ showTranslationActions: false }),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
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
  return createElement(ThreadFavoritesSheet, {
    visible,
    threadKey: "thread-1",
    bot: null,
    onClose: () => {},
    onJump: () => {},
  });
}

describe("ThreadFavoritesSheet", () => {
  it("shows the favorites in a modal while the native sheet is still loading", () => {
    mocks.sheet = undefined;
    const node = mount(sheet());
    expect(node.textContent).toContain("My favorites");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("shows the favorites in a modal when the build has no native sheet", () => {
    mocks.sheet = null;
    const node = mount(sheet());
    expect(node.textContent).toContain("My favorites");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("uses the native sheet once it is available", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(sheet());
    expect(node.textContent).toContain("My favorites");
    expect(node.querySelector("[data-native-sheet]")).not.toBeNull();
    expect(node.querySelector("dialog")).toBeNull();
  });

  it("renders nothing when hidden", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(sheet(false));
    expect(node.textContent).toBe("");
  });
});
