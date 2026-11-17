// @vitest-environment jsdom
import type { Bot, PromptTemplate } from "@rakazo_mickvvw/contracts";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  apply: vi.fn(),
  applyPreset: vi.fn(),
}));
const botsApi = vi.hoisted(() => ({
  restoreInstructions: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { promptTemplates: api, bots: botsApi } }));
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
vi.mock("@rakazo_mickvvw/ui-web", async () => {
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
    DropdownMenuGroup: Plain,
    DropdownMenuSeparator: () => null,
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
    instructionHistory: [],
    imagePromptPresets: null,
    activeImagePromptPreset: null,
    videoPromptPresets: null,
    activeVideoPromptPreset: null,
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

async function renderSwitcher(props: { onBotUpdated?: (bot: Bot) => void; bot?: Bot } = {}) {
  await act(async () =>
    root.render(
      <ChatPersonaSwitcher
        bot={props.bot ?? bot()}
        onBotUpdated={props.onBotUpdated ?? (() => undefined)}
      />,
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

  it("restores the main persona from before the template was applied", async () => {
    const onBotUpdated = vi.fn();
    const current = bot({
      promptTemplateId: "tpl-1",
      instructions: "Translate.",
      instructionHistory: [
        {
          id: "v-2",
          instructions: "Translate.",
          reason: "Apply template",
          createdAt: "2026-11-13T00:00:00Z",
        },
        {
          id: "v-1",
          instructions: "You are a helpful assistant.",
          reason: "Apply template",
          createdAt: "2026-11-12T00:00:00Z",
        },
      ],
    });
    const updated = bot({ promptTemplateId: null, instructions: "You are a helpful assistant." });
    api.list.mockResolvedValue([template()]);
    botsApi.restoreInstructions.mockResolvedValue(updated);
    await renderSwitcher({ onBotUpdated, bot: current });
    await openMenu();
    expect(container.textContent).toContain("Main persona");
    await act(async () => menuItem("Main persona").click());
    await act(async () => {});
    // The oldest template apply pushed the bot's own persona, so restoring it
    // undoes both applies at once.
    expect(botsApi.restoreInstructions).toHaveBeenCalledWith({
      botId: "bot-1",
      versionId: "v-1",
      expectedInstructions: "Translate.",
    });
    expect(onBotUpdated).toHaveBeenCalledWith(updated);
    expect(toast).toHaveBeenCalledWith("Switched to Main persona");
  });

  it("applies the active image preset and checks it while its prompt is the persona", async () => {
    const onBotUpdated = vi.fn();
    const current = bot({
      promptTemplateId: null,
      instructions: "Ghibli style.",
      imagePromptPresets: [{ name: "Ghibli", prompt: "Ghibli style." }],
      activeImagePromptPreset: "Ghibli",
    });
    const updated = bot({
      promptTemplateId: null,
      instructions: "Ghibli style.",
      imagePromptPresets: [{ name: "Ghibli", prompt: "Ghibli style." }],
      activeImagePromptPreset: "Ghibli",
    });
    api.list.mockResolvedValue([template()]);
    api.applyPreset.mockResolvedValue(updated);
    await renderSwitcher({ onBotUpdated, bot: current });
    await openMenu();
    expect(container.textContent).toContain("Image generation persona");
    // The preset's prompt is the current persona, so it carries the check mark.
    expect(menuItem("Image generation persona").querySelector("svg")).not.toBeNull();
    // Clicking the current persona is a no-op.
    await act(async () => menuItem("Image generation persona").click());
    await act(async () => {});
    expect(api.applyPreset).not.toHaveBeenCalled();
    expect(onBotUpdated).not.toHaveBeenCalled();
  });

  it("applies the active video preset when it is not the current persona", async () => {
    const onBotUpdated = vi.fn();
    const current = bot({
      promptTemplateId: null,
      instructions: "You are a helpful assistant.",
      videoPromptPresets: [{ name: "Cinematic", prompt: "Cinematic look." }],
      activeVideoPromptPreset: "Cinematic",
    });
    const updated = bot({
      promptTemplateId: null,
      instructions: "Cinematic look.",
      videoPromptPresets: [{ name: "Cinematic", prompt: "Cinematic look." }],
      activeVideoPromptPreset: "Cinematic",
    });
    api.list.mockResolvedValue([template()]);
    api.applyPreset.mockResolvedValue(updated);
    await renderSwitcher({ onBotUpdated, bot: current });
    await openMenu();
    expect(menuItem("Video generation persona").querySelector("svg")).toBeNull();
    await act(async () => menuItem("Video generation persona").click());
    await act(async () => {});
    expect(api.applyPreset).toHaveBeenCalledWith({ botId: "bot-1", kind: "video" });
    expect(onBotUpdated).toHaveBeenCalledWith(updated);
    expect(toast).toHaveBeenCalledWith("Switched to Video generation persona");
  });

  it("hides the media personas when the bot has no presets, and keeps the main one", async () => {
    api.list.mockResolvedValue([template()]);
    await renderSwitcher();
    await openMenu();
    expect(container.textContent).toContain("Main persona");
    expect(container.textContent).not.toContain("Image generation persona");
    expect(container.textContent).not.toContain("Video generation persona");
  });

  it("marks the main persona when no template or preset override is active", async () => {
    api.list.mockResolvedValue([template()]);
    await renderSwitcher({
      bot: bot({ promptTemplateId: null, instructions: "Custom persona." }),
    });
    await openMenu();
    expect(menuItem("Main persona").querySelector("svg")).not.toBeNull();
    expect(menuItem("Main persona").hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed preset apply inside the menu and keeps the switcher usable", async () => {
    const onBotUpdated = vi.fn();
    api.list.mockResolvedValue([template()]);
    api.applyPreset.mockRejectedValue(new Error("preset boom"));
    await renderSwitcher({
      onBotUpdated,
      bot: bot({
        promptTemplateId: null,
        instructions: "You are a helpful assistant.",
        imagePromptPresets: [{ name: "Ghibli", prompt: "Ghibli style." }],
        activeImagePromptPreset: "Ghibli",
      }),
    });
    await openMenu();
    await act(async () => menuItem("Image generation persona").click());
    await act(async () => {});
    expect(container.textContent).toContain("preset boom");
    expect(onBotUpdated).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
