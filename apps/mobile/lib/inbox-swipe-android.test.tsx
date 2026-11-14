// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxSwipeRowProps } from "../components/inbox-swipe-row";
import { InboxSwipeRow } from "../components/inbox-swipe-row";
import type { InboxRowAction } from "./inbox-swipe";
import type { MobileBotSection } from "./mobile-types";

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": accessibilityLabel,
        role: accessibilityRole,
        onClick: onPress,
      },
      children,
    ),
}));
// react-native-gesture-handler ships syntax the jsdom runner cannot parse; the
// swipe action renders inline here so its button stays clickable in tests.
vi.mock("react-native-gesture-handler", () => ({
  Swipeable: ({
    children,
    renderRightActions,
  }: {
    children?: ReactNode;
    renderRightActions?: () => ReactNode;
  }) => createElement("div", null, children, renderRightActions?.()),
}));
vi.mock("./native", () => ({
  native: {},
  useMobileTokens: () => ({
    destructiveFill: "error-fill",
    destructiveForeground: "on-error-fill",
  }),
}));
vi.mock("./i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Android swipe row", () => {
  const sections = [{ id: "s1", name: "Work" }] as MobileBotSection[];

  function render(row: Partial<InboxSwipeRowProps> = {}) {
    const onAction = vi.fn<(action: InboxRowAction) => void>();
    const onOrganize = vi.fn<InboxSwipeRowProps["onOrganize"]>();
    const onEditSection = vi.fn<InboxSwipeRowProps["onEditSection"]>();
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <InboxSwipeRow
          rowKey="bot:1"
          sections={sections}
          preview={{ title: "Ada", message: "Hi", avatar: <i /> }}
          onAction={onAction}
          onOrganize={onOrganize}
          onEditSection={onEditSection}
          {...row}
        >
          <span>row</span>
        </InboxSwipeRow>,
      ),
    );
    const deleteButton = () => container.querySelector<HTMLElement>('button[aria-label="Delete…"]');
    return { container, root, onAction, deleteButton };
  }

  it("reveals a Delete button on swipe left", () => {
    const { container, deleteButton, root } = render();
    expect(container.textContent).toContain("row");
    expect(deleteButton()).not.toBeNull();
    act(() => root.unmount());
  });

  it("pressing Delete calls onAction with delete", () => {
    const { deleteButton, onAction, root } = render();
    act(() => deleteButton()!.click());
    expect(onAction.mock.calls).toEqual([["delete"]]);
    act(() => root.unmount());
  });

  it("renders the row plainly without actions", () => {
    // The pass-through is defensive: callers only mount the row with actions, but a row
    // without them must still render instead of swiping nowhere.
    const { container, deleteButton, root } = render({
      onAction: undefined as unknown as InboxSwipeRowProps["onAction"],
    });
    expect(container.textContent).toContain("row");
    expect(deleteButton()).toBeNull();
    act(() => root.unmount());
  });
});
