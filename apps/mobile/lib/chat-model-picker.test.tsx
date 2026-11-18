// @vitest-environment jsdom

import { notifyManager } from "@tanstack/react-query";
import type { ComponentType, CSSProperties, ReactNode, Ref } from "react";
import { act, createElement, useEffect, useImperativeHandle, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelConnection from "../app/(settings)/model-connection";
import SettingsModelPickerScreen from "../app/(settings)/model-picker";
import Models from "../app/(settings)/models";
import BotModelScreen from "../app/bot-model";
import BotSettingsScreen from "../app/bot-settings";
import { ModelPickerList } from "../components/model-picker-list";
import { ThreadComposerChips } from "../components/thread/thread-composer-chips";
import type {
  ThreadModelPickerRole,
  ThreadModelSave,
} from "../components/thread/thread-model-picker-sheet";
import { ThreadModelPickerSheet } from "../components/thread/thread-model-picker-sheet";
import type { MobileBot, MobileModel } from "./mobile-types";
import type { ModelConnectionRequest } from "./model-connection-request";
import { modelConnectionRequest, openModelConnection } from "./model-connection-request";
import { modelPickerRequest } from "./model-picker-selection";
import { resetModelTestRunStore } from "./model-test-run";
import { queryClient } from "./query";

// Bot settings now uses the image picker for expression-face replacement;
// without this mock the real expo-image-picker pulls in Expo's async-require
// setup, which references the __DEV__ global the test environment lacks.
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true, assets: [] })),
}));

const mocks = vi.hoisted(() => ({
  showMenu: vi.fn(),
  scrollToLocation: vi.fn(),
  scrollTo: vi.fn(),
  reportVisibleRows: true,
  headerInset: 0,
  focused: true,
  platform: "ios",
  connected: true,
  serverCredentials: false,
  catalogEmpty: false,
  extraProviders: false,
  gateway: false,
  workers: false,
  savedMaxTokens: undefined as number | undefined,
  savedAccountId: "account-fixture",
  savedGatewayId: "gateway-fixture",
  vendorLabels: false,
  subscriptionSignIn: false,
  secondConnection: false,
  enabledModelIds: undefined as string[] | undefined,
  alert: vi.fn(),
  prompt: vi.fn(),
  completeOAuth: vi.fn(),
  testProvider: vi.fn((input: { credentialId: string }) => ({
    label: input.credentialId === WORK_CREDENTIAL_ID ? "Work" : "OpenRouter",
    provider: "openrouter",
    total: 2,
    truncated: false,
    ok: ["vendor/model-1"],
    results: [
      { model: "vendor/model-1", state: "ok", detail: "2", seconds: 1 },
      { model: "vendor/model-2", state: "auth", detail: "No permission", seconds: 1 },
    ],
    summary: {
      ok: 1,
      empty: 0,
      limited: 0,
      auth: 1,
      notfound: 0,
      badreq: 0,
      servererr: 0,
      timeout: 0,
      neterr: 0,
    },
  })),
  rpc: vi.fn(),
  dismissKeyboard: vi.fn(),
  listProps: {} as Record<string, unknown>,
  params: {} as Record<string, string | undefined>,
  update: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  dismissTo: vi.fn(),
  setParams: vi.fn(),
  setOptions: vi.fn(),
  announce: vi.fn(),
  backups: [] as { provider: string; modelId: string }[] | Promise<unknown>,
  primary: null as { provider: string; modelId: string; thinkingLevel?: string | null } | null,
  computerPrimary: null as {
    provider: string;
    modelId: string;
  } | null,
  voiceStatus: {
    configured: true,
    ready: true,
    transcribe: false,
    provider: "fish",
    voiceId: "xiaoxiao",
  },
  voiceCatalog: [{ id: "fish", name: "Fish Audio", description: "", transcribe: false }],
  voiceList: [{ id: "xiaoxiao", label: "晓晓 · 女声" }],
  computerStatus: {
    botId: "bot-fixture",
    mode: "team",
    kind: "docker",
    state: "running",
    controlHolder: "none",
    controlBotId: null,
    takeoverRequested: false,
    screenAvailable: true,
    screenWidth: 1024,
    screenHeight: 768,
    homeRevision: null,
    busyBotName: null,
    canUpdate: false,
    terminalAvailable: false,
  },
  routines: [
    { id: "routine-1", botId: "bot-fixture", active: true },
    { id: "routine-2", botId: "bot-fixture", active: true },
    { id: "routine-3", botId: "bot-fixture", active: true },
    { id: "routine-4", botId: "bot-fixture", active: false },
  ],
  sheet: null as ComponentType<{ children?: ReactNode }> | null,
  menus: new Map<
    string,
    {
      actions: {
        id: string;
        title: string;
        subactions?: { id: string; title: string; state: string }[];
      }[];
      onPressAction: (event: { nativeEvent: { event: string } }) => void;
    }
  >(),
  rowAccessibilityActions: new Map<
    string,
    (event: { nativeEvent: { actionName: string } }) => void
  >(),
}));

/** The deployment's approval model, shown when the member chose none. */
const APPROVAL_DEFAULT = { provider: "openrouter", modelId: "vendor/model-1" };
const CREDENTIAL_ID = "credential-fixture";
const WORK_CREDENTIAL_ID = "credential-work";

const catalog = Array.from({ length: 11 }, (_, index) => ({
  provider: "openrouter",
  providerName: "OpenRouter",
  id: `vendor/model-${index + 1}`,
  label: `Model ${index + 1}`,
  billing: "",
  auth: "api-key",
  thinkingLevels: ["low", "medium", "high"],
}));

const defaultVoiceStatus = () => ({
  configured: true,
  ready: true,
  transcribe: false,
  provider: "fish",
  voiceId: "xiaoxiao",
});
const defaultVoiceCatalog = () => [
  { id: "fish", name: "Fish Audio", description: "", transcribe: false },
];
const defaultVoiceList = () => [{ id: "xiaoxiao", label: "晓晓 · 女声" }];
const defaultComputerStatus = () => ({
  botId: "bot-fixture",
  mode: "team",
  kind: "docker",
  state: "running",
  controlHolder: "none",
  controlBotId: null,
  takeoverRequested: false,
  screenAvailable: true,
  screenWidth: 1024,
  screenHeight: 768,
  homeRevision: null,
  busyBotName: null,
  canUpdate: false,
  terminalAvailable: false,
});
const defaultRoutines = () => [
  { id: "routine-1", botId: "bot-fixture", active: true },
  { id: "routine-2", botId: "bot-fixture", active: true },
  { id: "routine-3", botId: "bot-fixture", active: true },
  { id: "routine-4", botId: "bot-fixture", active: false },
];

vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 34 }),
  SafeAreaView: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
}));
vi.mock("./floating-header", () => ({ useFloatingHeaderInset: () => mocks.headerInset }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./message-action-sheet", () => ({ presentMessageActionSheet: vi.fn() }));
vi.mock("./live-notifications", () => ({ afterChatNotifyChange: vi.fn(async () => undefined) }));

// The model test run store persists its snapshot to SecureStore.
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock("./session", () => ({
  loadSessionToken: async () => "token",
  currentSessionGeneration: () => 1,
}));
// Cache updates reach the screen inside act instead of on a later timer.
notifyManager.setScheduler((callback) => callback());
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({
  currentApiBase: () => "https://app.example.test",
  captureApiRequestContext: async () => ({ headers: {} }),
  selectedSpaceId: () => "space-fixture",
  rpc: async (procedure: string, input?: unknown, options?: { signal?: AbortSignal }) => {
    const cloudflare = mocks.gateway
      ? {
          provider: "cloudflare-ai-gateway",
          providerName: "Cloudflare AI Gateway",
          routingFields: ["accountId", "gatewayId"],
        }
      : mocks.workers
        ? {
            provider: "cloudflare-workers-ai",
            providerName: "Cloudflare Workers AI",
            routingFields: ["accountId"],
          }
        : undefined;
    const result = mocks.rpc(procedure, input);
    if (procedure === "models/connect") {
      await result;
      const saved = input as {
        maxTokens?: number | null;
        accountId?: string;
        gatewayId?: string;
        enabledModelIds?: string[];
      };
      // A null limit clears it, as the server does.
      mocks.savedMaxTokens = saved.maxTokens ?? undefined;
      if (saved.accountId) mocks.savedAccountId = saved.accountId;
      if (saved.gatewayId) mocks.savedGatewayId = saved.gatewayId;
      // A saved model list persists, as the server does, so a reload after a
      // removal shows the remaining models.
      if (saved.enabledModelIds && mocks.enabledModelIds !== undefined)
        mocks.enabledModelIds = saved.enabledModelIds;
      return { id: CREDENTIAL_ID };
    }
    if (procedure === "models/beginOAuth")
      return {
        loginId: "login-fixture",
        mode: "device-code",
        verificationUri: "https://example.com/sign-in",
        userCode: "FIXTURE",
        expiresInSeconds: 600,
      };
    if (procedure === "models/completeOAuth") return mocks.completeOAuth(options?.signal);
    if (procedure === "bots/update") return mocks.update(input);
    if (procedure === "models/role") {
      const role = (input as { role: string }).role;
      const main = role === "main";
      return {
        primary: main ? mocks.primary : role === "computer" ? mocks.computerPrimary : null,
        backups: main ? await mocks.backups : [],
        deploymentPrimary: main ? null : APPROVAL_DEFAULT,
      };
    }
    if (procedure === "models/forRole") return mocks.catalogEmpty ? [] : catalog;
    if (procedure === "models/setRole") {
      await result;
      const patch = input as Partial<{
        role: string;
        primary: typeof mocks.primary;
        backups: { provider: string; modelId: string }[];
      }>;
      if (patch.role !== "main")
        return {
          primary: patch.primary ?? null,
          backups: patch.backups ?? [],
          deploymentPrimary: APPROVAL_DEFAULT,
        };
      // The main list persists like the server so a reload after a promotion keeps it.
      if (patch.primary !== undefined) mocks.primary = patch.primary;
      if (patch.backups) mocks.backups = patch.backups;
      return { primary: mocks.primary, backups: await mocks.backups };
    }
    if (procedure === "models/setDefault") return result;
    if (procedure === "voice/status") return mocks.voiceStatus;
    if (procedure === "voice/catalog") return mocks.voiceCatalog;
    if (procedure === "voice/voices") return mocks.voiceList;
    if (procedure === "computer/status") return mocks.computerStatus;
    if (procedure === "routines/list") return mocks.routines;
    if (procedure === "bots/get")
      return { id: "bot-fixture", name: "Fixture", title: "", computerMode: "team" };
    if (procedure === "me")
      return {
        userId: "user-fixture",
        spaceId: "space-fixture",
        defaultProvider: cloudflare?.provider ?? "openrouter",
        defaultModel: "vendor/model-1",
        hostCredentialProvider: mocks.serverCredentials ? "openrouter" : undefined,
      };
    if (procedure === "models/list")
      return mocks.catalogEmpty
        ? []
        : mocks.vendorLabels
          ? catalog.map((entry, index) => ({
              ...entry,
              label:
                index === 0
                  ? "Anthropic: Claude Sonnet 4.5"
                  : index === 1
                    ? "Google: Gemini"
                    : entry.label,
            }))
          : mocks.subscriptionSignIn
            ? catalog.map((entry) => ({ ...entry, signIn: "device-code" }))
            : [
                ...catalog.map((entry) => ({
                  ...entry,
                  provider: cloudflare?.provider ?? entry.provider,
                  providerName: cloudflare?.providerName ?? entry.providerName,
                  ...(cloudflare ? { routingFields: cloudflare.routingFields } : {}),
                })),
                ...(mocks.extraProviders
                  ? ["Anthropic", "Google", "OpenAI", "Other", "Last"].map((name) => ({
                      ...catalog[0],
                      provider: name.toLowerCase(),
                      providerName: name,
                    }))
                  : []),
              ];
    if (procedure === "models/credentials")
      return mocks.connected
        ? [
            {
              id: CREDENTIAL_ID,
              provider: cloudflare?.provider ?? "openrouter",
              label: cloudflare?.providerName ?? "OpenRouter",
              maxTokens: mocks.savedMaxTokens,
              ...(mocks.gateway
                ? { accountId: mocks.savedAccountId, gatewayId: mocks.savedGatewayId }
                : mocks.workers
                  ? { accountId: mocks.savedAccountId }
                  : {}),
              modelId: "vendor/model-1",
              isDefault: true,
              thinkingLevel: "high",
              ...(mocks.enabledModelIds ? { enabledModelIds: mocks.enabledModelIds } : {}),
            },
            ...(mocks.secondConnection
              ? [
                  {
                    id: WORK_CREDENTIAL_ID,
                    provider: "openrouter",
                    label: "Work",
                    hasKey: true,
                    isDefault: false,
                    authKind: "api_key",
                  },
                ]
              : []),
          ]
        : [];
    if (procedure === "models/testProvider")
      return mocks.testProvider(input as { credentialId: string });
    return [];
  },
}));
vi.mock("./bot-voices", () => ({
  voiceLabel: () => "",
  deviceVoices: async () => [],
  voiceForBot: async () => undefined,
  setVoiceForBot: async () => undefined,
}));
vi.mock("./device-voice", () => ({ loadDeviceVoiceEnabled: async () => false }));
vi.mock("./voice", () => ({ stopVoicePlayback: () => undefined }));
vi.mock("expo-speech", () => ({ stop: async () => undefined, speak: () => undefined }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({
    back: mocks.back,
    push: mocks.push,
    replace: mocks.replace,
    dismissTo: mocks.dismissTo,
    setParams: mocks.setParams,
  }),
  useNavigation: () => ({ setOptions: mocks.setOptions }),
  useLocalSearchParams: () => mocks.params,
  useFocusEffect: (effect: () => (() => void) | undefined) =>
    useEffect(() => (mocks.focused ? effect() : undefined), [effect, mocks.focused]),
}));
vi.mock("react-native", () => {
  const view = ({
    children,
    accessibilityLabel,
    accessibilityRole,
    accessibilityValue,
    onAccessibilityAction,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityValue?: { text: string };
    onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
  }) => {
    if (accessibilityLabel && onAccessibilityAction)
      mocks.rowAccessibilityActions.set(accessibilityLabel, onAccessibilityAction);
    return createElement(
      "div",
      {
        "aria-label": accessibilityLabel,
        role: accessibilityRole,
        "aria-valuetext": accessibilityValue?.text,
      },
      children,
    );
  };
  return {
    AccessibilityInfo: { announceForAccessibility: mocks.announce },
    ActivityIndicator: () => createElement("i", { "data-loading": true }),
    Platform: {
      get OS() {
        return mocks.platform;
      },
    },
    Keyboard: { dismiss: mocks.dismissKeyboard },
    Alert: { alert: mocks.alert, prompt: mocks.prompt },
    Linking: { openURL: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Modal: ({ children }: { children?: ReactNode }) => createElement("div", {}, children),
    useWindowDimensions: () => ({ height: 800, width: 400 }),
    ScrollView: view,
    View: view,
    Text: ({ children }: { children?: ReactNode }) => createElement("span", {}, children),
    TextInput: ({
      value,
      onChangeText,
      accessibilityLabel,
      placeholder,
    }: {
      value: string;
      onChangeText: (text: string) => void;
      accessibilityLabel?: string;
      placeholder?: string;
    }) =>
      createElement("input", {
        value,
        onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
        "aria-label": accessibilityLabel,
        placeholder,
      }),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
      accessibilityValue,
      accessibilityRole,
    }: {
      accessibilityRole?: string;
      children?: ReactNode;
      onPress: () => void;
      accessibilityLabel?: string;
      accessibilityValue?: { text: string };
    }) =>
      createElement(
        "button",
        {
          type: "button",
          role: accessibilityRole,
          onClick: onPress,
          "aria-label": accessibilityLabel,
          "aria-valuetext": accessibilityValue?.text,
        },
        children,
      ),
    SectionList: ({
      ref,
      onViewableItemsChanged,
      ...props
    }: {
      ref: Ref<{
        scrollToLocation: typeof mocks.scrollToLocation;
        getScrollResponder: () => { scrollTo: typeof mocks.scrollTo };
      }>;
      onViewableItemsChanged: (info: {
        viewableItems: { index: number; item: { key: string } }[];
      }) => void;
      onScrollToIndexFailed: (info: { averageItemLength: number; index: number }) => void;
      onScrollBeginDrag: () => void;
      sections: { key: string; heading?: string; data: { key: string }[] }[];
      renderItem: (info: {
        item: { key: string };
        index: number;
        section: { data: { key: string }[] };
      }) => ReactNode;
      renderSectionHeader: (info: { section: { heading?: string } }) => ReactNode;
      keyExtractor: (item: { key: string }) => string;
      ListEmptyComponent: ReactNode;
      ListHeaderComponent?: ReactNode;
      automaticallyAdjustKeyboardInsets: boolean;
      contentContainerStyle: unknown;
      contentInsetAdjustmentBehavior: string;
    }) => {
      const {
        sections,
        renderItem,
        renderSectionHeader,
        keyExtractor,
        ListEmptyComponent,
        ListHeaderComponent,
      } = props;
      useImperativeHandle(
        ref,
        () => ({
          scrollToLocation: mocks.scrollToLocation,
          getScrollResponder: () => ({ scrollTo: mocks.scrollTo }),
        }),
        [],
      );
      useEffect(() => {
        if (mocks.reportVisibleRows)
          onViewableItemsChanged({
            viewableItems: sections
              .flatMap((section) => section.data.map((item, index) => ({ index, item })))
              .slice(0, 4),
          });
      }, [sections, onViewableItemsChanged]);
      mocks.listProps = { ...props, onViewableItemsChanged };
      return createElement(
        "ul",
        {},
        ListHeaderComponent,
        sections.length
          ? sections.map((section) =>
              createElement(
                "section",
                { key: section.key },
                renderSectionHeader({ section }),
                section.data.map((item, index) =>
                  createElement(
                    "li",
                    { key: keyExtractor(item) },
                    renderItem({ item, index, section }),
                  ),
                ),
              ),
            )
          : ListEmptyComponent,
      );
    },
  };
});
vi.mock("./native", () => ({
  native: new Proxy({}, { get: (_target, name) => String(name) }),
  useMobileTokens: () => ({
    mutedForeground: "muted",
    foreground: "ink",
    destructive: "error",
    destructiveFill: "error-fill",
    destructiveForeground: "on-error-fill",
  }),
  useResolvedAppearance: () => "light",
  useThemedStyles: (createStyles: () => unknown) => createStyles(),
}));
// react-native-gesture-handler ships syntax the jsdom runner cannot parse; the
// swipe action renders inline here so its button stays clickable in tests.
vi.mock("react-native-gesture-handler", () => ({
  Swipeable: ({
    children,
    renderRightActions,
  }: {
    children?: ReactNode;
    renderRightActions?: () => ReactNode;
  }) => createElement("div", null, children, renderRightActions?.()),
}));
vi.mock("./i18n", () => {
  const t = (text: string, values?: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));
  return { t, useI18n: () => ({ t }) };
});
vi.mock("../components/settings-group", () => ({
  SettingsGroup: ({
    label,
    footer,
    children,
  }: {
    label?: string;
    footer?: string;
    children: ReactNode;
  }) =>
    createElement(
      "section",
      { "aria-label": label },
      createElement("header", {}, label),
      children,
      footer,
    ),
  SettingsLabel: ({ children }: { children: ReactNode }) => createElement("h2", {}, children),
  SettingsSwitch: ({ label }: { label: string }) =>
    createElement("button", { type: "button", role: "switch" }, label),
  SettingsFooter: ({ children }: { children: ReactNode }) => createElement("span", {}, children),
  SettingsRow: ({
    title,
    detail,
    accessibilityState,
    onPress,
    trailing,
    value,
    accessibilityLabel,
    accessibilityHint,
    accessibilityValue,
    disabled,
    chevron,
    accessibilityActions,
    onAccessibilityAction,
    leading,
  }: {
    leading?: ReactNode;
    accessibilityActions?: { name: string; label: string }[];
    onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
    disabled?: boolean;
    chevron?: "right" | "down";
    value?: string;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    accessibilityValue?: { text: string };
    title: string;
    detail?: string;
    accessibilityState?: { selected?: boolean; expanded?: boolean };
    onPress: () => void;
    trailing: ReactNode;
  }) => {
    if (onAccessibilityAction) mocks.rowAccessibilityActions.set(title, onAccessibilityAction);
    return createElement(
      "button",
      {
        "data-accessibility-actions": accessibilityActions?.map((action) => action.label).join(),
        type: "button",
        "aria-label": accessibilityLabel ?? title,
        "aria-description": accessibilityHint,
        "data-settings-row": true,
        "data-chevron": chevron,
        "aria-expanded": accessibilityState?.expanded,
        disabled,
        "aria-valuetext": accessibilityValue?.text,
        "aria-selected": accessibilityState?.selected,
        onClick: onPress,
      },
      leading,
      title,
      value,
      detail ? createElement("small", {}, detail) : null,
      trailing,
    );
  },
}));
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => null }));
vi.mock("./bot-avatar-edit", () => ({
  avatarColor: (value: string) => value,
  avatarShape: () => null,
  isAvatarPhoto: () => false,
  withAvatarColor: (_value: string, color: string) => color,
  withAvatarShape: (value: string) => value,
}));
vi.mock("../components/computer-mode-picker", () => ({ ComputerModePicker: () => null }));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    onPress,
    disabled,
    prominence = "primary",
    variant,
    fill,
    style,
  }: {
    variant?: string;
    fill?: boolean;
    style?: CSSProperties;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    prominence?: string;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        onClick: onPress,
        disabled,
        "data-prominence": prominence,
        "data-variant": variant,
        "data-fill": fill ?? (prominence === "primary" || prominence === "destructive"),
        style,
      },
      label,
    ),
}));
vi.mock("../components/native-switch", () => ({ NativeSwitch: () => null }));
vi.mock("../components/row-accessories", () => ({
  Chevron: () => null,
  Checkmark: () => createElement("i", { "data-checkmark": true }),
}));
vi.mock("../components/text-only-mark", () => ({
  TextOnlyMark: () => createElement("i", { "data-text-only": true }),
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/native-sheet", () => ({
  useNativeSheet: () => mocks.sheet,
  NativeSheet: ({
    Sheet,
    children,
  }: {
    Sheet: ComponentType<{ children?: ReactNode }>;
    children: ReactNode;
  }) => createElement("div", {}, Sheet ? createElement(Sheet, {}, children) : children),
}));
vi.mock("@expo/ui/community/menu", () => ({
  MenuView: ({
    ref,
    title,
    actions,
    onPressAction,
    children,
  }: {
    ref?: Ref<{ show: () => void }>;
    title: string;
    actions: { id: string; title: string }[];
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
    children: ReactNode;
  }) => {
    useImperativeHandle(ref, () => ({ show: () => mocks.showMenu(title) }), [title]);
    mocks.menus.set(title, { actions, onPressAction });
    return createElement("section", { "data-menu": title }, children);
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  resetModelTestRunStore();
  mocks.reportVisibleRows = true;
  mocks.headerInset = 0;
  mocks.focused = true;
  mocks.platform = "ios";
  mocks.connected = true;
  mocks.serverCredentials = false;
  mocks.catalogEmpty = false;
  mocks.extraProviders = false;
  mocks.gateway = false;
  mocks.workers = false;
  mocks.savedMaxTokens = undefined;
  mocks.savedAccountId = "account-fixture";
  mocks.savedGatewayId = "gateway-fixture";
  mocks.vendorLabels = false;
  mocks.subscriptionSignIn = false;
  mocks.secondConnection = false;
  mocks.enabledModelIds = undefined;
  mocks.backups = [];
  mocks.primary = null;
  mocks.computerPrimary = null;
  mocks.voiceStatus = defaultVoiceStatus();
  mocks.voiceCatalog = defaultVoiceCatalog();
  mocks.voiceList = defaultVoiceList();
  mocks.computerStatus = defaultComputerStatus();
  mocks.routines = defaultRoutines();
  mocks.sheet = null;
  mocks.rpc.mockReset();
  mocks.menus.clear();
  mocks.rowAccessibilityActions.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queryClient.clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chat settings model row", () => {
  const render = async () => {
    await act(async () => root.render(<BotSettingsScreen />));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Advanced"]')!.click());
  };

  it("opens the searchable model list when there are too many models for a menu", async () => {
    mocks.params = { botId: "bot-fixture" };
    await render();
    expect(container.querySelector('[data-menu="Model"]')).toBeNull();
    const row = container.querySelector<HTMLButtonElement>('button[aria-label="Model"]');
    expect(row?.getAttribute("aria-valuetext")).toBe("Space default (Model 1)");
    act(() => row!.click());
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
      pathname: "/bot-model",
      params: { botId: "bot-fixture", value: "" },
    });
  });

  it("stages the model the list hands back until Save", async () => {
    mocks.params = { botId: "bot-fixture" };
    await render();
    mocks.params = { botId: "bot-fixture", model: "openrouter::vendor/model-3" };
    await act(async () => root.render(<BotSettingsScreen />));
    expect(mocks.setParams).toHaveBeenCalledWith({ model: undefined });
    const row = container.querySelector('button[aria-label="Model"]');
    expect(row?.getAttribute("aria-valuetext")).toBe("Model 3 (OpenRouter)");
    expect(mocks.update).not.toHaveBeenCalled();
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    await act(async () => save!.click());
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ modelProvider: "openrouter", modelId: "vendor/model-3" }),
    );
  });
});

