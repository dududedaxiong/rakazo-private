// @vitest-environment jsdom
// Regression probe: render ChatPersonaSwitcher with the REAL Base UI menu
// (the existing chat-persona-switcher.test.tsx mocks the menu), open it, and
// prove the app-wide error boundary never fires. A render throw anywhere in
// the switcher or the real menu must surface here, not on the user's screen.
import type { Bot, PromptTemplate } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act, Component } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { promptTemplates: api } }));
vi.mock("../../lib/user-error", () => ({
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce(
        (text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`,
        "",
      ),
  }),
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));

import { ChatPersonaSwitcher } from "./chat-persona-switcher";

const template = (overrides: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: "tpl-1",
  name: "默认助手",
  content: "You are a helpful assistant.",
  isBuiltIn: true,
  sourceUrl: null,
  createdAt: "2026-11-12T00:00:00Z",
  updatedAt: "2026-11-12T00:00:00Z",
  ...overrides,
});

const bot = (overrides: Partial<Bot> = {}): Bot =>
  ({
    id: "bot-1",
    name: "New Bot",
    instructions: "You are a helpful assistant.",
    promptTemplateId: "tpl-1",
    ...overrides,
  }) as Bot;

/** Stand-in for the app-wide error boundary: records any render throw. */
class Boundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { error: unknown | null }
> {
  override state: { error: unknown | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  override render() {
    if (this.state.error) return <div data-testid="boundary-fallback">crashed</div>;
    return this.props.children;
  }
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let boundaryError: unknown | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  boundaryError = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderSwitcher() {
  await act(async () =>
    root.render(
      <Boundary onError={(error) => (boundaryError = error)}>
        <ChatPersonaSwitcher bot={bot()} onBotUpdated={() => undefined} />
      </Boundary>,
    ),
  );
}

async function openMenu() {
  act(() =>
    container.querySelector<HTMLButtonElement>('[data-testid="persona-switcher"]')!.click(),
  );
  await act(async () => {});
  await act(async () => {});
}

describe("ChatPersonaSwitcher with the real menu", () => {
  it("opens the real menu, loads templates, and never trips the boundary", async () => {
    api.list.mockResolvedValue([template(), template({ id: "tpl-2", name: "翻译助手" })]);
    await renderSwitcher();
    await openMenu();
    expect(boundaryError).toBeNull();
    expect(document.body.textContent).toContain("默认助手");
    expect(document.body.textContent).toContain("翻译助手");
  });

  it("survives a non-array list reply in the real menu", async () => {
    api.list.mockResolvedValue({ templates: [template()] });
    await renderSwitcher();
    await openMenu();
    expect(boundaryError).toBeNull();
    expect(document.body.textContent).toContain("Something went wrong. Try again.");
  });

  it("survives an empty list in the real menu", async () => {
    api.list.mockResolvedValue([]);
    await renderSwitcher();
    await openMenu();
    expect(boundaryError).toBeNull();
    expect(document.body.textContent).toContain("No templates yet");
  });
});
