// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadRows } from "../components/thread/thread-rows";
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

const i18n = vi.hoisted(() => ({ t: (message: string) => message, locale: "en" }));
vi.mock("./i18n", () => ({
  useI18n: () => i18n,
}));

vi.mock("expo-modules-core", () => ({ requireNativeModule: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("./thread-edges", () => ({
  threadHeaderFloats: () => false,
}));

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

function userMessage(id: string, runId: string | null): MobileMessage {
  return {
    id,
    role: "user",
    author: { id: "u1", name: "Me" },
    createdAt: Date.now(),
    runId,
    blocks: [{ kind: "text", text: "Shanghai weather" }],
  } as unknown as MobileMessage;
}

function botMessage(id: string, text: string): MobileMessage {
  return {
    id,
    role: "bot",
    author: { id: "b1", name: "Bot" },
    createdAt: Date.now(),
    blocks: [{ kind: "text", text }],
  } as unknown as MobileMessage;
}

function runningRun(startedAgoMs: number, status = "running") {
  const startedAt = new Date(Date.now() - startedAgoMs).toISOString();
  return {
    id: "run-1",
    status,
    botId: "b1",
    modelProvider: "p1",
    modelId: "model-a",
    startedAt,
    createdAt: startedAt,
  };
}

describe("useThreadRows stuck runs", () => {
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

  function baseProps(messages: MobileMessage[], run: ReturnType<typeof runningRun> | null) {
    const snap = {
      messages,
      members: [],
      activeRuns: run ? [run] : [],
      run,
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
    return {
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
    } satisfies RowsProps;
  }

  function stuckOf(message: MobileMessage) {
    const row = latest?.renderMessageRow(message) as ReactElement<{ stuck?: boolean }>;
    return row.props.stuck;
  }

  it("marks a message stuck when its run went quiet past the threshold", () => {
    const message = userMessage("m1", "run-1");
    render(baseProps([message], runningRun(200_000)));
    expect(stuckOf(message)).toBe(true);
  });

  it("does not mark a message stuck while its run is still young", () => {
    const message = userMessage("m1", "run-1");
    render(baseProps([message], runningRun(60_000)));
    expect(stuckOf(message)).toBe(false);
  });

  it("does not mark a message stuck once its run answered", () => {
    const message = userMessage("m1", "run-1");
    const reply = botMessage("m2", "Sunny, 24 degrees.");
    render(baseProps([message, reply], runningRun(200_000)));
    expect(stuckOf(message)).toBe(false);
  });

  it("does not mark a message stuck when its run finished", () => {
    const message = userMessage("m1", "run-1");
    render(baseProps([message], runningRun(200_000, "completed")));
    expect(stuckOf(message)).toBe(false);
  });

  it("marks only the message whose run is stuck", () => {
    const stuckMessage = userMessage("m1", "run-1");
    const otherMessage = userMessage("m2", null);
    render(baseProps([stuckMessage, otherMessage], runningRun(200_000)));
    expect(stuckOf(stuckMessage)).toBe(true);
    expect(stuckOf(otherMessage)).toBe(false);
  });
});
