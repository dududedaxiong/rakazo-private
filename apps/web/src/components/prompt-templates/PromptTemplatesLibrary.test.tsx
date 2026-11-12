// @vitest-environment jsdom
import type { Bot, PromptTemplate } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  apply: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  restoreDefaults: vi.fn(),
  saveCurrentAsTemplate: vi.fn(),
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
vi.mock("@rakazo/ui-web", () => ({
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
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SectionHeading: ({ children, ...props }: ComponentProps<"h3">) => <h3 {...props}>{children}</h3>,
}));
vi.mock("../ConfirmDialog", () => ({
  ConfirmDialog: ({
    title,
    onConfirm,
    onCancel,
  }: {
    title: ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div role="alertdialog">
      <p>{title}</p>
      <button type="button" onClick={onConfirm}>
        Delete
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

import { PromptTemplatesLibrary } from "./PromptTemplatesLibrary";

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

function rowButton(templateName: string, label: string) {
  const row = [...container.querySelectorAll("li")].find((item) =>
    item.textContent?.includes(templateName),
  );
  const found = [...(row?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no ${label} button for ${templateName}`);
  return found;
}

async function renderLibrary(props: { bot?: Bot | null; onBotUpdated?: (bot: Bot) => void } = {}) {
  api.list.mockResolvedValue([
    template(),
    template({ id: "tpl-2", name: "翻译助手", content: "Translate.", isBuiltIn: false }),
  ]);
  await act(async () =>
    root.render(
      <PromptTemplatesLibrary bot={props.bot ?? bot()} onBotUpdated={props.onBotUpdated} />,
    ),
  );
}

describe("PromptTemplatesLibrary", () => {
  it("marks the bot's template in use and applies another on Use", async () => {
    const onBotUpdated = vi.fn();
    const updated = bot({ promptTemplateId: "tpl-2", instructions: "Translate." });
    api.apply.mockResolvedValue(updated);
    await renderLibrary({ onBotUpdated });
    expect(container.textContent).toContain("翻译助手");
    await act(async () => rowButton("翻译助手", "Use").click());
    expect(api.apply).toHaveBeenCalledWith({ templateId: "tpl-2", botId: "bot-1" });
    expect(onBotUpdated).toHaveBeenCalledWith(updated);
    expect(toast).toHaveBeenCalledWith("Switched to 翻译助手");
  });

  it("confirms before deleting a template", async () => {
    api.remove.mockResolvedValue({ ok: true });
    await renderLibrary();
    await act(async () => rowButton("翻译助手", "Delete").click());
    expect(container.textContent).toContain("Delete 翻译助手?");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click(),
    );
    expect(api.remove).toHaveBeenCalledWith({ templateId: "tpl-2" });
    expect(container.textContent).not.toContain("翻译助手");
  });

  it("edits a template in place", async () => {
    api.update.mockResolvedValue(
      template({ id: "tpl-2", name: "翻译助手", content: "Translate well." }),
    );
    await renderLibrary();
    await act(async () => rowButton("翻译助手", "Edit").click());
    const textarea = container.querySelector<HTMLTextAreaElement>("#prompt-template-content");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!
        .set!;
      setter.call(textarea, "Translate well.");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((button) => button.textContent?.trim() === "Save")!
        .click(),
    );
    expect(api.update).toHaveBeenCalledWith({ templateId: "tpl-2", content: "Translate well." });
    expect(container.textContent).toContain("Translate well.");
  });
});
