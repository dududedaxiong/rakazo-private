// @vitest-environment jsdom
import type { ModelSwitchAttempt } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: ({
    accessibilityRole,
    accessibilityLabel,
    onPress,
    children,
  }: {
    accessibilityRole?: string;
    accessibilityLabel?: string;
    onPress?: () => void;
    children?: ReactNode;
  }) =>
    createElement(
      "rn-pressable",
      { role: accessibilityRole, "aria-label": accessibilityLabel, onClick: onPress },
      children,
    ),
  Text: ({ children }: { children?: ReactNode }) => createElement("rn-text", {}, children),
  View: ({ children }: { children?: ReactNode }) => createElement("div", {}, children),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("../lib/native", () => ({
  useMobileTokens: () => ({ mutedForeground: "muted", foreground: "ink" }),
  useResolvedAppearance: () => "light",
}));
// The bar shares its file with the timeline sheet; the sheet shell is
// never rendered here, so it stays a stub.
vi.mock("../components/bottom-sheet-shell", () => ({
  BottomSheetShell: () => null,
  SheetHeader: () => null,
}));

import { ModelSwitchBar } from "../components/model-switch-timeline-sheet";

const attempts: ModelSwitchAttempt[] = [
  {
    model: "deepseek-v4.1-flash",
    provider: "主站",
    outcome: "failed",
    errorCode: "rate_limit",
    at: "2026-11-15T10:00:00.000Z",
  },
  {
    model: "krisphyn-DeepSeek-V4-Pro",
    provider: "GB中转",
    outcome: "succeeded",
    at: "2026-11-15T10:00:12.000Z",
  },
];

afterEach(() => {
  vi.useRealTimers();
});

async function renderBar(element: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    bar: () => container.querySelector("rn-pressable"),
    text: () => container.textContent ?? "",
    click: async () => {
      await act(async () => {
        (container.querySelector("rn-pressable") as HTMLElement | null)?.click();
      });
    },
    unmount: () => act(async () => root.unmount()),
  };
}

it("renders the timeline bar with the final model and opens the history", async () => {
  const onPress = vi.fn();
  const view = await renderBar(
    <ModelSwitchBar
      switches={{ attempts, finalModel: "krisphyn-DeepSeek-V4-Pro" }}
      onPress={onPress}
    />,
  );
  expect(view.bar()?.getAttribute("role")).toBe("button");
  expect(view.bar()?.getAttribute("aria-label")).toBe("Switch history");
  expect(view.text()).toContain("Active model: krisphyn-DeepSeek-V4-Pro · GB中转 ›");
  await view.click();
  expect(onPress).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it("renders the same bar for a lone mark and opens the model list", async () => {
  const onPress = vi.fn();
  const view = await renderBar(<ModelSwitchBar model="deepseek-flash" onPress={onPress} />);
  expect(view.bar()?.getAttribute("role")).toBe("button");
  expect(view.bar()?.getAttribute("aria-label")).toBe("Change model");
  expect(view.text()).toContain("Active model: deepseek-flash ›");
  await view.click();
  expect(onPress).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it("keeps the preset on a lone media mark", async () => {
  const view = await renderBar(
    <ModelSwitchBar model="model-x" presetName="默认预设" onPress={() => {}} />,
  );
  expect(view.text()).toContain("Active model: model-x · 默认预设 ›");
  await view.unmount();
});
