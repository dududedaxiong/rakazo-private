import { Trans, useLingui } from "@lingui/react/macro";
import type { MiscSettings } from "@rakazo_mickvvw/contracts";
import type { ArtifactCategory, ArtifactSoftwareKind } from "@rakazo_mickvvw/core";
import { Button, buttonVariants, Input, SectionHeading, Spinner } from "@rakazo_mickvvw/ui-web";
import {
  Apple,
  AppWindow,
  Archive,
  Box,
  ChevronLeft,
  FileCode2,
  FileText,
  ImageIcon,
  Monitor,
  Smartphone,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

type CategoryIcon = typeof ImageIcon;

function ExtensionEditor({
  extensions,
  onAdd,
  onRemove,
  blocked,
}: {
  extensions: string[];
  onAdd: (extension: string) => void;
  onRemove: (extension: string) => void;
  blocked?: readonly string[];
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState("");
  function submit() {
    const cleaned = draft.trim().replace(/^\./, "").toLowerCase();
    setDraft("");
    if (!/^[a-z0-9]+$/.test(cleaned)) return;
    if (extensions.includes(cleaned)) return;
    if (blocked?.includes(cleaned)) return;
    onAdd(cleaned);
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {extensions.map((extension) => (
          <span
            key={extension}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-body-sm"
          >
            {extension}
            <button
              type="button"
              aria-label={t`Remove "${extension}"`}
              onClick={() => onRemove(extension)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={t`Add extension`}
          className="min-w-0 flex-1"
        />
        <Button variant="outline" size="sm" onClick={submit} className="shrink-0">
          <Trans>Add</Trans>
        </Button>
      </div>
    </div>
  );
}

export function MiscSettingsPage() {
  const { t } = useLingui();
  const [settings, setSettings] = useState<MiscSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef<MiscSettings | null>(null);
  const lastSavedRef = useRef<MiscSettings | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await rpc.miscSettings.get();
      setSettings(next);
      lastSavedRef.current = next;
    } catch (cause) {
      setLoadError(errorText(cause, t`Could not load settings`));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(next: MiscSettings) {
    pendingRef.current = next;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (pendingRef.current) {
        const current = pendingRef.current;
        pendingRef.current = null;
        try {
          await rpc.miscSettings.set(current);
        } catch (cause) {
          setSaveError(errorText(cause, t`Could not save settings`));
          setSettings(lastSavedRef.current);
          pendingRef.current = null;
          break;
        }
        lastSavedRef.current = current;
      }
    } finally {
      savingRef.current = false;
    }
  }

  function updateSettings(next: MiscSettings) {
    setSettings(next);
    setSaveError(null);
    void saveSettings(next);
  }

  const categorySections: {
    key: Exclude<ArtifactCategory, "software" | "other">;
    label: string;
    icon: CategoryIcon;
  }[] = [
    { key: "image", label: t`Images`, icon: ImageIcon },
    { key: "video", label: t`Film and video`, icon: Video },
    { key: "archive", label: t`Archives`, icon: Archive },
    { key: "script", label: t`Scripts`, icon: FileCode2 },
    { key: "document", label: t`Documents`, icon: FileText },
  ];
  const softwareSections: { key: ArtifactSoftwareKind; label: string; icon: CategoryIcon }[] = [
    { key: "desktop", label: t`Desktop software`, icon: Monitor },
    { key: "apple", label: t`Apple software`, icon: Apple },
    { key: "android", label: t`Android software`, icon: Smartphone },
    { key: "other", label: t`Other software`, icon: Box },
  ];

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90">
      <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        {desktopBridge() ? <WindowChrome /> : null}
        <div className="flex min-w-fit flex-1 items-center gap-1">
          <Link
            to="/app"
            aria-label={t`Back`}
            className={buttonVariants({
              variant: "ghost",
              size: "icon",
              className: "app-no-drag text-muted-foreground",
            })}
          >
            <ChevronLeft />
          </Link>
          <h1 className="font-medium text-foreground">
            <Trans>Miscellaneous settings</Trans>
          </h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6">
          {settings === null ? (
            <div className="grid place-items-center py-16 text-muted-foreground/80">
              {loadError ? (
                <div className="flex flex-col items-center gap-3">
                  <p role="alert" className="text-body text-destructive">
                    {loadError}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void load()}>
                    <Trans>Try again</Trans>
                  </Button>
                </div>
              ) : (
                <Spinner aria-label={t`Loading…`} />
              )}
            </div>
          ) : (
            <>
              {categorySections.map((section) => {
                const Icon = section.icon;
                return (
                  <section key={section.key} className="flex flex-col gap-3">
                    <SectionHeading className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      {section.label}
                    </SectionHeading>
                    <ExtensionEditor
                      extensions={settings.categories[section.key]}
                      onAdd={(extension) =>
                        updateSettings({
                          ...settings,
                          categories: {
                            ...settings.categories,
                            [section.key]: [...settings.categories[section.key], extension],
                          },
                        })
                      }
                      onRemove={(extension) =>
                        updateSettings({
                          ...settings,
                          categories: {
                            ...settings.categories,
                            [section.key]: settings.categories[section.key].filter(
                              (item) => item !== extension,
                            ),
                          },
                        })
                      }
                    />
                  </section>
                );
              })}
              <section className="flex flex-col gap-3">
                <SectionHeading className="flex items-center gap-2">
                  <AppWindow className="size-4 text-muted-foreground" />
                  <Trans>Software</Trans>
                </SectionHeading>
                {softwareSections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <div key={section.key} className="flex flex-col gap-3 pl-1">
                      <SectionHeading variant="label" className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        {section.label}
                      </SectionHeading>
                      <ExtensionEditor
                        extensions={settings.categories.software[section.key]}
                        onAdd={(extension) =>
                          updateSettings({
                            ...settings,
                            categories: {
                              ...settings.categories,
                              software: {
                                ...settings.categories.software,
                                [section.key]: [
                                  ...settings.categories.software[section.key],
                                  extension,
                                ],
                              },
                            },
                          })
                        }
                        onRemove={(extension) =>
                          updateSettings({
                            ...settings,
                            categories: {
                              ...settings.categories,
                              software: {
                                ...settings.categories.software,
                                [section.key]: settings.categories.software[section.key].filter(
                                  (item) => item !== extension,
                                ),
                              },
                            },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </section>
              <section className="flex flex-col gap-3">
                <SectionHeading className="flex items-center gap-2">
                  <Upload className="size-4 text-muted-foreground" />
                  <Trans>Upload formats</Trans>
                </SectionHeading>
                <ExtensionEditor
                  extensions={settings.uploadExtensions}
                  blocked={["env"]}
                  onAdd={(extension) =>
                    updateSettings({
                      ...settings,
                      uploadExtensions: [...settings.uploadExtensions, extension],
                    })
                  }
                  onRemove={(extension) =>
                    updateSettings({
                      ...settings,
                      uploadExtensions: settings.uploadExtensions.filter(
                        (item) => item !== extension,
                      ),
                    })
                  }
                />
              </section>
              {saveError ? (
                <p role="alert" className="text-body text-destructive">
                  {saveError}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
