// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSelectionBar } from "./message-selection";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function buttonByText(text: string) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === text);
}

function renderBar(props: { busy?: boolean; onDelete?: () => void } = {}) {
  const onDelete = props.onDelete ?? vi.fn();
  act(() =>
    root.render(
      <MessageSelectionBar
        count={2}
        busy={props.busy ?? false}
        onExport={vi.fn()}
        onTranslate={vi.fn()}
        onForward={vi.fn()}
        onDelete={onDelete}
        onCancel={vi.fn()}
      />,
    ),
  );
  return { onDelete };
}

describe("MessageSelectionBar", () => {
  it("shows the count and all batch actions including delete", () => {
    renderBar();
    expect(container.textContent).toContain("2 selected");
    for (const label of ["Export", "Translate", "Forward", "Delete", "Cancel"]) {
      expect(buttonByText(label)).not.toBeUndefined();
    }
  });

  it("calls onDelete when the delete button is clicked", () => {
    const { onDelete } = renderBar();
    act(() => buttonByText("Delete")?.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables the delete button while a batch action is running", () => {
    renderBar({ busy: true });
    expect(buttonByText("Delete")?.disabled).toBe(true);
  });
});
