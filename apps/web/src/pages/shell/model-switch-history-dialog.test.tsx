// @vitest-environment jsdom
import type { ModelSwitchAttempt } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

import { ModelSwitchHistoryDialog, ModelSwitchHistoryEntry } from "./model-switch-history-dialog";

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

  it("calls onLocateModel with the model and provider, then closes", async () => {
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
    expect(onLocateModel).toHaveBeenCalledExactlyOnceWith({
      kind: "chat",
      botId: "bot-1",
      model: "deepseek-v4.1-flash",
      provider: "Main",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
    expect(text).toContain("Main pool");
    expect(text).toContain("Backup pool");
    // One main tag, one backup tag; the pool-less record adds no third tag.
    expect(text.match(/Main pool/g)).toHaveLength(1);
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
});
