// @vitest-environment jsdom
import type { Bot, PromptTemplate } from "@rakazo/contracts";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  apply: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
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
vi.mock("@rakazo/ui-web", async () => {
  const React = await import("react");
  const MenuContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);
  const Plain = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    toast,
    Button: ({
      variant: _v,
      size: _s,
      ...props
    }: ComponentProps<"button"> & Record<string, unknown>) => <button type="button" {...props} />,
    DropdownMenu: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children?: ReactNode;
    }) => <MenuContext.Provider value={{ open, onOpenChange }}>{children}</MenuContext.Provider>,
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    DropdownMenuLabel: Plain,
    DropdownMenuTrigger: ({ render, children }: { render?: ReactNode; children?: ReactNode }) => {
      const ctx = React.useContext(MenuContext);
      const trigger = React.isValidElement(render)
        ? React.cloneElement(render as ReactElement<{ onClick?: () => void }>, {
            onClick: () => ctx?.onOpenChange(!ctx.open),
          })
        : null;
      return (
        <>
          {trigger}
          {children}
        </>
      );
    },
  };
});

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

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderSwitcher(props: { onBotUpdated?: (bot: Bot) => void } = {}) {
  await act(async () =>
    root.render(
      <ChatPersonaSwitcher bot={bot()} onBotUpdated={props.onBotUpdated ?? (() => undefined)} />,
    ),
  );
}

async function openMenu() {
  act(() =>
    container.querySelector<HTMLButtonElement>('[data-testid="persona-switcher"]')!.click(),
  );
  await act(async () => {});
}

function menuItem(name: string) {
  const found = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(name),
  );
  if (!found) throw new Error(`no menu item for ${name}`);
  return found;
}

describe("ChatPersonaSwitcher", () => {
  it("loads templates only once opened, marks the current one, and applies another", async () => {
    const onBotUpdated = vi.fn();
    const updated = bot({ promptTemplateId: "tpl-2", instructions: "Translate." });
    api.list.mockResolvedValue([
      template(),
      template({ id: "tpl-2", name: "翻译助手", content: "Translate.", isBuiltIn: false }),
    ]);
    api.apply.mockResolvedValue(updated);
    await renderSwitcher({ onBotUpdated });
    expect(api.list).not.toHaveBeenCalled();
    await openMenu();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("默认助手");
    expect(container.textContent).toContain("翻译助手");
    // The current template carries the check mark; the other one does not.
    expect(menuItem("默认助手").querySelector("svg")).not.toBeNull();
    expect(menuItem("翻译助手").querySelector("svg")).toBeNull();
    await act(async () => menuItem("翻译助手").click());
    await act(async () => {});
    expect(api.apply).toHaveBeenCalledWith({ templateId: "tpl-2", botId: "bot-1" });
    expect(onBotUpdated).toHaveBeenCalledWith(updated);
    expect(toast).toHaveBeenCalledWith("Switched to 翻译助手");
  });

  it("shows an empty state instead of crashing on an empty list", async () => {
    api.list.mockResolvedValue([]);
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("No templates yet");
  });

  it("shows a rejected list only inside the menu, without crashing the page", async () => {
    api.list.mockRejectedValue(new Error("list boom"));
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("list boom");
    expect(container.textContent).not.toContain("默认助手");
    expect(container.querySelector('[data-testid="persona-switcher"]')).not.toBeNull();
  });

  it("shows a synchronously thrown list only inside the menu, without crashing the page", async () => {
    api.list.mockImplementation(() => {
      throw new Error("sync boom");
    });
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("sync boom");
    expect(container.querySelector('[data-testid="persona-switcher"]')).not.toBeNull();
  });

  it("shows a non-array list reply only inside the menu, without crashing the page", async () => {
    api.list.mockResolvedValue({ templates: [template()] });
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("Something went wrong. Try again.");
    expect(container.textContent).not.toContain("默认助手");
    expect(container.querySelector('[data-testid="persona-switcher"]')).not.toBeNull();
  });

  it("shows a null list reply only inside the menu, without crashing the page", async () => {
    api.list.mockResolvedValue(null);
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("Something went wrong. Try again.");
    expect(container.querySelector('[data-testid="persona-switcher"]')).not.toBeNull();
  });

  it("drops malformed entries and still lists the usable ones", async () => {
    api.list.mockResolvedValue([
      null,
      template(),
      { id: 1, name: null },
      template({ id: "tpl-2", name: "翻译助手", content: "Translate.", isBuiltIn: false }),
    ]);
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("默认助手");
    expect(container.textContent).toContain("翻译助手");
  });

  it("shows a failed apply inside the menu and keeps the switcher usable", async () => {
    const onBotUpdated = vi.fn();
    api.list.mockResolvedValue([
      template(),
      template({ id: "tpl-2", name: "翻译助手", content: "Translate.", isBuiltIn: false }),
    ]);
    api.apply.mockRejectedValue(new Error("apply boom"));
    await renderSwitcher({ onBotUpdated });
    await openMenu();
    await act(async () => menuItem("翻译助手").click());
    await act(async () => {});
    expect(container.textContent).toContain("apply boom");
    expect(onBotUpdated).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="persona-switcher"]')).not.toBeNull();
  });
});
