// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRowActions } from "../components/thread/message-row";
import { useLatestRowActions, useThreadRows } from "../components/thread/thread-rows";
import type { MobileMessage, MobileSnapshot } from "./mobile-types";
import type { useThreadTranscript } from "./thread-transcript";

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    Platform: { OS: "ios" },
    StyleSheet: { create: <T,>(styles: T) => styles },
    View: ({ children }: { children?: ReactNode }) => h("div", null, children),
  };
});

// The translation function must be referentially stable across renders, as in
// the app; a fresh `t` on every render would recreate the row renderer for an
// unrelated reason and hide the stale-selection bug this test guards.
const i18n = vi.hoisted(() => ({ t: (message: string) => message, locale: "en" }));
vi.mock("./i18n", () => ({
  useI18n: () => i18n,
}));

// thread-favorites lazily imports expo-secure-store; without these mocks the
// real Expo module pulls in Expo's async-require setup, which references the
// __DEV__ global the test environment lacks.
vi.mock("expo-modules-core", () => ({ requireNativeModule: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("./thread-edges", () => ({
  threadHeaderFloats: () => false,
}));

// The rows only need these two pure helpers from these modules; importing the
// real modules pulls in the API client and its Expo dependencies.
vi.mock("./thread-favorites", () => ({
  translationFavoriteId: (id: string) => `translation:${id}`,
}));
vi.mock("./thread-message-text", () => ({
  previewMessageText: () => "",
}));

vi.mock("../components/thread/message-row", () => ({
  MessageRow: () => null,
}));

vi.mock("../components/time-separator", () => ({ TimeSeparator: () => null }));
vi.mock("../components/unread-divider", () => ({ UnreadDivider: () => null }));
vi.mock("../components/VoiceChatCard", () => ({ VoiceChatCard: () => null }));

type Rows = ReturnType<typeof useThreadRows>;
type RowsProps = Parameters<typeof useThreadRows>[0];

function message(id: string, text: string): MobileMessage {
  return {
    id,
    role: "user",
    author: { id: "u1", name: "Me" },
    createdAt: Date.now(),
    blocks: [{ kind: "text", text }],
  } as unknown as MobileMessage;
}

describe("useThreadRows multi-select", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let latest: Rows | null = null;

  function Harness({ props }: { props: RowsProps }) {
    latest = useThreadRows(props);
    return null;
  }

  function render(props: RowsProps) {
    act(() => {
      root?.render(createElement(Harness, { props }));
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    latest = null;
  });

  it("reflects a second picked message after the selection changes", () => {
    const first = message("m1", "first");
    const second = message("m2", "second");
    const messages = [first, second];
    // Every input except the selection is the same reference on both renders,
    // as in the app where the transcript and snapshot are memoized. Only the
    // picked set changes, so a stale row renderer would keep the first render's
    // selection and never show the second message as picked.
    const toggle = vi.fn();
    const snap = {
      messages,
      members: [],
      activeRuns: [],
      run: null,
      olderCursor: null,
    } as unknown as MobileSnapshot;
    const transcriptObj = {
      showBotSenderName: false,
      reactionView: {
        reactions: new Map(),
        mentions: new Map(),
        visibleMessages: messages,
      },
      exchanges: { lines: new Map(), lineOf: new Map() },
      visibleMessages: messages,
    } as unknown as ReturnType<typeof useThreadTranscript>;
    const base: RowsProps = {
      snap,
      userId: "u1",
      transcript: transcriptObj,
      rowActions: {} as unknown as RowsProps["rowActions"],
      botId: "b1",
      inGroup: false,
      readOnly: false,
      onCall: false,
      mentionBots: [],
      columnWidth: 400,
      readSeq: null,
      highlightedMessageId: null,
      selecting: true,
      selectedMessageIds: new Set(["m1"]),
      onToggleSelectMessage: toggle,
    };

    render(base);
    const firstRow = latest?.renderMessageRow(first) as ReactElement<{ selected: boolean }>;
    const secondRow = latest?.renderMessageRow(second) as ReactElement<{ selected: boolean }>;
    expect(firstRow.props.selected).toBe(true);
    expect(secondRow.props.selected).toBe(false);

    // Tapping a second message adds it to the picked set; the rows must
    // re-render with the fresh selection instead of the stale one.
    render({ ...base, selectedMessageIds: new Set(["m1", "m2"]) });
    const firstRowAfter = latest?.renderMessageRow(first) as ReactElement<{ selected: boolean }>;
    const secondRowAfter = latest?.renderMessageRow(second) as ReactElement<{ selected: boolean }>;
    expect(firstRowAfter.props.selected).toBe(true);
    expect(secondRowAfter.props.selected).toBe(true);
  });

  it("shows checkboxes only while selecting", () => {
    const first = message("m1", "first");
    const messages = [first];
    const snap = {
      messages,
      members: [],
      activeRuns: [],
      run: null,
      olderCursor: null,
    } as unknown as MobileSnapshot;
    const transcriptObj = {
      showBotSenderName: false,
      reactionView: {
        reactions: new Map(),
        mentions: new Map(),
        visibleMessages: messages,
      },
      exchanges: { lines: new Map(), lineOf: new Map() },
      visibleMessages: messages,
    } as unknown as ReturnType<typeof useThreadTranscript>;
    const base: RowsProps = {
      snap,
      userId: "u1",
      transcript: transcriptObj,
      rowActions: {} as unknown as RowsProps["rowActions"],
      botId: "b1",
      inGroup: false,
      readOnly: false,
      onCall: false,
      mentionBots: [],
      columnWidth: 400,
      readSeq: null,
      highlightedMessageId: null,
      selecting: false,
      selectedMessageIds: new Set(),
      onToggleSelectMessage: vi.fn(),
    };

    render(base);
    const row = latest?.renderMessageRow(first) as ReactElement<{ selecting: boolean }>;
    expect(row.props.selecting).toBe(false);

    render({ ...base, selecting: true, selectedMessageIds: new Set(["m1"]) });
    const selectingRow = latest?.renderMessageRow(first) as ReactElement<{ selecting: boolean }>;
    expect(selectingRow.props.selecting).toBe(true);
  });
});

describe("useLatestRowActions resend", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let latest: MessageRowActions | null = null;

  function Harness({ current }: { current: MessageRowActions }) {
    latest = useLatestRowActions(current);
    return null;
  }

  function render(current: MessageRowActions) {
    act(() => {
      root?.render(createElement(Harness, { current }));
    });
  }

  function rowActions(resend: (message: MobileMessage) => void): MessageRowActions {
    return {
      helperToggle: () => {},
      reply: () => {},
      quote: () => {},
      select: () => {},
      enterSelection: () => {},
      speak: () => {},
      react: async () => true,
      markUnread: () => {},
      answer: async () => {},
      openBot: () => {},
      openComputer: () => {},
      previewFile: () => {},
      previewImage: () => {},
      jump: () => {},
      dismissChoice: () => {},
      openPeerChat: () => {},
      layout: () => {},
      resend,
    };
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    latest = null;
  });

  it("forwards resend to the latest action without invalidating rows", () => {
    const first = vi.fn();
    const target = message("m1", "Hello again");
    render(rowActions(first));
    const stable = latest;
    expect(stable).not.toBeNull();
    stable?.resend?.(target);
    expect(first).toHaveBeenCalledWith(target);

    // Re-rendering with a new resend keeps the same stable wrapper, but the
    // wrapper must call through to the newest action, not the first one.
    const second = vi.fn();
    render(rowActions(second));
    expect(latest).toBe(stable);
    latest?.resend?.(target);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(target);
  });
});
