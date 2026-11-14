// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRowActions } from "../components/thread/message-row";
import { MessageRow } from "../components/thread/message-row";
import type { MessageMenuEntry } from "./message-context-menu";
import type { MobileMessage } from "./mobile-types";

const mocks = vi.hoisted(() => ({
  os: "ios",
  menu: null as {
    actions: readonly MessageMenuEntry[];
    onAction: (id: string) => void;
    onLongPress?: (event: { nativeEvent: { pageX: number; pageY: number } }) => void;
  } | null,
  present: vi.fn(),
  resend: vi.fn(),
  favorite: vi.fn(),
  showMediaFavorite: true,
  hasGeneratedImage: false,
  hasGeneratedMedia: false,
}));

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActionSheetIOS: {},
    Alert: { alert: vi.fn() },
    Platform: {
      get OS() {
        return mocks.os;
      },
      select: (options: { ios?: unknown; android?: unknown }) =>
        mocks.os === "ios" ? options.ios : options.android,
    },
    Pressable: ({ children }: { children?: ReactNode }) => h("div", null, children),
    Text: ({ children }: { children?: ReactNode }) => h("span", null, children),
    View: ({ children }: { children?: ReactNode }) => h("div", null, children),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (styles: unknown) => (Array.isArray(styles) ? Object.assign({}, ...styles) : styles),
      hairlineWidth: 1,
    },
  };
});

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn(async () => {}) }));
vi.mock("expo-modules-core", () => ({ requireNativeModule: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("react-native-reanimated", () => ({
  default: { View: () => null, Text: () => null },
  cancelAnimation: () => {},
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useReducedMotion: () => false,
  useSharedValue: (value: unknown) => ({ value }),
  withRepeat: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[0],
  withTiming: (value: unknown) => value,
  ZoomIn: {},
}));

vi.mock("./i18n", () => ({
  useI18n: () => ({ t: (message: string) => message, locale: "en" }),
}));

vi.mock("./native", () => ({
  useMobileTokens: () => ({
    muted: "#eee",
    mutedForeground: "#888",
    destructive: "#c00",
    label: "#111",
    secondaryLabel: "#666",
    fill: "#f5f5f5",
    background: "#fff",
    card: "#fff",
    border: "#ddd",
    primary: "#111",
  }),
  useResolvedAppearance: () => ({ colorScheme: "light" }),
  native: {},
}));

vi.mock("./custom-settings", () => ({
  useCustomSettings: () => ({
    messageActions: { order: ["copy", "speak", "share", "favorite", "regenerate"], hidden: [] },
  }),
  visibleMessageActions: (_settings: unknown, capabilities: Record<string, boolean | undefined>) =>
    Object.keys(capabilities).filter((id) => capabilities[id] !== false),
}));

vi.mock("./message-action-sheet", () => ({
  presentMessageActionSheet: vi.fn(),
}));

vi.mock("./media-display", () => ({
  mediaDisplaySettingsFromBot: () => ({
    showMediaFavorite: mocks.showMediaFavorite,
    showMediaShare: true,
    showMediaPreview: true,
    showMediaDownload: true,
  }),
  messageHasGeneratedImage: () => mocks.hasGeneratedImage,
  messageHasGeneratedMedia: () => mocks.hasGeneratedMedia,
}));

vi.mock("./translation", () => ({
  translationSettingsFromBot: () => ({}),
}));

vi.mock("@rakazo/chat-ui/native", () => ({
  markdownCodeBlocks: () => [],
}));

vi.mock("../components/message-context-menu", () => ({
  MessageContextMenu: ({
    actions,
    children,
    onAction,
    onLongPress,
  }: {
    actions: readonly MessageMenuEntry[];
    children?: ReactNode;
    onAction: (id: string) => void;
    onLongPress?: (event: { nativeEvent: { pageX: number; pageY: number } }) => void;
  }) => {
    mocks.menu = { actions, onAction, onLongPress };
    return createElement("div", null, children);
  },
}));

vi.mock("../components/message-action-menu", () => ({
  presentMessageMenu: mocks.present,
  MessageMenuHost: () => null,
}));

vi.mock("../components/thread/message-translation", () => ({
  MessageTranslationView: () => null,
  TranslateButton: () => null,
  useMessageTranslation: () => ({
    status: "idle",
    result: null,
    error: null,
    expanded: false,
    translate: () => {},
    collapse: () => {},
  }),
}));

vi.mock("../components/thread/message-bubble", () => ({
  MessageBubble: () => createElement("div", { "data-bubble": true }),
}));

vi.mock("../components/reply-line", () => ({ ReplyLine: () => null }));
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => null }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/thread/message-selection-bar", () => ({
  MessageSelectCheckbox: () => null,
}));
vi.mock("../components/time-separator", () => ({ TimeSeparator: () => null }));
vi.mock("../components/unread-divider", () => ({ UnreadDivider: () => null }));
vi.mock("../components/thread/thread-model-picker-sheet", () => ({
  ThreadModelPickerSheet: () => null,
}));

