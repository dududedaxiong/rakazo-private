// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import { ORPCError } from "@orpc/client";
import type { Bot, BotAvatarSet } from "@rakazo_mickvvw/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/rpc", () => {
  const rpc = {
    bots: {
      get: vi.fn(),
      update: vi.fn(),
      restoreInstructions: vi.fn(),
      testTranslationModel: vi.fn(),
      // This server receives no email, so the panel offers no address.
      emailAddress: vi.fn(async () => null),
    },
    voice: { voices: vi.fn().mockResolvedValue([]) },
    models: {
      credentials: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
    },
    me: vi.fn().mockResolvedValue(null),
  };
  return {
    rpc,
    rpcForSpace: () => rpc,
    createSpaceRpc: () => rpc,
    selectedSpaceId: () => null,
  };
});
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo_mickvvw/ui-web", () => ({
  useCopyText: () => [false, () => {}],
  Disclosure: ({
    summary,
    children,
    defaultOpen: _defaultOpen,
    open: _open,
    onOpenChange: _onOpenChange,
    ...props
  }: {
    summary?: ReactNode;
    children?: ReactNode;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } & ComponentProps<"div">) => (
    <div {...props}>
      {summary}
      {children}
    </div>
  ),
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? children : null,
  DialogContent: (props: ComponentProps<"div">) => <div {...props} />,
  DialogTitle: (props: ComponentProps<"div">) => <div {...props} />,
  SectionHeading: ({
    variant: _variant,
    ...props
  }: ComponentProps<"h3"> & { variant?: string }) => <h3 {...props} />,
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  Switch: ({
    onCheckedChange,
    checked,
    ...props
  }: ComponentProps<"button"> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
  Toggle: ({
    onPressedChange,
    pressed,
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & {
    variant?: string;
    size?: string;
    pressed?: boolean;
    onPressedChange?: (pressed: boolean) => void;
  }) => (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange?.(!pressed)}
      {...props}
    >
      {props.children}
    </button>
  ),
  Tabs: ({
    value: _value,
    onValueChange: _onValueChange,
    ...props
  }: ComponentProps<"div"> & { value?: string; onValueChange?: (value: string) => void }) => (
    <div {...props} />
  ),
  TabsList: (props: ComponentProps<"div">) => <div role="tablist" {...props} />,
  TabsTrigger: ({ value: _value, ...props }: ComponentProps<"button"> & { value: string }) => (
    <button type="button" role="tab" {...props} />
  ),
  TabsContent: ({ value: _value, ...props }: ComponentProps<"div"> & { value: string }) => (
    <div {...props} />
  ),
}));
vi.mock("./avatar-studio-popover", () => ({
  AvatarStudioPopover: ({
    value,
    avatarSet,
    onChange,
  }: {
    value: string;
    avatarSet?: BotAvatarSet;
    onChange: (value: string, avatarSet?: BotAvatarSet) => void;
  }) => (
    <>
      <button
        type="button"
        aria-label="Avatar color"
        data-color={value}
        onClick={() => onChange(value === "blue" ? "ink" : "blue")}
      />
      <button
        type="button"
        aria-label="Avatar set"
        data-avatar-set={avatarSet}
        data-color={value}
        onClick={() => onChange("#F97316", avatarSet === "rakazo" ? "organic" : "rakazo")}
      />
    </>
  ),
}));
vi.mock("../ScratchpadSection", () => ({ ScratchpadSection: () => <h3>Open work</h3> }));
vi.mock("../KnowledgeSection", () => ({
  KnowledgeSection: () => <h3>Memory and skills</h3>,
}));

