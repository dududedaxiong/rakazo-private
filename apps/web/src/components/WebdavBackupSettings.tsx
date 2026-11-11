import { Trans, useLingui } from "@lingui/react/macro";
import { isIdentityConfirmationRequired } from "@rakazo/contracts";
import { Button, Input, Label, Spinner } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import {
  BACKUP_PASSWORD_MIN_LENGTH,
  canSendBackupPassword,
  isBackupPasswordBreached,
  validateBackupPassword,
} from "../lib/backup-password";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import type {
  BackupManifest,
  WebdavBackupAccount,
  WebdavBackupErrorCode,
} from "../lib/webdav-backup";
import {
  buildBackupManifest,
  ensureWebdavDirectory,
  getWebdavTextFile,
  listWebdavDirectory,
  normalizeWebdavServerUrl,
  parseBackupManifest,
  putWebdavTextFile,
  sanitizeBackupDirectory,
  testWebdavConnection,
  WEBDAV_BACKUP_MANIFEST_NAME,
  WEBDAV_BACKUP_ZIP_NAME,
  WebdavBackupError,
} from "../lib/webdav-backup";
import { loadWebdavBackupAccount, saveWebdavBackupAccount } from "../lib/webdav-backup-account";
import {
  downloadAccountExport,
  downloadZipFromWebdav,
  importAccountZip,
  uploadZipToWebdav,
} from "../lib/webdav-backup-transfer";
import { SuccessPop } from "./ai/primitives";
import { useIdentityConfirmation } from "./ConfirmIdentityDialog";
import { SettingsRow } from "./SettingsRows";

type Busy = "saving" | "testing" | "uploading" | "downloading" | null;

/**
 * WebDAV backup, in the data group of account settings. The backup password
 * lives in the shared "Backup password" row above and is passed in: it is
 * never stored, only held in state for the operation that needs it, and
 * cleared the moment the operation ends.
 *
 * The account itself is saved with its own button: the server never returns
 * the password, so an empty password field on save keeps the stored one.
 * Test connection saves first, because the proxy tests the stored account.
 */