type RowProps = ComponentProps<typeof MessageRow>;

function message(id: string, role: "user" | "bot", text: string): MobileMessage {
  return {
    id,
    role,
    author: { id: "u1", name: "Me" },
    createdAt: Date.now(),
    blocks: [{ kind: "text", text }],
  } as unknown as MobileMessage;
}

/** A bot reply carrying text plus a generated image. */
function mediaMessage(id: string, role: "user" | "bot", text: string): MobileMessage {
  return {
    id,
    role,
    author: { id: "u1", name: "Me" },
    createdAt: Date.now(),
    blocks: [
      { kind: "text", text },
      { kind: "image", url: "https://example.invalid/generated.png" },
    ],
  } as unknown as MobileMessage;
}

function actions(overrides: Partial<MessageRowActions> = {}): MessageRowActions {
  return {
    helperToggle: () => {},
    reply: () => {},
    quote: () => {},
    select: () => {},
    enterSelection: () => {},
    speak: () => {},
    react: async () => true,
    markUnread: () => {},
    answer: async () => {},
    openBot: () => {},
    openComputer: () => {},
    previewFile: () => {},
    previewImage: () => {},
    jump: () => {},
    dismissChoice: () => {},
    openPeerChat: () => {},
    layout: () => {},
    resend: mocks.resend,
    ...overrides,
  };
}

function rowProps(target: MobileMessage, overrides: Partial<RowProps> = {}): RowProps {
  return {
    message: target,
    actions: actions(),
    botId: "b1",
    bubbleBotId: "b1",
    showBotSenderName: false,
    bots: [],
    readOnly: false,
    onCall: false,
    canAnswer: false,
    canDismiss: false,
    highlighted: false,
    separator: false,
    headerAdjacent: false,
    unreadDivider: false,
    markedUnread: false,
    replyAuthor: "Bot",
    waitingForUser: false,
    inGroup: false,
    columnWidth: 400,
    enableJump: false,
    index: 0,
    userId: "u1",
    ...overrides,
  };
}

function menuIds(entries: readonly MessageMenuEntry[]): string[] {
  return entries.flatMap((entry) => [
    entry.id,
    ...(entry.subactions ? menuIds(entry.subactions) : []),
  ]);
}

