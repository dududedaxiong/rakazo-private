// @vitest-environment jsdom
import type { Bot, PromptTemplate } from "@rakazo_mickvvw/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  apply: vi.fn(),
  saveCurrentAsTemplate: vi.fn(),
  update: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { promptTemplates: api } }));
vi.mock("../../lib/user-error", () => ({ errorText: (err: unknown) => (err as Error).message }));
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
vi.mock("@rakazo_mickvvw/ui-web", () => ({
  toast,
  Badge: ({ children, ...props }: ComponentProps<"span">) => <span {...props}>{children}</span>,
  Button: ({
    variant: _v,
    size: _s,
    ...props
  }: ComponentProps<"button"> & Record<string, unknown>) => <button type="button" {...props} />,
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: ComponentProps<"input"> & { onCheckedChange?: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  SectionHeading: ({ children, ...props }: ComponentProps<"h3">) => <h3 {...props}>{children}</h3>,
}));

import { BotPersonaSection } from "./BotPersonaSection";

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
    updatedAt: "2026-11-12T00:00:00Z",
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

describe("BotPersonaSection", () => {
  it("shows the linked template as current and applies another on click", async () => {
    const onBotUpdated = vi.fn();
    const updated = bot({ promptTemplateId: "tpl-2", instructions: "Translate." });
    api.list.mockResolvedValue([
      template(),
      template({ id: "tpl-2", name: "翻译助手", content: "Translate.", isBuiltIn: false }),
    ]);
    api.apply.mockResolvedValue(updated);
    await act(async () =>
      root.render(
        <BotPersonaSection bot={bot()} onBotUpdated={onBotUpdated} onManageTemplates={() => {}} />,
      ),
    );
    expect(container.textContent).toContain("默认助手");
    const row = [...container.querySelectorAll<HTMLButtonElement>("li button")].find((button) =>
      button.textContent?.includes("翻译助手"),
    )!;
    await act(async () => row.click());
    expect(api.apply).toHaveBeenCalledWith({ templateId: "tpl-2", botId: "bot-1" });
    expect(onBotUpdated).toHaveBeenCalledWith(updated);
    expect(toast).toHaveBeenCalledWith("Switched to 翻译助手");
    expect(container.textContent).toContain("翻译助手");
  });

  it("shows a custom persona when the bot is not linked to a template", async () => {
    api.list.mockResolvedValue([template()]);
    await act(async () =>
      root.render(
        <BotPersonaSection
          bot={bot({ promptTemplateId: null, instructions: "Be brief." })}
          onBotUpdated={() => {}}
          onManageTemplates={() => {}}
        />,
      ),
    );
    expect(container.textContent).toContain("Custom");
    expect(container.textContent).toContain("Be brief.");
  });

  it("saves the current persona as a template", async () => {
    api.list.mockResolvedValue([template()]);
    api.saveCurrentAsTemplate.mockResolvedValue(
      template({
        id: "tpl-9",
        name: "New Bot",
        content: "You are a helpful assistant.",
        isBuiltIn: false,
      }),
    );
    await act(async () =>
      root.render(
        <BotPersonaSection bot={bot()} onBotUpdated={() => {}} onManageTemplates={() => {}} />,
      ),
    );
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save current persona as template",
    )!;
    await act(async () => save.click());
    expect(api.saveCurrentAsTemplate).toHaveBeenCalledWith({ botId: "bot-1" });
    expect(toast).toHaveBeenCalledWith("Saved as template");
    expect(container.textContent).toContain("New Bot");
  });
});
