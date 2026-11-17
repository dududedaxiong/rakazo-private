// @vitest-environment jsdom

import type { Bot, ThreadMessage, ThreadSnapshot } from "@rakazo_mickvvw/contracts";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useReadAloud } from "./use-read-aloud";

const speakerMock = vi.hoisted(() => {
  const listeners = new Set<
    (snapshot: {
      status: string;
      messageId?: string;
      caption?: string;
      segmentIndex?: number;
      segmentTotal?: number;
    }) => void
  >();
  return {
    speak: vi.fn(async (): Promise<string | undefined> => undefined),
    stop: vi.fn(),
    subscribe: (
      listener: (snapshot: {
        status: string;
        messageId?: string;
        caption?: string;
        segmentIndex?: number;
        segmentTotal?: number;
      }) => void,
    ) => {
      listeners.add(listener);
      listener({ status: "idle" });
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (snapshot: {
      status: string;
      messageId?: string;
      caption?: string;
      segmentIndex?: number;
      segmentTotal?: number;
    }) => {
      for (const listener of [...listeners]) listener(snapshot);
    },
    isSpeaking: () => false,
  };
});
const speak = speakerMock.speak;

vi.mock("../../lib/tts", () => ({ speaker: speakerMock }));
vi.mock("@rakazo_mickvvw/ui-web", () => ({ toast: { error: vi.fn() } }));

const speaking: Bot = { id: "bot-b", autoSpeak: true } as unknown as Bot;

function message(id: string, text: string, role: "user" | "bot" = "bot"): ThreadMessage {
  return { id, role, blocks: [{ kind: "text", text }] } as unknown as ThreadMessage;
}

function snapshot(
  messages: ThreadMessage[],
  run: { status: string } | null = null,
): ThreadSnapshot {
  return { botId: "bot-b", messages, run } as unknown as ThreadSnapshot;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: ReturnType<typeof useReadAloud>;

function renderRead(props: { snapshot: ThreadSnapshot; callBotId?: string }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rerenderRead(props);
}

function rerenderRead({ snapshot, callBotId }: { snapshot: ThreadSnapshot; callBotId?: string }) {
  act(() => {
    root?.render(<ReadHarness active={speaking} snapshot={snapshot} callBotId={callBotId} />);
  });
}

function ReadHarness({
  active,
  snapshot,
  callBotId,
}: {
  active: Bot;
  snapshot: ThreadSnapshot;
  callBotId?: string;
}) {
  latest = useReadAloud({ active, snapshot, callBotId, activeBotId: { current: active.id } });
  return null;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

it("does not auto-speak a reply while a call with another bot is active", () => {
  const first = snapshot([message("m1", "first reply")]);
  renderRead({ snapshot: first });
  rerenderRead({
    snapshot: snapshot([message("m1", "first reply"), message("m2", "second reply")]),
    callBotId: "bot-a",
  });
  expect(speak).not.toHaveBeenCalled();
  // The reply that arrived during the call stays marked spoken, not queued.
  rerenderRead({
    snapshot: snapshot([message("m1", "first reply"), message("m2", "second reply")]),
  });
  expect(speak).not.toHaveBeenCalled();
});

it("auto-speaks a new reply when no call is active", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]) });
  rerenderRead({
    snapshot: snapshot([message("m1", "first reply"), message("m2", "second reply")]),
  });
  expect(speak).toHaveBeenCalledWith("second reply", {
    botId: "bot-b",
    messageId: "m2",
    full: false,
  });
});

it("does not start a manual read while a call is active", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]), callBotId: "bot-a" });
  act(() => latest.speakMessage(message("m2", "spoken words")));
  expect(speak).not.toHaveBeenCalled();
});

it("reads a message on request when no call is active", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]) });
  act(() => latest.speakMessage(message("m2", "spoken words")));
  expect(speak).toHaveBeenCalledWith("spoken words", {
    botId: "bot-b",
    messageId: "m2",
    full: true,
  });
});

it("reads arbitrary text, such as a translation, on request", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]) });
  act(() => latest.speakText("translated words", { botId: "bot-b", messageId: "m2" }));
  expect(speak).toHaveBeenCalledWith("translated words", {
    botId: "bot-b",
    messageId: "m2",
    full: true,
  });
});

it("does not start an arbitrary read while a call is active", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]), callBotId: "bot-a" });
  act(() => latest.speakText("translated words", { botId: "bot-b", messageId: "m2" }));
  expect(speak).not.toHaveBeenCalled();
});

function deferredSpeak() {
  let resolve: (value: undefined) => void = () => undefined;
  speak.mockImplementationOnce(
    () =>
      new Promise<undefined>((r) => {
        resolve = r;
      }),
  );
  return () => resolve(undefined);
}

