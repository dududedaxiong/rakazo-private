// @vitest-environment jsdom

import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import type { PopoverContent } from "@rakazo_mickvvw/ui-web/components/ui/popover";
import type { ComponentProps, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatModelPicker } from "./chat-model-picker";

const { popoverProps } = vi.hoisted(() => ({ popoverProps: vi.fn() }));

vi.mock("@rakazo_mickvvw/ui-web/components/ui/popover", async (importOriginal) => {
  const actual = await importOriginal<{ PopoverContent: typeof PopoverContent }>();
  return {
    ...actual,
    PopoverContent: (props: ComponentProps<typeof PopoverContent>) => {
      popoverProps(props);
      return createElement(actual.PopoverContent, props);
    },
  };
});

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

function choices(count: number): ChatModelChoice[] {
  return [
    { key: "", label: "Space default" },
    ...Array.from({ length: count }, (_, index) => ({
      key: `openrouter::vendor/model-${index + 1}`,
      label: `Model ${index + 1} (OpenRouter)`,
      provider: "openrouter",
      providerLabel: "OpenRouter",
      modelLabel: `Model ${index + 1}`,
      modelId: `vendor/model-${index + 1}`,
    })),
  ];
}

function stubMatchMedia(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe("ChatModelPicker", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    stubMatchMedia(false);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = () => undefined;
    onChange.mockReset();
    popoverProps.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (list: ChatModelChoice[], value: string) =>
    act(() =>
      root.render(<ChatModelPicker id="model" choices={list} value={value} onChange={onChange} />),
    );
  const options = () => [...document.querySelectorAll('[role="option"]')];
  const search = (text: string) =>
    act(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search models"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("keeps the native select for a short list", () => {
    render(choices(9), "");
    expect(container.querySelector("select")?.options).toHaveLength(10);
  });

  it("marks a short list's selected model when it cannot read images", () => {
    const list = choices(2).map((choice, index) =>
      index === 1 ? { ...choice, images: false } : { ...choice, images: true },
    );
    render(list, "openrouter::vendor/model-1");
    const select = container.querySelector("select")!;
    const hint = () => document.getElementById(select.getAttribute("aria-describedby") ?? "");
    expect(container.querySelector('[title="Can\'t read images"]')).not.toBeNull();
    expect(hint()?.textContent).toBe("Can't read images");

    render(list, "openrouter::vendor/model-2");
    expect(container.querySelector('[title="Can\'t read images"]')).toBeNull();
    expect(select.hasAttribute("aria-describedby")).toBe(false);
  });

  it("marks text-only rows and the selected model in a long list", () => {
    const list = choices(11).map((choice) =>
      choice.modelId === "vendor/model-3" ? { ...choice, images: false } : choice,
    );
    render(list, "openrouter::vendor/model-3");
    const trigger = container.querySelector<HTMLButtonElement>("button#model")!;
    expect(trigger.querySelector('[title="Can\'t read images"]')).not.toBeNull();
    act(() => trigger.click());
    const marked = options().filter((option) =>
      option.querySelector('[title="Can\'t read images"]'),
    );
    expect(marked.map((option) => option.textContent)).toEqual(["Model 3"]);
    expect(marked[0]?.getAttribute("aria-describedby")).toBe(
      trigger.getAttribute("aria-describedby"),
    );
  });

  it("searches a long list by name or id and picks from it", () => {
    render(choices(11), "openrouter::vendor/model-2");
    expect(container.querySelector("select")).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>("button#model")!;
    expect(trigger.textContent).toBe("Model 2 (OpenRouter)");

    act(() => trigger.click());
    expect(options()).toHaveLength(12);
    expect(document.querySelector("[cmdk-group-heading]")?.textContent).toBe("OpenRouter");
    expect(options()[2]?.getAttribute("aria-label")).toBe("Model 2 (OpenRouter)");
    const checked = options().filter((option) => option.getAttribute("data-checked") === "true");
    expect(checked.map((option) => option.textContent)).toEqual(["Model 2"]);

    search("MODEL 1");
    expect(options().map((option) => option.textContent)).toEqual([
      "Model 1",
      "Model 10",
      "Model 11",
    ]);
    search("vendor/model-7");
    expect(options().map((option) => option.textContent)).toEqual(["Model 7"]);

    act(() => (options()[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("openrouter::vendor/model-7");
    expect(options()).toHaveLength(0);
  });

  it("says when nothing matches", () => {
    render(choices(11), "");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    search("no such model");
    expect(options()).toHaveLength(0);
    expect(document.querySelector("[cmdk-group-heading]")).toBeNull();
    expect(document.body.textContent).toContain("No matching models");
  });

  it("tags the located row and opens on it for a timeline tap", () => {
    const list = choices(11);
    act(() =>
      root.render(
        <ChatModelPicker
          id="model"
          choices={list}
          value="openrouter::vendor/model-2"
          onChange={onChange}
          locatedKey="openrouter::vendor/model-7"
          autoOpen
        />,
      ),
    );
    // The list opens on the located row without a click.
    expect(options()).toHaveLength(12);
    const located = options().filter((option) => option.textContent?.includes("Located here"));
    expect(located.map((option) => option.getAttribute("aria-label"))).toEqual([
      "Model 7 (OpenRouter)",
    ]);
  });

  it("lets the popup flip vertically without switching axes", () => {
    render(choices(11), "");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    expect(popoverProps.mock.lastCall?.[0]).toMatchObject({
      side: "bottom",
      align: "start",
      collisionAvoidance: { side: "flip", align: "shift", fallbackAxisSide: "none" },
    });
  });

  it("does not autofocus the search input on a coarse pointer", () => {
    stubMatchMedia(true);
    render(choices(11), "");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    expect(popoverProps.mock.lastCall?.[0]).toMatchObject({ initialFocus: false });
  });

  it("keeps the default focus on a fine pointer", () => {
    render(choices(11), "");
    act(() => container.querySelector<HTMLButtonElement>("button#model")!.click());
    expect(popoverProps.mock.lastCall?.[0].initialFocus).toBeUndefined();
  });

  it("wraps the trigger's model name instead of truncating it", () => {
    render(choices(11), "openrouter::vendor/model-2");
    const trigger = container.querySelector<HTMLButtonElement>("button#model")!;
    const name = trigger.querySelector("span");
    expect(name?.className).not.toContain("truncate");
    expect(name?.className).toContain("break-words");
    expect(trigger.className).toContain("min-h-8");
    expect(trigger.className).not.toContain(" h-8 ");
  });
});
