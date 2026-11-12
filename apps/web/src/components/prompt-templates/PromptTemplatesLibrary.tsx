import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, PromptTemplate } from "@rakazo/contracts";
import { Badge, Button, toast } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { downloadPromptTemplate, downloadPromptTemplates } from "../../lib/prompt-template-files";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { ConfirmDialog } from "../ConfirmDialog";
import { PromptTemplateEditor } from "./PromptTemplateEditor";
import { PromptTemplateImportDialog } from "./PromptTemplateImportDialog";

/**
 * The settings library: every template with a two-line preview. A bot in scope adds per-row
 * "Use" and the save-from-current action; without one this is only a library.
 */
export function PromptTemplatesLibrary({
  bot,
  onBotUpdated,
}: {
  bot?: Bot | null;
  onBotUpdated?: (bot: Bot) => void;
}) {
  const { t } = useLingui();
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromptTemplate | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<PromptTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      setTemplates(await rpc.promptTemplates.list());
    } catch (err) {
      setLoadError(errorText(err));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function upsert(saved: PromptTemplate[]) {
    setTemplates((current) => {
      const next = [...(current ?? [])];
      for (const template of saved) {
        const at = next.findIndex((entry) => entry.id === template.id);
        if (at >= 0) next[at] = template;
        else next.push(template);
      }
      return next;
    });
  }

  async function apply(template: PromptTemplate) {
    if (!bot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await rpc.promptTemplates.apply({ templateId: template.id, botId: bot.id });
      toast(t`Switched to ${template.name}`);
      onBotUpdated?.(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveFromCurrent() {
    if (!bot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await rpc.promptTemplates.saveCurrentAsTemplate({ botId: bot.id });
      upsert([saved]);
      toast(t`Saved as template`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefaults() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setTemplates(await rpc.promptTemplates.restoreDefaults());
      toast(t`Default templates restored`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: PromptTemplate) {
    setBusy(true);
    setError(null);
    try {
      await rpc.promptTemplates.remove({ templateId: template.id });
      setTemplates((current) => current?.filter((entry) => entry.id !== template.id) ?? null);
      setDeleting(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="prompt-templates-library">
      <div className="flex flex-wrap gap-2">
        <Button className="rounded-full" disabled={busy} onClick={() => setEditing("new")}>
          <Trans>New template</Trans>
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={busy}
          onClick={() => setImporting(true)}
        >
          <Trans>Import</Trans>
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={busy || !templates?.length}
          onClick={() => templates && downloadPromptTemplates(templates)}
        >
          <Trans>Export all</Trans>
        </Button>
        {bot ? (
          <Button
            variant="outline"
            className="rounded-full"
            disabled={busy}
            onClick={() => void saveFromCurrent()}
          >
            <Trans>Save current persona as template</Trans>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="rounded-full"
          disabled={busy}
          onClick={() => void restoreDefaults()}
        >
          <Trans>Restore defaults</Trans>
        </Button>
      </div>
      {loadError ? (
        <p role="alert" className="text-body text-destructive">
          {loadError}{" "}
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <Trans>Retry</Trans>
          </Button>
        </p>
      ) : null}
      {templates === null && !loadError ? (
        <p className="text-body text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : null}
      {templates?.length === 0 ? (
        <p className="text-body text-muted-foreground">
          <Trans>No templates yet. Create one or restore the defaults.</Trans>
        </p>
      ) : null}
      <ul className="space-y-3">
        {(templates ?? []).map((template) => {
          const inUse = bot?.promptTemplateId === template.id;
          return (
            <li
              key={template.id}
              className={`rounded-xl border p-4 ${inUse ? "border-primary/40 bg-primary/5" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-body font-medium">
                    <span className="break-words">{template.name}</span>
                    {inUse ? (
                      <Badge>
                        <Trans>In use</Trans>
                      </Badge>
                    ) : null}
                    {template.isBuiltIn ? (
                      <Badge variant="secondary">
                        <Trans>Built-in</Trans>
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <Trans>My template</Trans>
                      </Badge>
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-body-sm text-muted-foreground">
                    {template.content}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {bot && !inUse ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() => void apply(template)}
                  >
                    <Trans>Use</Trans>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => setEditing(template)}
                >
                  <Trans>Edit</Trans>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => downloadPromptTemplate(template)}
                >
                  <Trans>Export</Trans>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-destructive"
                  disabled={busy}
                  onClick={() => setDeleting(template)}
                >
                  <Trans>Delete</Trans>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-body-sm text-muted-foreground">
        <Trans>
          Exported files are named after the template. Edit one outside the app and import it again
          under the same name to update it; a template in use applies right away.
        </Trans>
      </p>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      {editing ? (
        <PromptTemplateEditor
          open
          template={editing === "new" ? null : editing}
          bot={bot}
          onClose={() => setEditing(null)}
          onSaved={(saved, appliedBot) => {
            upsert([saved]);
            if (appliedBot) {
              toast(t`Switched to ${saved.name}`);
              onBotUpdated?.(appliedBot);
            }
          }}
        />
      ) : null}
      {importing ? (
        <PromptTemplateImportDialog
          open
          bot={bot}
          onClose={() => setImporting(false)}
          onImported={(imported, updatedBot) => {
            upsert(imported);
            if (updatedBot) onBotUpdated?.(updatedBot);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t`Delete ${deleting.name}?`}
          description={
            bot?.promptTemplateId === deleting.id
              ? t`This bot keeps its current persona, but stops following this template.`
              : undefined
          }
          confirmLabel={t`Delete`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}
