// @vitest-environment jsdom
import type { ModelSwitchAttempt } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act, useEffect, useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

import {
  ModelSwitchHistoryDialog,
  ModelSwitchHistoryEntry,
  ModelSwitchMarkButton,
} from "./model-switch-history-dialog";

const attempts: ModelSwitchAttempt[] = [
  {
    model: "deepseek-v4.1-flash",
    provider: "Main",
    outcome: "failed",
    errorCode: "rate_limit",
    errorMessage: "429 Too Many Requests: slow down.",
    at: "2026-11-15T10:00:00.000Z",
  },
  {
    model: "deepseek-v4.1-flash",
    provider: "GB relay",
    outcome: "failed",
    errorCode: "connection",
    errorMessage: "Connection failed.",
    at: "2026-11-15T10:00:01.000Z",
  },
  {
    model: "krisphyn-DeepSeek-V4-Pro",
    provider: "GB relay",
    outcome: "succeeded",
    at: "2026-11-15T10:00:02.000Z",
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

function dialogText() {
  return document.querySelector('[data-testid="model-switch-history"]')?.textContent ?? "";
}

describe("ModelSwitchHistoryDialog", () => {
  it("renders failed attempts, switch lines, and the finishing model", () => {
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={() => undefined}
          attempts={attempts}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
        />,
      ),
    );
    const text = dialogText();
    expect(text).toContain("Switch history");
    expect(text).toContain("deepseek-v4.1-flash");
    expect(text).toContain("Main");
    expect(text).toContain("GB relay");
    expect(text).toContain("429 rate limit");
    expect(text).toContain("Connection error");
    expect(text).toContain("Switch to deepseek-v4.1-flash · GB relay");
    expect(text).toContain("Switch to krisphyn-DeepSeek-V4-Pro · GB relay");
    expect(text).toContain("Finished, current model");
    expect(text).toContain("krisphyn-DeepSeek-V4-Pro");
    // The full error stays hidden until its label is tapped.
    expect(text).not.toContain("429 Too Many Requests: slow down.");
  });

  it("expands a failed attempt to its full error message", async () => {
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={() => undefined}
          attempts={attempts}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
        />,
      ),
    );
    const label = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("429 rate limit"),
    );
    expect(label).not.toBeUndefined();
    await act(async () => {
      label?.click();
    });
    expect(dialogText()).toContain("429 Too Many Requests: slow down.");
  });

  it("opens the confirm popup on a model name and locates only from the popup", async () => {
    const onLocateModel = vi.fn();
    const onOpenChange = vi.fn();
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={onOpenChange}
          attempts={attempts}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
          onLocateModel={onLocateModel}
        />,
      ),
    );
    const modelButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "deepseek-v4.1-flash",
    );
    expect(modelButton).not.toBeUndefined();
    await act(async () => {
      modelButton?.click();
    });
    // The history closes behind the popup; nothing locates yet.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onLocateModel).not.toHaveBeenCalled();
    const popup = document.querySelector('[data-testid="model-locate-popup"]');
    expect(popup?.textContent).toContain("Locate");
    expect(popup?.textContent).toContain("deepseek-v4.1-flash（Main）");
    expect(popup?.textContent).toContain("Tap to go");
    const confirm = document.querySelector('[data-testid="model-locate-confirm"]');
    await act(async () => {
      (confirm as HTMLButtonElement | null)?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "deepseek-v4.1-flash",
      provider: "Main",
    });
  });

  it("closing the popup locates nothing", async () => {
    const onLocateModel = vi.fn();
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={() => undefined}
          attempts={attempts}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
          onLocateModel={onLocateModel}
        />,
      ),
    );
    const modelButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "deepseek-v4.1-flash",
    );
    await act(async () => {
      modelButton?.click();
    });
    const popup = document.querySelector('[data-testid="model-locate-popup"]');
    expect(popup).not.toBeNull();
    const close = popup?.querySelector('[data-slot="dialog-close"]');
    await act(async () => {
      (close as HTMLButtonElement | null)?.click();
    });
    expect(document.querySelector('[data-testid="model-locate-popup"]')).toBeNull();
    expect(onLocateModel).not.toHaveBeenCalled();
  });

  it("marks an all-failed timeline as failed, with the last model still locatable", async () => {
    const failed: ModelSwitchAttempt[] = [
      {
        model: "deepseek-v4.1-flash",
        provider: "Main",
        outcome: "failed",
        errorCode: "rate_limit",
        errorMessage: "slow down",
        at: "2026-11-15T10:00:00.000Z",
      },
      {
        model: "krisphyn-DeepSeek-V4-Pro",
        provider: "GB relay",
        outcome: "failed",
        errorCode: "connection",
        errorMessage: "Connection failed.",
        at: "2026-11-15T10:00:01.000Z",
      },
    ];
    const onLocateModel = vi.fn();
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={() => undefined}
          attempts={failed}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
          onLocateModel={onLocateModel}
        />,
      ),
    );
    const text = dialogText();
    expect(text).toContain("All models failed");
    expect(text).not.toContain("Finished, current model");
    const modelButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "krisphyn-DeepSeek-V4-Pro",
    );
    expect(modelButton).not.toBeUndefined();
    await act(async () => {
      modelButton?.click();
    });
    // The name opens the popup; the popup's name does the locating.
    expect(document.querySelector('[data-testid="model-locate-popup"]')).not.toBeNull();
    const confirm = document.querySelector('[data-testid="model-locate-confirm"]');
    await act(async () => {
      (confirm as HTMLButtonElement | null)?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "krisphyn-DeepSeek-V4-Pro",
      provider: "GB relay",
    });
  });

  it("shows only the finishing line when nothing switched", () => {
    const single: ModelSwitchAttempt[] = [
      {
        model: "deepseek-v4.1-flash",
        provider: "Main",
        outcome: "succeeded",
        at: "2026-11-15T10:00:00.000Z",
      },
    ];
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={() => undefined}
          attempts={single}
          finalModel="deepseek-v4.1-flash"
          kind="translation"
          botId="bot-1"
        />,
      ),
    );
    const text = dialogText();
    expect(text).toContain("Finished, current model");
    expect(text).not.toContain("Switch to");
  });

  it("tags each attempt with its pool and leaves pool-less records untagged", () => {
    const pooled: ModelSwitchAttempt[] = [
      {
        model: "model-a",
        provider: "Main",
        outcome: "failed",
        errorCode: "rate_limit",
        pool: "main",
        at: "2026-11-15T10:00:00.000Z",
      },
      {
        model: "model-b",
        provider: "Main",
        outcome: "failed",
        errorCode: "rate_limit",
        pool: "backup",
        at: "2026-11-15T10:00:01.000Z",
      },
      {
        model: "model-c",
        provider: "Main",
        outcome: "failed",
        errorCode: "rate_limit",
        at: "2026-11-15T10:00:02.000Z",
      },
    ];
    act(() =>
      root.render(
        <ModelSwitchHistoryDialog
          open
          onOpenChange={() => undefined}
          attempts={pooled}
          finalModel="model-c"
          kind="chat"
          botId="bot-1"
        />,
      ),
    );
    const text = dialogText();
    expect(text).toContain("Main models");
    expect(text).toContain("Backup pool");
    // One main tag, one backup tag; the pool-less record adds no third tag.
    expect(text.match(/Main models/g)).toHaveLength(1);
    expect(text.match(/Backup pool/g)).toHaveLength(1);
  });
});

