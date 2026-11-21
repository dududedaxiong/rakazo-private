// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const picked = vi.hoisted(() => ({
  role: null as string | null,
  editRole: null as string | null,
  preset: null as { role: string; name: string | null } | null,
  presetsChange: null as { role: string; count: number } | null,
  saveDirectory: null as { role: string; value: string | null } | null,
  toggle: null as { action: string; value: boolean } | null,
  translationSource: null as string | null,
  translationTarget: null as string | null,
  autoTranslate: null as boolean | null,
  translationActions: null as boolean | null,
  removed: null as { list: string; entry: { provider: string; model: string } } | null,
}));

vi.mock("./appearance", () => ({
  mobileTokens: () => ({
    foreground: "#111111",
    mutedForeground: "#666666",
    border: "#dddddd",
    link: "#2f6bff",
    destructiveFill: "#ff0000",
    destructiveForeground: "#ffffff",
  }),
}));
// The sheet reads translation helpers, which import the API client; the
// client pulls expo-secure-store, which needs the native __DEV__ global.
vi.mock("./api", () => ({ rpc: vi.fn() }));
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
vi.mock("./i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
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
  TextInput: ({
    value,
    onChangeText,
    onBlur,
    onSubmitEditing,
    accessibilityLabel,
    placeholder,
  }: {
    value?: string;
    onChangeText?: (text: string) => void;
    onBlur?: () => void;
    onSubmitEditing?: () => void;
    accessibilityLabel?: string;
    placeholder?: string;
  }) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      placeholder,
      value: value ?? "",
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
      onBlur: () => onBlur?.(),
      onKeyDown: (event: { key: string }) => {
        if (event.key === "Enter") onSubmitEditing?.();
      },
    }),
}));
vi.mock("../components/bottom-sheet-shell", () => ({
  BottomSheetShell: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-testid": "media-sheet" }, children),
  SheetHeader: ({ title }: { title: string }) => createElement("div", null, title),
}));
vi.mock("../components/row-accessories", () => ({
  Chevron: () => createElement("span", null, "›"),
}));
vi.mock("../components/native-switch", () => ({
  NativeSwitch: ({
    value,
    onValueChange,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: (next: boolean) => void;
    accessibilityLabel?: string;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": accessibilityLabel,
        "aria-pressed": value,
        onClick: () => onValueChange(!value),
      },
      accessibilityLabel,
    ),
}));
vi.mock("../components/menu-picker", () => ({
  MenuPicker: ({
    label,
    choices,
    value,
    onChange,
  }: {
    label: string;
    choices: { key: string; label: string }[];
    value: string;
    onChange: (key: string) => void;
  }) =>
    createElement(
      "div",
      { "aria-label": label },
      createElement(
        "span",
        null,
        `${label}: ${choices.find((choice) => choice.key === value)?.label ?? value}`,
      ),
      choices.map((choice) =>
        createElement(
          "button",
          { key: choice.key, type: "button", onClick: () => onChange(choice.key) },
          choice.label,
        ),
      ),
    ),
}));
vi.mock("../components/thread/prompt-preset-section", () => ({
  PromptPresetSection: ({
    presets,
    active,
    onActiveChange,
    onChange,
  }: {
    presets: { name: string; prompt: string }[];
    active: string | null;
    onActiveChange: (name: string | null) => void;
    onChange: (next: { name: string; prompt: string }[]) => void;
  }) =>
    createElement(
      "div",
      null,
      presets.map((preset) =>
        createElement(
          "button",
          {
            key: preset.name,
            type: "button",
            onClick: () => onActiveChange(preset.name),
          },
          `${active === preset.name ? "✓ " : ""}${preset.name}`,
        ),
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onChange([...presets, { name: "New", prompt: "p" }]),
        },
        "New preset",
      ),
    ),
}));

import { ThreadMediaModelSheet } from "../components/thread/thread-media-model-sheet";

