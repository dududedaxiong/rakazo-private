// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelErrorActions, toastModelError } from "./model-error-actions";

const toast = vi.hoisted(() => vi.fn());

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => `${text}${index > 0 ? String(values[index - 1]) : ""}${part}`,
      "",
    );
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children?: ReactNode }) => children,
  };
});

vi.mock("@rakazo_mickvvw/ui-web", () => ({ toast }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.activate("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderActions(props: Parameters<typeof ModelErrorActions>[0]) {
  act(() => root.render(<ModelErrorActions {...props} />));
}

function actionLabels(): string[] {
  return [...container.querySelectorAll('[data-testid="model-error-action"]')].map(
    (button) => button.textContent ?? "",
  );
}

it("offers a key test and a provider switch for a rejected key", async () => {
  const onCheckKey = vi.fn(async () => "invalid_key" as const);
  renderActions({
    error: '401: {"message":"Invalid API key"}',
    onCheckKey,
    onOpenConnections: vi.fn(),
  });
  expect(container.textContent).toContain("rejected the API key");
  expect(actionLabels()).toEqual(["Test this key", "Change provider"]);
  const check = container.querySelectorAll('[data-testid="model-error-action"]')[0]!;
  await act(async () => {
    check.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onCheckKey).toHaveBeenCalledOnce();
  expect(toast).toHaveBeenCalledWith("Key is invalid");
});

it("offers a model switch for a missing model", () => {
  const onOpenModels = vi.fn();
  renderActions({ error: '404: {"message":"Model gone does not exist"}', onOpenModels });
  expect(actionLabels()).toEqual(["Change model"]);
  act(() => {
    container
      .querySelector('[data-testid="model-error-action"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onOpenModels).toHaveBeenCalledOnce();
});

it("offers retry-later and a model switch for rate limits and timeouts", () => {
  const onDismiss = vi.fn();
  const onOpenModels = vi.fn();
  renderActions({
    error: '429: {"message":"Too many requests"}',
    onDismiss,
    onOpenModels,
  });
  expect(actionLabels()).toEqual(["Try again later", "Change model"]);
  renderActions({ error: "Request timed out.", onDismiss, onOpenModels });
  expect(actionLabels()).toEqual(["Check network", "Change model"]);
});

it("offers a provider switch for quota and keeps the raw error behind details", () => {
  const onOpenConnections = vi.fn();
  renderActions({
    error: '402: {"message":"You have no credits remaining."}',
    onOpenConnections,
  });
  expect(actionLabels()).toEqual(["Change provider"]);
  renderActions({ error: "Something entirely unexpected happened." });
  expect(actionLabels()).toEqual([]);
  const details = container.querySelector("details");
  expect(details?.querySelector("pre")?.textContent).toBe(
    "Something entirely unexpected happened.",
  );
});

it("keeps the connect-a-model action for a missing model", () => {
  const onOpenConnections = vi.fn();
  renderActions({
    error: "Connect a model in Settings before running bots.",
    onOpenConnections,
  });
  expect(actionLabels()).toEqual(["Connect a model"]);
});

it("toasts a media failure with the action that fixes it", async () => {
  const rpc = {
    models: {
      credentials: vi.fn(async () => [{ id: "c1", provider: "openai" }]),
      checkKey: vi.fn(async () => ({
        credentialId: "c1",
        status: "invalid_key" as const,
        checkedAt: "2026-11-15T12:00:00.000Z",
      })),
    },
  } as unknown as Parameters<typeof toastModelError>[1]["rpc"];
  toastModelError(new Error('401: {"message":"Invalid API key"}'), {
    rpc,
    provider: "openai",
  });
  expect(toast).toHaveBeenCalledOnce();
  const call = toast.mock.calls[0]!;
  expect(call[0]).toContain("rejected the API key");
  const action = (call[1] as { action: { label: string; onClick: () => void } }).action;
  expect(action.label).toBe("Test this key");
  await act(async () => {
    action.onClick();
  });
  expect(toast).toHaveBeenLastCalledWith("Key is invalid");
});

it("toasts an unknown media failure with the raw error as its description", () => {
  const rpc = { models: {} } as unknown as Parameters<typeof toastModelError>[1]["rpc"];
  toastModelError(new Error("Something entirely unexpected happened."), { rpc });
  expect(toast).toHaveBeenCalledWith(expect.stringContaining("returned an error"), {
    description: "Something entirely unexpected happened.",
  });
});
