import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, PromptTemplate } from "@rakazo_mickvvw/contracts";
import { Badge, Button, SectionHeading, toast } from "@rakazo_mickvvw/ui-web";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { PromptTemplateEditor } from "./PromptTemplateEditor";

/**
 * A bot's persona tab: the persona it runs now, the templates it can switch to, and saving what
 * it runs now as a template. Switching applies at once; the next message uses the new prompt.
 */
export function BotPersonaSection({
  bot,
  onBotUpdated,
  onManageTemplates,
}: {
  bot: Bot;
  onBotUpdated: (bot: Bot) => void;
  onManageTemplates: () => void;
}) {
  const { t } = useLingui();
  const [current, setCurrent] = useState(bot);
  // A newer bot from the server (for instance after a switch elsewhere) replaces the one shown.
  useEffect(() => {
    if (bot.updatedAt >= current.updatedAt) setCurrent(bot);
  }, [bot]);
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.promptTemplates
      .list()
      .then((loaded) => {
        if (!cancelled) setTemplates(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const linked = templates?.find((template) => template.id === current.promptTemplateId) ?? null;
  const custom = current.promptTemplateId === null;

  async function apply(template: PromptTemplate) {
    if (applyingId || current.promptTemplateId === template.id) return;
    setApplyingId(template.id);
    setError(null);
    try {
      const updated = await rpc.promptTemplates.apply({
        templateId: template.id,
        botId: current.id,
      });
      setCurrent(updated);
      toast(t`Switched to ${template.name}`);
      onBotUpdated(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplyingId(null);
    }
  }

  async function saveCurrent() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await rpc.promptTemplates.saveCurrentAsTemplate({ botId: current.id });
      setTemplates((list) => {
        const next = [...(list ?? [])];
        const at = next.findIndex((entry) => entry.id === saved.id);
        if (at >= 0) next[at] = saved;
        else next.push(saved);
        return next;
      });
      toast(t`Saved as template`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="bot-persona">
      <section>
        <SectionHeading variant="label" className="mb-2">
          <Trans>Current persona</Trans>
        </SectionHeading>
        <div className="rounded-xl border border-border bg-muted/50 p-4">
          {custom ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-body font-medium">
                <Trans>Custom</Trans>
                <Badge variant="secondary">
                  <Trans>Not linked to a template</Trans>
                </Badge>
              </p>
              {current.instructions.trim() ? (
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-body-sm text-muted-foreground">
                  {current.instructions}
                </p>
              ) : (
                <p className="mt-1 text-body-sm text-muted-foreground">
                  <Trans>This bot has no persona yet.</Trans>
                </p>
              )}
            </>
          ) : linked ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-body font-medium">
                <span className="break-words">{linked.name}</span>
                <Badge>
                  <Trans>In use</Trans>
                </Badge>
                {linked.isBuiltIn ? (
                  <Badge variant="secondary">
                    <Trans>Built-in</Trans>
                  </Badge>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ms-auto rounded-full"
                  onClick={() => setEditing(linked)}
                >
                  <Trans>Edit template</Trans>
                </Button>
              </p>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-body-sm text-muted-foreground">
                {linked.content}
              </p>
            </>
          ) : (
            <p className="text-body-sm text-muted-foreground">
              <Trans>Loading…</Trans>
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionHeading variant="label" className="mb-2">
          <Trans>Switch persona</Trans>
        </SectionHeading>
        {loadError ? (
          <p role="alert" className="text-body text-destructive">
            {loadError}
          </p>
        ) : null}
        {templates === null && !loadError ? (
          <p className="text-body text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : null}
        <ul className="space-y-2">
          {(templates ?? []).map((template) => {
            const isCurrent = current.promptTemplateId === template.id;
            return (
              <li key={template.id}>
                <button
                  type="button"
                  aria-pressed={isCurrent}
                  disabled={applyingId !== null}
                  onClick={() => void apply(template)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-4 text-start ${
                    isCurrent ? "border-primary/40 bg-primary/5" : "border-border"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input"
                    }`}
                  >
                    {isCurrent ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium">{template.name}</span>
                    <span className="block truncate text-body-sm text-muted-foreground">
                      {template.content}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button className="rounded-full" disabled={saving} onClick={() => void saveCurrent()}>
          <Trans>Save current persona as template</Trans>
        </Button>
        <Button variant="outline" className="rounded-full" onClick={onManageTemplates}>
          <Trans>Manage templates</Trans>
        </Button>
      </div>
      <p className="text-body-sm text-muted-foreground">
        <Trans>
          Switching takes effect at once. The next message uses the new prompt; earlier messages
          stay as they are. Editing the instructions directly makes the persona custom.
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
          template={editing}
          bot={current}
          onClose={() => setEditing(null)}
          onSaved={(saved, appliedBot) => {
            setTemplates(
              (list) => list?.map((entry) => (entry.id === saved.id ? saved : entry)) ?? null,
            );
            if (appliedBot) {
              setCurrent(appliedBot);
              toast(t`Switched to ${saved.name}`);
              onBotUpdated(appliedBot);
            }
          }}
        />
      ) : null}
    </div>
  );
}