const catalog = [
  { provider: "provider-a", id: "video-a", label: "Video A", billing: "metered" },
  { provider: "provider-a", id: "video-b", label: "Video B", billing: "metered" },
  { provider: "provider-a", id: "video-c", label: "Video C", billing: "metered" },
  { provider: "provider-a", id: "image-a", label: "Image A", billing: "metered" },
  { provider: "provider-a", id: "translation-a", label: "Translation A", billing: "metered" },
  { provider: "provider-a", id: "translation-b", label: "Translation B", billing: "metered" },
];

let root: Root;
let node: HTMLDivElement;

async function mountSheet(
  options: {
    video?: { provider: string | null; modelId: string | null };
    image?: { provider: string | null; modelId: string | null };
    videoModels?: { provider: string; model: string }[] | null;
    imageModels?: { provider: string; model: string }[] | null;
    videoEdit?: { provider: string | null; modelId: string | null };
    imageEdit?: { provider: string | null; modelId: string | null };
    videoEditModels?: { provider: string; model: string }[] | null;
    imageEditModels?: { provider: string; model: string }[] | null;
    videoPresets?: { name: string; prompt: string }[] | null;
    imagePresets?: { name: string; prompt: string }[] | null;
    activeVideoPreset?: string | null;
    activeImagePreset?: string | null;
    videoSaveDirectory?: string | null;
    imageSaveDirectory?: string | null;
    translation?: { provider: string | null; modelId: string | null };
    translationModels?: { provider: string; model: string }[] | null;
    translationSource?: "auto" | "zh" | "en" | "ja" | "ko";
    translationTarget?:
      | "auto"
      | "zh"
      | "en"
      | "ja"
      | "ko"
      | "fr"
      | "de"
      | "es"
      | "pt"
      | "ru"
      | "ar";
    autoTranslate?: boolean;
    showTranslationActions?: boolean;
    showMediaFavorite?: boolean;
    showMediaShare?: boolean;
    showMediaPreview?: boolean;
    showMediaDownload?: boolean;
  } = {},
) {
  await act(async () =>
    root.render(
      <ThreadMediaModelSheet
        visible
        catalog={catalog as never}
        video={options.video ?? { provider: "provider-a", modelId: "video-a" }}
        image={options.image ?? { provider: "provider-a", modelId: "image-a" }}
        videoModels={options.videoModels ?? [{ provider: "provider-a", model: "video-a" }]}
        imageModels={options.imageModels ?? [{ provider: "provider-a", model: "image-a" }]}
        videoEdit={options.videoEdit ?? { provider: null, modelId: null }}
        imageEdit={options.imageEdit ?? { provider: null, modelId: null }}
        videoEditModels={options.videoEditModels ?? []}
        imageEditModels={options.imageEditModels ?? []}
        videoPresets={options.videoPresets ?? null}
        imagePresets={options.imagePresets ?? null}
        activeVideoPreset={options.activeVideoPreset ?? null}
        activeImagePreset={options.activeImagePreset ?? null}
        videoSaveDirectory={options.videoSaveDirectory ?? null}
        imageSaveDirectory={options.imageSaveDirectory ?? null}
        translation={options.translation ?? { provider: "provider-a", modelId: "translation-a" }}
        translationModels={
          options.translationModels ?? [{ provider: "provider-a", model: "translation-a" }]
        }
        translationSource={options.translationSource ?? "auto"}
        translationTarget={options.translationTarget ?? "auto"}
        autoTranslate={options.autoTranslate ?? false}
        showTranslationActions={options.showTranslationActions ?? true}
        showMediaFavorite={options.showMediaFavorite ?? true}
        showMediaShare={options.showMediaShare ?? true}
        showMediaPreview={options.showMediaPreview ?? true}
        showMediaDownload={options.showMediaDownload ?? true}
        onPickRole={(role) => {
          picked.role = role;
        }}
        onPickEditRole={(role) => {
          picked.editRole = role === "video" ? "videoEdit" : "imageEdit";
        }}
        onPickTranslation={() => {
          picked.role = "translation";
        }}
        onRemoveModel={(list, entry) => {
          picked.removed = { list, entry };
        }}
        onTranslationSourceChange={(source) => {
          picked.translationSource = source;
        }}
        onTranslationTargetChange={(target) => {
          picked.translationTarget = target;
        }}
        onToggleAutoTranslate={(value) => {
          picked.autoTranslate = value;
        }}
        onToggleTranslationActions={(value) => {
          picked.translationActions = value;
        }}
        onPickPreset={(role, name) => {
          picked.preset = { role, name };
        }}
        onPresetsChange={(role, next) => {
          picked.presetsChange = { role, count: next.length };
        }}
        onSaveDirectory={(role, value) => {
          picked.saveDirectory = { role, value };
        }}
        onToggleMediaAction={(action, value) => {
          picked.toggle = { action, value };
        }}
        onClose={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  picked.role = null;
  picked.editRole = null;
  picked.preset = null;
  picked.presetsChange = null;
  picked.saveDirectory = null;
  picked.toggle = null;
  picked.translationSource = null;
  picked.translationTarget = null;
  picked.autoTranslate = null;
  picked.translationActions = null;
  picked.removed = null;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("ThreadMediaModelSheet", () => {
  it("shows the current video and image models", async () => {
    await mountSheet();
    expect(node.textContent).toContain("Video generation model");
    expect(node.textContent).toContain("Video A");
    expect(node.textContent).toContain("Image generation model");
    expect(node.textContent).toContain("Image A");
  });

  it("shows the edit model rows after the generation rows and before the presets", async () => {
    await mountSheet({
      videoEdit: { provider: "provider-a", modelId: "video-a" },
      imageEdit: { provider: "provider-a", modelId: "image-a" },
      videoEditModels: [{ provider: "provider-a", model: "video-a" }],
      imageEditModels: [{ provider: "provider-a", model: "image-a" }],
    });
    const text = node.textContent ?? "";
    expect(text).toContain("Video edit model");
    expect(text).toContain("Image edit model");
    expect(
      text.indexOf("Video generation model") < text.indexOf("Video edit model") &&
        text.indexOf("Video edit model") < text.indexOf("Video prompt presets"),
    ).toBe(true);
    expect(
      text.indexOf("Image generation model") < text.indexOf("Image edit model") &&
        text.indexOf("Image edit model") < text.indexOf("Image prompt presets"),
    ).toBe(true);
  });

  it("shows Not set for unset edit models and opens the edit picker on tap", async () => {
    await mountSheet();
    const videoRow = node.querySelector<HTMLButtonElement>(
      '[aria-label="Video edit model: Not set"]',
    );
    expect(videoRow).not.toBeNull();
    await act(async () => videoRow!.click());
    expect(picked.editRole).toBe("videoEdit");
    const imageRow = node.querySelector<HTMLButtonElement>(
      '[aria-label="Image edit model: Not set"]',
    );
    expect(imageRow).not.toBeNull();
    await act(async () => imageRow!.click());
    expect(picked.editRole).toBe("imageEdit");
  });

  it("numbers edit fallback models and offers Add edit backup", async () => {
    await mountSheet({
      videoEdit: { provider: "provider-a", modelId: "video-a" },
      videoEditModels: [
        { provider: "provider-a", model: "video-a" },
        { provider: "provider-a", model: "video-b" },
        { provider: "provider-a", model: "video-c" },
      ],
    });
    expect(node.textContent).toContain("2. Video B");
    expect(node.textContent).toContain("3. Video C");
    expect(node.textContent).toContain("Add video edit backup");
    const fallbackRow = node.querySelector<HTMLButtonElement>('[aria-label="Fallback 2: Video B"]');
    expect(fallbackRow).not.toBeNull();
    await act(async () => fallbackRow!.click());
    expect(picked.editRole).toBe("videoEdit");
  });

  it("shows Not set for an unpicked role and opens its picker on tap", async () => {
    await mountSheet({
      video: { provider: null, modelId: null },
      videoModels: null,
    });
    expect(node.textContent).toContain("Not set");
    const videoRow = node.querySelector<HTMLButtonElement>(
      '[aria-label="Video generation model: Not set"]',
    );
    expect(videoRow).not.toBeNull();
    await act(async () => videoRow!.click());
    expect(picked.role).toBe("video");
  });

  it("renders nothing when hidden", async () => {
    await act(async () =>
      root.render(
        <ThreadMediaModelSheet
          visible={false}
          catalog={catalog as never}
          video={{ provider: null, modelId: null }}
          image={{ provider: null, modelId: null }}
          videoModels={null}
          imageModels={null}
          videoEdit={{ provider: null, modelId: null }}
          imageEdit={{ provider: null, modelId: null }}
          videoEditModels={null}
          imageEditModels={null}
          videoPresets={null}
          imagePresets={null}
          activeVideoPreset={null}
          activeImagePreset={null}
          videoSaveDirectory={null}
          imageSaveDirectory={null}
          translation={{ provider: null, modelId: null }}
          translationModels={null}
          translationSource="auto"
          translationTarget="auto"
          autoTranslate={false}
          showTranslationActions
          showMediaFavorite
          showMediaShare
          showMediaPreview
          showMediaDownload
          onPickRole={() => {}}
          onPickEditRole={() => {}}
          onPickTranslation={() => {}}
          onRemoveModel={() => {}}
          onTranslationSourceChange={() => {}}
          onTranslationTargetChange={() => {}}
          onToggleAutoTranslate={() => {}}
          onToggleTranslationActions={() => {}}
          onPickPreset={() => {}}
          onPresetsChange={() => {}}
          onSaveDirectory={() => {}}
          onToggleMediaAction={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    expect(node.textContent).toBe("");
  });

  it("numbers fallback models and offers Add backup", async () => {
    await mountSheet({
      videoModels: [
        { provider: "provider-a", model: "video-a" },
        { provider: "provider-a", model: "video-b" },
        { provider: "provider-a", model: "video-c" },
      ],
    });
    expect(node.textContent).toContain("2. Video B");
    expect(node.textContent).toContain("3. Video C");
    expect(node.textContent).toContain("Add video backup");
    const fallbackRow = node.querySelector<HTMLButtonElement>('[aria-label="Fallback 2: Video B"]');
    expect(fallbackRow).not.toBeNull();
    await act(async () => fallbackRow!.click());
    expect(picked.role).toBe("video");
  });

  it("reveals a Remove action on fallback rows and removes the tapped one", async () => {
    await mountSheet({
      videoModels: [
        { provider: "provider-a", model: "video-a" },
        { provider: "provider-a", model: "video-b" },
        { provider: "provider-a", model: "video-c" },
      ],
    });
    const removeButtons = [...node.querySelectorAll<HTMLButtonElement>('[aria-label="Remove"]')];
    expect(removeButtons).toHaveLength(2);
    await act(async () => removeButtons[0]!.click());
    expect(picked.removed).toEqual({
      list: "video",
      entry: { provider: "provider-a", model: "video-b" },
    });
  });

  it("offers no Remove action when a list has no fallbacks", async () => {
    await mountSheet();
    expect(node.querySelector('[aria-label="Remove"]')).toBeNull();
  });

  it("removes a translation fallback from its own list", async () => {
    await mountSheet({
      translationModels: [
        { provider: "provider-a", model: "translation-a" },
        { provider: "provider-a", model: "translation-b" },
      ],
    });
    const removeButtons = [...node.querySelectorAll<HTMLButtonElement>('[aria-label="Remove"]')];
    expect(removeButtons).toHaveLength(1);
    await act(async () => removeButtons[0]!.click());
    expect(picked.removed).toEqual({
      list: "translation",
      entry: { provider: "provider-a", model: "translation-b" },
    });
  });

  it("shows the active preset and picks another on tap", async () => {
    await mountSheet({
      videoPresets: [
        { name: "水彩", prompt: "用水彩风格画" },
        { name: "赛博", prompt: "赛博朋克风格" },
      ],
      activeVideoPreset: "水彩",
    });
    const presetRow = node.querySelector<HTMLButtonElement>(
      '[aria-label="Video prompt presets: 水彩"]',
    );
    expect(presetRow).not.toBeNull();
    await act(async () => presetRow!.click());
    const option = [...node.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("赛博"),
    );
    expect(option).not.toBeUndefined();
    await act(async () => option!.click());
    expect(picked.preset).toEqual({ role: "video", name: "赛博" });
  });

  it("shows both settings sections and the actions section", async () => {
    await mountSheet();
    expect(node.textContent).toContain("Image generation settings");
    expect(node.textContent).toContain("Video generation settings");
    expect(node.textContent).toContain("Generated media actions");
    expect(node.textContent).toContain("Save directory");
  });

  it("saves the image directory on blur", async () => {
    await mountSheet();
    const inputs = [...node.querySelectorAll("input")];
    // The image section comes first, so its directory input is first.
    const input = inputs[0]!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!
      .set!;
    await act(async () => {
      setter.call(input, "MyAlbum");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React's onBlur listens for focusout, which jsdom's blur() does not fire.
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(picked.saveDirectory).toEqual({ role: "image", value: "MyAlbum" });
  });

  it("toggles a generated-media action", async () => {
    await mountSheet({ showMediaFavorite: true });
    const toggle = node.querySelector<HTMLButtonElement>('[aria-label="Favorite"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle!.click());
    expect(picked.toggle).toEqual({ action: "favorite", value: false });
  });

  it("puts the translation section after video and before the actions", async () => {
    await mountSheet();
    const text = node.textContent ?? "";
    expect(text).toContain("Translation settings");
    expect(text).toContain("Translation model");
    expect(text).toContain("Translation A");
    expect(
      text.indexOf("Image generation settings") < text.indexOf("Video generation settings") &&
        text.indexOf("Video generation settings") < text.indexOf("Translation settings") &&
        text.indexOf("Translation settings") < text.indexOf("Generated media actions"),
    ).toBe(true);
  });

  it("numbers translation fallbacks and opens its picker on tap", async () => {
    await mountSheet({
      translationModels: [
        { provider: "provider-a", model: "translation-a" },
        { provider: "provider-a", model: "translation-b" },
      ],
    });
    expect(node.textContent).toContain("2. Translation B");
    expect(node.textContent).toContain("Add translation backup");
    const translationRow = node.querySelector<HTMLButtonElement>(
      '[aria-label="Translation model: Translation A"]',
    );
    expect(translationRow).not.toBeNull();
    await act(async () => translationRow!.click());
    expect(picked.role).toBe("translation");
  });

  it("shows the translation direction and picks a source language", async () => {
    await mountSheet();
    expect(node.textContent).toContain("Translation direction");
    expect(node.textContent).toContain("自动检测 → 自动");
    const chip = node.querySelector<HTMLButtonElement>('[aria-label="中文"]');
    expect(chip).not.toBeNull();
    await act(async () => chip!.click());
    expect(picked.translationSource).toBe("zh");
  });

  it("picks a target language", async () => {
    await mountSheet();
    expect(node.textContent).toContain("Target language: 自动（跟随系统语言）");
    const option = [...node.querySelectorAll("button")].find(
      (button) => button.textContent === "法语",
    );
    expect(option).not.toBeUndefined();
    await act(async () => option!.click());
    expect(picked.translationTarget).toBe("fr");
  });

  it("toggles auto-translate and translation actions", async () => {
    await mountSheet({ autoTranslate: false, showTranslationActions: true });
    const autoToggle = node.querySelector<HTMLButtonElement>('[aria-label="Auto-translate"]');
    expect(autoToggle).not.toBeNull();
    expect(autoToggle!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => autoToggle!.click());
    expect(picked.autoTranslate).toBe(true);
    const actionsToggle = node.querySelector<HTMLButtonElement>(
      '[aria-label="Show read-aloud, share, and favorite on translations"]',
    );
    expect(actionsToggle).not.toBeNull();
    expect(actionsToggle!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => actionsToggle!.click());
    expect(picked.translationActions).toBe(false);
  });
});
