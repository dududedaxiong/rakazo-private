import { Trans, useLingui } from "@lingui/react/macro";
import type { BotPromptPreset } from "@rakazo_mickvvw/contracts";
import { BOT_PROMPT_PRESET_MAX } from "@rakazo_mickvvw/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Textarea,
} from "@rakazo_mickvvw/ui-web";
import { useState } from "react";

/** How many preset tags show before the row folds behind "More". */
const VISIBLE_TAGS = 5;

type Editing = {
  originalName: string | null;
  name: string;
  prompt: string;
  error: string | null;
};

/**
 * One row of prompt-preset tags: at most five, then "More" to unfold the
 * rest, then "+" to add one. Tapping a tag selects that preset and opens
 * the view/edit dialog, where the full prompt shows with rename, edit and
 * delete; saving applies at once through the same callbacks the old
 * per-row list used. Empty lists show only "+"; at the preset limit "+"
 * hides. Deleting the active preset clears it; name and prompt validation
 * are unchanged.
 */
export function PromptPresetTags({
  presets,
  active,
  onPresetsChange,
  onActiveChange,
}: {
  presets: readonly BotPromptPreset[];
  active: string | null;
  onPresetsChange: (presets: BotPromptPreset[]) => void;
  onActiveChange: (name: string | null) => void;
}) {
  const { t } = useLingui();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const visible = showAll ? presets : presets.slice(0, VISIBLE_TAGS);

  function openEditor(preset: BotPromptPreset | null) {
    setEditing(
      preset
        ? { originalName: preset.name, name: preset.name, prompt: preset.prompt, error: null }
        : { originalName: null, name: "", prompt: "", error: null },
    );
    setDialogOpen(true);
  }

  function saveEditing() {
    if (!editing) return;
    const name = editing.name.trim();
    const prompt = editing.prompt.trim();
    if (!name) {
      setEditing({ ...editing, error: t`Enter a preset name` });
      return;
    }
    if (!prompt) {
      setEditing({ ...editing, error: t`Enter a prompt` });
      return;
    }
    if (presets.some((preset) => preset.name === name && preset.name !== editing.originalName)) {
      setEditing({ ...editing, error: t`A preset with this name already exists` });
      return;
    }
    const next = [...presets];
    const wasActive = editing.originalName !== null && editing.originalName === active;
    if (editing.originalName === null) {
      next.push({ name, prompt });
    } else {
      const index = next.findIndex((preset) => preset.name === editing.originalName);
      if (index === -1) return;
      next[index] = { name, prompt };
    }
    onPresetsChange(next);
    if (wasActive) onActiveChange(name);
    if (editing.originalName === null && next.length === 1) onActiveChange(name);
    setDialogOpen(false);
    setEditing(null);
  }

  function deleteEditing() {
    if (!editing?.originalName) return;
    onPresetsChange(presets.filter((preset) => preset.name !== editing.originalName));
    if (editing.originalName === active) onActiveChange(null);
    setDialogOpen(false);
    setEditing(null);
  }

  return (
    <div data-testid="prompt-preset-tags" className="flex flex-wrap items-center gap-1.5">
      {visible.map((preset) => {
        const isActive = active === preset.name;
        return (
          <Button
            key={preset.name}
            type="button"
            variant={isActive ? "secondary" : "outline"}
            size="sm"
            aria-pressed={isActive}
            onClick={() => {
              onActiveChange(isActive ? null : preset.name);
              openEditor(preset);
            }}
            className="max-w-44 rounded-full font-normal"
          >
            <span className="truncate">{isActive ? `✓ ${preset.name}` : preset.name}</span>
          </Button>
        );
      })}
      {presets.length > VISIBLE_TAGS ? (
        <Button
          type="button"
          variant="text"
          size="sm"
          onClick={() => setShowAll((current) => !current)}
          className="font-normal"
        >
          {showAll ? <Trans>Show less</Trans> : <Trans>More</Trans>}
        </Button>
      ) : null}
      {presets.length < BOT_PROMPT_PRESET_MAX ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t`New preset`}
          onClick={() => openEditor(null)}
          className="rounded-full font-normal"
        >
          +
        </Button>
      ) : null}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="prompt-preset-dialog" size="md" className="gap-0 p-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
            <DialogTitle className="text-body-lg font-semibold">
              {editing?.originalName ? <Trans>Edit preset</Trans> : <Trans>New preset</Trans>}
            </DialogTitle>
          </div>
          <div className="space-y-2 px-5 py-4">
            <Input
              aria-label={t`Preset name`}
              placeholder={t`Preset name`}
              value={editing?.name ?? ""}
              onChange={(event) =>
                setEditing((current) =>
                  current ? { ...current, name: event.target.value, error: null } : current,
                )
              }
            />
            <Textarea
              aria-label={t`Preset prompt`}
              placeholder={t`Preset prompt`}
              value={editing?.prompt ?? ""}
              onChange={(event) =>
                setEditing((current) =>
                  current ? { ...current, prompt: event.target.value, error: null } : current,
                )
              }
              rows={3}
            />
            {editing?.error ? (
              <p className="text-body-sm text-destructive">{editing.error}</p>
            ) : null}
            <div className="flex justify-between gap-2">
              <div>
                {editing?.originalName ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t`Delete preset`}
                    onClick={deleteEditing}
                    className="font-normal text-destructive"
                  >
                    <Trans>Delete</Trans>
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button size="sm" onClick={saveEditing}>
                  <Trans>Save</Trans>
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
