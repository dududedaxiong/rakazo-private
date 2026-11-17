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
  const { runWithIdentityConfirmation } = await import("@rakazo_mickvvw/contracts");
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
vi.mock("@rakazo_mickvvw/ui-web", () => ({
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

import { WebdavBackupSettings } from "./WebdavBackupSettings";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function proxyResponse(status: number, body?: BodyInit) {
  return new Response(body, {
    status: 200,
    headers: { "x-webdav-status": String(status) },
  });
}

/** A breach-range reply that does not contain the password's suffix. */
function cleanRange() {
  return new Response("00AABBCC:2\n", { status: 200 });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", webcrypto);
  // jsdom's Blob lacks .stream(); shim the standard API for the upload path.
  if (typeof Blob.prototype.stream !== "function") {
    Blob.prototype.stream = function () {
      const blob = this as Blob;
      return new ReadableStream({
        async start(controller) {
          controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
          controller.close();
        },
      });
    };
  }
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

type RouteState = {
  storedAccount: {
    serverUrl: string;
    username: string;
    directory: string;
    hasPassword: boolean;
  } | null;
  manifest: string | null;
  importResult: unknown;
  propfindStatus: number;
  propfindBody: string;
};

function installFetchMock(state: RouteState) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.startsWith("https://api.pwnedpasswords.com/range/")) {
      return cleanRange();
    }
    if (url === "/api/webdav-backup/account") {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as {
          serverUrl: string;
          username: string;
          directory: string;
        };
        state.storedAccount = {
          serverUrl: body.serverUrl,
          username: body.username,
          directory: body.directory || "rakazo-backup",
          hasPassword: true,
        };
        return jsonResponse(200, { account: state.storedAccount });
      }
      return jsonResponse(200, { account: state.storedAccount });
    }
    if (url === "/api/webdav-backup/proxy") {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const method = headers["x-webdav-method"];
      const path = headers["x-webdav-path"] ?? "";
      if (method === "PUT" && init?.body) {
        // The network pulls the counting stream: consume it to drive progress.
        await new Response(init.body as BodyInit).arrayBuffer();
      }
      if (method === "PROPFIND") return proxyResponse(state.propfindStatus, state.propfindBody);
      if (method === "MKCOL") return proxyResponse(201);
      if (method === "PUT") return proxyResponse(201);
      if (method === "GET" && path.endsWith("rakazo-backup.zip")) {
        return proxyResponse(200, new Blob(["zip-bytes"], { type: "application/zip" }));
      }
      if (method === "GET" && path.endsWith("rakazo-backup.json")) {
        return state.manifest === null ? proxyResponse(404) : proxyResponse(200, state.manifest);
      }
      return proxyResponse(404);
    }
    if (url === "/api/account/export") {
      return new Response(new Blob(["zip-bytes"], { type: "application/zip" }), {
        status: 200,
        headers: { "content-length": "9" },
      });
    }
    if (url === "/api/account/import") {
      return jsonResponse(200, state.importResult);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function freshState(): RouteState {
  return {
    storedAccount: null,
    manifest: null,
    importResult: { ok: true },
    propfindStatus: 207,
    propfindBody: `<d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/rakazo-backup/</d:href></d:response>
      <d:response><d:href>/rakazo-backup/rakazo-backup.zip</d:href></d:response>
    </d:multistatus>`,
  };
}

async function render(
  props: {
    backupPassword?: string;
    backupPasswordConfirm?: string;
    onBackupPasswordUsed?: () => void;
    onImported?: () => Promise<void>;
  } = {},
) {
  await act(async () => {
    root.render(
      <WebdavBackupSettings
        backupPassword={props.backupPassword ?? ""}
        backupPasswordConfirm={props.backupPasswordConfirm ?? ""}
        onBackupPasswordUsed={props.onBackupPasswordUsed ?? (() => undefined)}
        onImported={props.onImported}
      />,
    );
  });
  await flush();
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Polls until the check passes: the backup chain spans several stream ticks. */
async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 30; i += 1) {
    await flush();
    if (check()) return;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function button(name: string) {
  const match = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );
  if (!match) throw new Error(`No ${name} button`);
  return match;
}

function input(testId: string) {
  return container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
}

async function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function fillAccountForm() {
  await setInputValue(input("webdav-server-url"), "https://dav.example.com");
  await setInputValue(input("webdav-username"), "alice");
  await setInputValue(input("webdav-password"), "s3cret-pass");
  await setInputValue(input("webdav-directory"), "");
}

it("shows the empty form and no backup yet", async () => {
  installFetchMock(freshState());
  await render();
  expect(input("webdav-server-url").value).toBe("");
  expect(container.textContent).toContain("No backup yet");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("loads a stored account and its last backup", async () => {
  const state = freshState();
  state.storedAccount = {
    serverUrl: "https://dav.example.com/dav",
    username: "alice",
    directory: "rakazo-backup",
    hasPassword: true,
  };
  state.manifest = JSON.stringify({
    version: 1,
    exportedAt: "2026-11-10T10:00:00.000Z",
    size: 9,
    sha256: "a".repeat(64),
  });
  installFetchMock(state);
  await render();
  expect(input("webdav-server-url").value).toBe("https://dav.example.com/dav");
  expect(input("webdav-username").value).toBe("alice");
  expect(input("webdav-password").placeholder).toBe("Password set");
  expect(container.textContent).toContain("Last backup:");
});

it("refuses an http server address on save", async () => {
  installFetchMock(freshState());
  await render();
  await setInputValue(input("webdav-server-url"), "http://dav.example.com");
  await setInputValue(input("webdav-username"), "alice");
  await setInputValue(input("webdav-password"), "s3cret-pass");
  await act(async () => button("Save").click());
  await flush();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Use an https address.");
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/webdav-backup/account")).toBe(true);
});

it("saves the account and reports Saved", async () => {
  const state = freshState();
  installFetchMock(state);
  await render();
  await fillAccountForm();
  await act(async () => button("Save").click());
  await flush();
  expect(state.storedAccount).toEqual({
    serverUrl: "https://dav.example.com",
    username: "alice",
    directory: "rakazo-backup",
    hasPassword: true,
  });
  expect(container.querySelector('[data-testid="success"]')).not.toBeNull();
});

it("tests the saved connection and reports Connected", async () => {
  installFetchMock(freshState());
  await render();
  await fillAccountForm();
  await act(async () => button("Test connection").click());
  await flush();
  expect(container.querySelector('[data-testid="success"]')?.textContent).toBe("Connected");
});

it("backs up through the proxy and clears the backup password", async () => {
  const state = freshState();
  installFetchMock(state);
  accountToken.mockResolvedValue({ token: "tok/1" });
  const onBackupPasswordUsed = vi.fn();
  await render({
    backupPassword: "correct horse battery staple",
    backupPasswordConfirm: "correct horse battery staple",
    onBackupPasswordUsed,
  });
  await fillAccountForm();
  await act(async () => button("Back up now").click());
  await waitFor(() => container.querySelector('[data-testid="success"]') !== null, "Backed up");
  expect(accountToken).toHaveBeenCalledTimes(1);
  const proxyCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/webdav-backup/proxy");
  const methods = proxyCalls.map(
    ([, init]) => (init as { headers: Record<string, string> }).headers["x-webdav-method"],
  );
  expect(methods).toContain("PUT");
  expect(container.querySelector('[data-testid="success"]')?.textContent).toBe("Backed up");
  expect(container.textContent).toContain("Last backup:");
  expect(onBackupPasswordUsed).toHaveBeenCalledTimes(1);
});

it("restores from the server and refreshes spaces", async () => {
  const state = freshState();
  installFetchMock(state);
  const onImported = vi.fn(async () => undefined);
  const onBackupPasswordUsed = vi.fn();
  await render({
    backupPassword: "correct horse battery staple",
    backupPasswordConfirm: "correct horse battery staple",
    onBackupPasswordUsed,
    onImported,
  });
  await fillAccountForm();
  await act(async () => button("Restore from WebDAV").click());
  await waitFor(() => container.querySelector('[data-testid="success"]') !== null, "Restored");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/account/import",
    expect.objectContaining({ method: "POST" }),
  );
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="success"]')?.textContent).toBe("Restored");
  expect(onBackupPasswordUsed).toHaveBeenCalledTimes(1);
});

it("reports a wrong backup password on restore", async () => {
  const state = freshState();
  state.importResult = { credentials: { error: "The backup password is incorrect." } };
  installFetchMock(state);
  await render({
    backupPassword: "correct horse battery staple",
    backupPasswordConfirm: "correct horse battery staple",
  });
  await fillAccountForm();
  await act(async () => button("Restore from WebDAV").click());
  await flush();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "The backup password is wrong.",
  );
});

it("requires the backup password for a backup", async () => {
  installFetchMock(freshState());
  await render();
  await fillAccountForm();
  await act(async () => button("Back up now").click());
  await flush();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Use at least 12 characters for the backup password",
  );
  expect(accountToken).not.toHaveBeenCalled();
});
