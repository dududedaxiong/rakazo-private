// @vitest-environment jsdom
import type { ThreadMessage } from "@rakazo_mickvvw/contracts";
import { foldPeerReplies } from "@rakazo_mickvvw/core";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rpc } from "../../lib/rpc";
import { Transcript } from "./transcript";

const stableT = (strings: TemplateStringsArray, ...values: unknown[]) =>
  String.raw(strings, ...values);

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: stableT }),
}));

vi.mock("@lingui/core/macro", () => ({
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));

vi.mock("../../lib/rpc", () => ({ rpc: {} }));

let container: HTMLDivElement;
let root: Root;
let scrollRef: RefObject<HTMLDivElement | null>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  scrollRef = { current: container };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

let seq = 0;
function at(minutes: number) {
  return new Date(2026, 0, 1, 10, minutes).toISOString();
}

function textMessage(id: string, role: "user" | "bot", text: string): ThreadMessage {
  seq += 1;
  return {
    id,
    threadId: "thread",
    seq,
    role,
    createdAt: at(seq),
    blocks: [{ kind: "text", text }],
  };
}

function liveMessage(text: string): ThreadMessage {
  return {
    id: "progress:run",
    threadId: "thread",
    seq: 9999,
    role: "bot",
    createdAt: at(120),
    blocks: [{ kind: "progress", text }],
  };
}

function history(): ThreadMessage[] {
  return [
    textMessage("m1", "user", "Book a weekend in the mountains"),
    textMessage("m2", "bot", "Looking at cabins near Zakopane"),
    textMessage("m3", "bot", "Atlas will pick the dates"),
    textMessage("m4", "user", "Sounds good"),
  ];
}

function baseProps(messages: readonly ThreadMessage[]): ComponentProps<typeof Transcript> {
  return {
    scrollRef,
    scrollRequest: null,
    onScrollRequestHandled: vi.fn(),
    followRequest: 0,
    callHoldsSpeaker: false,
    artifactTarget: { botId: "bot" },
    transcript: foldPeerReplies(messages, { includePeerReceipts: true }),
    showToolActivity: false,
    olderCursor: null,
    unreadAfterSeq: null,
    loadingOlder: false,
    answerableAskIds: new Set<string>(),
    dismissableAskIds: new Set<string>(),
    running: true,
    runs: [],
    workingBots: [{ botId: "bot", color: "orange", status: "running" }],
    onLoadOlder: vi.fn(),
    onOpenBot: vi.fn(),
    onAnswer: vi.fn(),
    onReply: vi.fn(),
    onMarkUnread: vi.fn(),
    onQuote: vi.fn(),
    onReact: vi.fn(),
    onJumpToMessage: vi.fn(),
    onOpenPeerMessages: vi.fn(),
    peerBot: () => ({ name: "Atlas", color: "orange" }),
    onRefresh: vi.fn(),
    onBotChanged: vi.fn(),
    onAddRoutine: vi.fn(),
    voiceReady: false,
    speakingMessageId: null,
    onSpeak: vi.fn(),
    onOpenComputer: vi.fn(),
    rpc,
  };
}

function render(props: ComponentProps<typeof Transcript>) {
  act(() => root.render(<Transcript {...props} />));
}

it("shows a model-switch progress line under the messages while the run works", () => {
  const switching: ThreadMessage = {
    id: "progress:run",
    threadId: "thread",
    seq: 9999,
    role: "bot",
    createdAt: at(120),
    blocks: [
      {
        kind: "progress",
        text: "DeepSeek failed, trying backup model Kimi",
        activity: true,
      },
    ],
  };
  const props = baseProps([...history(), switching]);
  render(props);
  // The switch line is the live run's activity text, shown under the
  // messages while the fallback is being tried, not a chat bubble.
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent).toContain("DeepSeek failed, trying backup model Kimi");

  // Once the fallback replies, the switch line is gone and the reply stands.
  render({
    ...props,
    transcript: foldPeerReplies([...history(), textMessage("m5", "bot", "Done")], {
      includePeerReceipts: true,
    }),
    running: false,
  });
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.textContent).not.toContain("DeepSeek failed");
});

it("drops the quote pill when a streaming edit replaces the selected nodes", async () => {
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, width: 0 }) as DOMRect;
  const historyMessages = history();
  const props = baseProps([...historyMessages, liveMessage("Drafting")]);
  render(props);
  const row = container.querySelector<HTMLElement>('[data-message-id="m2"]')!;
  const select = (needle: string) => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !node.textContent?.includes(needle)) node = walker.nextNode() as Text | null;
    if (!node) throw new Error(`needle ${needle} not found`);
    const range = document.createRange();
    range.setStart(node, node.textContent!.indexOf(needle));
    range.setEnd(node, node.textContent!.indexOf(needle) + needle.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
  };

  select("cabins near");
  expect(document.querySelector("[data-quote-selection]")).not.toBeNull();
  const range = window.getSelection()!.getRangeAt(0);
  expect(range.collapsed).toBe(false);

  // The stream rewrites the message with new markdown structure, replacing
  // the nodes the selection covered.
  const rewritten = historyMessages.map((message) =>
    message.id === "m2"
      ? {
          ...message,
          blocks: [{ kind: "text" as const, text: "Looking at **cabins** near Zakopane" }],
        }
      : message,
  );
  render({
    ...props,
    transcript: foldPeerReplies([...rewritten, liveMessage("Drafting")], {
      includePeerReceipts: true,
    }),
  });

  expect(window.getSelection()!.getRangeAt(0).collapsed).toBe(true);
  expect(document.querySelector("[data-quote-selection]")).toBeNull();
});

