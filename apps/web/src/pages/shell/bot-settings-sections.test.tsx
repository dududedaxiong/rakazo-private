// @vitest-environment jsdom

import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import type { ReactNode, RefObject } from "react";
import { act, createRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelLocateKind } from "../../lib/model-locate";
import { ModelSection } from "./bot-settings-sections";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

const choices: ChatModelChoice[] = [
  { key: "provider-a::model-a", label: "Model A", provider: "provider-a", modelId: "model-a" },
  { key: "provider-a::model-b", label: "Model B", provider: "provider-a", modelId: "model-b" },
];

let root: Root;
let container: HTMLDivElement;
let containerRef: RefObject<HTMLDivElement | null>;

async function renderSection(
  overrides: {
    value?: string;
    locatedKey?: string | null;
    locateKind?: ModelLocateKind | null;
    locateRequestId?: number;
  } = {},
) {
  await act(async () =>
    root.render(
      <ModelSection
        ids="test"
        containerRef={containerRef}
        choices={choices}
        value={overrides.value ?? "provider-a::model-a"}
        locatedKey={overrides.locatedKey ?? null}
        locateKind={overrides.locateKind ?? null}
        locateRequestId={overrides.locateRequestId}
        onModelChange={() => undefined}
        thinkingOptions={[]}
        thinkingLevel=""
        defaultThinkingLevel="low"
        onThinkingLevelChange={() => undefined}
      />,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  containerRef = createRef<HTMLDivElement>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ModelSection locate focus", () => {
  it("focuses the located chat row's picker when the model is listed", async () => {
    await renderSection({
      locatedKey: "provider-a::model-a",
      locateKind: "chat",
      locateRequestId: 1,
    });
    const select = container.querySelector<HTMLSelectElement>('select[id="test-model"]');
    expect(select).not.toBeNull();
    expect(document.activeElement).toBe(select);
  });

  it("refocuses when the same model is located again", async () => {
    await renderSection({
      locatedKey: "provider-a::model-a",
      locateKind: "chat",
      locateRequestId: 1,
    });
    const select = container.querySelector<HTMLSelectElement>('select[id="test-model"]');
    expect(document.activeElement).toBe(select);
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement).not.toBe(select);
    await renderSection({
      locatedKey: "provider-a::model-a",
      locateKind: "chat",
      locateRequestId: 2,
    });
    expect(document.activeElement).toBe(select);
  });

  it("focuses the section itself when the located model is no longer listed", async () => {
    await renderSection({ locatedKey: null, locateKind: "chat", locateRequestId: 1 });
    const section = container.querySelector('[data-model-section="chat"]');
    expect(section).not.toBeNull();
    expect(document.activeElement).toBe(section);
  });

  it("does not focus the row for a model that is not this row", async () => {
    await renderSection({
      locatedKey: "provider-a::model-b",
      locateKind: "chat",
      locateRequestId: 1,
    });
    expect(document.activeElement).not.toBe(container.querySelector('select[id="test-model"]'));
    expect(document.activeElement).not.toBe(container.querySelector('[data-model-section="chat"]'));
  });

  it("does not steal focus for other kinds", async () => {
    await renderSection({
      locatedKey: "provider-a::model-a",
      locateKind: "image",
      locateRequestId: 1,
    });
    expect(document.activeElement).not.toBe(container.querySelector('select[id="test-model"]'));
  });

  it("does not focus without a locate", async () => {
    await renderSection();
    expect(document.activeElement).toBe(document.body);
  });
});
