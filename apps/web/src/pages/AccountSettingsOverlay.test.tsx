// @vitest-environment jsdom

import type { AccountSecurity } from "@rakazo_mickvvw/contracts";
import type * as UiWeb from "@rakazo_mickvvw/ui-web";
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray) => strings.join(""),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@rakazo_mickvvw/ui-web", async (importOriginal) => ({
  BotAvatar: () => null,
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  buttonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
  Field: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } & React.ComponentProps<"button">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
  Toggle: ({
    children,
    onPressedChange,
    pressed: _pressed,
    variant: _variant,
    ...props
  }: {
    children?: ReactNode;
    onPressedChange?: () => void;
    pressed?: boolean;
    variant?: string;
  } & React.ComponentProps<"button">) => (
    <button type="button" onClick={() => onPressedChange?.()} {...props}>
      {children}
    </button>
  ),
  ToggleGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  OptionSelect: ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <div data-testid={testId} />
  ),
  SectionHeading: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  useCopyText: () => [false, copyText],
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

const accountPolicy = vi.hoisted(() => ({
  passwordChangeEnabled: undefined as boolean | undefined,
}));
vi.mock("../components/AccountAccess", () => ({
  AccountAccess: ({ onSecurity }: { onSecurity: (value: AccountSecurity) => void }) => {
    useEffect(
      () =>
        onSecurity({
          hasPassword: true,
          passwordChangeEnabled: accountPolicy.passwordChangeEnabled,
          freshOidcAuth: false,
          ssoLinked: false,
          emailDeletion: false,
          sso: null,
        }),
      [onSecurity],
    );
    return null;
  },
}));

vi.mock("../components/AccountDataSettings", () => ({ AccountDataSettings: () => null }));
vi.mock("../components/ApprovalRulesSettings", () => ({ ApprovalRulesSettings: () => null }));
vi.mock("../components/TrustedLinkSitesSettings", () => ({
  TrustedLinkSitesSettings: () => null,
}));
vi.mock("../components/ai/primitives", () => ({ SuccessPop: () => null }));
vi.mock("../components/ComputersUnavailableHint", () => ({
  ComputersUnavailableHint: () => null,
}));
vi.mock("../components/ComputerDeviceSettings", () => ({ ComputerDeviceSettings: () => null }));
vi.mock("../components/DesktopUpdates", () => ({ DesktopUpdateSection: () => null }));
vi.mock("../lib/auth", () => ({ authClient: { changePassword: vi.fn(), updateUser: vi.fn() } }));
vi.mock("../lib/i18n", () => ({
  getActiveUiLocale: () => "en",
  setUiLocale: (locale: string) => Promise.resolve(locale),
}));
vi.mock("../lib/ui-appearance", () => ({
  getUiAppearancePreference: () => "system",
  setUiAppearance: vi.fn(),
}));