describe("chat model list", () => {
  const search = (text: string) =>
    act(() => {
      const options = mocks.setOptions.mock.lastCall![0];
      options.headerSearchBarOptions.onChangeText({ nativeEvent: { text } });
    });
  const rows = () => [...container.querySelectorAll("li button")];

  it("checks the current model, filters by name or id, and returns the pick", async () => {
    mocks.params = { botId: "bot-fixture", value: "openrouter::vendor/model-2" };
    await act(async () => root.render(<BotModelScreen />));
    expect(rows()).toHaveLength(12);
    expect(mocks.setOptions.mock.lastCall![0].headerSearchBarOptions).toMatchObject({
      hideNavigationBar: false,
    });
    expect(mocks.listProps).toMatchObject({
      automaticallyAdjustKeyboardInsets: true,
      contentInsetAdjustmentBehavior: "automatic",
      contentContainerStyle: expect.arrayContaining([
        expect.objectContaining({ paddingBottom: 106 }),
      ]),
    });
    expect(container.querySelectorAll("h2")).toHaveLength(1);
    expect(container.querySelector("h2")?.textContent).toBe("OpenRouter");
    expect(rows()[0]?.querySelector("small")?.textContent).toBe("Model 1");
    expect(rows()[0]!.textContent).toBe("Space defaultModel 1");
    const checked = rows().filter((row) => row.getAttribute("aria-selected") === "true");
    expect(checked.map((row) => row.textContent)).toEqual(["Model 2"]);
    expect(checked[0]!.querySelector("[data-checkmark]")).not.toBeNull();

    search("MODEL 1");
    expect(rows().map((row) => row.textContent)).toEqual([
      "Space defaultModel 1",
      "Model 1",
      "Model 10",
      "Model 11",
    ]);
    search("vendor/model-7");
    expect(rows().map((row) => row.textContent)).toEqual(["Model 7"]);

    act(() => (rows()[0] as HTMLButtonElement).click());
    expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith({
      pathname: "/bot-settings",
      params: { botId: "bot-fixture", model: "openrouter::vendor/model-7" },
    });
  });

  it("remounts the list only when the search query changes", async () => {
    mocks.params = { botId: "bot-fixture", value: "" };
    await act(async () => root.render(<BotModelScreen />));
    const initialList = container.querySelector("ul");
    expect(initialList).not.toBeNull();

    search("vendor/model-7");
    const filteredList = container.querySelector("ul");
    expect(filteredList).not.toBe(initialList);
    search("vendor/model-7");
    expect(container.querySelector("ul")).toBe(filteredList);
    search("no such model");
    const emptyList = container.querySelector("ul");
    expect(emptyList).not.toBe(filteredList);
    search("no such model");
    expect(container.querySelector("ul")).toBe(emptyList);
    search("vendor/model-2");
    const nextList = container.querySelector("ul");
    expect(nextList).not.toBe(emptyList);
    act(() => mocks.setOptions.mock.lastCall![0].headerSearchBarOptions.onCancelButtonPress());
    expect(container.querySelector("ul")).not.toBe(nextList);
    expect(rows()).toHaveLength(12);
  });

  it("says when nothing matches", async () => {
    mocks.params = { botId: "bot-fixture", value: "" };
    await act(async () => root.render(<BotModelScreen />));
    search("no such model");
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toBe("No matching models");
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith("No matching models");
  });
});

// Keep the base screen mounted as the native stack does, and simulate blur/focus on push/back.
function SettingsStackFixture({ base }: { base: "models" | "connection" }) {
  return (
    <>
      <div hidden={!mocks.focused}>{base === "models" ? <Models /> : <ModelConnection />}</div>
      {!mocks.focused ? <SettingsModelPickerScreen key={mocks.params.requestId} /> : null}
    </>
  );
}

function modelRow() {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Model"]')!;
}

async function renderStack(base: "models" | "connection", params: Record<string, string> = {}) {
  mocks.params = params;
  mocks.push.mockImplementation(({ params }: { params: Record<string, string> }) => {
    mocks.params = params;
    mocks.focused = false;
    root.render(<SettingsStackFixture base={base} />);
  });
  mocks.back.mockImplementation(() => {
    mocks.focused = true;
    mocks.params = params;
    root.render(<SettingsStackFixture base={base} />);
  });
  await act(async () => root.render(<SettingsStackFixture base={base} />));
}

const renderModels = () => renderStack("models");

/** Opens the connect or manage screen the model list would push for one provider. */
async function renderConnection(request: Partial<ModelConnectionRequest> = {}) {
  const requestId = openModelConnection({
    provider: mocks.gateway
      ? "cloudflare-ai-gateway"
      : mocks.workers
        ? "cloudflare-workers-ai"
        : "openrouter",
    credentialId: mocks.connected ? CREDENTIAL_ID : null,
    makeDefault: false,
    target: { scope: "account" },
    ...request,
  });
  await renderStack("connection", { requestId });
}

function searchModels(text: string) {
  act(() =>
    mocks.setOptions.mock.calls
      .findLast(([options]) => options.headerSearchBarOptions)![0]
      .headerSearchBarOptions.onChangeText({
        nativeEvent: { text },
      }),
  );
}

function pickerRows() {
  return [...container.querySelectorAll<HTMLButtonElement>("li button")];
}

function buttonWithText(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
}

