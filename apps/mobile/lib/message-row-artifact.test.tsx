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
  alert: vi.fn(),
  askRename: vi.fn(),
  rpc: vi.fn(async () => ({ ok: true })),
  renameArtifact: vi.fn(async () => ({ name: "renamed.py" })),
  removeArtifact: vi.fn(async () => undefined),
  getArtifactById: vi.fn(async (id: string) => ({
    id,
    mimeType: "text/x-python",
    name: "spider.py",
    contentBase64: "cHk=",
  })),
  downloadMobileArtifact: vi.fn(async (id: string) => ({
    name: "spider.py",
    uri: `file:///x/${id}`,
  })),
  writeArtifactCacheFile: vi.fn(() => ({ uri: "file:///cache/spider.py" })),
  shareLocalFile: vi.fn(async () => undefined),
  openMobileArtifact: vi.fn(async () => undefined),
  favorite: vi.fn(),
  refresh: vi.fn(),
  previewFile: vi.fn(),
  previewImage: vi.fn(),
  present: vi.fn(),
  resend: vi.fn(),
  menu: null as {
    actions: readonly MessageMenuEntry[];
    onAction: (id: string) => void;
    onLongPress?: (event: { nativeEvent: { pageX: number; pageY: number } }) => void;
  } | null,
  showMediaFavorite: true,
  showMediaShare: true,
  showMediaPreview: true,
  showMediaDownload: true,
  hasGeneratedImage: false,
  hasGeneratedMedia: false,
}));

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  const styleData = (style: unknown) =>
    JSON.stringify(typeof style === "function" ? style({ pressed: false }) : style);
  return {
    ActionSheetIOS: {},
    Alert: { alert: mocks.alert },
    Appearance: {
      getColorScheme: () => "light",
      addChangeListener: () => ({ remove: () => undefined }),
    },
    Platform: {
      get OS() {
        return mocks.os;
      },
      select: (options: { ios?: unknown; android?: unknown }) =>
        mocks.os === "ios" ? options.ios : options.android,
    },
    Share: { share: vi.fn(async () => ({})) },
    View: ({ children, style }: { children?: ReactNode; style?: unknown }) =>
      h("div", { "data-style": styleData(style) }, children),
    Text: ({ children, style }: { children?: ReactNode; style?: unknown }) =>
      h("span", { "data-style": styleData(style) }, children),
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
      accessibilityRole,
      style,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      style?: unknown;
    }) =>
      h(
        "button",
        {
          "aria-label": accessibilityLabel,
          role: accessibilityRole,
          "data-style": styleData(style),
          onClick: onPress,
        },
        children,
      ),
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
  t: (message: string) => message,
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
    accent: "#e8efff",
    link: "#2f6bff",
  }),
  useResolvedAppearance: () => ({ colorScheme: "light" }),
  native: {},
}));

vi.mock("./custom-settings", () => ({
  useCustomSettings: () => ({
    messageActions: { order: ["copy", "speak", "share", "favorite", "regenerate"], hidden: [] },
    messageBackgrounds: { user: null, ai: null },
    font: { size: 17, color: null },
  }),
  visibleMessageActions: (_settings: unknown, capabilities: Record<string, boolean | undefined>) =>
    Object.keys(capabilities).filter((id) => capabilities[id] !== false),
}));

vi.mock("./message-action-sheet", () => ({
  presentMessageActionSheet: vi.fn(),
}));

vi.mock("./media-display", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-display")>();
  return {
    ...actual,
    mediaDisplaySettingsFromBot: () => ({
      showMediaFavorite: mocks.showMediaFavorite,
      showMediaShare: mocks.showMediaShare,
      showMediaPreview: mocks.showMediaPreview,
      showMediaDownload: mocks.showMediaDownload,
    }),
    messageHasGeneratedImage: () => mocks.hasGeneratedImage,
    messageHasGeneratedMedia: () => mocks.hasGeneratedMedia,
  };
});

vi.mock("./translation", () => ({
  translationSettingsFromBot: () => ({}),
}));

vi.mock("./haptics", () => ({
  hapticImpact: vi.fn(),
  hapticSelection: vi.fn(),
  hapticSuccess: vi.fn(),
}));
vi.mock("./live-notifications", () => ({ resumeLiveNotifications: vi.fn() }));
vi.mock("./network-cache", () => ({ clearNetworkCache: vi.fn() }));
vi.mock("./artifact-open", () => ({
  openMobileArtifact: mocks.openMobileArtifact,
  downloadMobileArtifact: mocks.downloadMobileArtifact,
  writeArtifactCacheFile: mocks.writeArtifactCacheFile,
  shareLocalFile: mocks.shareLocalFile,
}));
vi.mock("./api", () => ({ rpc: mocks.rpc }));
vi.mock("./artifacts", () => ({
  renameArtifact: mocks.renameArtifact,
  removeArtifact: mocks.removeArtifact,
  getArtifactById: mocks.getArtifactById,
}));