const usageReset = vi.hoisted(() => vi.fn());
const referralCode = vi.hoisted(() => vi.fn());
const copyText = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../lib/rpc", () => ({
  rpc: { usage: { reset: usageReset }, referral: { code: referralCode } },
}));
vi.mock("../components/ConfirmDialog", () => ({
  ConfirmDialog: ({
    title,
    description,
    onCancel,
    onConfirm,
    busy,
    confirmLabel,
    error,
  }: {
    title?: ReactNode;
    description?: ReactNode;
    onCancel: () => void;
    onConfirm: () => void;
    busy?: boolean;
    confirmLabel?: ReactNode;
    error?: ReactNode;
  }) => (
    <div data-testid="confirm-dialog">
      <div>{title}</div>
      <div>{description}</div>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" disabled={busy} onClick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  ),
}));

import { authClient } from "../lib/auth";
import {
  COMPOSER_ENTER_TO_SEND_STORAGE_KEY,
  composerEnterToSendPreference,
} from "../lib/composer-enter-to-send-pref";
import { remoteImagesPreference } from "../lib/remote-images-preference";
import { TOOL_ACTIVITY_STORAGE_KEY } from "../lib/tool-activity-preference";
import {
  GeneralSettingsPanels,
  ReferralCodeSettingsPanel,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";

afterEach(() => {
  localStorage.clear();
});

it("flips the stored tool activity preference from the settings toggle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<GeneralSettingsPanels name="Jamie" />);
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-activity-toggle"]',
    );
    if (!toggle) throw new Error("Missing tool activity toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      toggle.click();
    });

    expect(localStorage.getItem(TOOL_ACTIVITY_STORAGE_KEY)).toBe("on");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      toggle.click();
    });

    expect(localStorage.getItem(TOOL_ACTIVITY_STORAGE_KEY)).toBe("off");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("turns loading web images on and off from the settings toggle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<GeneralSettingsPanels name="Jamie" />);
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="remote-images-toggle"]',
    );
    if (!toggle) throw new Error("Missing remote images toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(remoteImagesPreference.get()).toBe(false);

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(remoteImagesPreference.get()).toBe(true);

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(remoteImagesPreference.get()).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([undefined, true, false])("respects the password-change policy (%s)", async (enabled) => {
  accountPolicy.passwordChangeEnabled = enabled;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<GeneralSettingsPanels name="Test" />));
    expect(container.textContent?.includes("Change password")).toBe(enabled !== false);
  } finally {
    await act(async () => root.unmount());
    accountPolicy.passwordChangeEnabled = undefined;
    vi.unstubAllGlobals();
  }
});

