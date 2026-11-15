// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { ThreadMessage } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFavoritesCache } from "../../lib/favorites";
import { rpc } from "../../lib/rpc";
import { MessageView } from "./message-view";

const skills = vi.hoisted(() => ({
  updateDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
  testRun: vi.fn(async () => ({ runId: "run" })),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { skills, artifacts: { get: vi.fn() } } }));

vi.mock("@lingui/core/macro", () => ({
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
}));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.activate("en");
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type PeerBot = ComponentProps<typeof MessageView>["peerBot"];
const missingBot: PeerBot = () => undefined;
const existingBot: PeerBot = () => ({ color: "orange" });

const planner = (status: "created" | "archived" | "deleted" = "created") => ({
  kind: "child_bot" as const,
  botId: "child",
  name: "Planner",
  status,
});

function renderView(
  role: ThreadMessage["role"],
  blocks: ThreadMessage["blocks"],
  props: Partial<ComponentProps<typeof MessageView>> = {},
) {
  const message: ThreadMessage = {
    id: "message",
    threadId: "thread",
    seq: 1,
    role,
    createdAt: new Date().toISOString(),
    blocks,
  };
  act(() =>
    root.render(
      <MessageView
        rpc={rpc}
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        peerBot={existingBot}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        callHoldsSpeaker={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
        {...props}
      />,
    ),
  );
}

function renderMessage(
  blocks: ThreadMessage["blocks"],
  peerBot: PeerBot,
  mentions?: ReturnType<typeof planner>[],
) {
  const onOpenBot = vi.fn();
  renderView("bot", blocks, { mentions, onOpenBot, peerBot });
  const mention = container.querySelector<HTMLElement>('[data-testid="bot-mention"]')!;
  act(() => mention.click());
  return { mention, onOpenBot };
}

it("keeps a received peer marker off the user's side while user replies align to the end", () => {
  renderView("user", [
    { kind: "bot_message_received", fromBotId: "peer", fromBotName: "Atlas", text: "Done." },
  ]);
  const chip = container.querySelector('[data-testid="peer-receipt-chip"]');
  expect(chip?.textContent).toBe("Message from Atlas");
  expect(chip?.closest(".items-end")).toBeNull();

  renderView("user", [{ kind: "text", text: "Thanks." }]);
  expect(container.querySelector(".items-end")?.textContent).toContain("Thanks.");
});

it("names a new bot inline in the reply, in its color", () => {
  const { mention, onOpenBot } = renderMessage(
    [{ kind: "text", text: "Planner is ready." }],
    existingBot,
    [planner()],
  );
  const bubble = container.querySelector('[data-testid="message-bot-bubble"]');
  expect(bubble?.contains(mention)).toBe(true);
  expect(bubble?.textContent).toBe("Planner is ready.");
  expect(mention.tagName).toBe("BUTTON");
  expect(mention.querySelector("span[dir]")?.getAttribute("style")).toContain("color");
  expect(onOpenBot).toHaveBeenCalledWith("child");
});

it("puts the bot first when the reply does not name it", () => {
  renderMessage([{ kind: "text", text: "Ready when you are." }], existingBot, [planner()]);
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe(
    "Planner Ready when you are.",
  );
});

it.each([
  ["no longer exists", "created", missingBot],
  ["was deleted", "deleted", existingBot],
] as const)("keeps the name without color or link when the bot %s", (_, status, peerBot) => {
  const { mention, onOpenBot } = renderMessage(
    [{ kind: "text", text: "Planner is gone." }],
    peerBot,
    [planner(status)],
  );
  expect(mention.textContent).toBe("Planner");
  expect(mention.tagName).toBe("SPAN");
  expect(mention.querySelector("span[dir]")?.getAttribute("style")).toBeNull();
  expect(onOpenBot).not.toHaveBeenCalled();
});

it("shows an announcement with no reply yet on its own", () => {
  const { mention, onOpenBot } = renderMessage([planner()], existingBot);
  expect(mention.textContent).toBe("Planner");
  expect(onOpenBot).toHaveBeenCalledWith("child");
});

it("names the bot once across a reply's text blocks", () => {
  renderMessage(
    [
      { kind: "text", text: "Setting up." },
      { kind: "text", text: "Planner is ready." },
    ],
    existingBot,
    [planner()],
  );
  expect(container.querySelectorAll('[data-testid="bot-mention"]')).toHaveLength(1);
  expect(container.textContent).toContain("Setting up.");
  expect(container.textContent).toContain("Planner is ready.");
});

it("keeps an edit made after a save when the saved status arrives late", async () => {
  const draft = {
    kind: "skill_draft" as const,
    skillId: "skill",
    name: "Weekly report",
    goal: "Send the weekly report",
    playbook: {
      whenToUse: "Fridays",
      inputs: [],
      steps: ["Collect"],
      howToCheck: "",
      whatToReturn: "",
      approvalBoundaries: "",
      failureHandling: "",
    },
    status: "draft" as const,
  };
  const render = (block: typeof draft | (Omit<typeof draft, "status"> & { status: "saved" })) =>
    root.render(
      <MessageView
        rpc={rpc}
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={{
          id: "message",
          threadId: "thread",
          seq: 1,
          role: "bot",
          createdAt: new Date().toISOString(),
          blocks: [block],
        }}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        peerBot={existingBot}
        onRefresh={() => Promise.reject(new Error("offline"))}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        callHoldsSpeaker={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    );
  act(() => render(draft));
  const card = container.querySelector('[data-testid="skill-draft-card"]')!;
  const button = () => card.querySelector("button")!;
  await act(async () => button().click());
  expect(button().textContent).toBe("Saved");

  const input = card.querySelector("input")!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("Edited");
  act(() => render({ ...draft, status: "saved" }));

  expect(input.value).toBe("Edited");
  expect(button().textContent).toBe("Save");

  // A different skill always loads its own fields.
  act(() => render({ ...draft, skillId: "other", name: "Other" }));
  expect(card.querySelector("input")!.value).toBe("Other");

  // A second save is not undone when the first save's status arrives after it.
  await act(async () => button().click());
  type("Newer");
  await act(async () => button().click());
  act(() => render({ ...draft, skillId: "other", name: "Other", status: "saved" }));
  expect(input.value).toBe("Newer");
  expect(button().textContent).toBe("Saved");
});

const ana = { id: "user-a", name: "Ana" };
const authored: ThreadMessage = {
  id: "message",
  threadId: "thread",
  seq: 1,
  role: "user",
  author: ana,
  blocks: [{ kind: "text", text: "Book the table" }],
  createdAt: new Date().toISOString(),
};

function renderAuthored(message: ThreadMessage, meId = "user-b") {
  renderView(message.role, message.blocks, { message, meId });
  const bubble = container.querySelector<HTMLElement>('[data-testid="message-user-bubble"]');
  if (!bubble?.parentElement) throw new Error("user bubble missing");
  return { bubble, row: bubble.parentElement };
}

it("names someone else's message and keeps it on the people side", () => {
  const { bubble, row } = renderAuthored(authored);

  expect(container.textContent).toBe("AnaBook the table");
  expect(row.className).toContain("justify-end");
  expect(bubble.className).toContain("bg-muted");
  expect(bubble.className).not.toContain("bg-chat-user");
});

it("keeps my own message unnamed on the right", () => {
  const { bubble, row } = renderAuthored(authored, ana.id);

  expect(container.textContent).toBe("Book the table");
  expect(row.className).toContain("justify-end");
  expect(bubble.className).toContain("bg-chat-user");
});

it("names the person a reply quotes instead of saying You", () => {
  renderAuthored({
    ...authored,
    author: undefined,
    replyToMessageId: "parent",
    replyPreview: { role: "user", author: ana, text: "Find us a restaurant" },
  });

  expect(container.querySelector('[data-testid="reply-parent-preview"]')?.textContent).toContain(
    "Ana: Find us a restaurant",
  );
});

it("speaks the message it renders", () => {
  const onSpeak = vi.fn();
  renderView("bot", [{ kind: "text", text: "Hello" }], { onSpeak, voiceReady: true });
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Speak",
  );
  act(() => button?.click());
  expect(onSpeak).toHaveBeenCalledTimes(1);
  expect(onSpeak.mock.calls[0]?.[0]).toMatchObject({ id: "message" });
});

it("disables starting a read while a call holds the speaker, keeping stop available", () => {
  renderView("bot", [{ kind: "text", text: "Hello" }], {
    voiceReady: true,
    callHoldsSpeaker: true,
  });
  const startButtons = () => [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Speak this reply"]'),
  ];
  expect(startButtons().length).toBeGreaterThan(0);
  for (const button of startButtons()) expect(button.disabled).toBe(true);

  renderView("bot", [{ kind: "text", text: "Hello" }], {
    voiceReady: true,
    callHoldsSpeaker: true,
    speaking: true,
  });
  const stopButtons = () => [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Stop speaking"]'),
  ];
  expect(stopButtons().length).toBeGreaterThan(0);
  for (const button of stopButtons()) expect(button.disabled).toBe(false);
});

describe("read-aloud progress", () => {
  const progress = {
    messageId: "message",
    caption: "Second part of the reply.",
    index: 1,
    total: 3,
  };
  const progressLine = () => container.querySelector('[data-testid="read-aloud-progress"]');

  it("shows the sounding segment and its position under a bot reply", () => {
    renderView("bot", [{ kind: "text", text: "Hello" }], {
      voiceReady: true,
      speaking: true,
      speakingProgress: progress,
    });
    expect(progressLine()?.textContent).toContain("Second part of the reply.");
    expect(progressLine()?.textContent).toContain("Segment 2 of 3");
  });

  it("shows the same line under a user message during a conversation read", () => {
    renderView("user", [{ kind: "text", text: "Hello" }], {
      voiceReady: true,
      speaking: true,
      speakingProgress: progress,
    });
    expect(progressLine()?.textContent).toContain("Segment 2 of 3");
  });

  it("hides the line for a single-segment read", () => {
    renderView("bot", [{ kind: "text", text: "Hello" }], {
      voiceReady: true,
      speaking: true,
      speakingProgress: { ...progress, index: 0, total: 1 },
    });
    expect(progressLine()).toBeNull();
  });
});

describe("message translation", () => {
  const translated = {
    translatedText: "Hark AI 是一款新的 AI 搜索产品。",
    sourceLanguage: "en",
    targetLanguage: "zh",
    modelId: "deepseek-v4.1-flash",
    usedFallback: false,
  };
  const botMessage = (blocks: ThreadMessage["blocks"]): ThreadMessage => ({
    id: "message",
    threadId: "thread",
    seq: 1,
    role: "bot",
    botId: "bot-1",
    createdAt: new Date().toISOString(),
    blocks,
  });
  const textBlocks: ThreadMessage["blocks"] = [
    { kind: "text", text: "Hark AI is a new AI search product." },
  ];
  const translatingBot: PeerBot = () => ({
    color: "orange",
    translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
    translationSourceLanguage: "en",
    translationTargetLanguage: null,
    autoTranslate: false,
  });
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const translateButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Translate this reply"]');
  const translationPanel = () => container.querySelector('[data-testid="message-translation"]');
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text);
  // The switch menus render their items as menuitem roles (in a portal), not buttons.
  const menuItem = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === text,
    );

  function renderTranslated(
    props: Partial<ComponentProps<typeof MessageView>> = {},
    result: typeof translated & { attempts?: unknown } = translated,
  ) {
    const translate = vi.fn(async () => result);
    const update = vi.fn(async () => ({}));
    const favorites = {
      list: vi.fn(async () => []),
      add: vi.fn(async (input: { botId: string; messageId: string; snippet: string }) => ({
        id: "fav-1",
        ...input,
        text: null,
        createdAt: new Date().toISOString(),
      })),
      remove: vi.fn(async () => ({ ok: true as const })),
    };
    const spaceRpc = { bots: { translate, update }, favorites };
    renderView("bot", textBlocks, {
      message: botMessage(textBlocks),
      peerBot: translatingBot,
      rpc: spaceRpc as never,
      ...props,
    });
    return { translate, update, spaceRpc };
  }

  it("translates a bot reply on click and shows the translation under the bubble", async () => {
    const { translate } = renderTranslated();
    expect(translateButton()).not.toBeNull();
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(translate).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-1",
      text: "Hark AI is a new AI search product.",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain("Translated with deepseek-v4.1-flash · English to 中文");
    expect(panel?.textContent).toContain("Hark AI 是一款新的 AI 搜索产品。");
    expect(panel?.textContent).toContain("Copy translation");
    expect(panel?.textContent).toContain("Collapse");
    // The original stays as sent.
    expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toContain(
      "Hark AI is a new AI search product.",
    );
  });

  it("marks a translation that came from a fallback model", async () => {
    renderTranslated({}, { ...translated, usedFallback: true });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain(
      "Translated with deepseek-v4.1-flash (backup) · English to 中文",
    );
  });

  it("shows a current-model row under a translation, opening its timeline", async () => {
    renderTranslated();
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    const entry = panel?.querySelector('[data-testid="model-switch-history-entry"]');
    expect(entry?.textContent).toContain("Current model: deepseek-v4.1-flash · deepseek");
    expect(document.querySelector('[data-testid="model-switch-history"]')).toBeNull();
    await act(async () => {
      (entry as HTMLButtonElement | null)?.click();
    });
    const dialog = document.querySelector('[data-testid="model-switch-history"]');
    expect(dialog?.textContent).toContain("Switch history");
    // No fallback was walked, so the timeline is only the finishing line.
    expect(dialog?.textContent).toContain("Finished, current model");
    expect(dialog?.textContent).not.toContain("Switch to");
  });

  it("opens the translation timeline with its failed attempts", async () => {
    const onLocateModel = vi.fn();
    renderTranslated(
      { onLocateModel },
      {
        ...translated,
        modelId: "glm-5.3-flash",
        usedFallback: true,
        attempts: [
          {
            model: "deepseek-v4.1-flash",
            provider: "deepseek",
            outcome: "failed",
            errorCode: "rate_limit",
            errorMessage: "429 slow down",
            at: "2026-11-15T10:00:00.000Z",
          },
          {
            model: "glm-5.3-flash",
            provider: "test",
            outcome: "succeeded",
            at: "2026-11-15T10:00:01.000Z",
          },
        ],
      },
    );
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    const entry = panel?.querySelector('[data-testid="model-switch-history-entry"]');
    expect(entry?.textContent).toContain("Current model: glm-5.3-flash · test");
    await act(async () => {
      (entry as HTMLButtonElement | null)?.click();
    });
    const dialog = document.querySelector('[data-testid="model-switch-history"]');
    expect(dialog?.textContent).toContain("429 rate limit");
    const modelButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "deepseek-v4.1-flash",
    );
    await act(async () => {
      modelButton?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "translation",
      botId: "bot-1",
      model: "deepseek-v4.1-flash",
      provider: "deepseek",
    });
  });

  it("lists connected models the bot has not configured in the switch menu", async () => {
    renderTranslated({
      availableTranslationModels: [
        { provider: "deepseek", model: "deepseek-v4.1-flash" },
        { provider: "test", model: "glm-5.3-flash" },
      ],
    });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => buttonByText("deepseek-v4.1-flash")?.click());
    await act(async () => {});
    // The current row also carries its health badge ("Normal"), so match by inclusion.
    const items = [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.textContent ?? "",
    );
    expect(items.some((text) => text.includes("deepseek-v4.1-flash"))).toBe(true);
    expect(items.some((text) => text.includes("glm-5.3-flash"))).toBe(true);
  });

  it("switches to an unconfigured model, moves it to the front, and re-translates", async () => {
    const { translate, update } = renderTranslated({
      availableTranslationModels: [
        { provider: "deepseek", model: "deepseek-v4.1-flash" },
        { provider: "test", model: "glm-5.3-flash" },
      ],
    });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(translate).toHaveBeenCalledTimes(1);
    act(() => buttonByText("deepseek-v4.1-flash")?.click());
    await act(async () => {});
    await act(async () => {
      menuItem("glm-5.3-flash")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-1",
      translationModels: [
        { provider: "test", model: "glm-5.3-flash" },
        { provider: "deepseek", model: "deepseek-v4.1-flash" },
      ],
    });
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it("shows a generic label when the translation model id is an opaque code", async () => {
    renderTranslated({}, { ...translated, modelId: "Ff1dE9" });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain("Translated with Model · English to 中文");
    expect(panel?.textContent).not.toContain("Ff1dE9");
  });

  it("drops a lone opaque code the model echoed as the translation's first line", async () => {
    renderTranslated(
      {},
      {
        ...translated,
        translatedText: "Ff1dE9\n검색했어요. 이제 세부 사항(가격과 평판) 두 편을 더 볼게요.",
      },
    );
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain(
      "검색했어요. 이제 세부 사항(가격과 평판) 두 편을 더 볼게요.",
    );
    expect(panel?.textContent).not.toContain("Ff1dE9");
  });

  it("translates a reply with other blocks through the same panel", async () => {
    const mixed: ThreadMessage["blocks"] = [
      { kind: "text", text: "Hark AI is a new AI search product." },
      { kind: "card", lines: [{ k: "Source", v: "Hark" }] },
    ];
    const { translate } = renderTranslated({ message: botMessage(mixed) });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translationPanel()?.textContent).toContain("Hark AI 是一款新的 AI 搜索产品。");
  });

  it("prompts for a translation model instead of calling translate when none is set", async () => {
    const { translate } = renderTranslated({
      peerBot: () => ({ color: "orange" }),
    });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(translate).not.toHaveBeenCalled();
    expect(translationPanel()).toBeNull();
  });

  it("auto-translates the newest reply and expands it", async () => {
    const { translate } = renderTranslated({
      peerBot: () => ({ ...translatingBot("bot-1")!, autoTranslate: true }),
      isLastMessage: true,
    });
    await flush();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translationPanel()?.textContent).toContain("Hark AI 是一款新的 AI 搜索产品。");
  });

  it("does not auto-translate an older reply", async () => {
    const { translate } = renderTranslated({
      peerBot: () => ({ ...translatingBot("bot-1")!, autoTranslate: true }),
    });
    await flush();
    expect(translate).not.toHaveBeenCalled();
    expect(translationPanel()).toBeNull();
  });

  it("collapses the translation to one line and does not auto-expand it again", async () => {
    const { translate } = renderTranslated({
      peerBot: () => ({ ...translatingBot("bot-1")!, autoTranslate: true }),
      isLastMessage: true,
    });
    await flush();
    expect(translationPanel()?.textContent).toContain("Hark AI 是一款新的 AI 搜索产品。");
    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse translation"]',
    );
    await act(async () => {
      collapse?.click();
    });
    // The folded row stays: one line naming the translation, with Expand.
    expect(translationPanel()?.textContent).toContain("Translation");
    expect(translationPanel()?.textContent).not.toContain("Hark AI 是一款新的 AI 搜索产品。");
    expect(buttonByText("Expand")).not.toBeUndefined();
    await flush();
    expect(translate).toHaveBeenCalledTimes(1);
    await act(async () => {
      buttonByText("Expand")?.click();
    });
    expect(translationPanel()?.textContent).toContain("Hark AI 是一款新的 AI 搜索产品。");
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed translation", async () => {
    const translate = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(translated);
    renderView("bot", textBlocks, {
      message: botMessage(textBlocks),
      peerBot: translatingBot,
      rpc: {
        bots: { translate },
        favorites: {
          list: vi.fn(async () => []),
          add: vi.fn(async () => ({})),
          remove: vi.fn(async () => ({ ok: true as const })),
        },
      } as never,
    });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translationPanel()?.textContent).toContain("offline");
    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry translation"]',
    );
    expect(retry).not.toBeNull();
    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translationPanel()?.textContent).toContain("Hark AI 是一款新的 AI 搜索产品。");
  });

  it("reads the translated text aloud and offers to share it", async () => {
    const onSpeakText = vi.fn();
    renderTranslated({ voiceReady: true, onSpeakText });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain("Speak");
    expect(panel?.textContent).toContain("Share");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Speak"]')?.click();
    });
    expect(onSpeakText).toHaveBeenCalledExactlyOnceWith("Hark AI 是一款新的 AI 搜索产品。", {
      botId: "bot-1",
      messageId: "message",
    });
  });

  it("copies on share when the browser has no share sheet, and only Share shows Copied", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      Reflect.deleteProperty(navigator, "share");
      renderTranslated();
      await act(async () => {
        translateButton()?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        buttonByText("Share")?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(writeText).toHaveBeenCalledWith("Hark AI 是一款新的 AI 搜索产品。");
      // The fallback copy lights up Share itself; Copy keeps its own state.
      expect(buttonByText("Share")).toBeUndefined();
      expect(buttonByText("Copied")).not.toBeUndefined();
      expect(buttonByText("Copy translation")).not.toBeUndefined();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("uses the system share sheet when available and copies nothing", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      renderTranslated();
      await act(async () => {
        translateButton()?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        buttonByText("Share")?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(share).toHaveBeenCalledWith({ text: "Hark AI 是一款新的 AI 搜索产品。" });
      expect(writeText).not.toHaveBeenCalled();
      expect(buttonByText("Share")).not.toBeUndefined();
      expect(buttonByText("Copied")).toBeUndefined();
    } finally {
      Reflect.deleteProperty(navigator, "share");
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("copies nothing when the share sheet is dismissed", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("The user aborted the share.", "AbortError");
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      renderTranslated();
      await act(async () => {
        translateButton()?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        buttonByText("Share")?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(writeText).not.toHaveBeenCalled();
      expect(buttonByText("Share")).not.toBeUndefined();
    } finally {
      Reflect.deleteProperty(navigator, "share");
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("offers the text by hand when the fallback copy fails", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("Clipboard denied.");
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      Reflect.deleteProperty(navigator, "share");
      renderTranslated();
      await act(async () => {
        translateButton()?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        buttonByText("Share")?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const field = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Copy translation"]',
      );
      expect(field?.value).toBe("Hark AI 是一款新的 AI 搜索产品。");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("hides the read-aloud and share actions when the bot turns them off", async () => {
    renderTranslated({
      peerBot: () => ({
        color: "orange",
        translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
        translationSourceLanguage: "en",
        translationTargetLanguage: null,
        autoTranslate: false,
        showTranslationActions: false,
      }),
      voiceReady: true,
      onSpeakText: vi.fn(),
    });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain("Copy translation");
    expect(panel?.textContent).toContain("Collapse");
    expect(panel?.textContent).not.toContain("Speak");
    expect(panel?.textContent).not.toContain("Share");
  });

  it("favorites a translation under its own id", async () => {
    const { spaceRpc } = renderTranslated();
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).toContain("Favorite");
    const favoriteTranslation = panel?.querySelector<HTMLButtonElement>(
      'button[aria-label="Favorite translation"]',
    );
    expect(favoriteTranslation).not.toBeNull();
    await act(async () => {
      favoriteTranslation?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(spaceRpc.favorites.add).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-1",
      messageId: "message:translation",
      snippet: "Hark AI 是一款新的 AI 搜索产品。",
      text: "Hark AI 是一款新的 AI 搜索产品。",
    });
    expect(
      panel?.querySelector<HTMLButtonElement>('button[aria-label="Remove favorite"]'),
    ).not.toBeNull();
  });

  it("hides the translation favorite when the bot turns its actions off", async () => {
    renderTranslated({
      peerBot: () => ({
        color: "orange",
        translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
        translationSourceLanguage: "en",
        translationTargetLanguage: null,
        autoTranslate: false,
        showTranslationActions: false,
      }),
      voiceReady: true,
      onSpeakText: vi.fn(),
    });
    await act(async () => {
      translateButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = translationPanel();
    expect(panel?.textContent).not.toContain("Favorite");
  });
});

describe("message favorites", () => {
  const favoriteButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Favorite this reply"]');
  const favoritedButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove favorite"]');
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  function renderFavoritable(list: unknown[] = []) {
    const favorites = {
      list: vi.fn(async () => list),
      add: vi.fn(async (input: { botId: string; messageId: string; snippet: string }) => ({
        id: "fav-1",
        ...input,
        text: "Hello",
        createdAt: new Date().toISOString(),
      })),
      remove: vi.fn(async () => ({ ok: true as const })),
    };
    resetFavoritesCache();
    renderView("bot", [{ kind: "text", text: "Hello" }], {
      message: {
        id: "message-9",
        threadId: "thread",
        seq: 1,
        role: "bot",
        botId: "bot-9",
        createdAt: new Date().toISOString(),
        blocks: [{ kind: "text", text: "Hello" }],
      },
      peerBot: existingBot,
      rpc: { favorites } as never,
    });
    return favorites;
  }

  it("favorites a bot reply and shows the saved state", async () => {
    const favorites = renderFavoritable();
    await flush();
    expect(favoriteButton()).not.toBeNull();
    await act(async () => {
      favoriteButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(favorites.add).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-9",
      messageId: "message-9",
      snippet: "Hello",
      text: "Hello",
    });
    expect(favoritedButton()).not.toBeNull();
  });

  it("shows a saved reply as favorited and removes it on click", async () => {
    const favorites = renderFavoritable([
      {
        id: "fav-1",
        botId: "bot-9",
        messageId: "message-9",
        snippet: "Hello",
        text: "Hello",
        createdAt: new Date().toISOString(),
      },
    ]);
    await flush();
    expect(favoritedButton()).not.toBeNull();
    await act(async () => {
      favoritedButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(favorites.remove).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-9",
      messageId: "message-9",
    });
    expect(favoriteButton()).not.toBeNull();
  });

  it("rolls back when saving fails", async () => {
    const favorites = renderFavoritable();
    favorites.add.mockRejectedValueOnce(new Error("offline"));
    await flush();
    await act(async () => {
      favoriteButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(favorites.add).toHaveBeenCalledTimes(1);
    expect(favoriteButton()).not.toBeNull();
  });
});

it("opens one counted peer line without an inline reply toggle", () => {
  const open = vi.fn();
  renderView(
    "bot",
    [{ kind: "bot_message_sent", toBotId: "peer", toBotName: "Researcher", text: "Request" }],
    {
      peerExchange: {
        peerBotId: "peer",
        peerBotName: "Researcher",
        count: 3,
        direction: "sent",
      },
      onOpenPeerMessages: open,
    },
  );
  const line = container.querySelector<HTMLButtonElement>('[data-testid="peer-receipt-chip"]');
  expect(line?.getAttribute("aria-label")).toBe("3 messages with Researcher");
  expect(container.querySelector('[data-testid="peer-replies-toggle"]')).toBeNull();
  act(() => line?.click());
  expect(open).toHaveBeenCalledWith({ peerBotId: "peer", peerBotName: "Researcher" });
});

it("sends a settings Undo through the chat's space client", async () => {
  const spaceRpc = { bots: { update: vi.fn(async () => ({})) } };
  renderView(
    "bot",
    [
      {
        kind: "ask",
        text: "Settings updated",
        status: "answered",
        settingsUpdate: {
          botId: "bot-1",
          before: { modelProvider: null, modelId: null, thinkingLevel: null },
          after: { modelProvider: "google", modelId: "gemini-3.8-flash", thinkingLevel: "high" },
        },
      },
    ],
    { rpc: spaceRpc as never },
  );
  const undo = [...container.querySelectorAll("button")].find((b) => b.textContent === "Undo");
  await act(async () => undo?.click());
  expect(spaceRpc.bots.update).toHaveBeenCalledTimes(1);
});

it("stops a background helper from its saved running card, never a turn's live one", async () => {
  const spaceRpc = {
    threads: { stopHelper: vi.fn(async () => ({ ok: true })) },
    favorites: {
      list: vi.fn(async () => []),
      add: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({ ok: true as const })),
    },
  };
  const helper = (id: string): ThreadMessage => ({
    id,
    threadId: "thread",
    seq: 1,
    role: "bot",
    botId: "bot-1",
    createdAt: new Date().toISOString(),
    blocks: [{ kind: "subagent", agentId: id, name: "scout", task: "venues", status: "running" }],
  });
  const stopButton = () =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Stop");
  renderView("bot", [], { message: helper("subagent:live"), rpc: spaceRpc as never });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(stopButton()).toBeUndefined();
  renderView("bot", [], { message: helper("card-1"), rpc: spaceRpc as never });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  act(() => stopButton()?.click());
  expect(spaceRpc.threads.stopHelper).toHaveBeenCalledExactlyOnceWith({
    botId: "bot-1",
    messageId: "card-1",
  });
});

describe("generated media result", () => {
  const mediaBot: PeerBot = () => ({
    color: "orange",
    imageModels: [
      { provider: "p1", model: "model-a" },
      { provider: "p2", model: "model-b" },
    ],
    imagePromptPresets: [
      { name: "水彩", prompt: "watercolor" },
      { name: "油画", prompt: "oil painting" },
    ],
    activeImagePromptPreset: "水彩",
  });
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text);
  // The switch menus render their items as menuitem roles (in a portal), not buttons.
  const menuItem = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === text,
    );

  function renderMedia(modelSwitches?: {
    attempts: {
      model: string;
      provider?: string;
      outcome: "failed" | "skipped" | "succeeded";
      errorCode?: string;
      errorMessage?: string;
      at: string;
    }[];
    finalModel: string;
  }) {
    const update = vi.fn(async () => ({}));
    const onRegenerate = vi.fn(async () => undefined);
    const favorites = {
      list: vi.fn(async () => []),
      add: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({ ok: true as const })),
    };
    resetFavoritesCache();
    vi.mocked(rpc.artifacts.get).mockRejectedValue(new Error("no image"));
    renderView("bot", [], {
      message: {
        id: "message-media",
        threadId: "thread",
        seq: 1,
        role: "bot",
        botId: "bot-1",
        createdAt: new Date().toISOString(),
        blocks: [
          { kind: "image", artifactId: "art-1", mimeType: "image/png", name: "generated-1.png" },
          { kind: "text", text: "经 model-a · 水彩" },
        ],
        modelSwitches,
      },
      peerBot: mediaBot,
      rpc: { bots: { update }, favorites } as never,
      onRegenerate,
    });
    return { update, onRegenerate };
  }

  it("renders the result with its mark and action row, not a mark bubble", async () => {
    renderMedia();
    await flush();
    expect(container.querySelector('[data-testid="message-bot-bubble"]')).toBeNull();
    expect(buttonByText("model-a")).not.toBeUndefined();
    expect(buttonByText("水彩")).not.toBeUndefined();
    for (const label of ["Preview", "Download", "Share", "Favorite", "Regenerate", "Collapse"]) {
      expect(buttonByText(label)).not.toBeUndefined();
    }
  });

  it("regenerates from the message that produced the result", async () => {
    const { onRegenerate } = renderMedia();
    await flush();
    await act(async () => {
      buttonByText("Regenerate")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onRegenerate).toHaveBeenCalledExactlyOnceWith("message-media");
  });

  it("switches the image model from the mark and moves it to the front", async () => {
    const { update } = renderMedia();
    await flush();
    act(() => buttonByText("model-a")?.click());
    await act(async () => {});
    await act(async () => {
      menuItem("model-b")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-1",
      imageModels: [
        { provider: "p2", model: "model-b" },
        { provider: "p1", model: "model-a" },
      ],
    });
  });

  it("switches the prompt preset from the mark", async () => {
    const { update } = renderMedia();
    await flush();
    act(() => buttonByText("水彩")?.click());
    await act(async () => {});
    await act(async () => {
      menuItem("油画")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      botId: "bot-1",
      activeImagePromptPreset: "油画",
    });
  });

  it("collapses the result and shows it again", async () => {
    renderMedia();
    await flush();
    act(() => buttonByText("Collapse")?.click());
    expect(buttonByText("Preview")).toBeUndefined();
    expect(buttonByText("Show")).not.toBeUndefined();
    act(() => buttonByText("Show")?.click());
    expect(buttonByText("Preview")).not.toBeUndefined();
  });

  it("shows a switch-history button only when the message switched models", async () => {
    renderMedia();
    await flush();
    expect(buttonByText("Switch history")).toBeUndefined();
    renderMedia({
      attempts: [
        {
          model: "model-a",
          provider: "p1",
          outcome: "failed",
          errorCode: "rate_limit",
          errorMessage: "slow down",
          at: "2026-11-15T10:00:00.000Z",
        },
        { model: "model-b", provider: "p2", outcome: "succeeded", at: "2026-11-15T10:00:01.000Z" },
      ],
      finalModel: "model-b",
    });
    await flush();
    expect(buttonByText("Switch history")).not.toBeUndefined();
    await act(async () => {
      buttonByText("Switch history")?.click();
    });
    const dialog = document.querySelector('[data-testid="model-switch-history"]');
    expect(dialog?.textContent).toContain("Switch history");
    expect(dialog?.textContent).toContain("429 rate limit");
  });
});

describe("model switch history", () => {
  const switches = {
    attempts: [
      {
        model: "model-a",
        provider: "p1",
        outcome: "failed" as const,
        errorCode: "rate_limit",
        errorMessage: "slow down",
        at: "2026-11-15T10:00:00.000Z",
      },
      {
        model: "model-b",
        provider: "p2",
        outcome: "succeeded" as const,
        at: "2026-11-15T10:00:01.000Z",
      },
    ],
    finalModel: "model-b",
  };
  const historyEntry = () => container.querySelector('[data-testid="model-switch-history-entry"]');
  const historyDialog = () => document.querySelector('[data-testid="model-switch-history"]');

  it("opens the timeline from a fallback mark, and locates its model", async () => {
    const onLocateModel = vi.fn();
    renderView(
      "bot",
      [
        { kind: "text", text: "Here is the answer." },
        { kind: "text", text: "当前模型: model-b" },
      ],
      {
        message: {
          id: "message",
          threadId: "thread",
          seq: 1,
          role: "bot",
          botId: "bot-1",
          createdAt: new Date().toISOString(),
          blocks: [
            { kind: "text", text: "Here is the answer." },
            { kind: "text", text: "当前模型: model-b" },
          ],
          modelSwitches: switches,
        },
        onLocateModel,
      },
    );
    expect(historyEntry()?.textContent).toContain("Current model: model-b · p2");
    expect(historyDialog()).toBeNull();
    await act(async () => {
      (historyEntry() as HTMLButtonElement | null)?.click();
    });
    expect(historyDialog()?.textContent).toContain("Switch history");
    expect(historyDialog()?.textContent).toContain("429 rate limit");
    const modelButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "model-a",
    );
    await act(async () => {
      modelButton?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "model-a",
      provider: "p1",
    });
  });

  it("keeps a mark without a timeline as plain text", () => {
    renderView("bot", [
      { kind: "text", text: "Here is the answer." },
      { kind: "text", text: "当前模型: model-b" },
    ]);
    expect(historyEntry()).toBeNull();
    expect(container.textContent).toContain("当前模型: model-b");
  });

  it("opens the timeline from a mark in a non-narration reply", async () => {
    renderView(
      "bot",
      [
        { kind: "meta", text: "started" },
        { kind: "text", text: "Here is the answer." },
        { kind: "text", text: "当前模型: model-b" },
      ],
      {
        message: {
          id: "message",
          threadId: "thread",
          seq: 1,
          role: "bot",
          botId: "bot-1",
          createdAt: new Date().toISOString(),
          blocks: [
            { kind: "meta", text: "started" },
            { kind: "text", text: "Here is the answer." },
            { kind: "text", text: "当前模型: model-b" },
          ],
          modelSwitches: switches,
        },
      },
    );
    expect(historyEntry()?.textContent).toContain("Current model: model-b · p2");
    await act(async () => {
      (historyEntry() as HTMLButtonElement | null)?.click();
    });
    expect(historyDialog()?.textContent).toContain("Switch history");
  });
});

describe("long bot replies", () => {
  const longText = "word ".repeat(300);
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text);

  it("folds a long bot reply until expanded, and never folds a short one", () => {
    renderView("bot", [{ kind: "text", text: longText }]);
    const bubble = container.querySelector('[data-testid="message-bot-bubble"]')!;
    expect(bubble.querySelector(".max-h-48")).not.toBeNull();
    expect(buttonByText("Expand")).not.toBeUndefined();
    act(() => buttonByText("Expand")?.click());
    expect(bubble.querySelector(".max-h-48")).toBeNull();
    expect(buttonByText("Collapse")).not.toBeUndefined();
    act(() => buttonByText("Collapse")?.click());
    expect(bubble.querySelector(".max-h-48")).not.toBeNull();

    renderView("bot", [{ kind: "text", text: "Short reply." }]);
    expect(buttonByText("Expand")).toBeUndefined();
  });

  it("never folds a long user message", () => {
    renderView("user", [{ kind: "text", text: longText }]);
    expect(buttonByText("Expand")).toBeUndefined();
  });
});

describe("stuck run", () => {
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text);
  // The switch menus render their items as menuitem roles (in a portal), not buttons.
  const menuItem = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === text,
    );
  const stuck = {
    runId: "run-1",
    botId: "bot-1",
    messageId: "message",
    modelProvider: "p1",
    modelId: "model-a",
  };
  const models = [
    { provider: "p1", model: "model-a" },
    { provider: "p2", model: "model-b" },
  ];

  function renderStuck(props: Partial<ComponentProps<typeof MessageView>> = {}) {
    const onStopStuckRun = vi.fn(async () => undefined);
    const onRetryStuckRun = vi.fn(async () => undefined);
    renderView("user", [{ kind: "text", text: "Shanghai weather" }], {
      stuck,
      onStopStuckRun,
      onRetryStuckRun,
      availableRetryModels: models,
      ...props,
    });
    return { onStopStuckRun, onRetryStuckRun };
  }

  it("shows the recovery row under a stuck user message", () => {
    renderStuck();
    expect(container.querySelector('[data-testid="stuck-run-actions"]')).not.toBeNull();
    expect(buttonByText("Cancel")).not.toBeUndefined();
    expect(buttonByText("Switch model and retry")).not.toBeUndefined();
  });

  it("stops the run from Cancel", async () => {
    const { onStopStuckRun } = renderStuck();
    await act(async () => {
      buttonByText("Cancel")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onStopStuckRun).toHaveBeenCalledExactlyOnceWith();
  });

  it("retries on the picked model", async () => {
    const { onRetryStuckRun } = renderStuck();
    act(() => buttonByText("Switch model and retry")?.click());
    await act(async () => {});
    await act(async () => {
      menuItem("model-b")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onRetryStuckRun).toHaveBeenCalledExactlyOnceWith("message", "bot-1", {
      provider: "p2",
      model: "model-b",
    });
  });

  it("hides the retry picker when no model is connected, and hides the row without a stuck run", () => {
    renderStuck({ availableRetryModels: [] });
    expect(container.querySelector('[data-testid="stuck-run-actions"]')).not.toBeNull();
    expect(buttonByText("Switch model and retry")).toBeUndefined();
    expect(buttonByText("Cancel")).not.toBeUndefined();

    renderView("user", [{ kind: "text", text: "Shanghai weather" }]);
    expect(container.querySelector('[data-testid="stuck-run-actions"]')).toBeNull();
  });
});
