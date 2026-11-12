import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Bot, PromptTemplate, PromptTemplateImportItem } from "@rakazo/contracts";
import { PromptTemplateImportError, parsePromptTemplateImport } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@rakazo/ui-web";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/**
 * Imports templates from pasted text, a .txt/.md/.json file, the current bot, or a subscription
 * URL. Nothing is saved until the preview is confirmed; names match existing templates, so
 * re-importing an exported file updates the template of the same name.
 */
export function PromptTemplateImportDialog({
  open,
  onClose,
  bot,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  bot?: Bot | null;
  onImported: (templates: PromptTemplate[], updatedBot?: Bot) => void;
}) {
  const { t } = useLingui();
  const [mode, setMode] = useState<"local" | "url">("local");
  const [pastedText, setPastedText] = useState("");
  const [pastedName, setPastedName] = useState("");
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<PromptTemplateImportItem[] | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setMode("local");
    setPastedText("");
    setPastedName("");
    setUrl("");
    setItems(null);
    setSourceUrl(undefined);
    setError(null);
    setPending(false);
  }, [open]);

  function preview(parsed: PromptTemplateImportItem[], fromUrl?: string) {
    setItems(parsed);
    setSourceUrl(fromUrl);
    setError(null);
  }

  function parseLocal(text: string, suggestedName?: string) {
    try {
      preview(parsePromptTemplateImport({ text, suggestedName }));
    } catch (err) {
      setError(err instanceof PromptTemplateImportError ? err.message : errorText(err));
    }
  }

  async function readFile(file: File) {
    const text = await file.text();
    const suggestedName = file.name.replace(/\.[^.]+$/, "");
    parseLocal(text, suggestedName);
  }

  async function fetchFromUrl() {
    const trimmed = url.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const { templates } = await rpc.promptTemplates.fetchFromUrl({ url: trimmed });
      if (templates.length === 0) {
        setError(t`Nothing to import at that address`);
        return;
      }
      preview(templates, trimmed);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!items?.length || pending) return;
    setPending(true);
    setError(null);
    try {
      const { templates } = await rpc.promptTemplates.confirmImport({
        templates: items,
        ...(bot ? { botId: bot.id } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      });
      // An imported template the bot already uses applies at once; reread the bot so the
      // current persona shown elsewhere follows it.
      const updatedBot = bot ? await rpc.bots.get({ botId: bot.id }) : undefined;
      onImported(templates, updatedBot);
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
            <Trans>Import templates</Trans>
          </DialogTitle>
        </DialogHeader>
        {items ? (
          <div className="space-y-3">
            <p className="text-body text-muted-foreground">
              <Trans>Check the names and content, then import.</Trans>
            </p>
            <div className="max-h-96 space-y-3 overflow-y-auto pe-1">
              {items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="space-y-2 rounded-xl bg-muted/50 p-4">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t`Template name`}
                      value={item.name}
                      disabled={pending}
                      onChange={(event) =>
                        setItems(
                          (current) =>
                            current?.map((entry, at) =>
                              at === index ? { ...entry, name: event.target.value } : entry,
                            ) ?? null,
                        )
                      }
                    />
                    {items.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t`Remove ${item.name}`}
                        disabled={pending}
                        onClick={() =>
                          setItems((current) => current?.filter((_, at) => at !== index) ?? null)
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-body text-muted-foreground">
                    {item.content}
                  </div>
                </div>
              ))}
            </div>
            {error ? (
              <p role="alert" className="text-body text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setItems(null);
                  setSourceUrl(undefined);
                  setError(null);
                }}
              >
                <Trans>Back</Trans>
              </Button>
              <Button
                disabled={
                  pending || items.some((item) => !item.name.trim() || !item.content.trim())
                }
                onClick={() => void confirm()}
              >
                <Plural value={items.length} one="Import 1 template" other="Import # templates" />
              </Button>
            </div>
          </div>
        ) : (
          <Tabs value={mode} onValueChange={(next) => setMode(next as "local" | "url")}>
            <TabsList className="w-full">
              <TabsTrigger value="local">
                <Trans>Local file</Trans>
              </TabsTrigger>
              <TabsTrigger value="url">
                <Trans>Subscription URL</Trans>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="local" className="space-y-4 pt-4">
              <div className="space-y-2">
                <label htmlFor="prompt-template-paste" className="text-label font-medium">
                  <Trans>Paste text</Trans>
                </label>
                <Textarea
                  id="prompt-template-paste"
                  value={pastedText}
                  rows={6}
                  disabled={pending}
                  className="max-h-80 resize-none overflow-y-auto"
                  placeholder={t`Paste a prompt, or JSON like {"name": "...", "content": "..."}`}
                  onChange={(event) => setPastedText(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="prompt-template-paste-name" className="text-label font-medium">
                  <Trans>Name</Trans>
                </label>
                <Input
                  id="prompt-template-paste-name"
                  value={pastedName}
                  disabled={pending}
                  placeholder={t`A name for this persona`}
                  onChange={(event) => setPastedName(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={pending || !pastedText.trim()}
                  onClick={() => parseLocal(pastedText, pastedName)}
                >
                  <Trans>Preview</Trans>
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Trans>Choose a file</Trans>
                </Button>
                {bot ? (
                  <Button
                    variant="outline"
                    disabled={pending || !bot.instructions.trim()}
                    onClick={() => parseLocal(bot.instructions, bot.name)}
                  >
                    <Trans>From this bot</Trans>
                  </Button>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,.json,text/plain,text/markdown,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void readFile(file);
                  }}
                />
              </div>
            </TabsContent>
            <TabsContent value="url" className="space-y-4 pt-4">
              <div className="space-y-2">
                <label htmlFor="prompt-template-url" className="text-label font-medium">
                  <Trans>Subscription URL</Trans>
                </label>
                <Input
                  id="prompt-template-url"
                  value={url}
                  inputMode="url"
                  disabled={pending}
                  placeholder="https://"
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void fetchFromUrl();
                  }}
                />
              </div>
              <Button disabled={pending || !url.trim()} onClick={() => void fetchFromUrl()}>
                <Trans>Fetch and preview</Trans>
              </Button>
            </TabsContent>
          </Tabs>
        )}
        {!items && error ? (
          <p role="alert" className="text-body text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