it("reads the whole conversation in order, user and bot messages alike", async () => {
  renderRead({
    snapshot: snapshot([
      message("m1", "first", "user"),
      message("m2", "second"),
      message("m3", "third", "user"),
      message("m4", ""),
    ]),
  });
  await act(async () => {
    await latest.readConversation();
  });
  expect(speak.mock.calls).toEqual([
    ["first", { botId: "bot-b", messageId: "m1", full: true }],
    ["second", { botId: "bot-b", messageId: "m2", full: true }],
    ["third", { botId: "bot-b", messageId: "m3", full: true }],
  ]);
  expect(latest.readingConversation).toBe(false);
});

it("stops a conversation read when asked again", async () => {
  renderRead({
    snapshot: snapshot([message("m1", "first"), message("m2", "second")]),
  });
  const resolveFirst = deferredSpeak();
  let done: Promise<void> | undefined;
  act(() => {
    done = latest.readConversation();
  });
  expect(speak).toHaveBeenCalledTimes(1);
  expect(latest.readingConversation).toBe(true);
  act(() => {
    void latest.readConversation();
  });
  expect(speakerMock.stop).toHaveBeenCalled();
  await act(async () => {
    resolveFirst();
    await done;
  });
  expect(speak).toHaveBeenCalledTimes(1);
  expect(latest.readingConversation).toBe(false);
});

it("a manual read cancels a conversation read", async () => {
  renderRead({
    snapshot: snapshot([message("m1", "first"), message("m2", "second")]),
  });
  const resolveFirst = deferredSpeak();
  let done: Promise<void> | undefined;
  act(() => {
    done = latest.readConversation();
  });
  act(() => latest.speakMessage(message("m9", "spoken words")));
  expect(speak.mock.calls[1]).toEqual([
    "spoken words",
    { botId: "bot-b", messageId: "m9", full: true },
  ]);
  await act(async () => {
    resolveFirst();
    await done;
  });
  expect(speak).toHaveBeenCalledTimes(2);
  expect(latest.readingConversation).toBe(false);
});

it("tapping the message being read stops a conversation read", async () => {
  renderRead({
    snapshot: snapshot([message("m1", "first"), message("m2", "second")]),
  });
  const resolveFirst = deferredSpeak();
  let done: Promise<void> | undefined;
  act(() => {
    done = latest.readConversation();
  });
  act(() => speakerMock.emit({ status: "speaking", messageId: "m1" }));
  expect(latest.speakingMessageId).toBe("m1");
  act(() => latest.speakText("first", { botId: "bot-b", messageId: "m1" }));
  expect(speakerMock.stop).toHaveBeenCalled();
  await act(async () => {
    resolveFirst();
    await done;
  });
  expect(speak).toHaveBeenCalledTimes(1);
  expect(latest.readingConversation).toBe(false);
});

it("skips a reply still streaming at the end of a conversation read", async () => {
  renderRead({
    snapshot: snapshot([message("m1", "first", "user"), message("m2", "second")], {
      status: "running",
    }),
  });
  await act(async () => {
    await latest.readConversation();
  });
  expect(speak.mock.calls).toEqual([["first", { botId: "bot-b", messageId: "m1", full: true }]]);
});

it("does not start a conversation read while a call is active", async () => {
  renderRead({
    snapshot: snapshot([message("m1", "first reply")]),
    callBotId: "bot-a",
  });
  await act(async () => {
    await latest.readConversation();
  });
  expect(speak).not.toHaveBeenCalled();
  expect(latest.readingConversation).toBe(false);
});

it("stops the queue when a read fails outright", async () => {
  renderRead({
    snapshot: snapshot([message("m1", "first"), message("m2", "second")]),
  });
  speak.mockResolvedValueOnce("Voice provider is out of credit.");
  await act(async () => {
    await latest.readConversation();
  });
  expect(speak).toHaveBeenCalledTimes(1);
  expect(latest.readingConversation).toBe(false);
});

it("exposes the current read-aloud segment and clears it when idle", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]) });
  expect(latest.speakingProgress).toBeNull();
  act(() =>
    speakerMock.emit({
      status: "speaking",
      messageId: "m1",
      caption: "Second part.",
      segmentIndex: 1,
      segmentTotal: 3,
    }),
  );
  expect(latest.speakingMessageId).toBe("m1");
  expect(latest.speakingProgress).toEqual({
    messageId: "m1",
    caption: "Second part.",
    index: 1,
    total: 3,
  });
  act(() => speakerMock.emit({ status: "idle" }));
  expect(latest.speakingProgress).toBeNull();
  expect(latest.speakingMessageId).toBeNull();
});

it("hides progress while a read is still preparing", () => {
  renderRead({ snapshot: snapshot([message("m1", "first reply")]) });
  act(() => speakerMock.emit({ status: "preparing", messageId: "m1" }));
  expect(latest.speakingMessageId).toBe("m1");
  expect(latest.speakingProgress).toBeNull();
});
