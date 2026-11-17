import { Trans } from "@lingui/react/macro";
import type { Bot, PromptTemplate } from "@rakazo_mickvvw/contracts";
import {
  BOT_INSTRUCTIONS_MAX_LENGTH,
  PROMPT_TEMPLATE_NAME_MAX_LENGTH,
} from "@rakazo_mickvvw/contracts";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@rakazo_mickvvw/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/**
 * Creates a template, or edits one. Editing the template a bot currently uses offers to apply
 * the saved content to that bot at once; otherwise only the template changes.
 */
export function PromptTemplateEditor({
  open,
  onClose,
  template,
  bot,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Null for a new template. */
  template: PromptTemplate | null;
  /** The bot the template applies to, when one is in scope. */
  bot?: Bot | null;
  onSaved: (template: PromptTemplate, appliedBot?: Bot) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [applyToBot, setApplyToBot] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setContent(template?.content ?? "");
    setApplyToBot(true);
    setError(null);
  }, [open, template?.id, template?.name, template?.content]);
  const inUse = Boolean(template && bot && bot.promptTemplateId === template.id);
  const trimmedName = name.trim();
  const trimmedContent = content.trim();
  const nameChanged = template ? trimmedName !== template.name : trimmedName.length > 0;
  const contentChanged = template ? trimmedContent !== template.content : trimmedContent.length > 0;
  const canSave =
    !pending &&
    trimmedName.length > 0 &&
    trimmedContent.length > 0 &&
    (nameChanged || contentChanged);

  async function save() {
    if (!canSave) return;
    setPending(true);
    setError(null);
    try {
      const saved = template
        ? await rpc.promptTemplates.update({
            templateId: template.id,
            ...(nameChanged ? { name: trimmedName } : {}),
            ...(contentChanged ? { content: trimmedContent } : {}),
          })
        : await rpc.promptTemplates.create({ name: trimmedName, content: trimmedContent });
      let appliedBot: Bot | undefined;
      if (inUse && applyToBot && bot) {
        appliedBot = await rpc.promptTemplates.apply({ templateId: saved.id, botId: bot.id });
      }
      onSaved(saved, appliedBot);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {template ? <Trans>Edit template</Trans> : <Trans>New template</Trans>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="prompt-template-name" className="text-label font-medium">
              <Trans>Name</Trans>
            </label>
            <Input
              id="prompt-template-name"
              value={name}
              maxLength={PROMPT_TEMPLATE_NAME_MAX_LENGTH}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="prompt-template-content" className="text-label font-medium">
              <Trans>Prompt</Trans>
            </label>
            <Textarea
              id="prompt-template-content"
              value={content}
              maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
              rows={8}
              disabled={pending}
              className="max-h-80 resize-none overflow-y-auto"
              onChange={(event) => setContent(event.target.value)}
            />
            <p className="text-right text-body-sm text-muted-foreground">
              {content.length} / {BOT_INSTRUCTIONS_MAX_LENGTH}
            </p>
          </div>
          {inUse ? (
            <div className="space-y-2 rounded-xl bg-muted/50 p-4">
              <p className="text-body-sm text-muted-foreground">
                <Trans>
                  This template is in use on this bot. Saving alone only changes the template.
                </Trans>
              </p>
              <label
                htmlFor="prompt-template-apply"
                className="flex cursor-pointer items-center gap-2 text-body"
              >
                <Checkbox
                  id="prompt-template-apply"
                  checked={applyToBot}
                  disabled={pending}
                  onCheckedChange={(checked) => setApplyToBot(checked === true)}
                />
                <Trans>Save and apply to this bot</Trans>
              </label>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-body text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button disabled={!canSave} onClick={() => void save()}>
              <Trans>Save</Trans>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
