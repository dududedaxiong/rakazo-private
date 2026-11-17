import { useLingui } from "@lingui/react/macro";
import type { Bot, PromptTemplate } from "@rakazo_mickvvw/contracts";
import { activeBotPromptPreset, mainPersonaVersion } from "@rakazo_mickvvw/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@rakazo_mickvvw/ui-web";
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
        {/* Base UI's GroupLabel needs a Menu.Group ancestor; bare it throws
            "MenuGroupContext is missing" on open and trips the app-wide boundary. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t`Persona`}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {open ? <PersonaSwitchList bot={bot} onBotUpdated={onBotUpdated} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A list entry the switcher can render and apply; anything else is dropped, never rendered. */
function isSwitchableTemplate(value: unknown): value is PromptTemplate {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PromptTemplate).id === "string" &&
    typeof (value as PromptTemplate).name === "string"
  );
}

function PersonaSwitchList({ bot, onBotUpdated }: { bot: Bot; onBotUpdated: (bot: Bot) => void }) {
  const { t } = useLingui();
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Inside an async function so a synchronously thrown list() still lands in the catch
        // below instead of escaping the effect into the app-wide error boundary.
        const loaded = await rpc.promptTemplates.list();
        if (cancelled) return;
        if (!Array.isArray(loaded)) {
          // A non-list reply must never reach `templates.map` below.
          console.error("promptTemplates.list returned a non-array reply");
          setError(t`Something went wrong. Try again.`);
          return;
        }
        setTemplates(loaded.filter(isSwitchableTemplate));
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mainLabel = t`Main persona`;
  const imageLabel = t`Image generation persona`;
  const videoLabel = t`Video generation persona`;
  // The bot's own persona is current unless a template or a media preset
  // override sits on top of it; the override's pre-state is in history.
  const mainVersion = mainPersonaVersion(bot.instructionHistory);
  const imagePreset = activeBotPromptPreset(bot.imagePromptPresets, bot.activeImagePromptPreset);
  const videoPreset = activeBotPromptPreset(bot.videoPromptPresets, bot.activeVideoPromptPreset);
  const isImagePersona =
    bot.promptTemplateId === null &&
    imagePreset !== null &&
    bot.instructions === imagePreset.prompt;
  const isVideoPersona =
    bot.promptTemplateId === null &&
    videoPreset !== null &&
    bot.instructions === videoPreset.prompt;
  // The bot's own persona is current when no template and no media preset
  // persona sits on top of it; whether it can be restored is mainVersion.
  const isMainPersona = bot.promptTemplateId === null && !isImagePersona && !isVideoPersona;

  async function applyMain() {
    if (applyingId || isMainPersona || !mainVersion) return;
    setApplyingId("main");
    try {
      const updated = await rpc.bots.restoreInstructions({
        botId: bot.id,
        versionId: mainVersion.id,
        expectedInstructions: bot.instructions,
      });
      toast(t`Switched to ${mainLabel}`);
      onBotUpdated(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplyingId(null);
    }
  }

  async function applyPreset(kind: "image" | "video") {
    if (applyingId) return;
    if (kind === "image" && isImagePersona) return;
    if (kind === "video" && isVideoPersona) return;
    setApplyingId(kind);
    try {
      const updated = await rpc.promptTemplates.applyPreset({ botId: bot.id, kind });
      toast(t`Switched to ${kind === "image" ? imageLabel : videoLabel}`);
      onBotUpdated(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplyingId(null);
    }
  }

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

  const personaEntries = (
    <>
      <DropdownMenuItem
        disabled={applyingId !== null || isMainPersona || !mainVersion}
        onClick={() => void applyMain()}
      >
        {isMainPersona ? (
          <Check className="size-4" />
        ) : (
          <span className="size-4" aria-hidden="true" />
        )}
        <span className="truncate">{mainLabel}</span>
      </DropdownMenuItem>
      {imagePreset ? (
        <DropdownMenuItem
          disabled={applyingId !== null || isImagePersona}
          onClick={() => void applyPreset("image")}
        >
          {isImagePersona ? (
            <Check className="size-4" />
          ) : (
            <span className="size-4" aria-hidden="true" />
          )}
          <span className="truncate">{imageLabel}</span>
        </DropdownMenuItem>
      ) : null}
      {videoPreset ? (
        <DropdownMenuItem
          disabled={applyingId !== null || isVideoPersona}
          onClick={() => void applyPreset("video")}
        >
          {isVideoPersona ? (
            <Check className="size-4" />
          ) : (
            <span className="size-4" aria-hidden="true" />
          )}
          <span className="truncate">{videoLabel}</span>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
    </>
  );

  if (error)
    return (
      <>
        {personaEntries}
        <DropdownMenuItem disabled>{error}</DropdownMenuItem>
      </>
    );
  if (templates === null)
    return (
      <>
        {personaEntries}
        <DropdownMenuItem disabled>{t`Loading…`}</DropdownMenuItem>
      </>
    );
  if (templates.length === 0)
    return (
      <>
        {personaEntries}
        <DropdownMenuItem disabled>{t`No templates yet`}</DropdownMenuItem>
      </>
    );
  return (
    <>
      {personaEntries}
      {templates.map((template) => {
        const isCurrent = bot.promptTemplateId === template.id;
        return (
          <DropdownMenuItem
            key={template.id}
            disabled={applyingId !== null}
            onClick={() => void apply(template)}
          >
            {isCurrent ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4" aria-hidden="true" />
            )}
            <span className="truncate">{template.name}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
