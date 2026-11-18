// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeyHealthLine } from "./key-health-status";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function renderLine(props: Parameters<typeof KeyHealthLine>[0]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<KeyHealthLine {...props} />);
  });
  return container.querySelector("span");
}

it("says it is checking while a probe runs", () => {
  expect(renderLine({ checking: true })?.textContent).toBe("Checking…");
});

it("says not checked when a connection has no result yet", () => {
  expect(renderLine({})?.textContent).toBe("Not checked");
});

it("shows a normal check in the muted tone", () => {
  const line = renderLine({
    health: { status: "ok", checkedAt: "2026-11-18T10:00:00.000Z" },
  });
  expect(line?.textContent).toContain("Normal");
  expect(line?.className).toContain("text-muted-foreground");
  expect(line?.className).not.toContain("text-destructive");
});

it("marks a dead key red", () => {
  const line = renderLine({
    health: { status: "invalid_key", checkedAt: "2026-11-18T10:00:00.000Z" },
  });
  expect(line?.textContent).toContain("Invalid key");
  expect(line?.className).toContain("text-destructive");
});

it("marks an unreachable provider as a warning, not an error", () => {
  const line = renderLine({
    health: { status: "unreachable", checkedAt: "2026-11-18T10:00:00.000Z" },
  });
  expect(line?.textContent).toContain("Unreachable");
  expect(line?.className).toContain("text-warning");
  expect(line?.className).not.toContain("text-destructive");
});

it("marks a timed-out check as a warning", () => {
  const line = renderLine({
    health: { status: "timeout", checkedAt: "2026-11-18T10:00:00.000Z" },
  });
  expect(line?.textContent).toContain("Timed out");
  expect(line?.className).toContain("text-warning");
});
