// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createInviteCodes = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const listRows = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    admin: {
      inviteCodes: {
        list: {
          // Pass the infinite-query options through: useInfiniteQuery needs
          // initialPageParam and getNextPageParam from them.
          infiniteOptions: (options: Record<string, unknown>) => ({
            queryKey: ["inviteCodes"],
            queryFn: async () => listRows.current,
            ...options,
          }),
          key: () => ["inviteCodes"],
        },
      },
    },
  }),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: {
    admin: {
      inviteCodes: { create: createInviteCodes },
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
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo_mickvvw/ui-web", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Field: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
  Spinner: () => <span>Loading…</span>,
  toast: toastMock,
}));

import { AdminInviteCodesPanel } from "./AdminInviteCodes";

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
  listRows.current = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AdminInviteCodesPanel />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    if (!button("Generate invite codes")) throw new Error("waiting for the panel");
  });
}

async function openDialog() {
  await act(async () => button("Generate invite codes").click());
  await vi.waitFor(() => {
    if (!container.querySelector("#generate-custom-codes"))
      throw new Error("waiting for the dialog");
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

describe("AdminInviteCodes", () => {
  it("shows the custom codes field and disables count while it is filled", async () => {
    await render();
    await openDialog();
    const custom = container.querySelector("#generate-custom-codes") as HTMLInputElement;
    const count = container.querySelector("#generate-count") as HTMLInputElement;
    expect(custom).not.toBeNull();
    expect(count.disabled).toBe(false);
    await act(async () => setInputValue(custom, "SUMMER27, THANKS27"));
    expect(count.disabled).toBe(true);
    await act(async () => setInputValue(custom, "  "));
    expect(count.disabled).toBe(false);
  });

  it("sends custom codes comma-separated instead of a random batch", async () => {
    createInviteCodes.mockResolvedValue([]);
    await render();
    await openDialog();
    const custom = container.querySelector("#generate-custom-codes") as HTMLInputElement;
    await act(async () => setInputValue(custom, "SUMMER27，THANKS27, "));
    await act(async () => button("Generate").click());
    await vi.waitFor(() =>
      expect(createInviteCodes).toHaveBeenCalledWith({
        count: 1,
        maxUses: 1,
        expiresInDays: 30,
        codes: ["SUMMER27", "THANKS27"],
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith("2 invite codes generated");
  });

  it("appends a random code when the random button is clicked", async () => {
    createInviteCodes.mockResolvedValue([]);
    await render();
    await openDialog();
    const custom = container.querySelector("#generate-custom-codes") as HTMLInputElement;
    await act(async () => button("Generate random").click());
    expect(custom.value).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    await act(async () => button("Generate random").click());
    const appended = custom.value.split(",").map((entry) => entry.trim());
    expect(appended).toHaveLength(2);
    expect(appended[0]).not.toBe(appended[1]);
    for (const code of appended) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    await act(async () => button("Generate").click());
    await vi.waitFor(() =>
      expect(createInviteCodes).toHaveBeenCalledWith({
        count: 1,
        maxUses: 1,
        expiresInDays: 30,
        codes: appended,
      }),
    );
  });

  it("generates a random batch when no custom codes are entered", async () => {
    createInviteCodes.mockResolvedValue([]);
    await render();
    await openDialog();
    await act(async () => button("Generate").click());
    await vi.waitFor(() =>
      expect(createInviteCodes).toHaveBeenCalledWith({
        count: 10,
        maxUses: 1,
        expiresInDays: 30,
        codes: undefined,
      }),
    );
  });

  it("shows the server duplicate error", async () => {
    createInviteCodes.mockRejectedValue(
      new Error("An invite code with that value already exists: SUMMER27."),
    );
    await render();
    await openDialog();
    const custom = container.querySelector("#generate-custom-codes") as HTMLInputElement;
    await act(async () => setInputValue(custom, "SUMMER27"));
    await act(async () => button("Generate").click());
    await vi.waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "An invite code with that value already exists: SUMMER27.",
      ),
    );
  });

  it("shows a referral badge for referral codes", async () => {
    listRows.current = [
      {
        id: "code-1",
        code: "REFERRALCODE1",
        status: "active",
        usedCount: 3,
        maxUses: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
        isReferral: true,
      },
      {
        id: "code-2",
        code: "ADMINCODE1234",
        status: "active",
        usedCount: 0,
        maxUses: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
        isReferral: false,
      },
    ];
    await render();
    await vi.waitFor(() => {
      if (!container.textContent?.includes("REFERRALCODE1"))
        throw new Error("waiting for the list");
    });
    const badges = [...container.querySelectorAll("span")].filter(
      (node) => node.textContent === "Referral",
    );
    expect(badges).toHaveLength(1);
  });
});
