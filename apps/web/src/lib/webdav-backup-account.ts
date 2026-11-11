import { recheckSessionOnUnauthorized } from "./rpc";

/**
 * The WebDAV account, stored sealed on the server (same encryption as a
 * provider key). The client only ever sees metadata: the password is never
 * returned, so the form keeps it in a field the user types and an empty
 * field on save means "keep the stored one".
 */

export type WebdavBackupAccountMeta = {
  serverUrl: string;
  username: string;
  directory: string;
  hasPassword: boolean;
};

function isMeta(value: unknown): value is WebdavBackupAccountMeta {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.serverUrl === "string" &&
    typeof item.username === "string" &&
    typeof item.directory === "string" &&
    typeof item.hasPassword === "boolean"
  );
}

export async function loadWebdavBackupAccount(): Promise<WebdavBackupAccountMeta | null> {
  const response = await fetch("/api/webdav-backup/account", { credentials: "include" });
  recheckSessionOnUnauthorized(response.status);
  if (!response.ok) throw new Error("Could not load the WebDAV account");
  const body = (await response.json().catch(() => null)) as { account?: unknown } | null;
  if (body?.account === null || body?.account === undefined) return null;
  if (!isMeta(body.account)) throw new Error("Could not load the WebDAV account");
  return body.account;
}

export async function saveWebdavBackupAccount(input: {
  serverUrl: string;
  username: string;
  /** Empty keeps the stored password; the server never returns it. */
  password: string;
  directory: string;
}): Promise<WebdavBackupAccountMeta> {
  const response = await fetch("/api/webdav-backup/account", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  recheckSessionOnUnauthorized(response.status);
  const body = (await response.json().catch(() => null)) as {
    account?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" && body.error
        ? body.error
        : "Could not save the WebDAV account",
    );
  }
  if (!isMeta(body?.account)) throw new Error("Could not save the WebDAV account");
  return body.account;
}

/** Clears the signed-in account's WebDAV record; call on account removal. */
export async function clearWebdavBackupAccount(): Promise<void> {
  const response = await fetch("/api/webdav-backup/account", {
    method: "DELETE",
    credentials: "include",
  });
  recheckSessionOnUnauthorized(response.status);
  if (!response.ok) throw new Error("Could not clear the WebDAV account");
}