import { InstructionSettings } from "../../components/InstructionSettings";
import { spaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { BotSettings } from "./bot-panel";

const longInstructions = "I".repeat(4_000);

function bot(description = "Billing", overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    spaceId: "space-1",
    name: "Ada",
    title: "Helper",
    description,
    instructions: longInstructions,
    color: "ink",
    notifyOnFinish: true,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: "thread-1",
    preview: "",
    status: "idle",
    runErrorId: null,
    computerMode: "team",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    translationModels: null,
    translationMainModels: null,
    translationBackupModels: null,
    videoModels: null,
    videoMainModels: null,
    videoBackupModels: null,
    imageModels: null,
    imageMainModels: null,
    imageBackupModels: null,
    videoEditModels: null,
    videoEditMainModels: null,
    videoEditBackupModels: null,
    imageEditModels: null,
    imageEditMainModels: null,
    imageEditBackupModels: null,
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
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    fleetManagement: false,
    replyMode: "chat",
    disabledBuiltinTools: [],
    webhookConfigured: false,
    spawnKey: null,
    promptTemplateId: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const onSave = vi.fn(
  async (_patch: Parameters<ComponentProps<typeof BotSettings>["onSave"]>[0]) => undefined,
);
const onExport = vi.fn(async () => undefined);

async function render(
  description = "Billing",
  overrides: Partial<Bot> = {},
  memoryProviderConfigured = false,
  focusModel = 0,
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BotSettings
          onOpenConnections={() => undefined}
          focusModel={focusModel}
          bot={bot(description, overrides)}
          memoryProviderConfigured={memoryProviderConfigured}
          onSave={onSave}
          onExport={onExport}
          onClear={() => undefined}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function descriptionField(): HTMLTextAreaElement {
  const textarea =
    container.querySelector<HTMLTextAreaElement>('textarea[id$="-description"]') ??
    container.querySelector("textarea");
  if (!textarea) throw new Error("Missing description field");
  return textarea;
}

async function setDescription(value: string) {
  const textarea = descriptionField();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickSave() {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Save",
  );
  await act(async () => {
    if (button) button.click();
    else container.querySelector<HTMLButtonElement>('button[id$="-notify-finish"]')!.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSave.mockReset().mockResolvedValue(undefined);
  onExport.mockReset().mockResolvedValue(undefined);
  vi.mocked(rpc.bots.update).mockReset();
  vi.mocked(rpc.bots.get).mockReset();
  vi.mocked(rpc.bots.testTranslationModel).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

it("shows the profile and the Advanced tab's controls", async () => {
  vi.mocked(rpc.voice.voices).mockResolvedValueOnce([
    { id: "fixture-voice", label: "Fixture voice" },
  ]);
  await render("Billing", {}, true);
  expect(container.querySelector('[data-testid="bot-profile-header"]')?.textContent).toContain(
    "Ada",
  );
  expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
  expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
    "Computer",
    "Routines",
    "Pages",
    "Persona",
    "Advanced",
  ]);
  expect(
    [...container.querySelectorAll("button")].some((button) => button.textContent === "Save"),
  ).toBe(false);
  const advanced = container.querySelector<HTMLElement>('[data-testid="bot-settings-advanced"]')!;
  expect(advanced.querySelector('textarea[id$="-instructions"]')).not.toBeNull();
  expect(
    container
      .querySelector('[id$="-disabled-tools"]')
      ?.closest("section")
      ?.getAttribute("data-testid"),
  ).toBe("bot-settings-tools");
  const labels = {
    model: "Model",
    computer: "Computer",
    memoryScope: "Memory scope",
    voice: "Voice",
    readAloud: "Read replies aloud",
    fleetManagement: "Manage other bots",
    replyMode: "Replies",
  };
  const controls = [...advanced.querySelectorAll("h3, span, label, div")].flatMap((node) =>
    Object.entries(labels)
      .filter(([, label]) =>
        [...node.childNodes].some(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent === label,
        ),
      )
      .map(([key]) => key),
  );
  expect([...new Set(controls)]).toEqual([
    "model",
    "computer",
    "memoryScope",
    "voice",
    "readAloud",
    "fleetManagement",
    "replyMode",
  ]);
});

describe("BotSettings model choices", () => {
  it("offers an email address under the name until the bot has one", async () => {
    vi.mocked(rpc.bots.emailAddress).mockResolvedValueOnce({ domain: "bots.test", address: null });
    await render();
    const offer = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Get an email address",
    );
    expect(document.querySelector('[data-testid="bot-email"]')).toBeNull();
    await act(async () => offer?.click());
    expect(document.querySelector<HTMLInputElement>('[data-testid="bot-email"] input')?.value).toBe(
      "ada",
    );

    vi.mocked(rpc.bots.emailAddress).mockResolvedValueOnce({
      domain: "bots.test",
      address: "scout@bots.test",
    });
    queryClient.clear();
    await render();
    expect(document.querySelector('[data-testid="bot-email"]')?.textContent).toContain(
      "scout@bots.test",
    );
  });

  it("submits DeepSeek API ids and does not offer a display label", async () => {
    vi.mocked(rpc.models.credentials).mockResolvedValueOnce([
      {
        id: "cred-deepseek",
        provider: "deepseek",
        label: "DeepSeek",
        hasKey: true,
        isDefault: true,
        modelId: "DeepSeek-V4.1-Flash",
      },
    ]);
    vi.mocked(rpc.models.list).mockResolvedValueOnce([
      {
        provider: "deepseek",
        providerName: "DeepSeek",
        id: "deepseek-flash",
        label: "DeepSeek V4.1 Flash",
        billing: "",
      },
      {
        provider: "deepseek",
        providerName: "DeepSeek",
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        billing: "",
      },
    ]);
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="bot-settings-advanced"] button')!
        .click(),
    );
    const model = container.querySelector('[id$="-model"]');
    if (!(model instanceof HTMLSelectElement)) throw new Error("Missing model select");
    const values = [...model.options].map((option) => option.value);
    expect(values).toContain("deepseek::deepseek-flash");
    expect(values).toContain("deepseek::deepseek-v4-pro");
    expect(values).not.toContain("deepseek::DeepSeek-V4.1-Flash");
    expect(values.some((value) => value.includes("DeepSeek"))).toBe(false);
  });
});

describe("BotSettings thinking options", () => {
  it("preserves saved thinking on a profile save when options are hidden", async () => {
    await render("Billing", {
      modelProvider: "openai-compatible",
      modelId: "beta",
      thinkingLevel: "high",
    });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("thinkingLevel");
  });

  it("shows the connection's thinking levels for a bot on a second enabled model", async () => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.mocked(rpc.models.credentials).mockResolvedValueOnce([
      {
        id: "newer",
        provider: "openai-compatible",
        label: "Newer",
        hasKey: true,
        isDefault: false,
        enabledModelIds: ["beta"],
        thinkingLevels: ["off"],
      },
      {
        id: "cred-compatible",
        provider: "openai-compatible",
        label: "Local server",
        hasKey: true,
        isDefault: true,
        modelId: "alpha",
        enabledModelIds: ["alpha", "beta"],
        thinkingLevels: ["off", "low", "high"],
      },
    ]);
    await render("Billing", { modelProvider: "openai-compatible", modelId: "beta" });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="bot-settings-advanced"] button')!
        .click(),
    );
    const [model, thinking] = [...container.querySelectorAll('[id$="-model"], [id$="-thinking"]')];
    if (!(model instanceof HTMLSelectElement)) throw new Error("Missing model select");
    expect(model.value).toBe("openai-compatible::beta");
    if (!(thinking instanceof HTMLSelectElement)) throw new Error("Missing thinking select");
    expect([...thinking.options].map((option) => option.value)).toEqual(["", "low", "high"]);
  });
});