export function WebdavBackupSettings({
  backupPassword,
  backupPasswordConfirm,
  onBackupPasswordUsed,
  onImported,
}: {
  backupPassword: string;
  backupPasswordConfirm: string;
  onBackupPasswordUsed: () => void;
  onImported?: () => Promise<void>;
}) {
  const { t } = useLingui();
  const { withIdentityConfirmation, identityDialog } = useIdentityConfirmation();
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [directory, setDirectory] = useState("");
  const [hasAccount, setHasAccount] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const setBusyState = (next: Busy) => {
    busyRef.current = next;
    setBusy(next);
  };
  const [progress, setProgress] = useState<{ text: string; percent: number | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<BackupManifest | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    void (async () => {
      let meta: Awaited<ReturnType<typeof loadWebdavBackupAccount>>;
      try {
        meta = await loadWebdavBackupAccount();
      } catch {
        return;
      }
      if (cancelled || !meta) return;
      setServerUrl(meta.serverUrl);
      setUsername(meta.username);
      setDirectory(meta.directory);
      setHasAccount(true);
      const account: WebdavBackupAccount = {
        serverUrl: meta.serverUrl,
        username: meta.username,
        password: "",
        directory: meta.directory,
      };
      const manifestText = await getWebdavTextFile(account, WEBDAV_BACKUP_MANIFEST_NAME).catch(
        () => null,
      );
      if (cancelled || !manifestText) return;
      let manifest: BackupManifest | null = null;
      try {
        manifest = parseBackupManifest(JSON.parse(manifestText) as unknown);
      } catch {
        manifest = null;
      }
      if (manifest) setLastBackup(manifest);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function messageForCode(code: WebdavBackupErrorCode): string {
    switch (code) {
      case "https-required":
        return t`Use an https address.`;
      case "invalid-url":
        return t`That server address is not valid.`;
      case "credentials-in-url":
        return t`Put the account and password in their own fields, not in the address.`;
      case "invalid-directory":
        return t`The directory is not valid.`;
      case "auth":
        return t`Wrong password`;
      case "parent-missing":
        return t`A parent directory is missing on the server.`;
      case "not-found":
        return t`No backup found on the server.`;
      case "export-expired":
        return t`The export link expired. Try again.`;
      case "unreachable":
        return t`Could not reach the server`;
      default:
        return t`Something went wrong. Try again.`;
    }
  }

  function report(cause: unknown): void {
    if (cause instanceof WebdavBackupError) {
      setError(messageForCode(cause.code));
      return;
    }
    if (isIdentityConfirmationRequired(cause)) return;
    setError(errorText(cause, t`Something went wrong. Try again.`));
  }

  function accountFromFields(): WebdavBackupAccount | null {
    const normalized = normalizeWebdavServerUrl(serverUrl);
    if (!normalized.ok) {
      setError(messageForCode(normalized.error));
      return null;
    }
    const clean = sanitizeBackupDirectory(directory);
    if (!clean.ok) {
      setError(messageForCode(clean.error));
      return null;
    }
    if (!username.trim()) {
      setError(t`Enter the username.`);
      return null;
    }
    return {
      serverUrl: normalized.serverUrl,
      username: username.trim(),
      password: accountPassword,
      directory: clean.segments.join("/"),
    };
  }

  async function persistAccount(): Promise<WebdavBackupAccount | null> {
    const account = accountFromFields();
    if (!account) return null;
    if (!hasAccount && !accountPassword) {
      setError(t`Enter the WebDAV password.`);
      return null;
    }
    try {
      const meta = await saveWebdavBackupAccount({
        serverUrl: account.serverUrl,
        username: account.username,
        password: account.password,
        directory: account.directory,
      });
      setServerUrl(meta.serverUrl);
      setUsername(meta.username);
      setDirectory(meta.directory);
      setHasAccount(true);
      return account;
    } catch (cause) {
      setError(errorText(cause, t`Something went wrong. Try again.`));
      return null;
    }
  }

  async function saveAccount(): Promise<void> {
    if (busyRef.current) return;
    setBusyState("saving");
    setError(null);
    setStatus(null);
    try {
      const account = await persistAccount();
      if (account) setStatus(t`Saved`);
    } finally {
      setBusyState(null);
    }
  }

  async function testConnection(): Promise<void> {
    if (busyRef.current) return;
    setBusyState("testing");
    setError(null);
    setStatus(null);
    try {
      const account = await persistAccount();
      if (!account) return;
      const result = await testWebdavConnection(account);
      if (result.status === "ok") setStatus(t`Connected`);
      else if (result.status === "auth-error") setError(t`Wrong password`);
      else if (result.status === "missing-directory")
        setStatus(t`Signed in, but the backup directory does not exist yet.`);
      else if (result.status === "unreachable") setError(t`Could not reach the server`);
      else setError(t`The server answered with an error.`);
    } catch (cause) {
      report(cause);
    } finally {
      setBusyState(null);
    }
  }

  function progressText(
    label: string,
    written: number,
    total: number,
  ): { text: string; percent: number | null } {
    return total > 0
      ? {
          text: `${label} ${Math.round((written / total) * 100)}%`,
          percent: Math.round((written / total) * 100),
        }
      : { text: label, percent: null };
  }

  async function checkBackupPassword(): Promise<string | null> {
    const problem = validateBackupPassword(backupPassword, backupPasswordConfirm);
    if (problem === "too-short") {
      setError(t`Use at least ${BACKUP_PASSWORD_MIN_LENGTH} characters for the backup password`);
      return null;
    }
    if (problem === "mismatch") {
      setError(t`Backup passwords do not match`);
      return null;
    }
    if (!canSendBackupPassword()) {
      setError(t`Backup passwords need an HTTPS connection`);
      return null;
    }
    // The stored WebDAV password is never sent to the client, so this only
    // runs while the field still holds the password just typed.
    if (accountPassword !== "" && backupPassword === accountPassword) {
      setError(t`Use a different password from your account password.`);
      return null;
    }
    if (await isBackupPasswordBreached(backupPassword)) {
      setError(t`This password appeared in a data breach. Choose another.`);
      return null;
    }
    return backupPassword;
  }

  async function runBackup(): Promise<void> {
    if (busyRef.current) return;
    const account = await persistAccount();
    if (!account) return;
    const password = await checkBackupPassword();
    if (!password) return;
    setBusyState("uploading");
    setError(null);
    setStatus(null);
    try {
      await ensureWebdavDirectory(account);
      // The export token is one-time: a failed download spends it, so a
      // retry fetches a fresh token instead of reusing it.
      let downloaded: Awaited<ReturnType<typeof downloadAccountExport>> | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2 && !downloaded; attempt += 1) {
        try {
          const { token } = await withIdentityConfirmation(() => rpc.export.accountToken());
          downloaded = await downloadAccountExport({
            accountToken: token,
            backupPassword: password,
            onProgress: (written, total) =>
              setProgress(progressText(t`Downloading…`, written, total)),
          });
        } catch (cause) {
          lastError = cause;
        }
      }
      if (!downloaded) throw lastError ?? new WebdavBackupError("export-failed");
      const manifest = buildBackupManifest({ size: downloaded.size, sha256: downloaded.sha256 });
      setProgress({ text: t`Uploading…`, percent: null });
      await uploadZipToWebdav({
        account,
        fileName: WEBDAV_BACKUP_ZIP_NAME,
        blob: downloaded.blob,
        onProgress: (sent, total) => setProgress(progressText(t`Uploading…`, sent, total)),
      });
      await putWebdavTextFile(
        account,
        WEBDAV_BACKUP_MANIFEST_NAME,
        JSON.stringify(manifest),
        "application/json",
      );
      setLastBackup(manifest);
      setStatus(t`Backed up`);
    } catch (cause) {
      report(cause);
    } finally {
      setProgress(null);
      setBusyState(null);
      // The backup password only lives in memory for the operation.
      onBackupPasswordUsed();
    }
  }

  async function runRestore(): Promise<void> {
    if (busyRef.current) return;
    const account = await persistAccount();
    if (!account) return;
    // A restore must verify the backup password, the same as a backup:
    // without it the keys stay locked.
    if (!backupPassword) {
      setError(t`Enter the backup password to restore`);
      return;
    }
    setBusyState("downloading");
    setError(null);
    setStatus(null);
    try {
      const names = await listWebdavDirectory(account);
      if (!names.includes(WEBDAV_BACKUP_ZIP_NAME)) {
        throw new WebdavBackupError("not-found");
      }
      setProgress({ text: t`Downloading…`, percent: null });
      const blob = await downloadZipFromWebdav({ account, fileName: WEBDAV_BACKUP_ZIP_NAME });
      const manifestText = await getWebdavTextFile(account, WEBDAV_BACKUP_MANIFEST_NAME).catch(
        () => null,
      );
      const manifest = manifestText
        ? (() => {
            try {
              return parseBackupManifest(JSON.parse(manifestText) as unknown);
            } catch {
              return null;
            }
          })()
        : null;
      setProgress({ text: t`Uploading…`, percent: null });
      const result = await importAccountZip({ blob, backupPassword });
      const body = result.body as {
        error?: unknown;
        credentials?: { error?: unknown };
      } | null;
      if (result.status < 200 || result.status >= 300) {
        setError(
          typeof body?.error === "string" && body.error
            ? body.error
            : t`Something went wrong. Try again.`,
        );
        return;
      }
      if (typeof body?.error === "string" && body.error) {
        setError(body.error);
        return;
      }
      if (typeof body?.credentials?.error === "string" && body.credentials.error) {
        setError(t`The backup password is wrong.`);
        return;
      }
      if (manifest) setLastBackup(manifest);
      await onImported?.().catch(() => undefined);
      setStatus(t`Restored`);
    } catch (cause) {
      report(cause);
    } finally {
      setProgress(null);
      setBusyState(null);
      onBackupPasswordUsed();
    }
  }

  const disabled = busy !== null;

  return (
    <>
      <SettingsRow
        label={<Trans>WebDAV backup</Trans>}
        control={
          <>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t`Save WebDAV account`}
              data-testid="webdav-save"
              disabled={disabled}
              aria-busy={busy === "saving"}
              onClick={() => void saveAccount()}
            >
              {busy === "saving" ? <Spinner aria-hidden /> : null}
              <Trans>Save</Trans>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t`Test WebDAV connection`}
              data-testid="webdav-test"
              disabled={disabled}
              aria-busy={busy === "testing"}
              onClick={() => void testConnection()}
            >
              {busy === "testing" ? <Spinner aria-hidden /> : null}
              <Trans>Test connection</Trans>
            </Button>
          </>
        }
      >
        <div className="mt-2 max-w-md space-y-2">
          <div className="space-y-2">
            <Label htmlFor="webdav-server-url">
              <Trans>Server address</Trans>
            </Label>
            <Input
              id="webdav-server-url"
              data-testid="webdav-server-url"
              type="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="https://"
              value={serverUrl}
              disabled={disabled}
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webdav-username">
              <Trans>Username</Trans>
            </Label>
            <Input
              id="webdav-username"
              data-testid="webdav-username"
              autoCapitalize="off"
              autoCorrect="off"
              value={username}
              disabled={disabled}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webdav-password">
              <Trans>Password</Trans>
            </Label>
            <Input
              id="webdav-password"
              data-testid="webdav-password"
              type="password"
              autoComplete="new-password"
              placeholder={hasAccount ? t`Password set` : undefined}
              value={accountPassword}
              disabled={disabled}
              onChange={(event) => setAccountPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webdav-directory">
              <Trans>Backup directory</Trans>
            </Label>
            <Input
              id="webdav-directory"
              data-testid="webdav-directory"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="rakazo-backup"
              value={directory}
              disabled={disabled}
              onChange={(event) => setDirectory(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label={t`Back up now`}
              data-testid="webdav-backup"
              disabled={disabled}
              aria-busy={busy === "uploading"}
              onClick={() => void runBackup()}
            >
              {busy === "uploading" ? <Spinner aria-hidden /> : null}
              <Trans>Back up now</Trans>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t`Restore from WebDAV`}
              data-testid="webdav-restore"
              disabled={disabled}
              aria-busy={busy === "downloading"}
              onClick={() => void runRestore()}
            >
              {busy === "downloading" ? <Spinner aria-hidden /> : null}
              <Trans>Restore from WebDAV</Trans>
            </Button>
            {status ? <SuccessPop label={status} /> : null}
          </div>
          <p className="text-body-sm text-muted-foreground">
            {lastBackup
              ? t`Last backup: ${new Date(lastBackup.exportedAt).toLocaleString()}`
              : t`No backup yet`}
          </p>
          {progress ? (
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <Spinner aria-hidden />
                {progress.text}
              </p>
              {progress.percent !== null ? (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={progress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </SettingsRow>
      {identityDialog}
    </>
  );
}
