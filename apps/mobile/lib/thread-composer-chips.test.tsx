// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement, useEffect } from "react";
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

const vaultState = vi.hoisted(() => ({
  accountItems: [] as { name: string }[],
  spaceItems: [] as { name: string }[],
  // Whether the Space customized credentials, so it keeps its own vault.
  spaceOwnVault: false,
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: callbacks.push }),
  useFocusEffect: (effect: () => (() => void) | undefined) => useEffect(effect, [effect]),
}));
vi.mock("./settings-target", () => ({
  settingsTarget: (spaceId?: string) =>
    spaceId ? { scope: "space", spaceId } : { scope: "account" },
  // No scope is sent for a Space: the server resolves the vault the Space uses, its own when
  // it customized credentials, the account's otherwise — the same rule the vault page relies on.
  vaultScopeBody: (target: { scope: string }) =>
    target.scope === "account" ? { scope: "account" } : undefined,
  // An explicit scope wins, as the server resolves it; no scope means the server resolves the
  // vault the Space uses, its own when it customized credentials, the account's otherwise —
  // the same rule the vault page relies on.
  settingsRpc:
    (target: { scope: string }) => async (procedure: string, body?: { scope?: string }) => {
      if (procedure === "vault/list") {
        if (body?.scope === "space") return vaultState.spaceItems;
        if (body?.scope === "account") return vaultState.accountItems;
        if (target.scope === "space" && !vaultState.spaceOwnVault) return vaultState.accountItems;
        return target.scope === "space" ? vaultState.spaceItems : vaultState.accountItems;
      }
      return null;
    },
}));
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

async function mountChips(bot: MobileBot = currentBot, spaceId?: string | null) {
  await act(async () =>
    root.render(
      <ThreadComposerChips
        botId="bot-1"
        currentBot={bot}
        userId="user-1"
        spaceId={spaceId}
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
  vaultState.accountItems = [];
  vaultState.spaceItems = [];
  vaultState.spaceOwnVault = false;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("ThreadComposerChips routines, favorites, background, backup and gallery cards", () => {
  it("navigates to the routines page when the routines card is tapped", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>('[aria-label="Routines: 0 running"]');
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.push).toHaveBeenCalledTimes(1);
    expect(callbacks.push).toHaveBeenCalledWith({
      pathname: "/routines",
      params: { botId: "bot-1" },
    });
  });

  it("opens the favorites sheet when the favorites card is tapped", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>('[aria-label="Favorites: No favorites"]');
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.openFavorites).toHaveBeenCalledTimes(1);
  });

  it("opens the background sheet when the background card is tapped", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>('[aria-label="Background: Default"]');
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.openBackground).toHaveBeenCalledTimes(1);
  });

  it("opens the backup sheet when the backup card is tapped", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>('[aria-label="Backup: Not set up"]');
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.openBackup).toHaveBeenCalledTimes(1);
  });

  it("navigates to the gallery when the gallery card is tapped", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Gallery: No generated media"]',
    );
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.push).toHaveBeenCalledTimes(1);
    expect(callbacks.push).toHaveBeenCalledWith("/gallery");
  });
});

describe("ThreadComposerChips accounts card", () => {
  it("shows the vault count after the computer card", async () => {
    vaultState.accountItems = [{ name: "site-a" }, { name: "site-b" }];
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Account management: 2 accounts"]',
    );
    expect(card).not.toBeNull();
    const text = node.textContent ?? "";
    expect(text.indexOf("Account management")).toBeGreaterThan(text.indexOf("Computer"));
  });

  it("shows no accounts when the vault is empty", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Account management: No accounts"]',
    );
    expect(card).not.toBeNull();
  });

  it("counts the account vault for a Space without its own vault", async () => {
    vaultState.accountItems = [{ name: "site-a" }, { name: "site-b" }];
    vaultState.spaceItems = [];
    await mountChips(currentBot, "space-1");
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Account management: 2 accounts"]',
    );
    expect(card).not.toBeNull();
  });

  it("counts the Space's own vault once it has one", async () => {
    vaultState.accountItems = [{ name: "site-a" }, { name: "site-b" }];
    vaultState.spaceItems = [{ name: "site-c" }];
    vaultState.spaceOwnVault = true;
    await mountChips(currentBot, "space-1");
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Account management: 1 accounts"]',
    );
    expect(card).not.toBeNull();
  });

  it("opens the space vault when the card is tapped", async () => {
    vaultState.spaceItems = [{ name: "site-a" }, { name: "site-b" }];
    vaultState.spaceOwnVault = true;
    await mountChips(currentBot, "space-1");
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Account management: 2 accounts"]',
    );
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.push).toHaveBeenCalledTimes(1);
    expect(callbacks.push).toHaveBeenCalledWith({
      pathname: "/(settings)/vault",
      params: { spaceId: "space-1" },
    });
  });

  it("opens the account vault when there is no space", async () => {
    await mountChips();
    const card = node.querySelector<HTMLButtonElement>(
      '[aria-label="Account management: No accounts"]',
    );
    expect(card).not.toBeNull();
    await act(async () => card!.click());
    expect(callbacks.push).toHaveBeenCalledTimes(1);
    expect(callbacks.push).toHaveBeenCalledWith({
      pathname: "/(settings)/vault",
      params: {},
    });
  });
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