describe("BotSettings bot management saves", () => {
  it("cannot restore a stale enabled value when another session disables it", async () => {
    await render("Billing", { fleetManagement: true });
    await render("Billing", { fleetManagement: false });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("fleetManagement");
  });

  it("restores the toggle when the immediate save fails", async () => {
    await render();
    onSave.mockRejectedValueOnce(new Error("offline"));
    const toggle = container.querySelector<HTMLButtonElement>('button[id$="-fleet-management"]');
    if (!toggle) throw new Error("Missing switch");
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("shows a failed export instead of leaving it unhandled", async () => {
    await render();
    onExport.mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { status: 502 }));
    const exportButton = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Export",
    );
    if (!exportButton) throw new Error("Missing export");
    await act(async () => {
      exportButton.click();
    });
    expect(container.textContent).toContain("Could not reach the server");
  });

  it.each([false, true])("saves only the bot management toggle from %s", async (enabled) => {
    await render("Billing", { fleetManagement: enabled });
    const toggle = container.querySelector<HTMLButtonElement>('button[id$="-fleet-management"]');
    if (!toggle) throw new Error("Missing switch");
    await act(async () => {
      toggle.click();
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fleetManagement: !enabled });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("fleetManagement");
  });

  it("saves only the reply mode when it changes", async () => {
    await render();
    const select = container.querySelector<HTMLSelectElement>('select[id$="-reply-mode"]');
    if (!select) throw new Error("Missing reply mode");
    await act(async () => {
      select.value = "messages";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ replyMode: "messages" });
  });
});