it("keeps the password form closed until asked and closes it after a change", async () => {
  vi.mocked(authClient.changePassword).mockResolvedValue({ data: {}, error: null } as never);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const passwordFields = () => container.querySelectorAll('input[type="password"]');
  const setValue = (input: Element, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    await act(async () => root.render(<GeneralSettingsPanels name="Test" />));
    expect(passwordFields()).toHaveLength(0);

    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Change password",
    );
    await act(async () => open?.click());
    const [current, next, confirm] = passwordFields();
    await act(async () => {
      setValue(current!, "old-password");
      setValue(next!, "new-password-123");
      setValue(confirm!, "new-password-123");
    });
    await act(async () => container.querySelector("form")?.requestSubmit());

    expect(authClient.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      revokeOtherSessions: true,
    });
    expect(passwordFields()).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("updates the Enter preference from Settings and reflects external changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  composerEnterToSendPreference.set(true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<GeneralSettingsPanels name="Test" />);
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-enter-to-send-toggle"]',
    );
    if (!toggle) throw new Error("Missing Enter preference");
    expect(container.querySelector(`label[for="${toggle.id}"]`)?.textContent).toBe(
      "Send with Enter",
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(composerEnterToSendPreference.get()).toBe(false);
    expect(localStorage.getItem(COMPOSER_ENTER_TO_SEND_STORAGE_KEY)).toBe("0");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => composerEnterToSendPreference.set(true));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows today and total cards, a 7-day chart, and per-model cards", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dayKey = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const daily = [6, 5, 4, 3, 2, 1, 0].map((offset) => ({
    date: dayKey(offset),
    modelCalls: 1,
    inputTokens: 100 * (7 - offset) - 10,
    outputTokens: 10,
    totalTokens: 100 * (7 - offset),
    costUsd: 0,
    unknownTokensCalls: 0,
    unknownCostCalls: 0,
  }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <UsageSettingsPanel
          usage={{
            runs: 2,
            inputTokens: 1200,
            outputTokens: 34,
            totalTokens: 1234,
            costUsd: 0.5,
            modelCalls: 3,
            models: [
              {
                provider: "openai",
                model: "model-a",
                modelCalls: 2,
                inputTokens: 1000,
                outputTokens: 30,
                totalTokens: 1030,
                costUsd: 0.5,
                unknownTokensCalls: 0,
                unknownCostCalls: 0,
              },
              {
                provider: "local",
                model: "model-b",
                modelCalls: 1,
                inputTokens: 200,
                outputTokens: 4,
                totalTokens: 204,
                costUsd: null,
                unknownTokensCalls: 0,
                unknownCostCalls: 0,
              },
            ],
            daily,
          }}
        />,
      ),
    );
    const today = container.querySelector('[data-testid="usage-summary-today"]')!;
    expect(today.textContent).toContain("Today's usage");
    expect(today.textContent).toContain("700");
    expect(today.textContent).toContain("Input");
    const total = container.querySelector('[data-testid="usage-summary-total"]')!;
    expect(total.textContent).toContain("Total usage");
    expect(total.textContent).toContain("1,234");
    const trend = container.querySelector('[data-testid="usage-trend"]')!;
    expect(trend.textContent).toContain("Today");
    for (const value of ["100", "200", "300", "400", "500", "600", "700"]) {
      expect(trend.textContent).toContain(value);
    }
    expect(trend.querySelectorAll(":scope > div > div")).toHaveLength(7);
    const heights = [...trend.querySelectorAll("div")]
      .map((node) => node.style.height)
      .filter(Boolean)
      .map((height) => Number.parseFloat(height));
    expect(heights).toHaveLength(7);
    expect(Math.max(...heights)).toBe(100);
    expect(heights.every((height) => height <= 100)).toBe(true);
    const models = container.querySelector('[data-testid="usage-models"]')!;
    expect(models.textContent).toContain("model-a");
    expect(models.textContent).toContain("1,030");
    expect(models.textContent).toContain("model-b");
    expect(models.textContent).toContain("204");
    const shares = [...models.querySelectorAll(".h-full.rounded-full.bg-primary")].map(
      (node) => (node as HTMLElement).style.width,
    );
    expect(shares).toEqual(["83%", "17%"]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("resets usage only after confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usageReset.mockResolvedValue({ deleted: 5 });
  const onUsageReset = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <UsageSettingsPanel
          usage={{
            runs: 2,
            inputTokens: 1200,
            outputTokens: 34,
            totalTokens: 1234,
            costUsd: 0.5,
            modelCalls: 3,
            models: [],
          }}
          onUsageDaysChange={() => {}}
          onUsageReset={onUsageReset}
        />,
      ),
    );
    const resetButton = container.querySelector<HTMLButtonElement>('[data-testid="usage-reset"]')!;
    expect(resetButton).not.toBeNull();
    await act(async () => resetButton.click());
    expect(usageReset).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    const confirm = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Reset",
    )!;
    await act(async () => confirm.click());
    await act(async () => {});
    expect(usageReset).toHaveBeenCalledTimes(1);
    expect(onUsageReset).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

it("cancelling the reset confirmation does nothing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onUsageReset = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <UsageSettingsPanel
          usage={{
            runs: 2,
            inputTokens: 1200,
            outputTokens: 34,
            totalTokens: 1234,
            costUsd: 0.5,
            modelCalls: 3,
            models: [],
          }}
          onUsageDaysChange={() => {}}
          onUsageReset={onUsageReset}
        />,
      ),
    );
    const resetButton = container.querySelector<HTMLButtonElement>('[data-testid="usage-reset"]')!;
    await act(async () => resetButton.click());
    const cancel = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    )!;
    await act(async () => cancel.click());
    expect(usageReset).not.toHaveBeenCalled();
    expect(onUsageReset).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

