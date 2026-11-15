// @vitest-environment jsdom
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
  Image: ({ source }: { source?: { uri?: string } }) =>
    createElement("rn-image", { src: source?.uri }),
  ActivityIndicator: () => createElement("rn-activity", {}),
  Alert: { alert: () => undefined },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("./i18n", () => ({
  useI18n: () => ({ t: (text: string) => text, locale: "en" }),
}));
vi.mock("./message-context-menu", () => ({ shareMessageText: vi.fn() }));
vi.mock("./model-error", () => ({
  describeModelError: () => ({ key: "unknown" }),
  modelErrorActionKinds: () => [],
  modelErrorActionLabel: (_t: unknown, kind: string) => kind,
  modelErrorSummary: () => null,
}));
vi.mock("./model-switches", () => ({
  finalSwitchAttempt: () => undefined,
  translationModelSwitches: () => null,
}));
vi.mock("./native", () => ({
  useMobileTokens: () => ({
    link: "blue",
    accent: "lightblue",
    mutedForeground: "muted",
    foreground: "ink",
    destructive: "red",
  }),
  useResolvedAppearance: () => "light",
}));
vi.mock("./translation", () => ({
  hasTranslationModel: () => true,
  TRANSLATION_SOURCE_LANGUAGES: ["auto"],
  TRANSLATION_TARGET_LANGUAGES: ["auto"],
  translateBotMessage: vi.fn(),
  translationSourceLabel: (code: string) => code,
  translationTargetLabel: (code: string) => code,
}));
vi.mock("./user-error", () => ({ errorText: (_err: unknown, fallback: string) => fallback }));
vi.mock("./appearance", () => ({
  mobileTokens: () => ({ muted: "grey", mutedForeground: "muted", foreground: "ink" }),
}));
vi.mock("./artifact-open", () => ({
  imageArtifactPreview: vi.fn(() =>
    Promise.resolve({ uri: "file://test.png", size: { width: 200, height: 100 } }),
  ),
}));
vi.mock("../components/bottom-sheet-shell", () => ({
  BottomSheetShell: () => null,
  SheetHeader: () => null,
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));

import { InlineImageAttachment } from "../components/inline-image-attachment";
import type { MessageTranslation } from "../components/thread/message-translation";
import { MessageTranslationView } from "../components/thread/message-translation";

afterEach(() => {
  vi.useRealTimers();
});

async function renderEl(element: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    text: () => container.textContent ?? "",
    hasImage: () => Boolean(container.querySelector("rn-image")),
    clickByLabel: async (label: string) => {
      await act(async () => {
        (
          container.querySelector(`rn-pressable[aria-label="${label}"]`) as HTMLElement | null
        )?.click();
      });
    },
    flush: async () => {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount: () => act(async () => root.unmount()),
  };
}

function fakeTranslation(overrides: Partial<MessageTranslation>): MessageTranslation {
  return {
    status: "done",
    result: {
      translatedText: "Hola mundo",
      sourceLanguage: "en",
      targetLanguage: "es",
      modelId: "deepseek-flash",
      usedFallback: false,
    },
    error: null,
    expanded: true,
    translate: vi.fn(),
    collapse: vi.fn(),
    expand: vi.fn(),
    settings: {
      modelProvider: null,
      modelId: null,
      sourceLanguage: "auto",
      targetLanguage: "auto",
      autoTranslate: false,
      showTranslationActions: true,
    },
    switchLanguage: vi.fn(),
    languageApplying: false,
    languageError: null,
    ...overrides,
  };
}

it("a folded translation keeps a slim row and reopens without re-translating", async () => {
  const translation = fakeTranslation({ expanded: false });
  const view = await renderEl(<MessageTranslationView translation={translation} />);
  expect(view.text()).toContain("Translate");
  expect(view.text()).toContain("Show");
  expect(view.text()).not.toContain("Hola mundo");
  await view.clickByLabel("Show");
  expect(translation.expand).toHaveBeenCalledTimes(1);
  expect(translation.translate).not.toHaveBeenCalled();
  await view.unmount();
});

it("an expanded translation shows its text and folds with Collapse", async () => {
  const translation = fakeTranslation({ expanded: true });
  const view = await renderEl(<MessageTranslationView translation={translation} />);
  expect(view.text()).toContain("Hola mundo");
  expect(view.text()).toContain("Collapse");
  await view.clickByLabel("Collapse");
  expect(translation.collapse).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it("a generated image folds to its file name and opens again", async () => {
  const onOpen = vi.fn();
  const view = await renderEl(
    <InlineImageAttachment
      threadTarget={{ botId: "bot-1" }}
      artifactId="art-1"
      name="gen-1.png"
      mimeType="image/png"
      onOpen={onOpen}
      labelColor="ink"
      collapsible
    />,
  );
  await view.flush();
  expect(view.hasImage()).toBe(true);
  expect(view.text()).toContain("Collapse");
  await view.clickByLabel("Collapse");
  expect(view.hasImage()).toBe(false);
  expect(view.text()).toContain("gen-1.png");
  expect(view.text()).toContain("Show");
  await view.clickByLabel("Show");
  expect(view.hasImage()).toBe(true);
  await view.unmount();
});

it("a sent image has no fold button", async () => {
  const view = await renderEl(
    <InlineImageAttachment
      threadTarget={{ botId: "bot-1" }}
      artifactId="art-1"
      name="photo.png"
      mimeType="image/png"
      onOpen={() => {}}
      labelColor="ink"
    />,
  );
  await view.flush();
  expect(view.hasImage()).toBe(true);
  expect(view.text()).not.toContain("Collapse");
  await view.unmount();
});