describe("BotSettings description saves", () => {
  it("leaves instructions off a save that does not edit the description", async () => {
    await render();
    await clickSave();
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("description");
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("instructions");
  });

  it("does not resend instructions when the bot prop stays on the old description", async () => {
    await render();
    await setDescription("Invoices");
    await clickSave();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      description: "Invoices",
    });
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("instructions");

    // The parent still passes the description from when the panel opened.
    await render();
    await clickSave();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).not.toHaveProperty("description");
    expect(onSave.mock.calls[1]?.[0]).not.toHaveProperty("instructions");
  });

  it("still saves a description edited back to the stale prop value", async () => {
    await render();
    await setDescription("Invoices");
    await clickSave();
    await render();
    await setDescription("Billing");
    await clickSave();
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({
      description: "Billing",
    });
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("instructions");
  });

  it("keeps the previous description as the baseline when a save fails", async () => {
    onSave.mockRejectedValueOnce(new Error("offline"));
    await render();
    await setDescription("Invoices");
    await clickSave();
    await clickSave();
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({
      description: "Invoices",
    });
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("instructions");
  });
});

describe("instruction settings refresh", () => {
  it("refreshes a saved field against its latest baseline before the parent catches up", async () => {
    const initial = bot();
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({ ...initial, instructions: "Saved edit" });
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Saved edit");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      root.render(<InstructionSettings bot={{ ...initial, instructions: "External update" }} />);
    });
    expect(descriptionField().value).toBe("External update");
    await setDescription("Fresh edit");
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({ ...initial, instructions: "Fresh edit" });
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenLastCalledWith({
      botId: initial.id,
      instructions: "Fresh edit",
      expectedInstructions: "External update",
    });
  });
  it("keeps a dirty draft when run completion refreshes the bot", async () => {
    const initial = bot();
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Unsaved instructions");
    await act(async () => {
      root.render(
        <InstructionSettings bot={{ ...initial, updatedAt: "2026-09-02T00:00:00.000Z" }} />,
      );
    });
    expect(descriptionField().value).toBe("Unsaved instructions");
  });
  it("saves the original draft baseline after a newer instruction refresh", async () => {
    const initial = bot();
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({
      ...initial,
      instructions: "Unsaved instructions",
    });
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Unsaved instructions");
    await act(async () => {
      root.render(
        <InstructionSettings bot={{ ...initial, instructions: "Newer saved instructions" }} />,
      );
    });
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenCalledWith({
      botId: initial.id,
      instructions: "Unsaved instructions",
      expectedInstructions: initial.instructions,
    });
  });
  it("reloads the current instructions and baseline after a conflict", async () => {
    const initial = bot();
    vi.mocked(rpc.bots.update).mockRejectedValueOnce(
      new ORPCError("CONFLICT", { message: "Instructions changed" }),
    );
    vi.mocked(rpc.bots.get)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ...initial,
        instructions: "Newer saved instructions",
      });
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Unsaved instructions");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    const reload = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload",
    );
    if (!reload) throw new Error("Missing reload action");
    expect(descriptionField().value).toBe("Unsaved instructions");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      reload.click();
    });
    expect(descriptionField().value).toBe("Unsaved instructions");
    expect(container.textContent).toContain("Reload");
    await act(async () => {
      reload.click();
    });
    expect(descriptionField().value).toBe("Newer saved instructions");
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({ ...initial, instructions: "Fresh draft" });
    await setDescription("Fresh draft");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenLastCalledWith({
      botId: initial.id,
      instructions: "Fresh draft",
      expectedInstructions: "Newer saved instructions",
    });
  });
  it("refreshes pristine instructions after an external update", async () => {
    const initial = bot();
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await act(async () => {
      root.render(
        <InstructionSettings bot={{ ...initial, instructions: "Approved replacement" }} />,
      );
    });
    expect(descriptionField().value).toBe("Approved replacement");
  });
});

