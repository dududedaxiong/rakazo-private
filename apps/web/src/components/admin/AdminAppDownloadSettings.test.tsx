// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linksData = vi.hoisted(() => ({
  current: { androidUrl: "https://example.com/old.apk", iosUrl: null } as {
    androidUrl: string | null;
    iosUrl: string | null;
  },
}));
const updateLinks = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock("../../lib/query", () => ({
  useSpaceQueries: () => ({
    appDownloads: {
      get: {
        queryOptions: () => ({
          queryKey: ["appDownloads"],
          queryFn: async () => linksData.current,
        }),
        key: () => ["appDownloads"],
      },
    },
  }),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: { admin: { appDownloadSettings: { update: updateLinks } } },
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
  toast: toastMock,
}));

import { AdminAppDownloadSettings } from "./AdminAppDownloadSettings";

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
        <AdminAppDownloadSettings />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    if (!container.querySelector("#android-app-download-url"))
      throw new Error("waiting for the form");
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function input(label: string) {
  const found = [...container.querySelectorAll("input")].find(
    (node) =>
      node.id === (label === "Android" ? "android-app-download-url" : "ios-app-download-url"),
  );
  if (!found) throw new Error(`no input for ${label}`);
  return found;
}

async function clickSave() {
  const save = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Save settings",
  )!;
  await act(async () => save.click());
  await act(async () => {});
}

describe("AdminAppDownloadSettings", () => {
  it("saves a new Android link and clears an emptied iOS link", async () => {
    linksData.current = { androidUrl: "https://example.com/old.apk", iosUrl: null };
    updateLinks.mockResolvedValue({ androidUrl: "https://example.com/new.apk", iosUrl: null });
    await render();
    expect(input("Android").value).toBe("https://example.com/old.apk");
    expect(input("iOS").value).toBe("");
    await act(async () => setInputValue(input("Android"), "https://example.com/new.apk"));
    await clickSave();
    expect(updateLinks).toHaveBeenCalledWith({
      androidUrl: "https://example.com/new.apk",
      iosUrl: null,
    });
    expect(toastMock).toHaveBeenCalledWith("App download links saved");
  });

  it("rejects an invalid link without calling update", async () => {
    linksData.current = { androidUrl: null, iosUrl: null };
    await render();
    await act(async () => setInputValue(input("Android"), "not a link"));
    await clickSave();
    expect(updateLinks).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a valid link");
  });
});