it("drops the quote pill when an edit removes only one end of the selection", async () => {
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, width: 0 }) as DOMRect;
  const messages = history().map((message) =>
    message.id === "m2"
      ? {
          ...message,
          blocks: [{ kind: "text" as const, text: "Looking at **cabins** near Zakopane" }],
        }
      : message,
  );
  const props = baseProps([...messages, liveMessage("Drafting")]);
  render(props);
  const row = container.querySelector<HTMLElement>('[data-message-id="m2"]')!;
  const textNode = (needle: string) => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node && !node.textContent?.includes(needle)) node = walker.nextNode() as Text | null;
    if (!node) throw new Error(`needle ${needle} not found`);
    return node;
  };
  const start = textNode("Looking at");
  const end = textNode("near Zakopane");
  const range = document.createRange();
  range.setStart(start, start.textContent!.indexOf("at"));
  range.setEnd(end, end.textContent!.indexOf("near") + "near".length);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(document.querySelector("[data-quote-selection]")).not.toBeNull();

  // An edit replaces only the node holding the start: the range moves without collapsing.
  start.remove();
  render({
    ...props,
    transcript: foldPeerReplies([...messages, liveMessage("Drafting more")], {
      includePeerReceipts: true,
    }),
  });

  expect(window.getSelection()!.getRangeAt(0).collapsed).toBe(false);
  expect(document.querySelector("[data-quote-selection]")).toBeNull();
});

it("shows read-aloud progress only under the message being read", () => {
  const messages = [
    textMessage("m1", "bot", "First reply."),
    textMessage("m2", "bot", "Second reply."),
  ];
  render({
    ...baseProps(messages),
    speakingMessageId: "m2",
    speakingProgress: {
      messageId: "m2",
      caption: "Middle of the second reply.",
      index: 1,
      total: 3,
    },
  });
  const lines = [...document.querySelectorAll('[data-testid="read-aloud-progress"]')];
  expect(lines).toHaveLength(1);
  expect(lines[0]?.textContent).toContain("Middle of the second reply.");
  expect(lines[0]?.textContent).toContain("Segment 2 of 3");
});

it("shows the stuck recovery row under a message whose run went quiet", () => {
  const startedAt = new Date(Date.now() - 200_000).toISOString();
  const userMessage = { ...textMessage("m1", "user", "Shanghai weather"), runId: "run-1" };
  render({
    ...baseProps([userMessage]),
    runs: [
      {
        id: "run-1",
        botId: "bot",
        threadId: "thread",
        taskId: "task",
        status: "running",
        trigger: "user",
        routineId: null,
        routineName: null,
        modelProvider: "p1",
        modelId: "model-a",
        error: null,
        startedAt,
        completedAt: null,
        createdAt: startedAt,
      },
    ],
    availableTranslationModels: [
      { provider: "p1", model: "model-a" },
      { provider: "p2", model: "model-b" },
    ],
    onStopRun: vi.fn(),
    onRetryStuckRun: vi.fn(),
  });
  expect(container.querySelector('[data-testid="stuck-run-actions"]')).not.toBeNull();
});

it("clears a stuck run's frozen progress line while its recovery row stays", () => {
  const startedAt = new Date(Date.now() - 200_000).toISOString();
  const userMessage = { ...textMessage("m1", "user", "Shanghai weather"), runId: "run-1" };
  const frozen: ThreadMessage = {
    id: "progress:run-1",
    threadId: "thread",
    seq: 9999,
    role: "bot",
    runId: "run-1",
    botId: "bot",
    createdAt: at(120),
    blocks: [{ kind: "progress", text: "Still thinking…", activity: true }],
  };
  render({
    ...baseProps([userMessage, frozen]),
    runs: [
      {
        id: "run-1",
        botId: "bot",
        threadId: "thread",
        taskId: "task",
        status: "running",
        trigger: "user",
        routineId: null,
        routineName: null,
        modelProvider: "p1",
        modelId: "model-a",
        error: null,
        startedAt,
        completedAt: null,
        createdAt: startedAt,
      },
    ],
    onStopRun: vi.fn(),
    onRetryStuckRun: vi.fn(),
  });
  expect(container.querySelector('[data-testid="stuck-run-actions"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Still thinking");
});

it("hides the stuck recovery row while the run is still young", () => {
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const userMessage = { ...textMessage("m1", "user", "Shanghai weather"), runId: "run-1" };
  render({
    ...baseProps([userMessage]),
    runs: [
      {
        id: "run-1",
        botId: "bot",
        threadId: "thread",
        taskId: "task",
        status: "running",
        trigger: "user",
        routineId: null,
        routineName: null,
        modelProvider: "p1",
        modelId: "model-a",
        error: null,
        startedAt,
        completedAt: null,
        createdAt: startedAt,
      },
    ],
    onStopRun: vi.fn(),
    onRetryStuckRun: vi.fn(),
  });
  expect(container.querySelector('[data-testid="stuck-run-actions"]')).toBeNull();
});
