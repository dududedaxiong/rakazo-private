// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import type { ModelHealthReport } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelHealthDialog } from "./model-health-dialog";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

const report: ModelHealthReport = {
  label: "Test Relay",
  provider: "openai-compatible",
  total: 3,
  truncated: false,
  ok: ["model-a"],
  results: [
    { model: "model-a", state: "ok", detail: "2", seconds: 1.2 },
    {
      model: "model-b",
      state: "limited",
      detail: "429 Rate limit exceeded. Please try again later.",
      seconds: 0.5,
    },
    {
      model: "model-c",
      state: "auth",
      detail: "Incorrect API key provided: sk-ant-api03-xxxx",
      seconds: 0.5,
    },
  ],
  summary: {
    ok: 1,
    empty: 0,
    limited: 1,
    auth: 1,
    notfound: 0,
    badreq: 0,
    servererr: 0,
    timeout: 0,
    neterr: 0,
  },
};

beforeEach(() => {
  i18n.activate("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function renderDialog(overrides: Partial<ModelHealthReport> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const onKeepUsable = vi.fn();
  act(() => {
    root.render(
      <ModelHealthDialog
        result={{ ...report, ...overrides }}
        keeping={false}
        onClose={onClose}
        onKeepUsable={onKeepUsable}
      />,
    );
  });
  return { onClose, onKeepUsable };
}

function buttonNamed(name: string) {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(name),
  );
}

it("shows the summary and one row per model, with the failure reason", () => {
  renderDialog();
  const dialog = document.querySelector('[data-testid="model-health-dialog"]');
  expect(dialog?.textContent).toContain("Test results · Test Relay");
  expect(dialog?.textContent).toContain("1 of 3 models work");
  expect(dialog?.textContent).toContain("Rate limited 1");
  expect(dialog?.textContent).toContain("No permission 1");
  const rows = [...(dialog?.querySelectorAll("li") ?? [])];
  expect(rows).toHaveLength(3);
  // The ok reply is proof, not a failure reason: the usable row shows only name and badge.
  expect(rows[0]?.textContent).toBe("model-aUsable");
  expect(rows[1]?.textContent).toContain("model-b");
  // A failure row shows the shared plain-language summary, never the upstream's raw error.
  expect(rows[1]?.textContent).toContain(
    "Your model provider is rate limiting requests. Try again shortly.",
  );
  expect(rows[1]?.textContent).not.toContain("429 Rate limit exceeded");
  expect(rows[2]?.textContent).toContain("model-c");
  expect(rows[2]?.textContent).toContain(
    "Your model provider rejected the API key. Check your connection settings.",
  );
  expect(rows[2]?.textContent).not.toContain("sk-ant-api03-xxxx");
});

it("turns a raw provider error envelope into plain language", () => {
  renderDialog({
    total: 1,
    ok: [],
    results: [
      {
        model: "model-q",
        state: "servererr",
        detail: '{"error":{"message":"insufficient_quota: You exceeded your current quota"}}',
        seconds: 0.5,
      },
    ],
    summary: {
      ok: 0,
      empty: 0,
      limited: 0,
      auth: 0,
      notfound: 0,
      badreq: 0,
      servererr: 1,
      timeout: 0,
      neterr: 0,
    },
  });
  const dialog = document.querySelector('[data-testid="model-health-dialog"]');
  expect(dialog?.textContent).toContain("Your model provider reached its credit limit.");
  expect(dialog?.textContent).not.toContain("insufficient_quota");
  expect(dialog?.textContent).not.toContain('{"error"');
});

it("keeps only the usable models when asked", () => {
  const { onKeepUsable } = renderDialog();
  const keep = buttonNamed("Keep only usable models");
  expect(keep?.disabled).toBe(false);
  act(() => {
    keep?.click();
  });
  expect(onKeepUsable).toHaveBeenCalledOnce();
});

it("closes without keeping", () => {
  const { onClose } = renderDialog();
  const close = buttonNamed("Close");
  act(() => {
    close?.click();
  });
  expect(onClose).toHaveBeenCalledOnce();
});

it("disables keeping when every model works", () => {
  const allOk: ModelHealthReport = {
    ...report,
    total: 1,
    ok: ["model-a"],
    results: [{ model: "model-a", state: "ok", detail: "2", seconds: 1 }],
    summary: {
      ok: 1,
      empty: 0,
      limited: 0,
      auth: 0,
      notfound: 0,
      badreq: 0,
      servererr: 0,
      timeout: 0,
      neterr: 0,
    },
  };
  renderDialog(allOk);
  const keep = buttonNamed("Keep only usable models");
  expect(keep?.disabled).toBe(true);
});

it("says when the run stopped at the cap", () => {
  renderDialog({ truncated: true, total: 55 });
  const dialog = document.querySelector('[data-testid="model-health-dialog"]');
  expect(dialog?.textContent).toContain("Only the first 50 models were tested.");
  const keep = buttonNamed("Keep only usable models");
  expect(keep?.disabled).toBe(true);
});
