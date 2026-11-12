// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchFromUrl: vi.fn(),
  confirmImport: vi.fn(),
  get: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { promptTemplates: api, bots: { get: api.get } } }));
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
  Button: ({
    variant: _v,
    size: _s,
    ...props
  }: ComponentProps<"button"> & Record<string, unknown>) => <button type="button" {...props} />,
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
}));

import { PromptTemplateImportDialog } from "./PromptTemplateImportDialog";

const bot = {
  id: "bot-1",
  name: "New Bot",
  instructions: "You are a helpful assistant.",
  promptTemplateId: null,
} as Bot;

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

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return act(async () => found.click());
}

describe("PromptTemplateImportDialog", () => {
  it("parses pasted text into a preview and confirms the import", async () => {
    const onImported = vi.fn();
    const imported = [
      {
        id: "tpl-9",
        name: "学习导师",
        content: "Teach math.",
        isBuiltIn: false,
        sourceUrl: null,
        createdAt: "2026-11-12T00:00:00Z",
        updatedAt: "2026-11-12T00:00:00Z",
      },
    ];
    api.confirmImport.mockResolvedValue({ templates: imported });
    api.get.mockResolvedValue(bot);
    await act(async () =>
      root.render(
        <PromptTemplateImportDialog open bot={bot} onClose={() => {}} onImported={onImported} />,
      ),
    );
    setValue(container.querySelector("#prompt-template-paste")!, "Teach math.");
    setValue(container.querySelector("#prompt-template-paste-name")!, "学习导师");
    await clickButton("Preview");
    expect(container.textContent).toContain("Teach math.");
    await clickButton("Import 1 template");
    expect(api.confirmImport).toHaveBeenCalledWith({
      templates: [{ name: "学习导师", content: "Teach math." }],
      botId: "bot-1",
    });
    expect(onImported).toHaveBeenCalledWith(imported, bot);
  });

  it("parses pasted JSON without a typed name", async () => {
    api.confirmImport.mockResolvedValue({ templates: [] });
    await act(async () =>
      root.render(<PromptTemplateImportDialog open onClose={() => {}} onImported={() => {}} />),
    );
    setValue(
      container.querySelector("#prompt-template-paste")!,
      JSON.stringify([{ name: "JSON 模板", content: "From JSON." }]),
    );
    await clickButton("Preview");
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Template name"]')?.value,
    ).toBe("JSON 模板");
    expect(container.textContent).toContain("From JSON.");
  });

  it("fetches a subscription URL and confirms with its address recorded", async () => {
    const imported = [
      {
        id: "tpl-10",
        name: "订阅模板",
        content: "From a URL.",
        isBuiltIn: false,
        sourceUrl: "https://example.com/templates.json",
        createdAt: "2026-11-12T00:00:00Z",
        updatedAt: "2026-11-12T00:00:00Z",
      },
    ];
    api.fetchFromUrl.mockResolvedValue({
      templates: [{ name: "订阅模板", content: "From a URL." }],
    });
    api.confirmImport.mockResolvedValue({ templates: imported });
    await act(async () =>
      root.render(<PromptTemplateImportDialog open onClose={() => {}} onImported={() => {}} />),
    );
    setValue(
      container.querySelector("#prompt-template-url")!,
      "https://example.com/templates.json",
    );
    await clickButton("Fetch and preview");
    expect(api.fetchFromUrl).toHaveBeenCalledWith({ url: "https://example.com/templates.json" });
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Template name"]')?.value,
    ).toBe("订阅模板");
    expect(container.textContent).toContain("From a URL.");
    await clickButton("Import 1 template");
    expect(api.confirmImport).toHaveBeenCalledWith({
      templates: [{ name: "订阅模板", content: "From a URL." }],
      sourceUrl: "https://example.com/templates.json",
    });
  });

  it("shows a fetch failure instead of a preview", async () => {
    api.fetchFromUrl.mockRejectedValue(new Error("拉取失败，请检查订阅地址"));
    await act(async () =>
      root.render(<PromptTemplateImportDialog open onClose={() => {}} onImported={() => {}} />),
    );
    setValue(container.querySelector("#prompt-template-url")!, "https://example.com/bad.json");
    await clickButton("Fetch and preview");
    expect(container.textContent).toContain("拉取失败，请检查订阅地址");
    expect(container.textContent).not.toContain("Check the names and content");
  });
});
