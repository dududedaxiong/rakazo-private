// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statusData = vi.hoisted(() => ({
  current: { granted: false, expiresAt: null as string | null, configured: true },
}));
const verifyKey = vi.hoisted(() => vi.fn());

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    admin: {
      superKey: {
        status: {
          queryOptions: () => ({
            queryKey: ["superKeyStatus"],
            queryFn: async () => statusData.current,
          }),
          key: () => ["superKeyStatus"],
        },
      },
    },
  }),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: { admin: { superKey: { verify: verifyKey } } },
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
  Spinner: () => <span>Loading…</span>,
}));

import { SuperKeyGate } from "./AdminSuperKeyGate";

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
        <SuperKeyGate>
          <div>Gated content</div>
        </SuperKeyGate>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    const text = container.textContent ?? "";
    if (
      !text.includes("Super key required") &&
      !text.includes("No super key is configured") &&
      !text.includes("Gated content")
    )
      throw new Error("waiting for the gate");
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SuperKeyGate", () => {
  it("asks for the key and opens the page once verified", async () => {
    statusData.current = { granted: false, expiresAt: null, configured: true };
    verifyKey.mockResolvedValue({ granted: true, expiresAt: "2026-11-17T17:15:00.000Z" });
    await render();
    expect(container.textContent).not.toContain("Gated content");
    const input = container.querySelector("#admin-super-key") as HTMLInputElement | null;
    if (!input) throw new Error("no super key input");
    await act(async () => setInputValue(input, "correct-key"));
    const verify = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Verify",
    )!;
    await act(async () => verify.click());
    await vi.waitFor(() => expect(verifyKey).toHaveBeenCalledWith({ key: "correct-key" }));
    statusData.current = {
      granted: true,
      expiresAt: "2026-11-17T17:15:00.000Z",
      configured: true,
    };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["superKeyStatus"] });
    });
    await vi.waitFor(() => {
      if (!container.textContent?.includes("Gated content"))
        throw new Error("waiting for the gated page");
    });
  });

  it("shows a wrong key without opening the page", async () => {
    statusData.current = { granted: false, expiresAt: null, configured: true };
    verifyKey.mockRejectedValue(new Error("Super key is incorrect"));
    await render();
    const input = container.querySelector("#admin-super-key") as HTMLInputElement | null;
    if (!input) throw new Error("no super key input");
    await act(async () => setInputValue(input, "wrong-key"));
    const verify = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Verify",
    )!;
    await act(async () => verify.click());
    await vi.waitFor(() => {
      if (!container.textContent?.includes("Super key is incorrect"))
        throw new Error("waiting for the error");
    });
    expect(container.textContent).not.toContain("Gated content");
  });

  it("explains when no super key is configured anywhere", async () => {
    statusData.current = { granted: false, expiresAt: null, configured: false };
    await render();
    expect(container.querySelector("#admin-super-key")).toBeNull();
    expect(container.textContent).toContain("No super key is configured");
  });
});
