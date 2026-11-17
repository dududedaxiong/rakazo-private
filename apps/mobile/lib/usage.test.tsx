// @vitest-environment jsdom

import type { UsageRecord, UsageSummary } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsageDetail from "../app/(settings)/usage";

const { rpc, alert, focus } = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
  focus: { current: undefined as (() => (() => void) | undefined) | undefined },
}));

vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("./api", () => ({
  rpc: (procedure: string, ...args: unknown[]) => rpc(procedure, ...args),
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    focus.current = effect;
    useEffect(effect, [effect]);
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert },
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => createElement("button", { type: "button", disabled, onClick: onPress }, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("../components/native-segmented-control", () => ({ NativeSegmentedControl: () => null }));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { type: "button", disabled, onClick: onPress }, label),
}));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./native", () => ({
  native: {},
  useThemedStyles: (factory: () => unknown) => factory(),
}));
vi.mock("./i18n", () => {
  const t = (text: string) => text;
  return { t, useI18n: () => ({ t, locale: "en" }), dateLocaleForUi: () => "en-US" };
});

const emptySummary: UsageSummary = {
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  modelCalls: 0,
  models: [],
  bots: [],
  daily: [],
};

const summaryFixture: UsageSummary = {
  runs: 2,
  inputTokens: 1200,
  outputTokens: 34,
  totalTokens: 1234,
  costUsd: 0.5,
  modelCalls: 3,
  models: [],
  bots: [],
  daily: [],
};

function recordFixture(): UsageRecord {
  return {
    id: "rec-1",
    botId: "bot-1",
    runId: "run-1",
    provider: "test",
    model: "model-a",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    costUsd: 0.01,
    usageSource: "provider",
    createdAt: new Date().toISOString(),
  } as UsageRecord;
}

describe("usage reset", () => {
  let root: Root;
  let container: HTMLDivElement;
  let summary: UsageSummary;
  let records: UsageRecord[];

  function resetCalls() {
    return rpc.mock.calls.filter(([procedure]) => procedure === "usage/reset");
  }

  function lastAlert() {
    const call = alert.mock.calls.at(-1);
    if (!call) throw new Error("Alert.alert was not called");
    return call;
  }

  function alertButtons() {
    const buttons = lastAlert()[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    if (!buttons) throw new Error("Alert.alert was called without buttons");
    return buttons;
  }

  async function confirmAlert() {
    const reset = alertButtons().find((item) => item.text === "Reset");
    const onPress = reset?.onPress;
    if (!onPress) throw new Error("Alert is missing its Reset button");
    await act(async () => onPress());
  }

  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  async function renderScreen() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(UsageDetail)));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    summary = { ...summaryFixture };
    records = [recordFixture()];
    rpc.mockImplementation((procedure: string) => {
      if (procedure === "usage/summary") return Promise.resolve(summary);
      if (procedure === "usage/list") return Promise.resolve(records);
      if (procedure === "usage/reset") {
        const deleted = records.length;
        records = [];
        summary = { ...emptySummary };
        return Promise.resolve({ deleted });
      }
      throw new Error(`unexpected rpc ${procedure}`);
    });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    vi.unstubAllGlobals();
  });

  it("shows a Reset usage button once the usage loads", async () => {
    await renderScreen();
    expect(button("Reset usage")).not.toBeNull();
  });

  it("cancelling the reset confirmation does nothing", async () => {
    await renderScreen();
    await act(async () => button("Reset usage").click());
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe("Reset usage?");
    expect(resetCalls()).toHaveLength(0);
  });

  it("confirming the reset calls usage/reset once and reloads the data", async () => {
    await renderScreen();
    await act(async () => button("Reset usage").click());
    expect(alertButtons().map((item) => item.text)).toEqual(["Cancel", "Reset"]);
    await confirmAlert();
    expect(resetCalls()).toHaveLength(1);
    expect(rpc.mock.calls.filter(([procedure]) => procedure === "usage/summary")).toHaveLength(2);
    expect(rpc.mock.calls.filter(([procedure]) => procedure === "usage/list")).toHaveLength(2);
    expect(container.textContent).toContain("No usage yet");
  });

  it("a failed reset shows an error alert and keeps the data", async () => {
    await renderScreen();
    rpc.mockRejectedValueOnce(new Error("boom"));
    await act(async () => button("Reset usage").click());
    await confirmAlert();
    expect(resetCalls()).toHaveLength(1);
    expect(alert).toHaveBeenCalledWith("Could not reset usage", expect.any(String));
    expect(container.textContent).not.toContain("No usage yet");
  });
});