describe("ModelSwitchHistoryEntry", () => {
  it("opens the timeline when the current-model row is tapped", async () => {
    act(() =>
      root.render(
        <ModelSwitchHistoryEntry
          attempts={attempts}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
        />,
      ),
    );
    const entry = container.querySelector('[data-testid="model-switch-history-entry"]');
    expect(entry?.textContent).toContain("Current model: krisphyn-DeepSeek-V4-Pro · GB relay");
    expect(document.querySelector('[data-testid="model-switch-history"]')).toBeNull();
    await act(async () => {
      (entry as HTMLButtonElement | null)?.click();
    });
    expect(document.querySelector('[data-testid="model-switch-history"]')).not.toBeNull();
    expect(dialogText()).toContain("Switch history");
  });

  it("closes the history behind the popup and locates only from the popup", async () => {
    const onLocateModel = vi.fn();
    act(() =>
      root.render(
        <ModelSwitchHistoryEntry
          attempts={attempts}
          finalModel="krisphyn-DeepSeek-V4-Pro"
          kind="chat"
          botId="bot-1"
          onLocateModel={onLocateModel}
        />,
      ),
    );
    const entry = container.querySelector('[data-testid="model-switch-history-entry"]');
    await act(async () => {
      (entry as HTMLButtonElement | null)?.click();
    });
    expect(document.querySelector('[data-testid="model-switch-history"]')).not.toBeNull();
    const modelButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "deepseek-v4.1-flash",
    );
    await act(async () => {
      modelButton?.click();
    });
    // The history is gone from over the settings; the popup is up instead.
    expect(document.querySelector('[data-testid="model-switch-history"]')).toBeNull();
    expect(document.querySelector('[data-testid="model-locate-popup"]')).not.toBeNull();
    expect(onLocateModel).not.toHaveBeenCalled();
    const confirm = document.querySelector('[data-testid="model-locate-confirm"]');
    await act(async () => {
      (confirm as HTMLButtonElement | null)?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "deepseek-v4.1-flash",
      provider: "Main",
    });
  });
});

