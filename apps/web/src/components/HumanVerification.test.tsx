// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HumanVerification } from "./HumanVerification";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo_mickvvw/ui-web", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
  Spinner: (props: ComponentProps<"span">) => <span {...props} />,
}));

type RenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let renderOptions: RenderOptions | undefined;
const render = vi.fn((_container: HTMLElement, options: RenderOptions) => {
  renderOptions = options;
  return "widget-1";
});
const remove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  renderOptions = undefined;
  window.turnstile = { render, reset: vi.fn(), remove };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.turnstile;
});

async function renderWidget(onToken: (token: string | null) => void, resetKey = 0) {
  await act(async () =>
    root.render(
      <HumanVerification siteKey="test-site-key" onToken={onToken} resetKey={resetKey} />,
    ),
  );
}

it("renders the challenge and reports its token", async () => {
  const onToken = vi.fn();
  await renderWidget(onToken);
  expect(render).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({ sitekey: "test-site-key" }),
  );
  expect(onToken).toHaveBeenCalledWith(null);
  await act(async () => renderOptions?.callback("token-123"));
  expect(onToken).toHaveBeenCalledWith("token-123");
});

it("reports null when the challenge expires", async () => {
  const onToken = vi.fn();
  await renderWidget(onToken);
  await act(async () => renderOptions?.callback("token-123"));
  await act(async () => renderOptions?.["expired-callback"]());
  expect(onToken).toHaveBeenLastCalledWith(null);
});

it("removes the widget on unmount", async () => {
  await renderWidget(vi.fn());
  await act(async () => root.unmount());
  expect(remove).toHaveBeenCalledWith("widget-1");
});

it("offers a retry when the challenge script fails to load", async () => {
  delete window.turnstile;
  // A fresh module, so the script cache from the passing tests does not hide the load.
  vi.resetModules();
  const { HumanVerification: FreshHumanVerification } = await import("./HumanVerification");
  const onToken = vi.fn();
  await act(async () =>
    root.render(<FreshHumanVerification siteKey="test-site-key" onToken={onToken} resetKey={0} />),
  );
  const script = document.head.querySelector("script");
  expect(script).not.toBeNull();
  await act(async () => script?.dispatchEvent(new Event("error")));
  expect(host.textContent).toContain("Could not load human verification");
  expect(host.querySelector("button")).not.toBeNull();
});