function editField(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("provider connection screen", () => {
  it("connects a provider with only its connection controls", async () => {
    mocks.connected = false;
    await renderConnection({ makeDefault: true });
    expect(mocks.setOptions).toHaveBeenCalledWith({ title: "OpenRouter" });
    expect(container.querySelector('button[aria-label="Provider"]')).toBeNull();
    expect(modelRow()).toBeNull();
    expect(container.querySelector('button[aria-label="Thinking"]')).toBeNull();
    expect(buttonWithText("Advanced")).toBeUndefined();
    expect(container.querySelector('input[aria-label="Maximum output tokens"]')).toBeNull();
    expect(buttonWithText("Connect API key")?.dataset.prominence).toBe("primary");
    expect(buttonWithText("Connect API key")?.disabled).toBe(true);
    expect(buttonWithText("Disconnect")).toBeUndefined();
  });

  it("manages a connected provider without choosing its model again", async () => {
    await renderConnection();
    expect(modelRow()).toBeNull();
    expect(container.querySelector('button[aria-label="Thinking"]')).toBeNull();
    expect(container.textContent).not.toContain("Use this model");
    const disconnect = buttonWithText("Disconnect")!;
    expect(disconnect.dataset.prominence).toBe("destructive");
    expect(disconnect.dataset.variant).toBe("text");
    expect(disconnect.parentElement!.textContent).toBe("ConnectedDisconnect");
    const keySection = buttonWithText("Replace API key")!.parentElement!;
    expect(keySection.firstElementChild?.textContent).toBe("API key");
    expect(buttonWithText("Replace API key")?.dataset.prominence).toBe("secondary");
    const advanced = buttonWithText("Advanced")!;
    expect(advanced.getAttribute("aria-expanded")).toBe("false");
    act(() => advanced.click());
    expect(advanced.getAttribute("aria-expanded")).toBe("true");
    expect(advanced.dataset.chevron).toBe("down");
  });

  it("reveals only the own-key controls behind server credentials", async () => {
    mocks.connected = false;
    mocks.serverCredentials = true;
    await renderConnection();
    expect(buttonWithText("Connect API key")).toBeUndefined();
    act(() => buttonWithText("Use your own key")!.click());
    expect(buttonWithText("Connect API key")).toBeDefined();
    expect(modelRow()).toBeNull();
    expect(buttonWithText("Disconnect")).toBeUndefined();
  });

  it("continues in the screen the slot hands back after connecting", async () => {
    mocks.connected = false;
    const onConnected = vi.fn(async () => ({
      pathname: "/model-picker" as const,
      params: { requestId: "picker-fixture" },
    }));
    await renderConnection({ onConnected });
    editField("API key", "fixture-key");
    await act(async () => buttonWithText("Connect API key")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/connect",
      expect.objectContaining({
        provider: "openrouter",
        apiKey: "fixture-key",
        makeDefault: false,
      }),
    );
    expect(onConnected).toHaveBeenCalledWith({
      provider: "openrouter",
      modelId: "vendor/model-1",
      credentialId: CREDENTIAL_ID,
    });
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: "/model-picker",
      params: { requestId: "picker-fixture" },
    });
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("returns to the list when there is nothing to pick after connecting", async () => {
    mocks.connected = false;
    await renderConnection({ onConnected: async () => undefined });
    editField("API key", "fixture-key");
    await act(async () => buttonWithText("Connect API key")!.click());
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.back).toHaveBeenCalledOnce();
  });

  it("aborts pending subscription sign-in when the screen unmounts", async () => {
    mocks.connected = false;
    mocks.subscriptionSignIn = true;
    let completeSignIn!: (result: { status: "ready" }) => void;
    mocks.completeOAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        completeSignIn = resolve;
      }),
    );
    await renderConnection({ makeDefault: true });
    await act(async () => buttonWithText("Sign in")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/beginOAuth",
      expect.objectContaining({ provider: "openrouter", makeDefault: true }),
    );
    const signal = mocks.completeOAuth.mock.lastCall![0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    act(() => root.render(null));
    expect(signal.aborted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("models/cancelOAuth", { loginId: "login-fixture" });
    await act(async () => completeSignIn({ status: "ready" }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("models/finishOAuth", expect.anything());
  });
});

describe("provider connection limit saves", () => {
  it("shows Save under Advanced only when connected limits differ and saves without replacing a draft key", async () => {
    mocks.savedMaxTokens = 1000;
    await renderConnection();
    expect(buttonWithText("Replace API key")?.disabled).toBe(true);
    editField("API key", "1234567");
    expect(buttonWithText("Replace API key")?.disabled).toBe(true);
    editField("API key", "fixture-replacement-key");
    expect(buttonWithText("Replace API key")?.disabled).toBe(false);
    act(() => buttonWithText("Advanced")!.click());
    expect(buttonWithText("Save")).toBeUndefined();
    editField("Maximum output tokens", "2000");
    const save = buttonWithText("Save")!;
    expect(save.dataset.prominence).toBe("secondary");
    expect(save.previousElementSibling?.textContent).toContain("Maximum output tokens");
    editField("Maximum output tokens", "1000");
    expect(buttonWithText("Save")).toBeUndefined();
    editField("Maximum output tokens", "2000");
    await act(async () => buttonWithText("Save")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith("models/connect", {
      provider: "openrouter",
      modelId: "vendor/model-1",
      makeDefault: false,
      scope: "account",
      maxTokens: 2000,
      label: "OpenRouter",
      // A save on a managed connection updates that connection only.
      credentialId: CREDENTIAL_ID,
    });
    expect(buttonWithText("Save")).toBeUndefined();
    const field = container.querySelector('input[aria-label="Maximum output tokens"]')!;
    expect(field.parentElement?.nextElementSibling?.textContent).toBe("Saved.");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="API key"]')!.value).toBe(
      "fixture-replacement-key",
    );
  });

  it("shows Saving while the Advanced save is pending", async () => {
    await renderConnection();
    act(() => buttonWithText("Advanced")!.click());
    editField("Maximum output tokens", "2000");
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.rpc.mockImplementation((procedure) =>
      procedure === "models/connect" ? pending : undefined,
    );
    await act(async () => buttonWithText("Save")!.click());
    expect(buttonWithText("Saving…")?.disabled).toBe(true);
    expect(buttonWithText("Replace API key")?.disabled).toBe(true);
    await act(async () => finish());
    expect(buttonWithText("Saving…")).toBeUndefined();
    expect(container.textContent).toContain("Saved.");
  });

  it("keeps invalid limits feedback beside Advanced Save", async () => {
    await renderConnection();
    act(() => buttonWithText("Advanced")!.click());
    editField("Maximum output tokens", "0");
    await act(async () => buttonWithText("Save")!.click());
    expect(mocks.rpc.mock.calls.some(([procedure]) => procedure === "models/connect")).toBe(false);
    expect(buttonWithText("Save")?.nextElementSibling?.textContent).toContain(
      "Enter a whole number",
    );
  });

  it("edits a Workers AI account without a gateway or replacement key", async () => {
    mocks.workers = true;
    await renderConnection();
    expect(container.querySelector('input[aria-label="Account ID"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Gateway ID"]')).toBeNull();
    editField("Account ID", "account-updated");
    await act(async () => buttonWithText("Save")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/connect",
      expect.objectContaining({ provider: "cloudflare-workers-ai", accountId: "account-updated" }),
    );
    expect(
      mocks.rpc.mock.calls.find(([procedure]) => procedure === "models/connect")?.[1].apiKey,
    ).toBeUndefined();
  });

  it("enables the connected gateway Save only for changed routing and keeps feedback at that button", async () => {
    mocks.gateway = true;
    await renderConnection();
    expect(buttonWithText("Save")?.disabled).toBe(true);
    editField("Account ID", "account-updated");
    expect(buttonWithText("Save")?.disabled).toBe(false);
    await act(async () => buttonWithText("Save")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/connect",
      expect.objectContaining({
        provider: "cloudflare-ai-gateway",
        accountId: "account-updated",
        gatewayId: "gateway-fixture",
      }),
    );
    expect(buttonWithText("Save")?.disabled).toBe(true);
    expect(buttonWithText("Save")?.parentElement?.nextElementSibling?.textContent).toBe("Saved.");
    editField("Gateway ID", "gateway-updated");
    expect(container.textContent).not.toContain("Saved.");
    editField("Gateway ID", "gateway-fixture");
    expect(buttonWithText("Save")?.disabled).toBe(true);
  });
});

