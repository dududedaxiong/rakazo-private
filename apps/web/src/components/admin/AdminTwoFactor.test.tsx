// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusData = vi.hoisted(() => ({
  current: { enabled: false, verified: false, recoveryCodesRemaining: 0 },
}));
const enrollStart = vi.hoisted(() => vi.fn());
const enrollConfirm = vi.hoisted(() => vi.fn());
const disableTotp = vi.hoisted(() => vi.fn());
const resetTotp = vi.hoisted(() => vi.fn());
const changeSuperKey = vi.hoisted(() => vi.fn());
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
      twoFactor: {
        status: {
          queryOptions: () => ({
            queryKey: ["twoFactorStatus"],
            queryFn: async () => statusData.current,
          }),
          key: () => ["twoFactorStatus"],
        },
      },
    },
  }),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: {
    admin: {
      twoFactor: {
        enrollStart,
        enrollConfirm,
        disable: disableTotp,
        reset: resetTotp,
      },
      superKey: { change: changeSuperKey },
    },
  },
}));
vi.mock("../../lib/share-link-qr", () => ({
  shareLinkQrDataUrl: vi.fn(async () => "data:image/png;base64,qr"),
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
  InputOTP: ({
    value,
    onChange,
    onComplete,
    maxLength,
    children: _children,
    ...props
  }: {
    value?: string;
    onChange?: (value: string) => void;
    onComplete?: (value: string) => void;
    maxLength?: number;
  } & React.ComponentProps<"input">) => (
    <input
      {...props}
      value={value ?? ""}
      onChange={(event) => {
        onChange?.(event.target.value);
        if (event.target.value.length >= (maxLength ?? 6)) onComplete?.(event.target.value);
      }}
    />
  ),
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  InputOTPSlot: () => null,
  SectionHeading: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Spinner: () => <span>Loading…</span>,
  toast: toastMock,
  useCopyText: () => [false, vi.fn(async () => true)],
}));

import { AdminTwoFactorPanel } from "./AdminTwoFactor";

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
        <AdminTwoFactorPanel />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    if (!container.textContent?.includes("Two-factor authentication"))
      throw new Error("waiting for the page");
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

describe("AdminTwoFactor", () => {
  it("enrolls with a QR code and shows the recovery codes once", async () => {
    statusData.current = { enabled: false, verified: false, recoveryCodesRemaining: 0 };
    enrollStart.mockResolvedValue({
      otpauthUri: "otpauth://totp/test?secret=ABCDEFGH",
      secret: "ABCDEFGH",
    });
    const codes = Array.from(
      { length: 10 },
      (_, index) => `AAAA-${String(index).padStart(4, "0")}`,
    );
    enrollConfirm.mockResolvedValue({ recoveryCodes: codes });
    await render();
    await act(async () => button("Set up two-factor authentication").click());
    await vi.waitFor(() => expect(enrollStart).toHaveBeenCalled());
    await vi.waitFor(() => {
      if (!container.querySelector("img")) throw new Error("waiting for the QR code");
    });
    expect((container.querySelector("#admin-totp-secret") as HTMLInputElement).value).toBe(
      "ABCDEFGH",
    );
    const codeInput = container.querySelector("input[aria-label='Authenticator code']");
    if (!codeInput) throw new Error("no code input");
    await act(async () => setInputValue(codeInput as HTMLInputElement, "123456"));
    await vi.waitFor(() => expect(enrollConfirm).toHaveBeenCalledWith({ code: "123456" }));
    await vi.waitFor(() => {
      if (!container.textContent?.includes("AAAA-0000"))
        throw new Error("waiting for recovery codes");
    });
    expect(container.textContent).toContain("only shown this one time");
    await act(async () => button("I saved them").click());
    await vi.waitFor(() => {
      if (!container.textContent?.includes("Status")) throw new Error("waiting for the status");
    });
  });

  it("shows status and turns TOTP off with a code", async () => {
    statusData.current = { enabled: true, verified: true, recoveryCodesRemaining: 3 };
    disableTotp.mockResolvedValue({ enabled: false });
    await render();
    expect(container.textContent).toContain("On");
    expect(container.textContent).toContain("3");
    await act(async () => button("Turn off").click());
    const codeInput = container.querySelector("input[aria-label='Authenticator code']");
    if (!codeInput) throw new Error("no code input");
    await act(async () => setInputValue(codeInput as HTMLInputElement, "654321"));
    await vi.waitFor(() => expect(disableTotp).toHaveBeenCalledWith({ code: "654321" }));
  });

  it("changes the super key from the same page", async () => {
    statusData.current = { enabled: false, verified: false, recoveryCodesRemaining: 0 };
    changeSuperKey.mockResolvedValue({ changed: true });
    await render();
    const current = container.querySelector("#admin-super-key-current") as HTMLInputElement;
    const next = container.querySelector("#admin-super-key-new") as HTMLInputElement;
    await act(async () => setInputValue(current, "old-key-123"));
    await act(async () => setInputValue(next, "new-key-456"));
    await act(async () => button("Change super key").click());
    await vi.waitFor(() =>
      expect(changeSuperKey).toHaveBeenCalledWith({
        currentKey: "old-key-123",
        newKey: "new-key-456",
      }),
    );
    expect(toastMock).toHaveBeenCalledWith("Super key changed");
  });
});
