// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: false,
  isError: false,
  error: undefined as unknown,
  refetch: vi.fn(async () => undefined),
}));

vi.mock("./prompt-templates", () => ({
  usePromptTemplates: () => ({
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }),
}));
vi.mock("./api", () => ({ rpc: vi.fn(async () => undefined) }));
vi.mock("./user-error", () => ({
  errorText: (error: unknown, fallback = "Something went wrong. Try again.") =>
    error instanceof Error ? error.message : fallback,
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    foreground: "#111111",
    mutedForeground: "#666666",
    destructive: "#cc0000",
    border: "#dddddd",
    primary: "#000000",
    primaryForeground: "#ffffff",
    muted: "#eeeeee",
  }),
}));
vi.mock("./i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Pressable: ({
    children,
    onPress,
    style,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    style?: unknown;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        onClick: onPress,
        "data-style": typeof style === "function" ? "function" : "object",
      },
      children,
    ),
  Alert: { alert: vi.fn() },
}));
vi.mock("../components/bottom-sheet-shell", () => ({
  BottomSheetShell: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-testid": "persona-sheet" }, children),
  SheetHeader: ({ title }: { title: string }) => createElement("div", null, title),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress(): void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
}));

import { ThreadPersonaSheet } from "../components/thread/thread-persona-sheet";

const template = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-1",
  name: "翻译助手",
  content: "Translate.",
  isBuiltIn: true,
  sourceUrl: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
  ...overrides,
});

let root: Root;
let node: HTMLDivElement;

async function mountSheet() {
  await act(async () =>
    root.render(
      <ThreadPersonaSheet
        visible
        botId="bot-1"
        currentTemplateId={null}
        onClose={() => {}}
        onManageTemplates={() => {}}
        onApplied={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  query.data = undefined;
  query.isPending = false;
  query.isError = false;
  query.error = undefined;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("ThreadPersonaSheet guards", () => {
  it("drops a null entry and renders the usable templates", async () => {
    query.data = [null, template(), { id: "tpl-2" }];
    await mountSheet();
    expect(node.textContent).toContain("翻译助手");
    expect(node.textContent).not.toContain("Could not load templates");
  });

  it("shows an inline error for a non-list reply instead of throwing", async () => {
    query.data = { templates: [template()] };
    await mountSheet();
    expect(node.textContent).toContain("Could not load templates");
    expect(node.textContent).not.toContain("翻译助手");
  });

  it("shows an inline error when the query fails instead of throwing", async () => {
    query.isError = true;
    query.error = new Error("templates unavailable");
    await mountSheet();
    expect(node.textContent).toContain("templates unavailable");
    expect(node.querySelector("button")).not.toBeNull();
  });

  it("renders a template whose content is not text", async () => {
    query.data = [template({ content: { text: "Translate." } })];
    await mountSheet();
    expect(node.textContent).toContain("翻译助手");
  });
});