describe("model role lists", () => {
  const model = (index: number) => ({ provider: "openrouter", modelId: `vendor/model-${index}` });
  /** A row picked from the list runs on the connection it was listed under. */
  const pinned = (index: number) => ({ ...model(index), credentialId: CREDENTIAL_ID });
  const section = (title: string) =>
    container.querySelector<HTMLElement>(`section[aria-label="${title}"]`)!;
  const rowTitles = (title = "Main model") =>
    [...section(title).querySelectorAll<HTMLElement>("[data-menu]")].map((row) => row.dataset.menu);
  const roleSaves = (role = "main") =>
    mocks.rpc.mock.calls
      .filter(
        ([procedure, input]) =>
          procedure === "models/setRole" && (input as { role: string }).role === role,
      )
      .map(([, input]) => {
        const {
          role: _role,
          expectedUserId: _user,
          scope: _scope,
          ...patch
        } = input as Record<string, unknown>;
        return patch;
      });
  const menuAction = async (title: string, action: string) =>
    act(async () => mocks.menus.get(title)!.onPressAction({ nativeEvent: { event: action } }));
  const rowButton = (title: string, name: string) =>
    [...section(title).querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes(name),
    )!;

  it("opens Android model options from accessibility activation", async () => {
    mocks.platform = "android";
    mocks.primary = model(1);
    await renderModels();
    const activate = mocks.rowAccessibilityActions.get("Model 1 (OpenRouter) options")!;
    act(() => activate({ nativeEvent: { actionName: "activate" } }));
    expect(mocks.showMenu).toHaveBeenCalledExactlyOnceWith("Model 1");
  });

  it("keeps the native menu outside the model picker's press target", async () => {
    mocks.primary = model(1);
    await renderModels();
    const menu = section("Main model").querySelector('[data-menu="Model 1"]')!;
    expect(menu.closest("button")).toBeNull();
    act(() => rowButton("Main model", "Model 1").click());
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/model-picker" }));
  });

  it("numbers the main model and its fallbacks, then offers Add fallback", async () => {
    mocks.primary = { ...model(1), thinkingLevel: "high" };
    mocks.backups = [model(2)];
    await renderModels();
    expect(container.textContent).not.toContain("Active model");
    expect(container.querySelector('button[aria-label="Provider"]')).toBeNull();
    const main = section("Main model");
    expect([...main.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "1Model 1OpenRouter, Thinking: High",
      "2Model 2OpenRouter",
      "Add fallback",
    ]);
    const approval = [...section("Approval model").querySelectorAll("button")];
    // A single row has no order to number.
    expect(approval.map((button) => button.textContent)).toEqual([
      "Model 1OpenRouter",
      "Add fallback",
    ]);
  });

  it("starts an empty main model with a row that asks for one", async () => {
    mocks.backups = [model(2)];
    await renderModels();
    expect(
      [...section("Main model").querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["1Choose a model", "2Model 2OpenRouter", "Add fallback"]);
  });

  it("adds a fallback from the shared picker and saves it immediately", async () => {
    mocks.primary = model(1);
    await renderModels();
    act(() => rowButton("Main model", "Add fallback").click());
    expect(mocks.setOptions).toHaveBeenCalledWith({ title: "Add fallback" });
    expect(pickerRows()).toHaveLength(10);
    expect(mocks.setOptions.mock.calls.some(([options]) => options.headerSearchBarOptions)).toBe(
      false,
    );
    await act(async () =>
      pickerRows()
        .find((row) => row.textContent?.includes("Model 4"))!
        .click(),
    );
    expect(rowTitles()).toEqual(["Model 1", "Model 4"]);
    // Keeping the first row leaves the main model and its effort alone.
    expect(roleSaves()).toEqual([{ backups: [pinned(4)] }]);
  });

  it("replaces a row in place from the picker", async () => {
    mocks.primary = model(1);
    mocks.backups = [model(2), model(3)];
    await renderModels();
    act(() => rowButton("Main model", "Model 2").click());
    expect(mocks.setOptions).toHaveBeenCalledWith({ title: "Main model" });
    expect(
      pickerRows()
        .filter((row) => row.getAttribute("aria-selected") === "true")
        .map((row) => row.textContent),
    ).toEqual(["Model 2"]);
    searchModels("vendor/model-5");
    await act(async () => pickerRows()[0]!.click());
    expect(roleSaves()).toEqual([{ backups: [pinned(5), model(3)] }]);
  });

  it("moves, removes and promotes with the full list", async () => {
    mocks.primary = model(1);
    mocks.backups = [model(2), model(3)];
    await renderModels();
    const ids = (title: string) => mocks.menus.get(title)!.actions.map((action) => action.id);
    expect(ids("Model 1")).toEqual(["thinking", "moveDown", "manage", "remove"]);
    expect(ids("Model 2")).toEqual(["moveUp", "moveDown", "manage", "remove"]);
    expect(ids("Model 3")).toEqual(["moveUp", "manage", "remove"]);
    expect(rowButton("Main model", "Model 1").getAttribute("data-accessibility-actions")).toBe(
      "Thinking: Default,Thinking: Low,Thinking: Medium,Thinking: High,Move down,Manage OpenRouter,Remove",
    );
    await menuAction("Model 3", "moveUp");
    expect(rowTitles()).toEqual(["Model 1", "Model 3", "Model 2"]);
    await act(async () =>
      mocks.rowAccessibilityActions.get("Model 1")!({ nativeEvent: { actionName: "remove" } }),
    );
    expect(rowTitles()).toEqual(["Model 3", "Model 2"]);
    expect(roleSaves()).toEqual([
      { backups: [model(3), model(2)] },
      { primary: model(3), backups: [model(2)] },
    ]);
  });

  it("lets any listed model lead the main list, including one the deployment runs", async () => {
    const managed = { provider: "anthropic", modelId: "claude-fixture" };
    mocks.primary = model(1);
    mocks.backups = [managed, model(3)];
    await renderModels();
    await menuAction("claude-fixture", "moveUp");
    expect(rowTitles()).toEqual(["claude-fixture", "Model 1", "Model 3"]);
    expect(roleSaves()).toEqual([{ primary: managed, backups: [model(1), model(3)] }]);
  });

  it("changes the main model's thinking with its role list", async () => {
    mocks.primary = { ...model(1), thinkingLevel: "high" };
    await renderModels();
    const thinking = mocks.menus.get("Model 1")!.actions[0]!;
    expect(thinking.subactions!.map((action) => [action.title, action.state])).toEqual([
      ["Default", "off"],
      ["Low", "off"],
      ["Medium", "off"],
      ["High", "on"],
    ]);
    await menuAction("Model 1", "thinking:medium");
    await menuAction("Model 1", "thinking:");
    expect(roleSaves()).toEqual([
      { primary: { ...model(1), thinkingLevel: "medium" } },
      { primary: { ...model(1), thinkingLevel: null } },
    ]);
    expect(mocks.rpc.mock.calls.some(([procedure]) => procedure === "models/setDefault")).toBe(
      false,
    );
  });

  it("opens the manage screen for a row's provider", async () => {
    mocks.primary = model(1);
    await renderModels();
    await menuAction("Model 1", "manage");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/model-connection",
      params: { requestId: expect.any(String) },
    });
    const request = modelConnectionRequest(mocks.params.requestId!)!;
    expect(request).toMatchObject({ provider: "openrouter", makeDefault: false });
    expect(request.onConnected).toBeUndefined();
  });

  it("lists providers to connect after the models and reopens the slot on that provider", async () => {
    mocks.primary = model(1);
    mocks.extraProviders = true;
    await renderModels();
    act(() => rowButton("Main model", "Model 1").click());
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "OpenRouter",
    ]);
    const anthropic = pickerRows().find((row) => row.textContent?.startsWith("Anthropic"))!;
    expect(anthropic.textContent).toBe("AnthropicConnect");
    expect(anthropic.dataset.chevron).toBe("right");
    act(() => anthropic.click());
    expect(mocks.back).not.toHaveBeenCalled();
    const route = mocks.replace.mock.lastCall![0] as {
      pathname: string;
      params: { requestId: string };
    };
    expect(route.pathname).toBe("/model-connection");
    // Connecting from a chosen main model leaves it running until a model is picked.
    expect(modelConnectionRequest(route.params.requestId)).toMatchObject({
      provider: "anthropic",
      makeDefault: false,
    });

    act(() => mocks.back());
    act(() => rowButton("Main model", "Add fallback").click());
    act(() =>
      pickerRows()
        .find((row) => row.textContent?.startsWith("Google"))!
        .click(),
    );
    const fallback = modelConnectionRequest(
      (mocks.replace.mock.lastCall![0] as { params: { requestId: string } }).params.requestId,
    )!;
    expect(fallback).toMatchObject({ provider: "google", makeDefault: false });
    // Nothing joins the list until a model is picked from that provider.
    let next: unknown;
    await act(async () => {
      next = await fallback.onConnected!(pinned(1));
    });
    expect(roleSaves()).toEqual([]);
    const picker = modelPickerRequest(
      (next as { params: { requestId: string } }).params.requestId,
    )!;
    expect(picker.title).toBe("Add fallback");
    expect(picker.connectChoices).toBeUndefined();
    expect(picker.choices.map((choice) => choice.modelLabel)).toEqual(
      catalog.slice(1).map((entry) => entry.label),
    );
    await act(async () => picker.onSelect(picker.choices[2]!));
    expect(roleSaves()).toEqual([{ backups: [pinned(4)] }]);
  });

  it("reopens the empty main slot on the connection that became the main model", async () => {
    mocks.connected = false;
    await renderModels();
    act(() => rowButton("Main model", "Choose a model").click());
    act(() =>
      pickerRows()
        .find((row) => row.textContent?.startsWith("OpenRouter"))!
        .click(),
    );
    const request = modelConnectionRequest(
      (mocks.replace.mock.lastCall![0] as { params: { requestId: string } }).params.requestId,
    )!;
    expect(request.makeDefault).toBe(true);
    mocks.connected = true;
    mocks.primary = model(1);
    let next: unknown;
    await act(async () => {
      next = await request.onConnected!(pinned(1));
    });
    const picker = modelPickerRequest(
      (next as { params: { requestId: string } }).params.requestId,
    )!;
    expect(picker.selectedKey).toBe(
      JSON.stringify(["openrouter", "vendor/model-1", CREDENTIAL_ID]),
    );
    expect(picker.choices).toHaveLength(11);
    await act(async () => picker.onSelect(picker.choices[0]!));
    expect(roleSaves()).toEqual([]);
  });

  it("names the approval model's deployment default, sets one, and clears back to it", async () => {
    await renderModels();
    act(() => rowButton("Approval model", "Model 1").click());
    expect(mocks.setOptions).toHaveBeenCalledWith({ title: "Approval model" });
    expect(pickerRows()[0]?.textContent).toBe("Model 1");
    expect(pickerRows()[0]?.getAttribute("aria-selected")).toBe("true");
    searchModels("vendor/model-2");
    await act(async () => pickerRows()[0]!.click());
    expect(rowTitles("Approval model")).toEqual(["Model 2"]);
    act(() => rowButton("Approval model", "Model 2").click());
    await act(async () => pickerRows()[0]!.click());
    expect(roleSaves("approval")).toEqual([
      { primary: pinned(2), backups: [] },
      { primary: null, backups: [] },
    ]);
  });

  const holdFirstSave = () => {
    const first: { finish: () => void; fail: (error: Error) => void } = {
      finish: () => undefined,
      fail: () => undefined,
    };
    mocks.rpc.mockImplementation((procedure: string) =>
      procedure === "models/setRole" && roleSaves().length === 1
        ? new Promise<void>((resolve, reject) => {
            first.finish = resolve;
            first.fail = reject;
          })
        : undefined,
    );
    return first;
  };
  const mainLoads = () =>
    mocks.rpc.mock.calls.filter(
      ([procedure, input]) =>
        procedure === "models/role" && (input as { role: string })?.role === "main",
    ).length;
  const leaveModels = () => {
    act(() => root.unmount());
    root = createRoot(container);
  };

  it("runs saves one at a time in edit order", async () => {
    mocks.backups = [model(2), model(3), model(4)];
    await renderModels();
    const first = holdFirstSave();
    await menuAction("Model 2", "moveDown");
    await menuAction("Model 4", "remove");
    expect(roleSaves()).toEqual([{ backups: [model(3), model(2), model(4)] }]);
    await act(async () => first.finish());
    expect(roleSaves()).toEqual([
      { backups: [model(3), model(2), model(4)] },
      { backups: [model(3), model(2)] },
    ]);
    expect(rowTitles()).toEqual(["Model 3", "Model 2"]);
  });

  it("drops edits queued behind a failed save and reverts to the saved list", async () => {
    mocks.backups = [model(2), model(3), model(4)];
    await renderModels();
    const first = holdFirstSave();
    await menuAction("Model 2", "remove");
    await menuAction("Model 3", "remove");
    await act(async () => first.fail(new Error("Save failed")));
    expect(roleSaves()).toEqual([{ backups: [model(3), model(4)] }]);
    expect(rowTitles()).toEqual(["Model 2", "Model 3", "Model 4"]);
    expect(container.textContent).toContain("Save failed");
  });

  it("keeps saving accepted edits after leaving Models", async () => {
    mocks.backups = [model(2), model(3), model(4)];
    await renderModels();
    const first = holdFirstSave();
    await menuAction("Model 2", "remove");
    await menuAction("Model 3", "remove");
    leaveModels();
    await act(async () => first.finish());
    expect(roleSaves()).toEqual([{ backups: [model(3), model(4)] }, { backups: [model(4)] }]);
  });

  it("waits for pending saves before reloading the list", async () => {
    mocks.backups = [model(2), model(3)];
    await renderModels();
    const first = holdFirstSave();
    await menuAction("Model 2", "remove");
    leaveModels();
    mocks.backups = [model(3)];
    await renderModels();
    expect(mainLoads()).toBe(1);
    expect(container.textContent).not.toContain("Main model");
    await act(async () => first.finish());
    expect(mainLoads()).toBe(2);
    expect(rowTitles()).toEqual(["Model 3"]);
  });

  it("reverts to the saved list and announces the error when a save fails", async () => {
    mocks.backups = [model(2), model(3)];
    await renderModels();
    mocks.rpc.mockImplementation((procedure: string) =>
      procedure === "models/setRole" ? Promise.reject(new Error("Save failed")) : undefined,
    );
    await menuAction("Model 2", "remove");
    expect(roleSaves()).toEqual([{ backups: [model(3)] }]);
    expect(rowTitles()).toEqual(["Model 2", "Model 3"]);
    expect(container.textContent).toContain("Save failed");
    expect(mocks.announce).toHaveBeenCalledWith("Save failed");
  });

  it("hides the list while loading and offers no manage action without a connection", async () => {
    mocks.backups = new Promise(() => undefined);
    await renderModels();
    expect(container.textContent).not.toContain("Main model");
    leaveModels();
    mocks.backups = [model(2)];
    mocks.connected = false;
    await renderModels();
    expect(rowTitles()).toEqual(["Model 2"]);
    expect(mocks.menus.get("Model 2")!.actions.map((action) => action.id)).toEqual(["remove"]);
  });
});

