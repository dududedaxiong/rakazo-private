// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callbacks = vi.hoisted(() => ({
  push: vi.fn(),
  pickModel: vi.fn(),
  pickMediaModel: vi.fn(),
  openFavorites: vi.fn(),
  openBackground: vi.fn(),
  openBackup: vi.fn(),
}));

vi.mock("expo-router", () => ({ useRouter: () => ({ push: callbacks.push }) }));
vi.mock("./api", () => ({
  rpc: async (procedure: string) => {
    if (procedure === "voice/catalog") return [];
    if (procedure === "voice/status") return { provider: null };
    if (procedure === "computer/status") return { state: "idle" };
    if (procedure === "routines/list") return [];
    return null;
  },
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    border: "#dddddd",
    background: "#ffffff",
    card: "#ffffff",
    link: "#0066cc",
    foreground: "#111111",
    mutedForeground: "#666666",
    success: "#007041",
  }),
}));
vi.mock("./custom-settings", () => ({
  useCustomSettings: () => ({ chipsRowWidthPct: 100, chipsCardWidth: 72 }),
}));
vi.mock("./i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
}));
vi.mock("./webdav-backup-account", () => ({
  loadWebdavBackupAccount: async () => null,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) =>
    createElement(
      "button",
      { type: "button", "aria-label": accessibilityLabel, onClick: onPress },
      children,
    ),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  StyleSheet: { hairlineWidth: 1, create: <T,>(styles: T) => styles },
}));
vi.mock("../components/native-symbol", () => ({
  NativeSymbol: () => createElement("span", null, "icon"),
}));

import { ThreadComposerChips } from "../components/thread/thread-composer-chips";
import type { MobileBot } from "./mobile-types";

const currentBot = {
  id: "bot-1",
  name: "Chief",
  modelProvider: "provider-a",
  modelId: "model-a",
  videoModels: null,
  imageModels: null,
  computerMode: "team",
} as unknown as MobileBot;

let root: Root;
let node: HTMLDivElement;

async function mountChips(bot: MobileBot = currentBot) {
  await act(async () =>
    root.render(
      <ThreadComposerChips
        botId="bot-1"
        currentBot={bot}
        userId="user-1"
        catalog={[]}
        mainOverride={null}
        videoOverride={null}
        imageOverride={null}
        computerChoice={null}
        onPickModel={callbacks.pickModel}
        onPickMediaModel={callbacks.pickMediaModel}
        favoriteCount={0}
        onOpenFavorites={callbacks.openFavorites}
        backgroundLabel="Default"
        onOpenBackground={callbacks.openBackground}
        onOpenBackup={callbacks.openBackup}
      />,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("ThreadComposerChips other models card", () => {
  it("shows the other models card after the voice model card", async () => {
    await mountChips();
    const text = node.textContent ?? "";
    expect(text).toContain("Other models");
    expect(text).toContain("What image and video generation needs");
    expect(text.indexOf("Other models")).toBeGreaterThan(text.indexOf("Voice model"));
  });

  it("opens the other models sheet when the card is tapped", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Other models: What image and video generation needs"]',
    );
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.pickMediaModel).toHaveBeenCalledTimes(1);
    expect(callbacks.pickModel).not.toHaveBeenCalled();
  });

  it("still shows the card when no image or video model is set", async () => {
    await mountChips({
      ...currentBot,
      videoModels: null,
      imageModels: null,
    } as unknown as MobileBot);
    expect(node.textContent).toContain("Other models");
  });
});
