// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusData = vi.hoisted(() => ({
  current: { enabled: true, verified: false, recoveryCodesRemaining: 0 },
}));
const verifyCode = vi.hoisted(() => vi.fn());

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    admin: {
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
  rpc: { admin: { twoFactor: { verify: verifyCode } } },
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
  Spinner: () => <span>Loading…</span>,
}));

import { AdminTwoFactorGate } from "./AdminTwoFactorGate";

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
        <AdminTwoFactorGate>
          <div>Admin content</div>
        </AdminTwoFactorGate>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    if (
      !container.textContent?.includes("Two-factor authentication") &&
      !container.textContent?.includes("Admin content")
    )
      throw new Error("waiting for the gate");
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminTwoFactorGate", () => {
  it("holds the admin surface behind the code box until verification", async () => {
    statusData.current = { enabled: true, verified: false, recoveryCodesRemaining: 0 };
    verifyCode.mockResolvedValue({ verified: true });
    await render();
    expect(container.textContent).not.toContain("Admin content");
    const input = container.querySelector("input");
    if (!input) throw new Error("no code input");
    await act(async () => setInputValue(input, "123456"));
    await vi.waitFor(() => expect(verifyCode).toHaveBeenCalledWith({ code: "123456" }));
    statusData.current = { enabled: true, verified: true, recoveryCodesRemaining: 0 };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["twoFactorStatus"] });
    });
    await vi.waitFor(() => {
      if (!container.textContent?.includes("Admin content"))
        throw new Error("waiting for the admin surface");
    });
  });

  it("shows a wrong code without opening the admin surface", async () => {
    statusData.current = { enabled: true, verified: false, recoveryCodesRemaining: 0 };
    verifyCode.mockRejectedValue(new Error("Code is incorrect"));
    await render();
    const input = container.querySelector("input");
    if (!input) throw new Error("no code input");
    await act(async () => setInputValue(input, "000000"));
    await vi.waitFor(() => {
      if (!container.textContent?.includes("Code is incorrect"))
        throw new Error("waiting for the error");
    });
    expect(container.textContent).not.toContain("Admin content");
  });

  it("lets an admin without TOTP straight in", async () => {
    statusData.current = { enabled: false, verified: false, recoveryCodesRemaining: 0 };
    await render();
    expect(container.textContent).toContain("Admin content");
    expect(verifyCode).not.toHaveBeenCalled();
  });
});