describe("initial model picker scroll", () => {
  const choices = [
    { key: "first", label: "First", providerLabel: "First provider" },
    ...Array.from({ length: 30 }, (_, index) => ({
      key: `model-${index}`,
      label: `Model ${index}`,
      providerLabel: "Second provider",
    })),
  ];
  const render = async (selectedKey = "model-20") => {
    await act(async () =>
      root.render(
        <ModelPickerList choices={choices} selectedKey={selectedKey} onSelect={() => undefined} />,
      ),
    );
  };
  const report = () =>
    act(() =>
      (mocks.listProps.onViewableItemsChanged as (info: unknown) => void)({
        viewableItems: [{ index: 0, item: choices[0] }],
      }),
    );
  const fail = () =>
    act(() =>
      (mocks.listProps.onScrollToIndexFailed as (info: unknown) => void)({
        averageItemLength: 50,
        index: 24,
      }),
    );

  it("reveals a distant selection once after the first visible rows are laid out", async () => {
    await render();
    expect(mocks.scrollToLocation).toHaveBeenCalledExactlyOnceWith({
      sectionIndex: 1,
      itemIndex: 20,
      viewPosition: 0.5,
      animated: false,
    });
    report();
    await render("model-25");
    searchModels("Model");
    searchModels("");
    report();
    expect(mocks.scrollToLocation).toHaveBeenCalledOnce();
  });

  it("waits for an asynchronously loaded catalog", async () => {
    await act(async () =>
      root.render(
        <ModelPickerList choices={null} selectedKey="model-20" onSelect={() => undefined} />,
      ),
    );
    expect(mocks.scrollToLocation).not.toHaveBeenCalled();
    await render();
    expect(mocks.scrollToLocation).toHaveBeenCalledExactlyOnceWith({
      sectionIndex: 1,
      itemIndex: 20,
      viewPosition: 0.5,
      animated: false,
    });
  });

  it.each(["first", "model-0", "", "missing"])(
    "leaves the initial viewport alone for %s",
    async (key) => {
      await render(key);
      report();
      expect(mocks.scrollToLocation).not.toHaveBeenCalled();
    },
  );

  it.each(["query", "drag"])("cancels a pending reveal after %s", async (interaction) => {
    mocks.reportVisibleRows = false;
    await render();
    if (interaction === "query") {
      searchModels("Model");
      searchModels("");
    } else act(() => (mocks.listProps.onScrollBeginDrag as () => void)());
    report();
    expect(mocks.scrollToLocation).not.toHaveBeenCalled();
  });

  it("moves the render window and retries an unmeasured location only once", async () => {
    vi.useFakeTimers();
    await render();
    fail();
    expect(mocks.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 1200, animated: false });
    act(() => vi.advanceTimersByTime(100));
    expect(mocks.scrollToLocation).toHaveBeenCalledTimes(2);
    fail();
    act(() => vi.advanceTimersByTime(100));
    expect(mocks.scrollToLocation).toHaveBeenCalledTimes(2);
  });

  it.each(["query", "drag", "unmount"])("cancels the retry after %s", async (interaction) => {
    vi.useFakeTimers();
    await render();
    fail();
    if (interaction === "query") searchModels("Model");
    else if (interaction === "drag") act(() => (mocks.listProps.onScrollBeginDrag as () => void)());
    else act(() => root.render(null));
    act(() => vi.advanceTimersByTime(100));
    expect(mocks.scrollToLocation).toHaveBeenCalledOnce();
  });

  it("reserves the floating header height without automatic double insets", async () => {
    mocks.headerInset = 104;
    await render("first");
    expect(mocks.listProps).toMatchObject({
      contentInsetAdjustmentBehavior: "never",
      contentContainerStyle: expect.arrayContaining([expect.objectContaining({ paddingTop: 120 })]),
    });
    searchModels("Model");
    expect(mocks.listProps.contentInsetAdjustmentBehavior).toBe("never");
  });
});

describe("shared model picker presentation", () => {
  const choices = [
    {
      key: "sonnet",
      label: "Anthropic: Claude Sonnet 4.5",
      modelLabel: "Anthropic: Claude Sonnet 4.5",
      providerLabel: "OpenRouter",
    },
    {
      key: "haiku",
      label: "Anthropic: Claude Haiku",
      modelLabel: "Anthropic: Claude Haiku",
      providerLabel: "OpenRouter",
    },
    {
      key: "gemini",
      label: "Google: Gemini",
      modelLabel: "Google: Gemini",
      providerLabel: "OpenRouter",
    },
    { key: "plain", label: "Plain model", modelLabel: "Plain model", providerLabel: "OpenRouter" },
  ];

  it("groups by vendor, strips titles, leaves ungrouped choices unheaded, filters and announces no matches", async () => {
    await act(async () =>
      root.render(
        <ModelPickerList
          choices={[
            ...choices,
            ...Array.from({ length: 7 }, (_, index) => ({
              key: `extra-${index}`,
              label: `Extra ${index}`,
            })),
          ]}
          selectedKey="sonnet"
          providerLabel="OpenRouter"
          onSelect={() => undefined}
        />,
      ),
    );
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "Anthropic",
      "Google",
    ]);
    expect(pickerRows().map((row) => row.textContent)).toEqual([
      ...Array.from({ length: 7 }, (_, index) => `Extra ${index}`),
      "Claude Sonnet 4.5",
      "Claude Haiku",
      "Gemini",
      "Plain model",
    ]);
    expect(pickerRows()[7]?.getAttribute("aria-selected")).toBe("true");
    searchModels("Anthropic");
    expect(pickerRows().map((row) => row.textContent)).toEqual([
      "Claude Sonnet 4.5",
      "Claude Haiku",
    ]);
    searchModels("unknown");
    expect(container.textContent).toBe("No matching models");
    expect(mocks.announce).toHaveBeenCalledWith("No matching models");
  });

  it("marks models that cannot read images and announces it", async () => {
    await act(async () =>
      root.render(
        <ModelPickerList
          choices={[
            { key: "text", label: "Text only", images: false },
            { key: "vision", label: "Vision", images: true },
            { key: "custom", label: "Custom" },
          ]}
          selectedKey="text"
          onSelect={() => undefined}
        />,
      ),
    );
    const [textOnly, vision, custom] = pickerRows();
    expect(textOnly?.querySelector("[data-text-only]")).not.toBeNull();
    expect(textOnly?.querySelector("[data-checkmark]")).not.toBeNull();
    expect(textOnly?.getAttribute("aria-description")).toBe("Can't read images");
    for (const row of [vision, custom]) {
      expect(row?.querySelector("[data-text-only]")).toBeNull();
      expect(row?.hasAttribute("aria-description")).toBe(false);
    }
  });

  it("renders loading and load errors", async () => {
    await act(async () =>
      root.render(<ModelPickerList choices={null} selectedKey="" onSelect={() => undefined} />),
    );
    expect(container.querySelector("[data-loading]")).not.toBeNull();
    await act(async () =>
      root.render(
        <ModelPickerList
          choices={null}
          selectedKey=""
          onSelect={() => undefined}
          error="Could not load model settings"
        />,
      ),
    );
    expect(container.textContent).toBe("Could not load model settings");
  });

  it("keeps the Android search input mounted while filtering", async () => {
    mocks.platform = "android";
    await act(async () =>
      root.render(
        <ModelPickerList
          choices={[
            ...choices,
            ...Array.from({ length: 7 }, (_, index) => ({
              key: `extra-${index}`,
              label: `Extra ${index}`,
            })),
          ]}
          selectedKey="sonnet"
          onSelect={() => undefined}
        />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search"]')!;
    expect(input).not.toBeNull();
    expect(mocks.setOptions).not.toHaveBeenCalled();
    // React's controlled input setter plus input event exercises the Android fallback.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Gemini");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(pickerRows().map((row) => row.textContent)).toEqual(["Gemini"]);
    expect(container.querySelector("input")).toBe(input);
  });
});

