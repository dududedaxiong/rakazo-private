import { createSha256 } from "./backup-crypto";
import { BACKUP_PASSWORD_HEADER } from "./backup-password";
import { recheckSessionOnUnauthorized } from "./rpc";
import type { WebdavBackupAccount } from "./webdav-backup";
import {
  normalizeWebdavServerUrl,
  sanitizeBackupDirectory,
  WebdavBackupError,
} from "./webdav-backup";

/**
 * Web transfers for WebDAV backup. The export is a POST (the backup
 * password rides in the POST body with the one-time account token), and the
 * zip travels to and from the WebDAV server through the server proxy, never
 * directly — so the browser never needs the WebDAV password.
 *
 * The zip upload reports progress through a counting stream: fetch has no
 * upload-progress event, but the browser pulls the stream as it sends, so
 * the counted bytes track the upload.
 */

export type ExportDownloadResult = {
  blob: Blob;
  size: number;
  sha256: string;
};

/** The proxy path for a file: directory segments plus the file, percent-encoded. */
export function webdavProxyPath(account: WebdavBackupAccount, fileName: string): string {
  const directory = sanitizeBackupDirectory(account.directory);
  if (!directory.ok) throw new WebdavBackupError(directory.error);
  const normalized = normalizeWebdavServerUrl(account.serverUrl);
  if (!normalized.ok) throw new WebdavBackupError(normalized.error);
  return [...directory.segments, fileName].map((part) => encodeURIComponent(part)).join("/");
}

function proxyStatus(response: Response): number {
  const status = Number(response.headers.get("x-webdav-status") ?? 0);
  return Number.isInteger(status) ? status : 0;
}

/** A proxy 401 is the session, not the WebDAV account: recheck and fail plainly. */
function throwIfProxyUnauthorized(response: Response): void {
  if (response.status === 401) {
    recheckSessionOnUnauthorized(response.status);
    throw new Error("WebDAV proxy session expired");
  }
}

/**
 * POSTs the account export (one-time token + backup password in the JSON
 * body, never in a URL) and streams the zip into a blob, feeding the
 * SHA-256 as it goes. The token is single-use: a failure here spends it, so
 * callers must fetch a fresh token before retrying — never reuse one.
 */
export async function downloadAccountExport(input: {
  accountToken: string;
  backupPassword: string;
  onProgress?: (written: number, total: number) => void;
}): Promise<ExportDownloadResult> {
  let response: Response;
  try {
    response = await fetch("/api/account/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      redirect: "error",
      body: JSON.stringify({ token: input.accountToken, backupPassword: input.backupPassword }),
    });
  } catch {
    throw new WebdavBackupError("export-failed");
  }
  recheckSessionOnUnauthorized(response.status);
  if (!response.ok) {
    throw new WebdavBackupError(
      response.status === 401 || response.status === 410 ? "export-expired" : "export-failed",
    );
  }
  const total = Number(response.headers.get("content-length") ?? 0) || -1;
  const body = response.body;
  if (!body) throw new WebdavBackupError("export-failed");
  const hasher = createSha256();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      hasher.update(value);
      size += value.length;
      input.onProgress?.(size, total);
    }
  } catch {
    throw new WebdavBackupError("export-failed");
  }
  return {
    blob: new Blob(chunks as BlobPart[], { type: "application/zip" }),
    size,
    sha256: hasher.digest(),
  };
}

/** PUTs a blob on the WebDAV server through the proxy, with upload progress. */
export async function uploadZipToWebdav(input: {
  account: WebdavBackupAccount;
  fileName: string;
  blob: Blob;
  onProgress?: (sent: number, total: number) => void;
}): Promise<void> {
  const path = webdavProxyPath(input.account, input.fileName);
  const total = input.blob.size;
  let sent = 0;
  const counting = input.blob.stream().pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.length;
        input.onProgress?.(sent, total);
        controller.enqueue(chunk);
      },
    }),
  );
  let response: Response;
  try {
    response = await fetch(
      "/api/webdav-backup/proxy",
      // `duplex: "half"` is required for stream bodies; this TS lib predates it.
      {
        method: "POST",
        headers: {
          "x-webdav-method": "PUT",
          "x-webdav-path": path,
          "content-type": "application/zip",
        },
        credentials: "include",
        body: counting,
        duplex: "half",
      } as RequestInit,
    );
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  throwIfProxyUnauthorized(response);
  const status = proxyStatus(response);
  if (!status) throw new WebdavBackupError("server-error");
  if (status === 401 || status === 403) throw new WebdavBackupError("auth");
  if (status < 200 || status >= 300) throw new WebdavBackupError("server-error");
}

/** GETs a WebDAV file through the proxy, straight into a blob. */
export async function downloadZipFromWebdav(input: {
  account: WebdavBackupAccount;
  fileName: string;
}): Promise<Blob> {
  const path = webdavProxyPath(input.account, input.fileName);
  let response: Response;
  try {
    response = await fetch("/api/webdav-backup/proxy", {
      method: "POST",
      headers: { "x-webdav-method": "GET", "x-webdav-path": path },
      credentials: "include",
    });
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  throwIfProxyUnauthorized(response);
  const status = proxyStatus(response);
  if (!status) throw new WebdavBackupError("server-error");
  if (status === 404) throw new WebdavBackupError("not-found");
  if (status === 401 || status === 403) throw new WebdavBackupError("auth");
  if (status !== 200) throw new WebdavBackupError("server-error");
  return response.blob();
}

/**
 * POSTs a downloaded zip to the account import route as `application/zip`.
 * Restore imports as a new copy and never overwrites; the server reports a
 * wrong backup password through the import result, not through this call,
 * so the result is returned even on failure and the caller reads it.
 */
export async function importAccountZip(input: {
  blob: Blob;
  backupPassword: string;
}): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch("/api/account/import", {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        [BACKUP_PASSWORD_HEADER]: input.backupPassword,
      },
      credentials: "include",
      body: input.blob,
    });
  } catch {
    throw new WebdavBackupError("unreachable");
  }
  recheckSessionOnUnauthorized(response.status);
  const body = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, body };
}
