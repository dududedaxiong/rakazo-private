// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsData = vi.hoisted(() => ({
  current: {
    signupsEnabled: true,
    masterSwitchEnabled: true,
    emailSignupEnabled: true,
    inviteCodeEnabled: false,
    signupAllowlist: [] as string[],
    ipRegistrationLimit: 5,
    ipRegistrationHourlyThreshold: 10,
    ipCollectiveBanEnabled: false,
    referralCodeEnabled: true,
    referralCodeMaxUses: 10,
  },
}));
const updateSettings = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    admin: {
      registrationSettings: {
        get: {
          queryOptions: () => ({
            queryKey: ["registrationSettings"],
            queryFn: async () => settingsData.current,
          }),
          key: () => ["registrationSettings"],
        },
      },
    },
  }),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: { admin: { registrationSettings: { update: updateSettings } } },
}));
vi.mock("../../lib/user-error", () => ({
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce(
        (text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`,
        "",
      ),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo_mickvvw/ui-web", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Field: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  SectionHeading: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Spinner: () => <span>Loading…</span>,
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } & React.ComponentProps<"input">) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
  Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
  toast: toastMock,
}));

import { AdminRegistrationSettingsPanel } from "./AdminRegistrationSettings";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  settingsData.current = {
    signupsEnabled: true,
    masterSwitchEnabled: true,
    emailSignupEnabled: true,
    inviteCodeEnabled: false,
    signupAllowlist: [],
    ipRegistrationLimit: 5,
    ipRegistrationHourlyThreshold: 10,
    ipCollectiveBanEnabled: false,
    referralCodeEnabled: true,
    referralCodeMaxUses: 10,
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AdminRegistrationSettingsPanel />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    if (!container.querySelector("#referral-code-max-uses"))
      throw new Error("waiting for the form");
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clickSave() {
  const save = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Save settings",
  )!;
  await act(async () => save.click());
  await act(async () => {});
}

describe("AdminRegistrationSettings", () => {
  it("saves the referral switch and uses with the other settings", async () => {
    updateSettings.mockResolvedValue(settingsData.current);
    await render();
    const uses = container.querySelector("#referral-code-max-uses") as HTMLInputElement;
    expect(uses.value).toBe("10");
    await act(async () => setInputValue(uses, "25"));
    await clickSave();
    expect(updateSettings).toHaveBeenCalledWith({
      emailSignupEnabled: true,
      inviteCodeEnabled: false,
      signupAllowlist: [],
      referralCodeEnabled: true,
      referralCodeMaxUses: 25,
    });
  });

  it("hides the uses input while referral codes are off", async () => {
    settingsData.current = { ...settingsData.current, referralCodeEnabled: false };
    updateSettings.mockResolvedValue(settingsData.current);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminRegistrationSettingsPanel />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => {
      if (!container.querySelector('input[aria-label="Referral codes"]'))
        throw new Error("waiting for the form");
    });
    expect(container.querySelector("#referral-code-max-uses")).toBeNull();
    const toggle = container.querySelector(
      'input[aria-label="Referral codes"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(container.querySelector("#referral-code-max-uses")).not.toBeNull();
  });

  it("clamps an out-of-range uses value instead of sending it", async () => {
    updateSettings.mockResolvedValue(settingsData.current);
    await render();
    const uses = container.querySelector("#referral-code-max-uses") as HTMLInputElement;
    await act(async () => setInputValue(uses, "500"));
    await clickSave();
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ referralCodeMaxUses: 100 }),
    );
  });
});
