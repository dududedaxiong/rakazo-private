// @vitest-environment jsdom

import type { MyReferralCode } from "@rakazo_mickvvw/contracts";
import type { ReactNode } from "react";
import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReferralCodeDetail from "../app/(settings)/referral";

const { rpc, focus } = vi.hoisted(() => ({
  rpc: vi.fn(),
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
  ActivityIndicator: () => null,
  Platform: { OS: "ios" },
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("../components/code-copy-button", () => ({
  CodeCopyButton: ({ code }: { code: string }) =>
    createElement(
      "button",
      { type: "button", "aria-label": "Copy code", "data-code": code },
      "Copy code",
    ),
}));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./native", () => ({
  native: {},
  useThemedStyles: (factory: () => unknown) => factory(),
}));
vi.mock("./i18n", () => {
  const t = (text: string, values?: Record<string, unknown>) => {
    if (!values) return text;
    return Object.entries(values).reduce(
      (out, [key, value]) => out.replace(`{${key}}`, String(value)),
      text,
    );
  };
  return { t, useI18n: () => ({ t, locale: "en" }), dateLocaleForUi: () => "en-US" };
});

const activeCode: MyReferralCode = {
  code: "ABCDEFGHJKMN",
  usedCount: 3,
  maxUses: 10,
  status: "active",
};

describe("referral code page", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function renderScreen() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(ReferralCodeDetail)));
    await act(async () => {});
  }

  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rpc.mockImplementation((procedure: string) => {
      if (procedure === "referral/code") return Promise.resolve(activeCode);
      throw new Error(`unexpected rpc ${procedure}`);
    });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the code, its uses, and a copy button", async () => {
    await renderScreen();
    expect(container.textContent).toContain("ABCDEFGHJKMN");
    expect(container.textContent).toContain("3 of 10 uses");
    expect(button("Copy code").getAttribute("data-code")).toBe("ABCDEFGHJKMN");
    expect(rpc).toHaveBeenCalledWith("referral/code");
  });

  it("shows the unavailable state when the switch is off", async () => {
    rpc.mockResolvedValue(null);
    await renderScreen();
    expect(container.textContent).toContain("Referral codes are not available.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows an exhausted code as used up", async () => {
    rpc.mockResolvedValue({ ...activeCode, usedCount: 10, status: "exhausted" });
    await renderScreen();
    expect(container.textContent).toContain("ABCDEFGHJKMN");
    expect(container.textContent).toContain("Used up");
    expect(container.textContent).not.toContain("of 10 uses");
  });

  it("retries loading after a failure", async () => {
    rpc.mockRejectedValueOnce(new Error("boom"));
    await renderScreen();
    expect(container.textContent).toContain("boom");
    await act(async () => button("Retry").click());
    await act(async () => {});
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("ABCDEFGHJKMN");
  });
});
