// @vitest-environment jsdom

import type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProviders } from "../components/model-providers";
import type { KeyHealth } from "./key-health";

vi.mock("react-native", () => {
  function MockView(props: { children?: ReactNode; style?: unknown }) {
    return createElement(
      "div",
      { "data-style": JSON.stringify(props.style ?? null) },
      props.children,
    );
  }
  function MockText(props: { children?: ReactNode; style?: unknown }) {
    return createElement(
      "span",
      { "data-style": JSON.stringify(props.style ?? null) },
      props.children,
    );
  }
  function MockPressable(props: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    style?: unknown;
  }) {
    const style = typeof props.style === "function" ? props.style({ pressed: false }) : props.style;
    return createElement(
      "button",
      {
        type: "button",
        "data-style": JSON.stringify(style ?? null),
        disabled: props.disabled,
        role: props.accessibilityRole,
        "aria-label": props.accessibilityLabel,
        onClick: () => {
          if (!props.disabled) props.onPress?.();
        },
      },
      props.children,
    );
  }
  return {
    Alert: { alert: vi.fn(), prompt: vi.fn() },
    Platform: { OS: "ios" },
    Pressable: MockPressable,
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
    Text: MockText,
    View: MockView,
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});
vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("./native", () => ({
  native: { fill: "fill", page: "page", secondaryLabel: "secondary", tertiaryLabel: "tertiary" },
  useMobileTokens: () => ({
    destructive: "red",
    foreground: "ink",
    mutedForeground: "gray",
    link: "blue",
    border: "border",
    card: "card",
    background: "bg",
  }),
  useThemedStyles: (create: () => Record<string, unknown>) => create(),
  useResolvedAppearance: () => "light",
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({ destructive: "red" }),
}));
vi.mock("./ripple", () => ({ androidRipple: () => undefined }));
vi.mock("./text-scale", () => ({ stacksAtTextScale: () => false }));
vi.mock("./i18n", () => ({
  useI18n: () => ({ t: (message: string) => message, locale: "en-US" }),
}));
vi.mock("../components/native-switch", () => ({ NativeSwitch: () => null }));
vi.mock("../components/row-accessories", () => ({ Chevron: () => null }));
vi.mock("../components/model-role-settings", () => ({
  RowMenu: ({ children }: { children?: ReactNode }) => children,
}));

const checkedAt = "2026-11-15T12:00:00.000Z";

function credential(id: string, provider: string): ModelCredential {
  return { id, provider, label: provider, hasKey: true, isDefault: false } as ModelCredential;
}

function catalogEntry(provider: string): ModelCatalogEntry {
  return { provider, providerName: provider, id: "model-1" } as unknown as ModelCatalogEntry;
}

const credentials = [
  credential("cred-1", "Anthropic"),
  credential("cred-2", "OpenAI"),
  credential("cred-3", "DeepSeek"),
];
const catalog = credentials.map((entry) => catalogEntry(entry.provider));

const roots: Root[] = [];
function mount(element: ReactNode) {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  roots.push(root);
  act(() => root.render(element));
  return node;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

function renderProviders(props?: {
  keyHealth?: Map<string, KeyHealth>;
  checkingKeys?: boolean;
  onCheckAllKeys?: () => void;
}) {
  return mount(
    createElement(ModelProviders, {
      catalog,
      credentials,
      keyHealth: props?.keyHealth,
      checkingKeys: props?.checkingKeys ?? false,
      onCheckAllKeys: props?.onCheckAllKeys,
      onManage: () => {},
      onAdd: () => {},
      onRename: () => {},
      onDisconnect: () => {},
    }),
  );
}

describe("ModelProviders key health", () => {
  it("marks an invalid key red with its check time and an ok key plain", () => {
    const node = renderProviders({
      keyHealth: new Map([
        ["cred-1", { status: "invalid_key", checkedAt }],
        ["cred-2", { status: "ok", checkedAt }],
      ]),
    });
    expect(node.textContent).toContain("Key invalid");
    expect(node.textContent).toContain("Key OK");
    const detail = [...node.querySelectorAll("span")].find((span) =>
      span.textContent?.includes("Key invalid"),
    );
    expect(detail?.getAttribute("data-style")).toContain("red");
    const okDetail = [...node.querySelectorAll("span")].find((span) =>
      span.textContent?.includes("Key OK"),
    );
    expect(okDetail?.getAttribute("data-style")).not.toContain("red");
  });

  it("says not checked for a connection with no health record", () => {
    const node = renderProviders({ keyHealth: new Map() });
    expect(node.textContent).toContain("Key not checked");
  });

  it("falls back to the persisted health when no fresh check ran", () => {
    const withPersisted = [
      { ...credentials[0], keyHealth: { status: "invalid_key", checkedAt } },
      credentials[1],
      credentials[2],
    ] as ModelCredential[];
    const node = mount(
      createElement(ModelProviders, {
        catalog,
        credentials: withPersisted,
        onManage: () => {},
        onAdd: () => {},
        onRename: () => {},
        onDisconnect: () => {},
      }),
    );
    expect(node.textContent).toContain("Key invalid");
  });

  it("checks all keys from the check-all row and reads busy while checking", () => {
    const onCheckAllKeys = vi.fn();
    const node = renderProviders({ keyHealth: new Map(), onCheckAllKeys });
    const button = [...node.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Check all keys"),
    );
    expect(button).toBeDefined();
    act(() => {
      button?.click();
    });
    expect(onCheckAllKeys).toHaveBeenCalledTimes(1);

    const busy = renderProviders({
      keyHealth: new Map(),
      checkingKeys: true,
      onCheckAllKeys,
    });
    const busyButton = [...busy.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Checking keys…"),
    );
    expect(busyButton?.disabled).toBe(true);
  });
});
