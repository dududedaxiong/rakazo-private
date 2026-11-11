// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const accountToken = vi.hoisted(() => vi.fn());

// The dialog itself is tested on its own; here it confirms at once.
vi.mock("./ConfirmIdentityDialog", async () => {
  const { useState } = await import("react");
  const { runWithIdentityConfirmation } = await import("@rakazo/contracts");
  return {
    useIdentityConfirmation: () => {
      const [settle, setSettle] = useState<((confirmed: boolean) => void) | null>(null);
      return {
        withIdentityConfirmation: <T,>(action: () => Promise<T>) =>
          runWithIdentityConfirmation(
            action,
            () => new Promise<boolean>((resolve) => setSettle(() => resolve)),
          ),
        identityDialog: settle ? (
          <button
            type="button"
            data-testid="identity-confirm"
            onClick={() => {
              settle(true);
              setSettle(null);
            }}
          />
        ) : null,
      };
    },
  };
});
vi.mock("../lib/rpc", () => ({
  rpc: { export: { accountToken } },
  recheckSessionOnUnauthorized: () => undefined,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((acc, part, i) => acc + part + (values[i] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button type="button" {...props} />
  ),
  Spinner: () => null,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor arrives via props.
  Label: ({ children, ...props }: ComponentProps<"label">) => <label {...props}>{children}</label>,
}));
vi.mock("./ai/primitives", () => ({
  SuccessPop: ({ label }: { label: string }) => <span data-testid="success">{label}</span>,
}));

import { AccountDataSettings } from "./AccountDataSettings";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", webcrypto);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  accountToken.mockReset();
});

it("renders the WebDAV section between the backup password and the agent import", async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/webdav-backup/account") {
      return new Response(JSON.stringify({ account: null }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  await act(async () => {
    root.render(<AccountDataSettings onImportAgent={() => undefined} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const text = container.textContent ?? "";
  const backupPasswordAt = text.indexOf("Backup password");
  const webdavAt = text.indexOf("WebDAV backup");
  const agentAt = text.indexOf("Agent from another app");
  expect(backupPasswordAt).toBeGreaterThanOrEqual(0);
  expect(webdavAt).toBeGreaterThan(backupPasswordAt);
  expect(agentAt).toBeGreaterThan(webdavAt);
  expect(fetchMock).toHaveBeenCalledWith("/api/webdav-backup/account", {
    credentials: "include",
  });
});