describe("ModelLocatePopup focus", () => {
  /** A located row beside the real mark button, wired like the panel:
   * confirming closes the popup and focuses the row in the same commit's
   * effect — the move the dialog's return focus used to steal. Rendering
   * only the section never caught it: the popup was never mounted, so its
   * unmount cleanup never ran. */
  function Harness() {
    const [located, setLocated] = useState(false);
    const rowRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
      if (located) rowRef.current?.focus();
    }, [located]);
    return (
      <div>
        <button type="button" data-testid="located-row" ref={rowRef}>
          Row
        </button>
        <ModelSwitchMarkButton
          model="deepseek-v4.1-flash"
          provider="Main"
          kind="chat"
          botId="bot-1"
          onLocateModel={() => setLocated(true)}
        />
      </div>
    );
  }

  function mark() {
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="model-switch-mark-entry"]',
    );
    if (!button) throw new Error("Missing mark entry");
    return button;
  }

  function row() {
    const button = container.querySelector<HTMLButtonElement>('[data-testid="located-row"]');
    if (!button) throw new Error("Missing located row");
    return button;
  }

  function confirmButton() {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="model-locate-confirm"]',
    );
    if (!button) throw new Error("Missing locate confirm");
    return button;
  }

  /** Lets the exit transition finish and the return-focus microtask run. */
  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  /** Opens the popup from the focused mark entry, as a real tap does. */
  async function openPopup() {
    if (!Element.prototype.getAnimations) {
      Element.prototype.getAnimations = () => [];
    }
    await act(async () => {
      mark().focus();
    });
    expect(document.activeElement).toBe(mark());
    await act(async () => {
      mark().click();
    });
    expect(document.querySelector('[data-testid="model-locate-popup"]')).not.toBeNull();
    // The dialog's initial focus may land a tick after the open commit;
    // what matters for the race is that the mark was focused at open time,
    // so it is the element a return would land on.
    await flush();
  }

  it("keeps focus on the located row after confirming the locate", async () => {
    act(() => root.render(<Harness />));
    await openPopup();
    await act(async () => {
      confirmButton().click();
    });
    await flush();
    expect(document.activeElement).toBe(row());
  });

  it("returns focus to the mark entry when the popup is dismissed", async () => {
    act(() => root.render(<Harness />));
    await openPopup();
    const close = document
      .querySelector('[data-testid="model-locate-popup"]')
      ?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
    if (!close) throw new Error("Missing dialog close");
    await act(async () => {
      close.click();
    });
    await flush();
    expect(document.activeElement).toBe(mark());
  });
});

describe("ModelSwitchMarkButton", () => {
  it("opens the popup on tap and locates from the popup's name", async () => {
    const onLocateModel = vi.fn();
    act(() =>
      root.render(
        <ModelSwitchMarkButton
          model="deepseek-v4.1-flash"
          kind="chat"
          botId="bot-1"
          onLocateModel={onLocateModel}
        />,
      ),
    );
    const mark = container.querySelector('[data-testid="model-switch-mark-entry"]');
    expect(mark?.textContent).toContain("Current model: deepseek-v4.1-flash");
    await act(async () => {
      (mark as HTMLButtonElement | null)?.click();
    });
    const popup = document.querySelector('[data-testid="model-locate-popup"]');
    expect(popup?.textContent).toContain("deepseek-v4.1-flash");
    expect(onLocateModel).not.toHaveBeenCalled();
    const confirm = document.querySelector('[data-testid="model-locate-confirm"]');
    await act(async () => {
      (confirm as HTMLButtonElement | null)?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "deepseek-v4.1-flash",
    });
  });

  it("opens no popup without a locator", async () => {
    act(() =>
      root.render(<ModelSwitchMarkButton model="deepseek-v4.1-flash" kind="chat" botId="bot-1" />),
    );
    const mark = container.querySelector('[data-testid="model-switch-mark-entry"]');
    await act(async () => {
      (mark as HTMLButtonElement | null)?.click();
    });
    expect(document.querySelector('[data-testid="model-locate-popup"]')).toBeNull();
  });

  it("shows the provider in the popup when the mark names the bot's current model", async () => {
    const onLocateModel = vi.fn();
    act(() =>
      root.render(
        <ModelSwitchMarkButton
          model="deepseek-v4.1-flash"
          provider="Main"
          kind="chat"
          botId="bot-1"
          onLocateModel={onLocateModel}
        />,
      ),
    );
    const mark = container.querySelector('[data-testid="model-switch-mark-entry"]');
    await act(async () => {
      (mark as HTMLButtonElement | null)?.click();
    });
    const popup = document.querySelector('[data-testid="model-locate-popup"]');
    expect(popup?.textContent).toContain("deepseek-v4.1-flash（Main）");
    const confirm = document.querySelector('[data-testid="model-locate-confirm"]');
    await act(async () => {
      (confirm as HTMLButtonElement | null)?.click();
    });
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "deepseek-v4.1-flash",
      provider: "Main",
    });
  });
});
