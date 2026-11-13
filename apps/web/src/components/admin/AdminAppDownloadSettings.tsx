import { Trans, useLingui } from "@lingui/react/macro";
import type { AppDownloadLinks } from "@rakazo/contracts";
import { Button, Field, FieldLabel, Input, SectionHeading, Spinner, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** Admin-only: the custom app download links shown by "Get the mobile app". */
export function AdminAppDownloadSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const links = useQuery(queries.appDownloads.get.queryOptions());
  const [formKey, setFormKey] = useState(0);
  if (links.isPending)
    return (
      <div className="grid place-items-center py-10">
        <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
      </div>
    );
  if (links.isError || !links.data)
    return (
      <div role="alert" className="flex items-center gap-3 text-body text-destructive">
        {errorText(links.error, t`Couldn't load app download links`)}
        <Button variant="outline" size="sm" onClick={() => void links.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  return (
    <SettingsForm key={formKey} initial={links.data} onSaved={() => setFormKey((key) => key + 1)} />
  );
}

function SettingsForm({ initial, onSaved }: { initial: AppDownloadLinks; onSaved: () => void }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [androidUrl, setAndroidUrl] = useState(initial.androidUrl ?? "");
  const [iosUrl, setIosUrl] = useState(initial.iosUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function parseUrl(value: string): string | null | undefined {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      new URL(trimmed);
    } catch {
      return undefined;
    }
    return trimmed;
  }

  async function save() {
    const android = parseUrl(androidUrl);
    const ios = parseUrl(iosUrl);
    if (android === undefined || ios === undefined) {
      setError(t`Enter a valid link, or leave it empty to hide that platform.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await rpc.admin.appDownloadSettings.update({ androidUrl: android, iosUrl: ios });
      await queryClient.invalidateQueries({ queryKey: queries.appDownloads.get.key() });
      toast(t`App download links saved`);
      onSaved();
    } catch (err) {
      toast.error(errorText(err, t`Could not save app download links`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeading>{t`Custom app download`}</SectionHeading>
      <p className="text-body-sm text-muted-foreground">
        <Trans>
          Links shown by “Get the mobile app” in the account menu. Leave a platform empty to hide
          it.
        </Trans>
      </p>
      <Field>
        <FieldLabel htmlFor="android-app-download-url">
          <Trans>Android download link</Trans>
        </FieldLabel>
        <Input
          id="android-app-download-url"
          value={androidUrl}
          inputMode="url"
          placeholder="https://example.com/app.apk"
          onChange={(event) => setAndroidUrl(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="ios-app-download-url">
          <Trans>iOS download link</Trans>
        </FieldLabel>
        <Input
          id="ios-app-download-url"
          value={iosUrl}
          inputMode="url"
          placeholder="https://example.com/app.ipa"
          onChange={(event) => setIosUrl(event.target.value)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? <Trans>Saving…</Trans> : <Trans>Save settings</Trans>}
      </Button>
    </div>
  );
}
