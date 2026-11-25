// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadBackupSheet } from "../components/thread/thread-backup-sheet";

const mocks = vi.hoisted(() => ({ sheet: undefined as unknown }));

vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 402, height: 800, fontScale: 1 }),
  StyleSheet: { create: (styles: unknown) => styles },
  Modal: ({ children }: { children: ReactNode }) =>
    createElement("dialog", { open: true }, children),
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("p", null, children),
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
  TextInput: () => createElement("input", { type: "text" }),
  Platform: { OS: "android" },
}));
vi.mock("../components/native-sheet", () => ({
  useNativeSheet: () => mocks.sheet,
  NativeSheet: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-native-sheet": true }, children),
}));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    card: "token-card",
    background: "token-background",
    foreground: "token-foreground",
    mutedForeground: "token-muted",
    border: "token-border",
    destructive: "token-destructive",
  }),
}));
vi.mock("./i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
}));
// The API client pulls expo-secure-store, which needs the native __DEV__ global.
vi.mock("./api", () => ({
  rpc: vi.fn(async () => ({})),
  captureApiRequestContext: vi.fn(),
}));
vi.mock("./webdav-backup", () => ({
  buildBackupManifest: vi.fn(),
  decideSync: vi.fn(),
  ensureWebdavDirectory: vi.fn(),
  getWebdavTextFile: vi.fn(),
  isBackupPasswordBreached: vi.fn(),
  listWebdavDirectory: vi.fn(),
  normalizeWebdavServerUrl: (url: string) => url,
  parseBackupManifest: vi.fn(),
  putWebdavTextFile: vi.fn(),
  sanitizeBackupDirectory: (directory: string) => directory,
  testWebdavConnection: vi.fn(),
  validateBackupPassword: vi.fn(),
  WEBDAV_BACKUP_MANIFEST_NAME: "manifest.json",
  WEBDAV_BACKUP_SETTINGS_NAME: "settings.json",
  WEBDAV_BACKUP_ZIP_NAME: "backup.zip",
  WebdavBackupError: class extends Error {},
  webdavUrl: (base: string) => base,
}));
vi.mock("./webdav-backup-account", () => ({
  loadWebdavBackupAccount: async () => null,
  loadWebdavBackupSyncState: async () => null,
  saveWebdavBackupAccount: vi.fn(async () => undefined),
  saveWebdavBackupSyncState: vi.fn(async () => undefined),
}));
vi.mock("./webdav-backup-settings", () => ({
  applyBackupSettingsFile: vi.fn(async () => undefined),
  readBackupSettingsFile: vi.fn(async () => null),
}));
vi.mock("./webdav-backup-transfer", () => ({
  downloadAccountExport: vi.fn(),
  downloadFileFromWebdav: vi.fn(),
  importAccountZip: vi.fn(),
  uploadFileToWebdav: vi.fn(),
}));
vi.mock("../components/confirm-identity", () => ({
  useIdentityConfirmation: () => ({
    withIdentityConfirmation: (run: () => unknown) => run(),
    identityDialog: null,
  }),
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, label),
}));
vi.mock("../components/native-symbol", () => ({
  NativeSymbol: () => null,
}));

const roots: ReturnType<typeof createRoot>[] = [];
function mount(element: ReactNode) {
  const node = document.createElement("div");
  const root = createRoot(node);
  roots.push(root);
  act(() => root.render(element));
  return node;
}
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

function FakeSheet({ children }: { children?: ReactNode }) {
  return createElement("div", { "data-fake-sheet": true }, children);
}

function sheet(visible = true) {
  return createElement(ThreadBackupSheet, {
    visible,
    userId: "user-1",
    onClose: () => {},
  });
}

describe("ThreadBackupSheet", () => {
  it("shows the backup settings in a modal while the native sheet is still loading", () => {
    mocks.sheet = undefined;
    const node = mount(sheet());
    expect(node.textContent).toContain("Backup settings");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("shows the backup settings in a modal when the build has no native sheet", () => {
    mocks.sheet = null;
    const node = mount(sheet());
    expect(node.textContent).toContain("Backup settings");
    expect(node.querySelector("dialog")).not.toBeNull();
  });

  it("uses the native sheet once it is available", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(sheet());
    expect(node.textContent).toContain("Backup settings");
    expect(node.querySelector("[data-native-sheet]")).not.toBeNull();
    expect(node.querySelector("dialog")).toBeNull();
  });

  it("renders nothing when hidden", () => {
    mocks.sheet = FakeSheet as ComponentType;
    const node = mount(sheet(false));
    expect(node.textContent).toBe("");
  });
});
