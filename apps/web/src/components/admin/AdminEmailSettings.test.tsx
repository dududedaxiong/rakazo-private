// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsData = vi.hoisted(() => ({
  current: {
    provider: "resend",
    from: "noreply@example.com",
    replyTo: null as string | null,
    apiKeyConfigured: true,
    smtpHost: null as string | null,
    smtpPort: null as number | null,
    smtpUser: null as string | null,
    smtpPasswordConfigured: false,
    source: "environment",
  },
}));
const updateSettings = vi.hoisted(() => vi.fn());
const clearSettings = vi.hoisted(() => vi.fn());
const testSettings = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    admin: {
      superKey: {
        status: {
          queryOptions: () => ({
            queryKey: ["superKeyStatus"],
            queryFn: async () => ({ granted: true, expiresAt: null, configured: true }),
          }),
          key: () => ["superKeyStatus"],
        },
      },
      emailSettings: {
        get: {
          queryOptions: () => ({
            queryKey: ["emailSettings"],
            queryFn: async () => settingsData.current,
          }),
          key: () => ["emailSettings"],
        },
      },
    },
  }),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: {
    admin: {
      emailSettings: { update: updateSettings, clear: clearSettings, test: testSettings },
    },
  },
}));
vi.mock("../../lib/user-error", () => ({
  errorCode: (err: unknown) =>
    err && typeof err === "object" && "code" in err ? err.code : undefined,
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
vi.mock("@rakazo/ui-web", () => ({
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
  NativeSelect: ({ children, ...props }: React.ComponentProps<"select">) => (
    <select {...props}>{children}</select>
  ),
  NativeSelectOption: ({ children, ...props }: React.ComponentProps<"option">) => (
    <option {...props}>{children}</option>
  ),
  SectionHeading: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Spinner: () => <span>Loading…</span>,
  toast: toastMock,
}));

import { AdminEmailSettingsPanel } from "./AdminEmailSettings";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
        <AdminEmailSettingsPanel />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    if (!container.querySelector("#admin-email-provider")) throw new Error("waiting for the form");
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

describe("AdminEmailSettings", () => {
  it("shows the environment badge and the API key field for Resend", async () => {
    settingsData.current = {
      provider: "resend",
      from: "noreply@example.com",
      replyTo: null,
      apiKeyConfigured: true,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPasswordConfigured: false,
      source: "environment",
    };
    await render();
    expect(container.textContent).toContain("Environment variables");
    expect(container.querySelector("#admin-email-api-key")).not.toBeNull();
    expect(container.querySelector("#admin-email-smtp-host")).toBeNull();
  });

  it("switching to SMTP shows server fields and saves only what changed", async () => {
    settingsData.current = {
      provider: "resend",
      from: "noreply@example.com",
      replyTo: null,
      apiKeyConfigured: true,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPasswordConfigured: false,
      source: "environment",
    };
    updateSettings.mockResolvedValue({ ...settingsData.current, provider: "smtp" });
    await render();
    const provider = container.querySelector("#admin-email-provider") as HTMLSelectElement;
    await act(async () => setSelectValue(provider, "smtp"));
    await vi.waitFor(() => {
      if (!container.querySelector("#admin-email-smtp-host"))
        throw new Error("waiting for SMTP fields");
    });
    expect(container.textContent).toContain("No API key needed");
    expect(container.querySelector("#admin-email-api-key")).toBeNull();
    const host = container.querySelector("#admin-email-smtp-host") as HTMLInputElement;
    await act(async () => setInputValue(host, "smtp.example.com"));
    await act(async () => button("Save settings").click());
    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        provider: "smtp",
        smtpHost: "smtp.example.com",
      }),
    );
  });

  it("sends a test email and reports the result", async () => {
    testSettings.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button("Send a test email").click());
    await vi.waitFor(() => expect(testSettings).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith("Test email sent");
  });

  it("clears page settings only after a second confirmation click", async () => {
    clearSettings.mockResolvedValue({ ...settingsData.current, source: "environment" });
    await render();
    await act(async () => button("Clear page settings").click());
    expect(clearSettings).not.toHaveBeenCalled();
    await act(async () => button("Confirm clear").click());
    await vi.waitFor(() => expect(clearSettings).toHaveBeenCalled());
  });
});