it("cancels an inline name edit", async () => {
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
  );
  const input = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
  expect(input.value).toBe("Ada");
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('[aria-label="Name"]')).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});

it("focuses the model control for a model deep link", async () => {
  await render("", {}, false, 1);
  expect(document.activeElement?.id.endsWith("-model")).toBe(true);
});

it("saves inline name edits on blur and on Enter", async () => {
  await render();
  for (const [value, event] of [
    ["Atlas", new FocusEvent("focusout", { bubbles: true })],
    ["Ada", new KeyboardEvent("keydown", { key: "Enter", bubbles: true })],
  ] as const) {
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(event));
    expect(onSave.mock.lastCall?.[0]).toHaveProperty("name", value);
  }
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "keeps an inline name edit open on IME Enter and Escape (%o)",
  async (composition) => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Atlas",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const windowKeys: string[] = [];
    const onWindowKey = (event: KeyboardEvent) => windowKeys.push(event.key);
    window.addEventListener("keydown", onWindowKey);
    for (const key of ["Enter", "Escape"]) {
      await act(async () =>
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...composition })),
      );
    }
    window.removeEventListener("keydown", onWindowKey);
    expect(container.querySelector('[aria-label="Name"]')).toBe(input);
    // A composing Escape must not reach page-level Escape listeners such as the reply chip.
    expect(windowKeys).not.toContain("Escape");
    expect(onSave).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onSave.mock.lastCall?.[0]).toHaveProperty("name", "Atlas");
  },
);

it.each(["color", "notifyOnFinish"])(
  "restores the last accepted %s after an automatic save fails",
  async (field) => {
    await render();
    const control = () =>
      container.querySelector<HTMLButtonElement>(
        field === "color" ? '[aria-label="Avatar color"]' : 'button[id$="-notify-finish"]',
      )!;
    const value = () => control().getAttribute(field === "color" ? "data-color" : "aria-checked");
    await act(async () => control().click());
    expect(value()).toBe(field === "color" ? "blue" : "false");
    onSave.mockRejectedValueOnce(new Error("offline"));
    await act(async () => control().click());
    expect(value()).toBe(field === "color" ? "blue" : "false");
    expect(container.textContent).toContain("offline");
    expect(
      [...container.querySelectorAll("button")].some((node) => node.textContent === "Save"),
    ).toBe(false);
  },
);

it("saves a color change back to the initial value after a successful automatic save", async () => {
  await render();
  const control = () => container.querySelector<HTMLButtonElement>('[aria-label="Avatar color"]')!;
  await act(async () => control().click());
  await act(async () => control().click());
  expect(onSave.mock.lastCall?.[0]).toHaveProperty("color", "ink");
});

describe("BotSettings avatar set persistence", () => {
  it("interprets a legacy missing set as Original without saving a replacement", async () => {
    await render();
    expect(
      container.querySelector('[aria-label="Avatar set"]')?.getAttribute("data-avatar-set"),
    ).toBe("organic");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves an explicit set switch atomically with its generated colour and retains it after reload", async () => {
    await render("Billing", { color: "#10B981" });
    const control = () => container.querySelector<HTMLButtonElement>('[aria-label="Avatar set"]')!;
    await act(async () => control().click());
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ avatarSet: "rakazo", color: "#F97316" });
    expect(control().getAttribute("data-avatar-set")).toBe("rakazo");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render("Billing", { color: "#F97316", avatarSet: "rakazo" });
    expect(control().getAttribute("data-avatar-set")).toBe("rakazo");
  });

  it("restores the accepted colour and set when switching fails", async () => {
    await render("Billing", { color: "#10B981" });
    onSave.mockRejectedValueOnce(new Error("offline"));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Avatar set"]')!.click(),
    );
    const control = container.querySelector('[aria-label="Avatar set"]')!;
    expect(control.getAttribute("data-avatar-set")).toBe("organic");
    expect(control.getAttribute("data-color")).toBe("#10B981");
    expect(container.textContent).toContain("offline");
  });

  it("keeps a colour edit in its existing set", async () => {
    await render("Billing", { avatarSet: "rakazo" });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Avatar color"]')!.click(),
    );
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("avatarSet");
    expect(
      container.querySelector('[aria-label="Avatar set"]')?.getAttribute("data-avatar-set"),
    ).toBe("rakazo");
  });
});