vi.mock("@rakazo_mickvvw/chat-ui/native", async () => {
  const { createContext } = await import("react");
  return {
    markdownCodeBlocks: () => [],
    MarkdownLongPressContext: createContext(undefined),
    ChatMarkdown: () => null,
    plainTextLinkParts: (text: string) => [{ type: "text", value: text }],
    withBlockMentions: <T,>(blocks: T) => blocks,
  };
});

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

vi.mock("../components/profile-edit-dialog", () => ({
  useTextEditDialog: () => ({ ask: mocks.askRename, dialog: null }),
}));

vi.mock("../components/message-caption", () => ({
  MessageCaption: ({ text }: { text: string }) => createElement("span", null, text),
  useMessageChatFont: () => ({ size: 17, color: null }),
}));
vi.mock("../components/ComputerCard", () => ({ ComputerCard: () => null }));
vi.mock("../components/thread/ask-block", () => ({ AskBlock: () => null }));
vi.mock("../components/AskActions", () => ({ AskActions: () => null }));
vi.mock("../components/AppConnectCard", () => ({ AppConnectCard: () => null }));
vi.mock("../components/audio-attachment", () => ({ AudioAttachment: () => null }));
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => null }));
vi.mock("../components/ChoiceCard", () => ({ ChoiceCard: () => null }));
vi.mock("../components/ImportSetupCard", () => ({ ImportSetupCard: () => null }));
vi.mock("../components/inline-image-attachment", () => ({ InlineImageAttachment: () => null }));
vi.mock("../components/instruction-undo", () => ({ InstructionUndo: () => null }));
vi.mock("../components/McpApprovalCard", () => ({ McpApprovalCard: () => null }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/pages/page-card", () => ({ PageCard: () => null }));
vi.mock("../components/thread/mcp-app-card", () => ({ McpAppCard: () => null }));
vi.mock("../components/reply-line", () => ({ ReplyLine: () => null }));
vi.mock("../components/message-selection-bar", () => ({
  MessageSelectCheckbox: () => null,
}));
vi.mock("../components/time-separator", () => ({ TimeSeparator: () => null }));
vi.mock("../components/unread-divider", () => ({ UnreadDivider: () => null }));
vi.mock("../components/thread/thread-model-picker-sheet", () => ({
  ThreadModelPickerSheet: () => null,
}));

import { artifactActionAttachments } from "./media-display";

type RowProps = ComponentProps<typeof MessageRow>;

function botMessage(id: string, blocks: MobileMessage["blocks"]): MobileMessage {
  return {
    id,
    role: "bot",
    author: { id: "u1", name: "Me" },
    createdAt: Date.now(),
    blocks,
  } as unknown as MobileMessage;
}

function pyMessage(id = "m-py"): MobileMessage {
  return botMessage(id, [
    {
      kind: "file",
      artifactId: "art-py",
      mimeType: "text/x-python",
      name: "spider.py",
      size: 15000,
    },
  ]);
}

function multiMessage(): MobileMessage {
  return botMessage("m-multi", [
    {
      kind: "file",
      artifactId: "art-py",
      mimeType: "text/x-python",
      name: "spider.py",
      size: 15000,
    },
    {
      kind: "file",
      artifactId: "art-zip",
      mimeType: "application/zip",
      name: "spider.zip",
      size: 4500,
    },
  ]);
}

function imageMessage(): MobileMessage {
  return botMessage("m-img", [
    { kind: "image", artifactId: "art-img", mimeType: "image/png", name: "generated.png" },
  ]);
}

function binMessage(): MobileMessage {
  return botMessage("m-bin", [
    {
      kind: "file",
      artifactId: "art-bin",
      mimeType: "application/octet-stream",
      name: "data.bin",
      size: 100,
    },
  ]);
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
    previewFile: mocks.previewFile,
    previewImage: mocks.previewImage,
    jump: () => {},
    dismissChoice: () => {},
    openPeerChat: () => {},
    layout: () => {},
    favorite: mocks.favorite,
    refresh: mocks.refresh,
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

/** The row's tiles, in the order they render. */
function tileLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button[aria-label]")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );
}

function tile(container: HTMLElement, label: string, occurrence = 0): HTMLElement {
  const matches = [...container.querySelectorAll(`button[aria-label="${label}"]`)];
  const found = matches[occurrence];
  if (!found || !(found instanceof HTMLElement)) throw new Error(`no ${label} tile`);
  return found;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("artifactActionAttachments", () => {
  it("covers a lone file, image, or video with no body text", () => {
    expect(artifactActionAttachments(pyMessage())?.map((a) => a.artifactId)).toEqual(["art-py"]);
    expect(artifactActionAttachments(imageMessage())?.map((a) => a.artifactId)).toEqual([
      "art-img",
    ]);
    const video = botMessage("m-vid", [
      {
        kind: "file",
        artifactId: "art-vid",
        mimeType: "video/mp4",
        name: "generated.mp4",
        size: 1400000,
      },
    ]);
    expect(artifactActionAttachments(video)?.map((a) => a.artifactId)).toEqual(["art-vid"]);
    expect(artifactActionAttachments(multiMessage())?.map((a) => a.artifactId)).toEqual([
      "art-py",
      "art-zip",
    ]);
  });

  it("keeps the generic row for body text, user messages, and audio", () => {
    const withBody = botMessage("m-body", [
      { kind: "text", text: "Here it is." },
      { kind: "file", artifactId: "art-py", mimeType: "text/x-python", name: "spider.py", size: 1 },
    ]);
    expect(artifactActionAttachments(withBody)).toBeNull();
    const user = { ...pyMessage(), role: "user" } as MobileMessage;
    expect(artifactActionAttachments(user)).toBeNull();
    const audio = botMessage("m-aud", [
      {
        kind: "file",
        artifactId: "art-aud",
        mimeType: "audio/mpeg",
        name: "voice.mp3",
        size: 1000,
      },
    ]);
    expect(artifactActionAttachments(audio)).toBeNull();
    expect(artifactActionAttachments(botMessage("m-empty", []))).toBeNull();
  });

  it("does not count the current-model mark as body text", () => {
    const marked = botMessage("m-mark", [
      { kind: "text", text: "当前模型: cogview-3-flash" },
      { kind: "image", artifactId: "art-img", mimeType: "image/png", name: "generated.png" },
    ]);
    expect(artifactActionAttachments(marked)?.map((a) => a.artifactId)).toEqual(["art-img"]);
  });
});

describe("MessageRow artifact actions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  function render(props: RowProps) {
    act(() => {
      root?.render(createElement(MessageRow, props));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.os = "ios";
    mocks.menu = null;
    mocks.alert.mockClear();
    mocks.askRename.mockClear();
    mocks.rpc.mockClear();
    mocks.renameArtifact.mockClear();
    mocks.removeArtifact.mockClear();
    mocks.getArtifactById.mockClear();
    mocks.downloadMobileArtifact.mockClear();
    mocks.writeArtifactCacheFile.mockClear();
    mocks.shareLocalFile.mockClear();
    mocks.openMobileArtifact.mockClear();
    mocks.favorite.mockClear();
    mocks.refresh.mockClear();
    mocks.previewFile.mockClear();
    mocks.previewImage.mockClear();
    mocks.showMediaFavorite = true;
    mocks.showMediaShare = true;
    mocks.showMediaPreview = true;
    mocks.showMediaDownload = true;
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
    vi.unstubAllGlobals();
  });

  it("shows the six tiles in order for a lone file, and no generic row", () => {
    render(rowProps(pyMessage()));
    expect(tileLabels(container!)).toEqual([
      "Rename",
      "Download",
      "Share",
      "Favorite",
      "Open",
      "Delete",
    ]);
  });

  it("keeps the generic row for a message with body text", () => {
    const target = botMessage("m-body", [
      { kind: "text", text: "Here it is." },
      { kind: "file", artifactId: "art-py", mimeType: "text/x-python", name: "spider.py", size: 1 },
    ]);
    render(rowProps(target));
    expect(tileLabels(container!)).toContain("Copy");
    expect(tileLabels(container!)).not.toContain("Rename");
  });

  it("gives each card in a multi-attachment message its own row", () => {
    render(rowProps(multiMessage()));
    expect(tileLabels(container!)).toEqual([
      "Rename",
      "Download",
      "Share",
      "Favorite",
      "Open",
      "Delete",
      "Rename",
      "Download",
      "Share",
      "Favorite",
      "Open",
      "Delete",
    ]);
  });

  it("hides rename and delete in read-only history, and keeps the rest", () => {
    render(rowProps(pyMessage(), { readOnly: true }));
    expect(tileLabels(container!)).toEqual(["Download", "Share", "Favorite", "Open"]);
  });

  it("follows the bot's media toggles for generated media, and ignores them for other files", () => {
    mocks.showMediaDownload = false;
    mocks.showMediaShare = false;
    render(rowProps(imageMessage()));
    expect(tileLabels(container!)).toEqual(["Rename", "Favorite", "Open", "Delete"]);
    render(rowProps(pyMessage()));
    expect(tileLabels(container!)).toEqual([
      "Rename",
      "Download",
      "Share",
      "Favorite",
      "Open",
      "Delete",
    ]);
  });

  it("downloads through the artifacts list path, and says it saved", async () => {
    render(rowProps(pyMessage()));
    act(() => {
      tile(container!, "Download").click();
    });
    await flush();
    expect(mocks.downloadMobileArtifact).toHaveBeenCalledWith("art-py");
    expect(mocks.alert).toHaveBeenCalledWith("Saved {name} locally");
  });

  it("shares through the cache file, and favorites the message", async () => {
    render(rowProps(pyMessage()));
    act(() => {
      tile(container!, "Share").click();
    });
    await flush();
    expect(mocks.getArtifactById).toHaveBeenCalledWith("art-py");
    expect(mocks.writeArtifactCacheFile).toHaveBeenCalledWith("art-py", "text/x-python", "cHk=");
    expect(mocks.shareLocalFile).toHaveBeenCalledWith(
      "file:///cache/spider.py",
      "text/x-python",
      "spider.py",
    );
    act(() => {
      tile(container!, "Favorite").click();
    });
    expect(mocks.favorite).toHaveBeenCalledTimes(1);
    expect((mocks.favorite.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "m-py" });
  });

  it("opens an image in the viewer, a zip in the detail page, and an unpreviewable file through the share panel", async () => {
    render(rowProps(imageMessage()));
    act(() => {
      tile(container!, "Open").click();
    });
    expect(mocks.previewImage).toHaveBeenCalledWith({
      artifactId: "art-img",
      name: "generated.png",
      mimeType: "image/png",
    });
    render(rowProps(multiMessage()));
    act(() => {
      tile(container!, "Open", 1).click();
    });
    expect(mocks.previewFile).toHaveBeenCalledWith("art-zip");
    render(rowProps(binMessage()));
    act(() => {
      tile(container!, "Open").click();
    });
    await flush();
    expect(mocks.openMobileArtifact).toHaveBeenCalledWith(
      { botId: "b1" },
      "art-bin",
      "data.bin",
      "application/octet-stream",
    );
  });

  it("renames through the detail page's dialog, then refreshes", async () => {
    render(rowProps(pyMessage()));
    act(() => {
      tile(container!, "Rename").click();
    });
    expect(mocks.askRename).toHaveBeenCalledTimes(1);
    const onCommit = mocks.askRename.mock.calls[0]![1] as (name: string) => void;
    await act(async () => {
      onCommit("renamed.py");
    });
    await flush();
    expect(mocks.renameArtifact).toHaveBeenCalledWith("art-py", "renamed.py");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("deletes a lone file by deleting the message first, then the artifact", async () => {
    render(rowProps(pyMessage()));
    act(() => {
      tile(container!, "Delete").click();
    });
    expect(mocks.alert).toHaveBeenCalledWith(
      'Delete "{name}"?',
      "This can't be undone.",
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel" }),
        expect.objectContaining({ text: "Delete" }),
      ]),
    );
    const buttons = mocks.alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((button) => button.text === "Delete");
    await act(async () => {
      confirm?.onPress?.();
    });
    await flush();
    expect(mocks.rpc).toHaveBeenCalledWith("threads/deleteMessage", {
      botId: "b1",
      messageId: "m-py",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "threads/deleteMessageAttachment",
      expect.anything(),
    );
    expect(mocks.removeArtifact).toHaveBeenCalledWith("art-py");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("deletes one card of a multi-attachment message and leaves the message", async () => {
    render(rowProps(multiMessage()));
    act(() => {
      tile(container!, "Delete", 1).click();
    });
    const buttons = mocks.alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((button) => button.text === "Delete");
    await act(async () => {
      confirm?.onPress?.();
    });
    await flush();
    expect(mocks.rpc).toHaveBeenCalledWith("threads/deleteMessageAttachment", {
      botId: "b1",
      messageId: "m-multi",
      artifactId: "art-zip",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("threads/deleteMessage", expect.anything());
    expect(mocks.removeArtifact).toHaveBeenCalledWith("art-zip");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
