import { useLingui } from "@lingui/react/macro";
import type { Bot, PromptTemplate } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  toast,
} from "@rakazo/ui-web";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** The chat header's quick persona switch: the templates, with the bot's current one checked. */
export function ChatPersonaSwitcher({
  bot,
  onBotUpdated,
}: {
  bot: Bot;
  onBotUpdated: (bot: Bot) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t`Switch persona`}
        render={<Button variant="floating" size="icon-lg" data-testid="persona-switcher" />}
      >
        <Sparkles strokeWidth={1.6} className="size-[17px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t`Persona`}</DropdownMenuLabel>
        {open ? <PersonaSwitchList bot={bot} onBotUpdated={onBotUpdated} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonaSwitchList({ bot, onBotUpdated }: { bot: Bot; onBotUpdated: (bot: Bot) => void }) {
  const { t } = useLingui();
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    rpc.promptTemplates
      .list()
      .then((loaded) => {
        if (!cancelled) setTemplates(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function apply(template: PromptTemplate) {
    if (applyingId || bot.promptTemplateId === template.id) return;
    setApplyingId(template.id);
    try {
      const updated = await rpc.promptTemplates.apply({ templateId: template.id, botId: bot.id });
      toast(t`Switched to ${template.name}`);
      onBotUpdated(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplyingId(null);
    }
  }

  if (error) return <DropdownMenuItem disabled>{error}</DropdownMenuItem>;
  if (templates === null) return <DropdownMenuItem disabled>{t`Loading…`}</DropdownMenuItem>;
  if (templates.length === 0)
    return <DropdownMenuItem disabled>{t`No templates yet`}</DropdownMenuItem>;
  return templates.map((template) => {
    const isCurrent = bot.promptTemplateId === template.id;
    return (
      <DropdownMenuItem
        key={template.id}
        disabled={applyingId !== null}
        onClick={() => void apply(template)}
      >
        {isCurrent ? <Check className="size-4" /> : <span className="size-4" aria-hidden="true" />}
        <span className="truncate">{template.name}</span>
      </DropdownMenuItem>
    );
  });
}