describe("MessageRow resend", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  function render(props: RowProps) {
    act(() => {
      root?.render(createElement(MessageRow, props));
    });
  }

  beforeEach(() => {
    mocks.os = "ios";
    mocks.menu = null;
    mocks.present.mockClear();
    mocks.resend.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    mocks.menu = null;
  });

  it("offers Resend in the menu for a user message with text, and calls resend", () => {
    const target = message("m1", "user", "Hello again");
    render(rowProps(target));
    const ids = menuIds(mocks.menu?.actions ?? []);
    expect(ids.indexOf("resend")).toBe(ids.indexOf("reply") + 1);
    mocks.menu?.onAction("resend");
    expect(mocks.resend).toHaveBeenCalledWith(target);
  });

  it("offers Resend in the Android sheet, and its tap resends", () => {
    mocks.os = "android";
    const target = message("m1", "user", "Hello again");
    render(rowProps(target));
    mocks.menu?.onLongPress?.({ nativeEvent: { pageX: 10, pageY: 20 } });
    expect(mocks.present).toHaveBeenCalledTimes(1);
    const groups = mocks.present.mock.calls[0]![0].groups as {
      name: string;
      onPress: () => void;
    }[][];
    const resendEntry = groups.flat().find((entry) => entry.name === "resend");
    expect(resendEntry).toBeDefined();
    resendEntry?.onPress();
    expect(mocks.resend).toHaveBeenCalledWith(target);
  });

  it("does not offer Resend for a bot reply", () => {
    const target = message("b1", "bot", "Hi there");
    render(rowProps(target));
    expect(menuIds(mocks.menu?.actions ?? [])).not.toContain("resend");
  });

  it("does not offer Resend in read-only history", () => {
    const target = message("m1", "user", "Hello again");
    render(rowProps(target, { readOnly: true }));
    expect(menuIds(mocks.menu?.actions ?? [])).not.toContain("resend");
  });

  it("does not offer Resend when the user message has no text", () => {
    const target = message("m1", "user", "   ");
    render(rowProps(target));
    expect(menuIds(mocks.menu?.actions ?? [])).not.toContain("resend");
  });

  it("does not offer Resend when the caller provides no resend action", () => {
    const target = message("m1", "user", "Hello again");
    render(rowProps(target, { actions: actions({ resend: undefined }) }));
    expect(menuIds(mocks.menu?.actions ?? [])).not.toContain("resend");
  });
});

describe("MessageRow media favorite", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  function render(props: RowProps) {
    act(() => {
      root?.render(createElement(MessageRow, props));
    });
  }

  beforeEach(() => {
    mocks.os = "ios";
    mocks.menu = null;
    mocks.present.mockClear();
    mocks.resend.mockClear();
    mocks.favorite.mockClear();
    mocks.showMediaFavorite = true;
    mocks.hasGeneratedImage = false;
    mocks.hasGeneratedMedia = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    mocks.menu = null;
  });

  it("renders a bot reply with text without throwing, and offers Favorite", () => {
    // Regression: the actions memo read the bot's media-display settings
    // before they were declared, so any bot reply with text crashed the row.
    const target = message("b1", "bot", "Hi there");
    render(rowProps(target, { actions: actions({ favorite: mocks.favorite }) }));
    expect(menuIds(mocks.menu?.actions ?? [])).toContain("favorite");
  });

  it("offers Favorite for a plain text reply even when the bot hides the toggle", () => {
    mocks.showMediaFavorite = false;
    const target = message("b1", "bot", "Hi there");
    render(rowProps(target, { actions: actions({ favorite: mocks.favorite }) }));
    expect(menuIds(mocks.menu?.actions ?? [])).toContain("favorite");
  });

  it("hides Favorite for generated media when the bot hides the toggle", () => {
    mocks.showMediaFavorite = false;
    mocks.hasGeneratedImage = true;
    mocks.hasGeneratedMedia = true;
    const target = mediaMessage("b1", "bot", "Here is your image");
    render(rowProps(target, { actions: actions({ favorite: mocks.favorite }) }));
    expect(menuIds(mocks.menu?.actions ?? [])).not.toContain("favorite");
  });

  it("offers Favorite for generated media when the bot shows the toggle", () => {
    mocks.hasGeneratedImage = true;
    mocks.hasGeneratedMedia = true;
    const target = mediaMessage("b1", "bot", "Here is your image");
    render(rowProps(target, { actions: actions({ favorite: mocks.favorite }) }));
    expect(menuIds(mocks.menu?.actions ?? [])).toContain("favorite");
  });

  it("does not offer Favorite when the caller provides no favorite action", () => {
    const target = message("b1", "bot", "Hi there");
    render(rowProps(target));
    expect(menuIds(mocks.menu?.actions ?? [])).not.toContain("favorite");
  });
});