it("does not expose server integration configuration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <GeneralSettingsPanels name="Jamie" />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/integrations/setup"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

async function renderNameEditor(name = "Alex Rivera") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onNameSaved = vi.fn<() => Promise<void>>(async () => undefined);
  await act(async () =>
    root.render(
      <GeneralSettingsPanels name={name} email="demo@example.com" onNameSaved={onNameSaved} />,
    ),
  );
  const card = container.querySelector<HTMLElement>('[data-testid="account-card"]')!;
  const button = (label: string) =>
    [...card.querySelectorAll("button")].find((b) => b.textContent === label)!;
  await act(async () => button("Edit").click());
  const input = card.querySelector("input")!;
  return {
    card,
    input,
    button,
    onNameSaved,
    change: async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    submit: async () =>
      act(async () => {
        card
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("saves a trimmed name and refreshes the account data", async () => {
  vi.mocked(authClient.updateUser).mockResolvedValue({ data: { status: true }, error: null });
  const editor = await renderNameEditor();
  try {
    expect(editor.input.value).toBe("Alex Rivera");
    expect(editor.input.maxLength).toBe(80);
    await editor.change("  Sam Rivera  ");
    await editor.submit();
    expect(authClient.updateUser).toHaveBeenCalledWith({ name: "Sam Rivera" });
    expect(editor.onNameSaved).toHaveBeenCalledOnce();
    expect(editor.card.querySelector("input")).toBeNull();
  } finally {
    await editor.cleanup();
  }
});

it("closes an unchanged name without saving", async () => {
  vi.mocked(authClient.updateUser).mockClear();
  const editor = await renderNameEditor();
  try {
    await editor.change("  Alex Rivera  ");
    await editor.submit();
    expect(authClient.updateUser).not.toHaveBeenCalled();
    expect(editor.onNameSaved).not.toHaveBeenCalled();
    expect(editor.card.querySelector("input")).toBeNull();
    expect(editor.card.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await editor.cleanup();
  }
});

it.each(["button", "Escape"])("cancels a name edit with %s without saving", async (method) => {
  vi.mocked(authClient.updateUser).mockClear();
  const editor = await renderNameEditor();
  try {
    await editor.change("Discard me");
    await act(async () => {
      if (method === "button") editor.button("Cancel").click();
      else
        editor.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(editor.card.querySelector("input")).toBeNull();
    expect(editor.card.textContent).toContain("Alex Rivera");
    expect(authClient.updateUser).not.toHaveBeenCalled();
    await act(async () => editor.button("Edit").click());
    expect(editor.card.querySelector("input")!.value).toBe("Alex Rivera");
  } finally {
    await editor.cleanup();
  }
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "keeps a name edit open on the Escape that ends an IME composition (%o)",
  async (composition) => {
    const editor = await renderNameEditor();
    try {
      await editor.change("Sam Rivera");
      const pressEscape = (init: KeyboardEventInit) =>
        act(async () => {
          editor.input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...init }),
          );
        });
      const onWindowKey = vi.fn();
      window.addEventListener("keydown", onWindowKey);
      await pressEscape(composition);
      window.removeEventListener("keydown", onWindowKey);
      expect(editor.card.querySelector("input")?.value).toBe("Sam Rivera");
      // The form keeps Escape from chat listeners behind Settings, as a plain Escape does.
      expect(onWindowKey).not.toHaveBeenCalled();
      await pressEscape({});
      expect(editor.card.querySelector("input")).toBeNull();
    } finally {
      await editor.cleanup();
    }
  },
);

it.each(["__AbCdEfGh__", "demo", "demo@example.com"])(
  "starts hidden name %s empty and rejects invalid submissions",
  async (name) => {
    vi.mocked(authClient.updateUser).mockClear();
    const editor = await renderNameEditor(name);
    try {
      expect(editor.input.value).toBe("");
      expect(editor.button("Save").disabled).toBe(true);
      for (const value of ["", "   ", "x".repeat(81)]) {
        await editor.change(value);
        await editor.submit();
      }
      expect(authClient.updateUser).not.toHaveBeenCalled();
      expect(editor.onNameSaved).not.toHaveBeenCalled();
    } finally {
      await editor.cleanup();
    }
  },
);

it.each(["💬", "__AbCdEfGh__"])(
  "rejects unsupported name %s without losing the current name",
  async (name) => {
    vi.mocked(authClient.updateUser).mockClear();
    const editor = await renderNameEditor();
    try {
      await editor.change(name);
      await editor.submit();
      expect(authClient.updateUser).not.toHaveBeenCalled();
      expect(editor.onNameSaved).not.toHaveBeenCalled();
      expect(editor.input.value).toBe(name);
      expect(editor.card.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update name",
      );
      await act(async () => editor.button("Cancel").click());
      expect(editor.card.textContent).toContain("Alex Rivera");
    } finally {
      await editor.cleanup();
    }
  },
);

it.each(["response", "network"])(
  "keeps the draft and shows an inline %s error",
  async (failure) => {
    if (failure === "network")
      vi.mocked(authClient.updateUser).mockRejectedValue(new Error("offline"));
    else
      vi.mocked(authClient.updateUser).mockResolvedValue({
        data: null,
        error: { status: 500, statusText: "Server error" },
      });
    const editor = await renderNameEditor();
    try {
      await editor.change("Sam Rivera");
      await editor.submit();
      expect(editor.card.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update name",
      );
      expect(editor.input.value).toBe("Sam Rivera");
      expect(editor.button("Save").disabled).toBe(false);
      expect(editor.onNameSaved).not.toHaveBeenCalled();
    } finally {
      await editor.cleanup();
    }
  },
);

it("closes the name editor before refresh finishes and ignores a refresh failure", async () => {
  vi.mocked(authClient.updateUser).mockResolvedValue({ data: { status: true }, error: null });
  const editor = await renderNameEditor();
  let rejectRefresh!: (error: Error) => void;
  editor.onNameSaved.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectRefresh = reject;
      }),
  );
  try {
    await editor.change("Sam Rivera");
    await editor.submit();
    expect(authClient.updateUser).toHaveBeenCalledWith({ name: "Sam Rivera" });
    expect(editor.onNameSaved).toHaveBeenCalledOnce();
    expect(editor.card.querySelector("input")).toBeNull();
    expect(editor.button("Edit").disabled).toBe(false);
    await act(async () => rejectRefresh(new Error("offline")));
    expect(editor.card.querySelector("input")).toBeNull();
    expect(editor.card.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await editor.cleanup();
  }
});

it("shows the invite code with its uses and copies it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  referralCode.mockResolvedValue({
    code: "ABCDEFGHJKMN",
    usedCount: 3,
    maxUses: 10,
    status: "active",
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ReferralCodeSettingsPanel />));
    await act(async () => {});
    expect(container.querySelector("h2")?.textContent).toBe("My invite code");
    expect(container.querySelector("code")?.textContent).toBe("ABCDEFGHJKMN");
    expect(container.textContent).toContain("3 of 10 uses");
    const copyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy code",
    )!;
    await act(async () => copyButton.click());
    expect(copyText).toHaveBeenCalledWith("ABCDEFGHJKMN");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

it("shows the invite code as unavailable when the switch is off", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  referralCode.mockResolvedValue(null);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ReferralCodeSettingsPanel />));
    await act(async () => {});
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toContain("Referral codes are not available.");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

it("shows an exhausted invite code as used up", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  referralCode.mockResolvedValue({
    code: "USEDUPCDE234",
    usedCount: 10,
    maxUses: 10,
    status: "exhausted",
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ReferralCodeSettingsPanel />));
    await act(async () => {});
    expect(container.querySelector("code")?.textContent).toBe("USEDUPCDE234");
    expect(container.textContent).toContain("Used up");
    expect(container.textContent).not.toContain("of 10 uses");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

it("retries loading the invite code after a failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  referralCode.mockRejectedValueOnce(new Error(""));
  referralCode.mockResolvedValue({
    code: "ABCDEFGHJKMN",
    usedCount: 0,
    maxUses: 10,
    status: "active",
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ReferralCodeSettingsPanel />));
    await act(async () => {});
    expect(container.textContent).toContain("Could not load invite code");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    await act(async () => {});
    expect(referralCode).toHaveBeenCalledTimes(2);
    expect(container.querySelector("code")?.textContent).toBe("ABCDEFGHJKMN");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
