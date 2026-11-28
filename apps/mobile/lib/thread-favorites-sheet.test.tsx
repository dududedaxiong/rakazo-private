// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sheetState = vi.hoisted(() => ({
  sheet: undefined as ComponentType<unknown> | null | undefined,
}));

vi.mock("../components/native-sheet", () => ({
  NativeSheet: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-testid": "native-sheet" }, children),
  useNativeSheet: () => sheetState.sheet,
}));
vi.mock("./thread-favorites", () => ({
  favoriteMessageId: (item: { messageId: string }) => item.messageId,
  removeThreadFavorite: vi.fn(),
  useThreadFavorites: () => [],
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    card: "#ffffff",
    foreground: "#111111",
    mutedForeground: "#666666",
    border: "#dddddd",
  }),
}));
vi.mock("./i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./translation", () => ({
  translationSettingsFromBot: () => ({}),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
}));
vi.mock("../components/thread/message-translation", () => ({
  MessageTranslationView: () => null,
  TranslateButton: () => null,
  useMessageTranslation: () => ({ status: "idle" }),
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-testid": "fallback-modal" }, children),
  Platform: { OS: "android" },
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

import { ThreadFavoritesSheet } from "../components/thread/thread-favorites-sheet";

let root: Root;
let node: HTMLDivElement;

async function mountSheet() {
  await act(async () =>
    root.render(
      <ThreadFavoritesSheet
        visible
        threadKey="thread-1"
        bot={null}
        onClose={vi.fn()}
        onJump={vi.fn()}
      />,
    ),
  );
}

beforeEach(() => {
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("ThreadFavoritesSheet fallback", () => {
  it("shows the Modal fallback while the native sheet is still loading", async () => {
    sheetState.sheet = undefined;
    await mountSheet();
    expect(node.querySelector('[data-testid="fallback-modal"]')).not.toBeNull();
    expect(node.textContent).toContain("My favorites");
  });

  it("shows the Modal fallback when the native sheet is unavailable", async () => {
    sheetState.sheet = null;
    await mountSheet();
    expect(node.querySelector('[data-testid="fallback-modal"]')).not.toBeNull();
    expect(node.textContent).toContain("My favorites");
  });

  it("uses the native sheet when it is available", async () => {
    sheetState.sheet = (() => null) as unknown as ComponentType<unknown>;
    await mountSheet();
    expect(node.querySelector('[data-testid="native-sheet"]')).not.toBeNull();
    expect(node.querySelector('[data-testid="fallback-modal"]')).toBeNull();
  });

  it("renders nothing when it is not visible", async () => {
    sheetState.sheet = null;
    await act(async () =>
      root.render(
        <ThreadFavoritesSheet
          visible={false}
          threadKey="thread-1"
          bot={null}
          onClose={vi.fn()}
          onJump={vi.fn()}
        />,
      ),
    );
    expect(node.textContent).toBe("");
  });
});
