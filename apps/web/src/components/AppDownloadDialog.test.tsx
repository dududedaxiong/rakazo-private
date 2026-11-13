// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { AppDownloadDialog } from "./AppDownloadDialog";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(downloads?: { androidUrl: string | null; iosUrl: string | null } | null) {
  await act(async () =>
    root.render(<AppDownloadDialog open onOpenChange={() => {}} downloads={downloads} />),
  );
  await act(async () => {});
}

describe("AppDownloadDialog", () => {
  it("shows a loading state while the links load", async () => {
    await render(undefined);
    expect(document.body.querySelector('[aria-label="Loading…"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("No app downloads are set up yet.");
  });

  it("shows a not-configured note when neither platform is set", async () => {
    await render({ androidUrl: null, iosUrl: null });
    expect(document.body.textContent).toContain("No app downloads are set up yet.");
    expect(document.body.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows only the configured platform", async () => {
    await render({ androidUrl: "https://example.com/app.apk", iosUrl: null });
    const links = [...document.body.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://example.com/app.apk");
    expect(links[0]!.textContent).toContain("Android");
    expect(document.body.textContent).not.toContain("iOS");
  });

  it("shows both platforms with their links", async () => {
    await render({
      androidUrl: "https://example.com/app.apk",
      iosUrl: "https://example.com/app.ipa",
    });
    const links = [...document.body.querySelectorAll("a")];
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/app.apk",
      "https://example.com/app.ipa",
    ]);
    expect(links[0]!.textContent).toContain("Android");
    expect(links[1]!.textContent).toContain("iOS");
  });
});