describe("BotSettings translation settings", () => {
  const deepseekCredential = {
    id: "cred-deepseek",
    provider: "deepseek",
    label: "DeepSeek",
    hasKey: true,
    isDefault: true,
    modelId: "DeepSeek-V4.1-Flash",
  };
  const deepseekCatalog = [
    {
      provider: "deepseek",
      providerName: "DeepSeek",
      id: "deepseek-flash",
      label: "DeepSeek V4.1 Flash",
      billing: "",
    },
  ];

  function translationSection() {
    const section = [...container.querySelectorAll("section")].find((node) =>
      node.querySelector("h3")?.textContent?.includes("Translation"),
    );
    if (!section) throw new Error("Missing Translation section");
    return section;
  }

  function translationAddSelect() {
    const select = translationSection().querySelector<HTMLSelectElement>(
      'select[aria-label="Add main model"]',
    );
    if (!select) throw new Error("Missing translation add select");
    return select;
  }

  function translationTargetSelect() {
    const select = container.querySelector<HTMLSelectElement>('[id$="-translation-target"]');
    if (!select) throw new Error("Missing translation target select");
    return select;
  }

  async function setSelect(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("shows the translation section with no model and Chinese as the default target", async () => {
    await render();
    const advanced = container.querySelector('[data-testid="bot-settings-advanced"]')!;
    expect(advanced.textContent).toContain("Translation");
    expect(translationSection().querySelector("[data-model-row]")).toBeNull();
    expect(translationTargetSelect().value).toBe("zh");
    expect(
      container.querySelector('button[id$="-auto-translate"]')?.getAttribute("aria-checked"),
    ).toBe("false");
    const sourceButtons = [...advanced.querySelectorAll("button")].filter(
      (button) => button.textContent === "自动检测",
    );
    expect(sourceButtons).toHaveLength(1);
    expect(sourceButtons[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a stored translation model, languages and auto-translate", async () => {
    await render("Billing", {
      translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
      translationSourceLanguage: "ja",
      translationTargetLanguage: "en",
      autoTranslate: true,
    } as Partial<Bot>);
    expect(
      translationSection().querySelector('[data-model-row="deepseek::deepseek-flash"]'),
    ).not.toBeNull();
    expect(translationTargetSelect().value).toBe("en");
    expect(
      container.querySelector('button[id$="-auto-translate"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    const sourceButtons = [...container.querySelectorAll("button")].filter(
      (button) => button.textContent === "日语",
    );
    expect(sourceButtons[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a Test button on the translation row and probes that model alone", async () => {
    vi.mocked(rpc.bots.testTranslationModel).mockResolvedValueOnce({
      supported: true,
      seconds: 1.2,
      detail: "你好",
    });
    await render("Billing", {
      translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
    } as Partial<Bot>);
    const row = translationSection().querySelector('[data-model-row="deepseek::deepseek-flash"]');
    expect(row).not.toBeNull();
    const testButton = [...row!.querySelectorAll("button")].find(
      (button) => button.textContent === "Test",
    );
    expect(testButton).not.toBeUndefined();
    await act(async () => {
      testButton!.click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(rpc.bots.testTranslationModel).toHaveBeenCalledWith({
      botId: "bot-1",
      provider: "deepseek",
      modelId: "deepseek-flash",
    });
    expect(translationSection().textContent).toContain("supports translation");
  });

  it("saves the chosen translation model, languages and auto-translate", async () => {
    vi.mocked(rpc.models.credentials).mockResolvedValueOnce([deepseekCredential]);
    vi.mocked(rpc.models.list).mockResolvedValueOnce(deepseekCatalog);
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    expect([...translationAddSelect().options].map((option) => option.value)).toContain(
      "deepseek::deepseek-flash",
    );
    await setSelect(translationAddSelect(), "deepseek::deepseek-flash");
    await setSelect(translationTargetSelect(), "ja");
    const sourceButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "English",
    );
    await act(async () => {
      sourceButton?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[id$="-auto-translate"]')!.click();
    });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      translationModelProvider: "deepseek",
      translationModelId: "deepseek-flash",
      translationSourceLanguage: "en",
      translationTargetLanguage: "ja",
      autoTranslate: true,
    });
  });

  it("clears the translation model pair together when the model is removed", async () => {
    await render("Billing", {
      translationModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
    } as Partial<Bot>);
    const row = translationSection().querySelector('[data-model-row="deepseek::deepseek-flash"]');
    await act(async () => {
      row?.querySelector<HTMLButtonElement>('[aria-label="Remove fallback model"]')?.click();
    });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      translationModelProvider: null,
      translationModelId: null,
    });
  });
});

describe("BotSettings media model settings", () => {
  const deepseekCredential = {
    id: "cred-deepseek",
    provider: "deepseek",
    label: "DeepSeek",
    hasKey: true,
    isDefault: true,
    modelId: "DeepSeek-V4.1-Flash",
  };
  const deepseekCatalog = [
    {
      provider: "deepseek",
      providerName: "DeepSeek",
      id: "deepseek-flash",
      label: "DeepSeek V4.1 Flash",
      billing: "",
    },
  ];
  const videoPresets = [
    { name: "水彩", prompt: "用水彩风格画" },
    { name: "赛博", prompt: "赛博朋克风格" },
  ];

  function mediaSection() {
    const section = [...container.querySelectorAll("section")].find((node) =>
      node.querySelector("h3")?.textContent?.includes("Media model"),
    );
    if (!section) throw new Error("Missing Media model section");
    return section;
  }

  // Media families render in order: video, image, video edit, image edit.
  function mediaAddSelects() {
    return [
      ...mediaSection().querySelectorAll<HTMLSelectElement>('select[aria-label="Add main model"]'),
    ];
  }

  function presetRowButton(name: string) {
    const button = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes(name),
    );
    if (!button) throw new Error(`Missing preset row "${name}"`);
    return button;
  }

  async function setSelect(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("shows the media model section above translation with no models set", async () => {
    await render();
    const advanced = container.querySelector('[data-testid="bot-settings-advanced"]')!;
    expect(advanced.textContent).toContain("Media model");
    expect(advanced.textContent!.indexOf("Media model")).toBeLessThan(
      advanced.textContent!.indexOf("Translation"),
    );
    expect(mediaSection().querySelector("[data-model-row]")).toBeNull();
    expect(container.querySelector('[id$="-video-preset"]')).toBeNull();
    expect(container.querySelector('[id$="-image-preset"]')).toBeNull();
  });

  it("shows stored video and image models with their active presets", async () => {
    await render("Billing", {
      videoModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
      imageModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
      videoPromptPresets: videoPresets,
      activeVideoPromptPreset: "水彩",
      imagePromptPresets: videoPresets,
      activeImagePromptPreset: "赛博",
    } as Partial<Bot>);
    const storedRows = [
      ...container.querySelectorAll('[data-model-row="deepseek::deepseek-flash"]'),
    ];
    expect(storedRows).toHaveLength(2);
    expect(container.textContent).toContain("✓ 水彩");
    expect(container.textContent).toContain("✓ 赛博");
  });

  it("saves the chosen video model at the front of its list and the active preset", async () => {
    vi.mocked(rpc.models.credentials).mockResolvedValueOnce([deepseekCredential]);
    vi.mocked(rpc.models.list).mockResolvedValueOnce(deepseekCatalog);
    await render("Billing", {
      videoModels: [{ provider: "other", model: "other-model" }],
      videoPromptPresets: videoPresets,
      activeVideoPromptPreset: "水彩",
    } as Partial<Bot>);
    await act(async () => {
      await Promise.resolve();
    });
    expect([...mediaAddSelects()[0]!.options].map((option) => option.value)).toContain(
      "deepseek::deepseek-flash",
    );
    await setSelect(mediaAddSelects()[0]!, "deepseek::deepseek-flash");
    // The add lands at the end of the main pool; move it up to the front.
    const addedRow = container.querySelector('[data-model-row="deepseek::deepseek-flash"]')!;
    await act(async () => {
      addedRow.querySelector<HTMLButtonElement>('[aria-label="Move fallback model up"]')!.click();
    });
    await act(async () => {
      presetRowButton("赛博").click();
    });
    // The tag opens its editor; close it before saving the panel.
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "Cancel")!
        .click();
    });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      videoModels: [
        { provider: "deepseek", model: "deepseek-flash" },
        { provider: "other", model: "other-model" },
      ],
      activeVideoPromptPreset: "赛博",
    });
  });

  it("saves a newly created preset and activates the first one", async () => {
    await render("Billing", {} as Partial<Bot>);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="New preset"]')!.click();
    });
    const nameInput = container.querySelector<HTMLInputElement>('[aria-label="Preset name"]');
    const promptInput = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Preset prompt"]',
    );
    if (!nameInput || !promptInput) throw new Error("Missing preset editor");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
        nameInput,
        "水彩",
      );
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
        promptInput,
        "用水彩风格画",
      );
      promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The first Save closes the editor; the second saves the panel.
    await clickSave();
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      videoPromptPresets: [{ name: "水彩", prompt: "用水彩风格画" }],
      activeVideoPromptPreset: "水彩",
    });
  });

  it("clears the video model list when the model is removed", async () => {
    await render("Billing", {
      videoModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
    } as Partial<Bot>);
    const row = container.querySelector('[data-model-row="deepseek::deepseek-flash"]')!;
    await act(async () => {
      row.querySelector<HTMLButtonElement>('[aria-label="Remove fallback model"]')!.click();
    });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ videoModels: [] });
  });

  it("removes a fallback model from the list", async () => {
    await render("Billing", {
      videoModels: [
        { provider: "deepseek", model: "deepseek-v4.1-flash" },
        { provider: "other", model: "other-model" },
      ],
    } as Partial<Bot>);
    expect(container.textContent).toContain("Fallback models");
    expect(container.textContent).toContain("other-model");
    const otherRow = [...container.querySelectorAll("[data-model-row]")].find((node) =>
      node.textContent?.includes("other-model"),
    );
    await act(async () => {
      otherRow?.querySelector<HTMLButtonElement>('[aria-label="Remove fallback model"]')?.click();
    });
    expect(container.textContent).not.toContain("other-model");
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      videoModels: [{ provider: "deepseek", model: "deepseek-v4.1-flash" }],
    });
  });
});

describe("BotSettings cached data", () => {
  it("shows cached voices at once and refreshes them in the background", async () => {
    queryClient.setQueryData(spaceQueries(null, null).voice.voices.queryKey({ input: {} }), [
      { id: "cached-voice", label: "Cached voice" },
    ]);
    vi.mocked(rpc.voice.voices)
      .mockClear()
      .mockReturnValueOnce(new Promise(() => undefined));
    await render();
    expect(container.querySelector('[id$="-voice"]')?.textContent).toContain("Cached voice");
    expect(rpc.voice.voices).toHaveBeenCalledTimes(1);
  });

  it("follows a newer bot in fields not edited and keeps the ones that were", async () => {
    await render("Billing", { computerMode: "team" });
    await setDescription("Invoices");
    await render("Remote edit", {
      name: "Grace",
      computerMode: "dedicated",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(container.querySelector('[aria-label="Edit name"]')?.textContent).toBe("Grace");
    expect(descriptionField().value).toBe("Invoices");
    await clickSave();
    const patch = onSave.mock.lastCall?.[0];
    expect(patch).toMatchObject({ description: "Invoices", computerMode: "dedicated" });
    expect(patch).not.toHaveProperty("name");
  });
});