describe("several connections for one provider", () => {
  const model = (index: number, credentialId?: string) => ({
    provider: "openrouter",
    modelId: `vendor/model-${index}`,
    ...(credentialId ? { credentialId } : {}),
  });
  const section = (title: string) =>
    container.querySelector<HTMLElement>(`section[aria-label="${title}"]`)!;
  const roleSaves = () =>
    mocks.rpc.mock.calls
      .filter(([procedure]) => procedure === "models/setRole")
      .map(([, input]) => {
        const {
          role: _role,
          expectedUserId: _user,
          scope: _scope,
          ...patch
        } = input as Record<string, unknown>;
        return patch;
      });
  const lastRequest = (mock: typeof mocks.push) =>
    (mock.mock.lastCall![0] as { params: { requestId: string } }).params.requestId;
  beforeEach(() => {
    mocks.secondConnection = true;
  });

  it("lists each connection's models under its own name and saves the connection picked", async () => {
    mocks.primary = model(1, CREDENTIAL_ID);
    await renderModels();
    act(() =>
      [...section("Main model").querySelectorAll("button")]
        .find((button) => button.textContent === "Add fallback")!
        .click(),
    );
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "OpenRouter",
      "OpenRouter (Work)",
    ]);
    // The running model is offered again on the other account.
    const picker = modelPickerRequest(mocks.params.requestId!)!;
    expect(picker.choices.filter((choice) => choice.modelId === "vendor/model-1")).toHaveLength(1);
    const work = picker.choices.find(
      (choice) =>
        choice.providerLabel === "OpenRouter (Work)" && choice.modelId === "vendor/model-1",
    )!;
    await act(async () => picker.onSelect(work));
    expect(roleSaves()).toEqual([{ backups: [model(1, WORK_CREDENTIAL_ID)] }]);
  });

  it("names a row's connection and manages that connection", async () => {
    mocks.primary = model(1, CREDENTIAL_ID);
    mocks.backups = [model(1, WORK_CREDENTIAL_ID)];
    await renderModels();
    expect(
      [...section("Main model").querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["1Model 1OpenRouter", "2Model 1OpenRouter (Work)", "Add fallback"]);
    expect(
      [...section("Main model").querySelectorAll('[role="button"]')].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Model 1 (OpenRouter) options", "Model 1 (OpenRouter, Work) options"]);
    const menu = [...mocks.menus.entries()].filter(([title]) => title === "Model 1");
    expect(menu).toHaveLength(1);
    await act(async () =>
      mocks.menus.get("Model 1")!.onPressAction({ nativeEvent: { event: "manage" } }),
    );
    expect(modelConnectionRequest(lastRequest(mocks.push))).toMatchObject({
      provider: "openrouter",
      credentialId: WORK_CREDENTIAL_ID,
      makeDefault: false,
    });
  });

  it("lists every connection under Providers with rename, replace and disconnect", async () => {
    await renderModels();
    expect(
      [...section("Providers").querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual([
      "OpenRouterKey not checked",
      "OpenRouter (Work)Key not checked",
      "Add provider",
      "Check all keys",
    ]);
    expect(mocks.menus.get("OpenRouter (Work)")!.actions.map((action) => action.title)).toEqual([
      "Rename",
      "Replace API key",
      "Disconnect",
    ]);

    await act(async () =>
      mocks.menus.get("OpenRouter (Work)")!.onPressAction({ nativeEvent: { event: "rename" } }),
    );
    const [, , buttons, , current] = mocks.prompt.mock.lastCall!;
    expect(current).toBe("Work");
    await act(async () => buttons[1].onPress(" Personal "));
    expect(mocks.rpc).toHaveBeenCalledWith("models/rename", {
      credentialId: WORK_CREDENTIAL_ID,
      label: "Personal",
    });

    await act(async () =>
      mocks.menus.get("OpenRouter (Work)")!.onPressAction({ nativeEvent: { event: "disconnect" } }),
    );
    const [title, , choices] = mocks.alert.mock.lastCall!;
    expect(title).toBe("Disconnect OpenRouter (Work)?");
    await act(async () => choices[1].onPress());
    expect(mocks.rpc).toHaveBeenCalledWith("models/disconnect", {
      provider: "openrouter",
      credentialId: WORK_CREDENTIAL_ID,
    });

    await act(async () =>
      mocks.menus.get("OpenRouter")!.onPressAction({ nativeEvent: { event: "manage" } }),
    );
    expect(modelConnectionRequest(lastRequest(mocks.push))).toMatchObject({
      credentialId: CREDENTIAL_ID,
    });
  });

  it("adds another connection for a connected provider without changing any list", async () => {
    await renderModels();
    act(() =>
      [...section("Providers").querySelectorAll("button")]
        .find((button) => button.textContent === "Add provider")!
        .click(),
    );
    expect(mocks.setOptions).toHaveBeenCalledWith({ title: "Add provider" });
    const openrouter = pickerRows().find((row) => row.textContent === "OpenRouter")!;
    act(() => openrouter.click());
    const request = modelConnectionRequest(lastRequest(mocks.replace))!;
    expect(request).toMatchObject({
      provider: "openrouter",
      credentialId: null,
      makeDefault: false,
    });
    expect(request.onConnected).toBeUndefined();
    expect(roleSaves()).toEqual([]);
  });
});

describe("connection screen targets", () => {
  it("adds a new connection and then keeps saving that one", async () => {
    mocks.connected = false;
    // The saved connection is listed when the screen reloads.
    mocks.rpc.mockImplementation((procedure: string) => {
      if (procedure === "models/connect") mocks.connected = true;
    });
    await renderConnection();
    editField("API key", "fixture-key");
    await act(async () => buttonWithText("Connect API key")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/connect",
      expect.objectContaining({ apiKey: "fixture-key", credentialId: null }),
    );
    editField("API key", "fixture-key-2");
    await act(async () => buttonWithText("Replace API key")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/connect",
      expect.objectContaining({ apiKey: "fixture-key-2", credentialId: CREDENTIAL_ID }),
    );
  });

  it("signs a new account in and disconnects only the managed connection", async () => {
    mocks.connected = false;
    mocks.subscriptionSignIn = true;
    mocks.completeOAuth.mockReturnValueOnce(new Promise(() => undefined));
    await renderConnection();
    await act(async () => buttonWithText("Sign in")!.click());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models/beginOAuth",
      expect.objectContaining({ provider: "openrouter", credentialId: null }),
    );
    act(() => root.render(null));

    mocks.connected = true;
    mocks.subscriptionSignIn = false;
    await renderConnection();
    act(() => buttonWithText("Disconnect")!.click());
    const [, , choices] = mocks.alert.mock.lastCall!;
    await act(async () => choices[1].onPress());
    expect(mocks.rpc).toHaveBeenCalledWith("models/disconnect", {
      provider: "openrouter",
      credentialId: CREDENTIAL_ID,
    });
  });
});

const threadBot: MobileBot = {
  id: "bot-fixture",
  name: "Fixture",
  preview: "",
  color: "#000000",
  notifyOnFinish: false,
  threadId: "thread-fixture",
  pinned: false,
  status: "idle",
  sectionId: null,
  archivedAt: null,
  unread: false,
  updatedAt: "2026-11-09T00:00:00Z",
  computerMode: "team",
  modelProvider: "openrouter",
  modelId: "vendor/model-2",
  thinkingLevel: null,
  translationModels: null,
  videoModels: null,
  imageModels: null,
  videoPromptPresets: null,
  activeVideoPromptPreset: null,
  imagePromptPresets: null,
  activeImagePromptPreset: null,
  videoTriggerWords: null,
  imageTriggerWords: null,
  imageSaveDirectory: null,
  videoSaveDirectory: null,
  showMediaFavorite: true,
  showMediaShare: true,
  showMediaPreview: true,
  showMediaDownload: true,
  translationSourceLanguage: "auto",
  translationTargetLanguage: null,
  autoTranslate: false,
  showTranslationActions: true,
  autoSpeak: false,
  fleetManagement: false,
};

async function renderChips() {
  mocks.computerPrimary = { provider: "openrouter", modelId: "vendor/model-2" };
  // The harness plays the screen: it owns the picker the chips open, like
  // Thread does, so a save lands back in the chip values.
  function Harness() {
    const [mainOverride, setMainOverride] = useState<ThreadModelSave | null>(null);
    const [computerChoice, setComputerChoice] = useState(mocks.computerPrimary);
    const [sheetRole, setSheetRole] = useState<ThreadModelPickerRole | null>(null);
    return (
      <>
        <ThreadComposerChips
          botId="bot-fixture"
          currentBot={threadBot}
          userId="user-fixture"
          catalog={catalog as MobileModel[]}
          mainOverride={mainOverride}
          computerChoice={computerChoice}
          onPickModel={setSheetRole}
          videoOverride={null}
          imageOverride={null}
          onPickMediaModel={() => undefined}
          favoriteCount={0}
          onOpenFavorites={() => undefined}
          backgroundLabel="Default"
          onOpenBackground={() => undefined}
          onOpenBackup={() => undefined}
        />
        {sheetRole ? (
          <ThreadModelPickerSheet
            visible
            role={sheetRole}
            botId="bot-fixture"
            userId="user-fixture"
            selectedKey=""
            onClose={() => setSheetRole(null)}
            onSaved={(choice) => {
              if (sheetRole === "main") {
                setMainOverride(choice);
              } else {
                setComputerChoice(
                  choice.provider && choice.modelId
                    ? { provider: choice.provider, modelId: choice.modelId }
                    : null,
                );
              }
            }}
          />
        ) : null}
      </>
    );
  }
  await act(async () => root.render(<Harness />));
}

function chipCard(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}:"]`);
}

// The test run finishes on detached promise chains; let them drain inside act.
async function settleRun() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const FakeSheet = ({ children }: { children?: ReactNode }) =>
  createElement("div", { "data-native-sheet": true }, children);

describe("thread composer quick cards", () => {
  it("shows live values on nine cards in the mockup's order", async () => {
    await renderChips();
    expect(
      [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Main model: Model 2",
      "Computer model: Model 2",
      "Voice model: 晓晓 · 女声",
      "Other models: What image and video generation needs",
      "Computer: Online",
      "Routines: 3 running",
      "Favorites: No favorites",
      "Background: Default",
      "Backup: Not set up",
    ]);
  });

  it("falls back to the provider name when no voice name resolves", async () => {
    mocks.voiceList = [];
    await renderChips();
    expect(chipCard("Voice model")?.getAttribute("aria-label")).toBe("Voice model: Fish Audio");
  });

  it("shows the stopped computer instead of online when it is not running", async () => {
    mocks.computerStatus = { ...defaultComputerStatus(), state: "stopped" };
    await renderChips();
    expect(chipCard("Computer")?.getAttribute("aria-label")).toBe("Computer: Computer is stopped");
  });

  it("counts only enabled routines as running", async () => {
    mocks.routines = defaultRoutines().map((routine) => ({ ...routine, active: false }));
    await renderChips();
    expect(chipCard("Routines")?.getAttribute("aria-label")).toBe("Routines: 0 running");
  });
});

