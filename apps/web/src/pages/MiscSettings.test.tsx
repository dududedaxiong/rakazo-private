// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const miscSettings = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("../lib/rpc", () => ({
  rpc: { miscSettings },
  rpcForSpace: () => ({ miscSettings }),
  createSpaceRpc: () => ({ miscSettings }),
  selectedSpaceId: () => null,
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((acc, part, index) => acc + part + (values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo_mickvvw/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button {...props} />,
    buttonVariants: () => "",
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    SectionHeading: Container,
    Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
  };
});

import { MiscSettingsPage } from "./MiscSettings";

const saved = {
  categories: {
    image: ["png", "jpg"],
    video: ["mp4"],
    archive: ["zip"],
    script: ["py"],
    document: ["md"],
    software: { desktop: ["exe"], apple: ["dmg"], android: ["apk"], other: ["iso"] },
  },
  uploadExtensions: ["png", "py"],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  miscSettings.get.mockResolvedValue(saved);
  miscSettings.set.mockResolvedValue(saved);
});

async function renderPage() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/app/misc-settings"]}>
        <MiscSettingsPage />
      </MemoryRouter>,
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("opens the misc settings screen and shows the saved extensions", async () => {
  const { container, cleanup } = await renderPage();
  try {
    expect(miscSettings.get).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Miscellaneous settings");
    for (const label of ["Images", "Film and video", "Archives", "Scripts", "Documents"]) {
      expect(container.textContent).toContain(label);
    }
    for (const label of [
      "Desktop software",
      "Apple software",
      "Android software",
      "Other software",
    ]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toContain("Upload formats");
    expect(container.querySelector("button[aria-label='Remove \"png\"']")).not.toBeNull();
    expect(container.querySelector("button[aria-label='Remove \"exe\"']")).not.toBeNull();
  } finally {
    await cleanup();
  }
});

it("removing an extension saves without it", async () => {
  const { container, cleanup } = await renderPage();
  try {
    const remove = container.querySelector("button[aria-label='Remove \"jpg\"']")!;
    await act(async () => (remove as HTMLButtonElement).click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(miscSettings.set).toHaveBeenCalledWith({
      ...saved,
      categories: { ...saved.categories, image: ["png"] },
    });
  } finally {
    await cleanup();
  }
});

it("adding an extension saves with it", async () => {
  const { container, cleanup } = await renderPage();
  try {
    const inputs = [...container.querySelectorAll("input")];
    const input = inputs[0]!;
    await act(async () => setInputValue(input, "webp"));
    const add = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Add",
    )!;
    await act(async () => add.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(miscSettings.set).toHaveBeenCalledWith({
      ...saved,
      categories: { ...saved.categories, image: ["png", "jpg", "webp"] },
    });
  } finally {
    await cleanup();
  }
});

it("shows the load error with a retry", async () => {
  miscSettings.get.mockRejectedValueOnce(new Error(""));
  const { container, cleanup } = await renderPage();
  try {
    expect(container.textContent).toContain("Could not load settings");
    expect(container.textContent).toContain("Try again");
  } finally {
    await cleanup();
  }
});