describe("thread model picker sheet", () => {
  const sheetRows = () => [...container.querySelectorAll<HTMLButtonElement>("li button")];
  // The swipe mock renders each row's Remove button inside the same li; the
  // row buttons carry the model's full label, the Remove buttons do not.
  const modelRows = () => sheetRows().filter((row) => row.getAttribute("aria-label") !== "Remove");
  const removeButtons = () =>
    [...container.querySelectorAll("button")].filter((button) => button.textContent === "Remove");
  const menuButton = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  const pickModel = async (cardLabel: string, modelLabel: string) => {
    await renderChips();
    await act(async () => chipCard(cardLabel)!.click());
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent === modelLabel)!
        .click(),
    );
    // A row tap opens the menu; switching happens from there.
    await act(async () => menuButton("Switch to this model")!.click());
  };

  it("saves the main model in place and closes without leaving the chat", async () => {
    await pickModel("Main model", "Model 3");
    expect(mocks.update).toHaveBeenCalledWith({
      botId: "bot-fixture",
      modelProvider: "openrouter",
      modelId: "vendor/model-3",
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.dismissTo).not.toHaveBeenCalled();
    expect(sheetRows()).toHaveLength(0);
    expect(chipCard("Main model")?.getAttribute("aria-label")).toBe("Main model: Model 3");
  });

  it("saves the computer model through the role RPC", async () => {
    await pickModel("Computer model", "Model 4");
    expect(mocks.rpc).toHaveBeenCalledWith("models/setRole", {
      role: "computer",
      expectedUserId: "user-fixture",
      scope: "account",
      primary: { provider: "openrouter", modelId: "vendor/model-4" },
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(sheetRows()).toHaveLength(0);
    expect(chipCard("Computer model")?.getAttribute("aria-label")).toBe("Computer model: Model 4");
  });

  it("saves a translation model pick to the front of the list", async () => {
    // A variable, not a literal: Biome reads a literal role prop as an ARIA
    // role, and "translation" is a picker role, not an ARIA role.
    const translationRole: ThreadModelPickerRole = "translation";
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ThreadModelPickerSheet
          visible
          role={translationRole}
          botId="bot-fixture"
          userId="user-fixture"
          selectedKey="openrouter::vendor/model-1"
          currentModels={[{ provider: "openrouter", model: "vendor/model-1" }]}
          onClose={() => setOpen(false)}
          onSaved={() => undefined}
        />
      ) : null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent === "Model 2")!
        .click(),
    );
    await act(async () => menuButton("Switch to this model")!.click());
    expect(mocks.update).toHaveBeenCalledWith({
      botId: "bot-fixture",
      translationModels: [
        { provider: "openrouter", model: "vendor/model-2" },
        { provider: "openrouter", model: "vendor/model-1" },
      ],
    });
    expect(sheetRows()).toHaveLength(0);
  });

  it("tests every testable connection from the header and shows the results on the rows", async () => {
    mocks.secondConnection = true;
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Test all models",
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await settleRun();
    // The managed catalog connection rejects every probe, so only the
    // connection that can answer is tested.
    expect(mocks.testProvider).toHaveBeenCalledTimes(1);
    expect(mocks.testProvider).toHaveBeenCalledWith({ credentialId: CREDENTIAL_ID });
    // The merged dialog is gone: results live on the rows.
    expect(container.textContent).not.toContain("Test results");
    expect(container.textContent).toContain("Usable · Latency 1s · Text ·");
    expect(container.textContent).toContain("No permission · 1s · Text ·");
    expect(container.textContent).toContain("OpenRouter · 1/11 passed");
    expect(container.textContent).toContain("Space default · 1/1 passed");
    expect(container.textContent).toContain("Only available");
    expect(container.textContent).toContain("Available now: 2");
    expect(container.textContent).toContain("Test finished 2/11");
  });

  it("reports when every provider test fails", async () => {
    mocks.testProvider.mockRejectedValueOnce(new Error("offline"));
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Test all models",
    );
    await act(async () => button!.click());
    await settleRun();
    expect(container.textContent).toContain("Could not test these models");
    expect(container.textContent).not.toContain("Test results");
  });

  it("opens the row menu instead of selecting the model", async () => {
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent === "Model 3")!
        .click(),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(sheetRows()).toHaveLength(12);
    expect(container.textContent).toContain("Switch to this model");
    expect(container.textContent).toContain("Retest this model");
    expect(container.textContent).toContain("Close");
    // A catalog row has no saved list to remove from.
    expect(container.textContent).not.toContain("Remove this model");
  });

  it("shows the switch action as the current model for the selected row", async () => {
    function Harness() {
      const [sheetRole, setSheetRole] = useState<ThreadModelPickerRole | null>(null);
      return (
        <>
          <ThreadComposerChips
            botId="bot-fixture"
            currentBot={threadBot}
            userId="user-fixture"
            catalog={catalog as MobileModel[]}
            mainOverride={null}
            computerChoice={mocks.computerPrimary}
            onPickModel={setSheetRole}
            videoOverride={null}
            imageOverride={null}
            onPickMediaModel={() => undefined}
            favoriteCount={0}
            onOpenFavorites={() => undefined}
            backgroundLabel="Default"
            onOpenBackground={() => undefined}
            onOpenBackup={() => undefined}
          />
          {sheetRole ? (
            <ThreadModelPickerSheet
              visible
              role={sheetRole}
              botId="bot-fixture"
              userId="user-fixture"
              selectedKey="openrouter::vendor/model-2"
              onClose={() => setSheetRole(null)}
              onSaved={() => undefined}
            />
          ) : null}
        </>
      );
    }
    await act(async () => root.render(<Harness />));
    await act(async () => chipCard("Main model")!.click());
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent === "Model 2")!
        .click(),
    );
    const button = menuButton("Current model");
    expect(button).toBeDefined();
    expect(button!.hasAttribute("disabled")).toBe(true);
    expect(menuButton("Switch to this model")).toBeUndefined();
  });

  it("retests one model from the row menu and keeps the other results", async () => {
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    await act(async () => menuButton("Test all models")!.click());
    await settleRun();
    expect(container.textContent).toContain("Test finished 2/11");
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent!.startsWith("Model 2"))!
        .click(),
    );
    // The menu shows the failure with its reason.
    expect(container.textContent).toContain("No permission");
    await act(async () => menuButton("Retest this model")!.click());
    await settleRun();
    expect(mocks.testProvider).toHaveBeenCalledTimes(2);
    expect(mocks.testProvider).toHaveBeenLastCalledWith({
      credentialId: CREDENTIAL_ID,
      modelId: "vendor/model-2",
    });
    // The retest kept the other model's result.
    expect(container.textContent).toContain("Usable · Latency 1s · Text ·");
    expect(container.textContent).toContain("No permission · 1s · Text ·");
    expect(container.textContent).not.toContain("Switch to this model");
  });

  it("aborts a run and resumes only the models still untested", async () => {
    let resolveProbe!: (report: ReturnType<typeof mocks.testProvider>) => void;
    mocks.testProvider.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof mocks.testProvider>>((resolve) => {
          resolveProbe = resolve;
        }) as unknown as ReturnType<typeof mocks.testProvider>,
    );
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    await act(async () => menuButton("Test all models")!.click());
    expect(menuButton("Testing 0/11")).toBeDefined();
    expect(menuButton("Abort test")).toBeDefined();
    await act(async () => menuButton("Abort test")!.click());
    expect(menuButton("Resume test 0/11")).toBeDefined();
    expect(menuButton("Abort test")).toBeUndefined();
    expect(mocks.testProvider).toHaveBeenCalledTimes(1);
    // The aborted probe answers late; its results are discarded.
    await act(async () =>
      resolveProbe({
        results: [{ model: "vendor/model-1", state: "ok", detail: "2", seconds: 1 }],
      } as ReturnType<typeof mocks.testProvider>),
    );
    expect(menuButton("Resume test 0/11")).toBeDefined();
    await act(async () => menuButton("Resume test 0/11")!.click());
    await settleRun();
    expect(mocks.testProvider).toHaveBeenCalledTimes(2);
    expect(menuButton("Test finished 2/11")).toBeDefined();
    expect(container.textContent).toContain("Usable · Latency 1s · Text ·");
  });

  it("filters to usable models with the Only available chip", async () => {
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    await act(async () => menuButton("Test all models")!.click());
    await settleRun();
    expect(modelRows()).toHaveLength(12);
    const chip = container.querySelector<HTMLButtonElement>('button[aria-label="Only available"]');
    expect(chip).not.toBeNull();
    expect(container.textContent).toContain("Available now: 2");
    await act(async () => chip!.click());
    const usable = modelRows();
    expect(usable).toHaveLength(2);
    expect(usable[0]!.textContent).toContain("Space default");
    expect(usable[0]!.textContent).toContain("Usable");
    expect(usable[1]!.textContent).toContain("Model 1");
    expect(usable[1]!.textContent).toContain("Usable");
    await act(async () => chip!.click());
    expect(modelRows()).toHaveLength(12);
  });

  it("removes a swiped model from its connection and keeps the sheet open", async () => {
    mocks.enabledModelIds = ["vendor/model-1", "vendor/model-2", "vendor/model-3"];
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    expect(modelRows().map((row) => row.textContent)).toEqual([
      "Space defaultModel 1",
      "vendor/model-1",
      "vendor/model-2",
      "vendor/model-3",
    ]);
    expect(removeButtons()).toHaveLength(3);
    await act(async () => removeButtons()[1]!.click());
    expect(mocks.rpc).toHaveBeenCalledWith("models/connect", {
      provider: "openrouter",
      credentialId: CREDENTIAL_ID,
      modelId: "vendor/model-1",
      enabledModelIds: ["vendor/model-1", "vendor/model-3"],
      makeDefault: false,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(modelRows().map((row) => row.textContent)).toEqual([
      "Space defaultModel 1",
      "vendor/model-1",
      "vendor/model-3",
    ]);
  });

  it("clears the bot's model when the removed model was selected", async () => {
    // The shared harness opens the sheet with no selection; this one opens it
    // on vendor/model-1, the way the chat does for the bot's current model.
    mocks.enabledModelIds = ["vendor/model-1", "vendor/model-2", "vendor/model-3"];
    function Harness() {
      const [mainOverride, setMainOverride] = useState<ThreadModelSave | null>(null);
      const [sheetRole, setSheetRole] = useState<ThreadModelPickerRole | null>(null);
      return (
        <>
          <ThreadComposerChips
            botId="bot-fixture"
            currentBot={threadBot}
            userId="user-fixture"
            catalog={catalog as MobileModel[]}
            mainOverride={mainOverride}
            computerChoice={mocks.computerPrimary}
            onPickModel={setSheetRole}
            videoOverride={null}
            imageOverride={null}
            onPickMediaModel={() => undefined}
            favoriteCount={0}
            onOpenFavorites={() => undefined}
            backgroundLabel="Default"
            onOpenBackground={() => undefined}
            onOpenBackup={() => undefined}
          />
          {sheetRole ? (
            <ThreadModelPickerSheet
              visible
              role={sheetRole}
              botId="bot-fixture"
              userId="user-fixture"
              selectedKey="openrouter::vendor/model-1"
              onClose={() => setSheetRole(null)}
              onSaved={(choice) => {
                if (sheetRole === "main") setMainOverride(choice);
              }}
            />
          ) : null}
        </>
      );
    }
    mocks.computerPrimary = { provider: "openrouter", modelId: "vendor/model-2" };
    await act(async () => root.render(<Harness />));
    await act(async () => chipCard("Main model")!.click());
    await act(async () => removeButtons()[0]!.click());
    expect(mocks.rpc).toHaveBeenCalledWith("models/connect", {
      provider: "openrouter",
      credentialId: CREDENTIAL_ID,
      modelId: "vendor/model-2",
      enabledModelIds: ["vendor/model-2", "vendor/model-3"],
      makeDefault: false,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      botId: "bot-fixture",
      modelProvider: null,
      modelId: null,
    });
    // The removed model stays listed as the saved-but-no-longer-offered row:
    // this harness keeps the old selectedKey, while the real chat clears it
    // through onSaved.
    expect(modelRows().map((row) => row.textContent)).toEqual([
      "Space defaultModel 1",
      "vendor/model-1",
      "vendor/model-2",
      "vendor/model-3",
    ]);
  });

  it("reports when a removal fails and restores the row", async () => {
    mocks.enabledModelIds = ["vendor/model-1", "vendor/model-2", "vendor/model-3"];
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    await act(async () => removeButtons()[1]!.click());
    expect(container.textContent).toContain("offline");
    expect(modelRows()).toHaveLength(4);
  });

  it("opens the native sheet on Android", async () => {
    mocks.sheet = FakeSheet;
    await renderChips();
    await act(async () => chipCard("Main model")!.click());
    expect(container.querySelector("[data-native-sheet]")).not.toBeNull();
    expect(sheetRows()).toHaveLength(12);
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent === "Model 3")!
        .click(),
    );
    await act(async () => menuButton("Switch to this model")!.click());
    expect(mocks.update).toHaveBeenCalledWith({
      botId: "bot-fixture",
      modelProvider: "openrouter",
      modelId: "vendor/model-3",
    });
  });

  it("opens the picker when the current model is no longer offered", async () => {
    // A provider that hit its spending limit leaves the bot on a model no
    // connection offers any more; the picker must still open and let the
    // user pick a replacement instead of crashing on the saved row.
    const limitedBot = {
      ...threadBot,
      modelProvider: "deepseek",
      modelId: "deepseek-v4",
    };
    function Harness() {
      const [mainOverride, setMainOverride] = useState<ThreadModelSave | null>(null);
      const [sheetRole, setSheetRole] = useState<ThreadModelPickerRole | null>(null);
      return (
        <>
          <ThreadComposerChips
            botId="bot-fixture"
            currentBot={limitedBot}
            userId="user-fixture"
            catalog={catalog as MobileModel[]}
            mainOverride={mainOverride}
            computerChoice={mocks.computerPrimary}
            onPickModel={setSheetRole}
            videoOverride={null}
            imageOverride={null}
            onPickMediaModel={() => undefined}
            favoriteCount={0}
            onOpenFavorites={() => undefined}
            backgroundLabel="Default"
            onOpenBackground={() => undefined}
            onOpenBackup={() => undefined}
          />
          {sheetRole ? (
            <ThreadModelPickerSheet
              visible
              role={sheetRole}
              botId="bot-fixture"
              userId="user-fixture"
              selectedKey="deepseek::deepseek-v4"
              onClose={() => setSheetRole(null)}
              onSaved={(choice) => {
                if (sheetRole === "main") setMainOverride(choice);
              }}
            />
          ) : null}
        </>
      );
    }
    await act(async () => root.render(<Harness />));
    expect(chipCard("Main model")?.getAttribute("aria-label")).toBe("Main model: deepseek-v4");
    await act(async () => chipCard("Main model")!.click());
    expect(sheetRows().length).toBeGreaterThan(0);
    expect(sheetRows().map((row) => row.textContent)).toContain("deepseek-v4");
    await act(async () =>
      sheetRows()
        .find((row) => row.textContent === "Model 3")!
        .click(),
    );
    await act(async () => menuButton("Switch to this model")!.click());
    expect(mocks.update).toHaveBeenCalledWith({
      botId: "bot-fixture",
      modelProvider: "openrouter",
      modelId: "vendor/model-3",
    });
    expect(sheetRows()).toHaveLength(0);
    expect(chipCard("Main model")?.getAttribute("aria-label")).toBe("Main model: Model 3");
  });
});
