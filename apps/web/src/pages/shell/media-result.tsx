import { Trans, useLingui } from "@lingui/react/macro";
import type { BotModelEntry, BotPromptPreset } from "@rakazo/contracts";
import { moveBotModelToFront } from "@rakazo/contracts";
import { displayName, modelOptionKey } from "@rakazo/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  toast,
} from "@rakazo/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { downloadArtifact, fetchArtifactBytes } from "../../lib/artifact-open";
import type { MediaMark } from "../../lib/media-mark";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { ArtifactImage } from "./message-cards";
import { ModelSwitchMenu } from "./model-switch-menu";

/**
 * The preset list for this generation kind: the preset names, with the active
 * one checked. Selecting one switches the bot's active preset for later
 * generations; it never re-generates this result.
 */
function PresetSwitchMenu({
  presets,
  activePreset,
  applying,
  onSelect,
  children,
}: {
  presets: readonly BotPromptPreset[];
  activePreset: string | null | undefined;
  applying: boolean;
  onSelect: (preset: BotPromptPreset) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="rounded-sm underline decoration-dotted underline-offset-2"
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t`Prompt preset`}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {presets.map((preset) => (
          <DropdownMenuItem key={preset.name} disabled={applying} onClick={() => onSelect(preset)}>
            {preset.name === activePreset ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4" aria-hidden="true" />
            )}
            <span className="truncate">{preset.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One generated image or video, with its "经 <model> · <preset>" attribution
 * and the action row (preview, download, share, favorite, collapse). The
 * model and preset names are menus: switching one updates the bot for later
 * generations and never re-generates this result.
 */
export function MediaResult({
  kind,
  target,
  artifactId,
  name,
  mimeType,
  size,
  mark,
  botId,
  rpc,
  onBotChanged,
  models,
  presets,
  activePreset,
  favorite,
  onRegenerate,
  regenerateDisabled,
}: {
  kind: "image" | "video";
  target: ArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  /** The file's size in bytes (video); images do not carry one. */
  size?: number;
  mark: MediaMark | null;
  botId: string | undefined;
  rpc: ReturnType<typeof createSpaceRpc>;
  onBotChanged?: () => Promise<void>;
  /** The bot's configured models for this kind; first is primary. */
  models: readonly BotModelEntry[] | null | undefined;
  /** The bot's prompt presets for this kind. */
  presets: readonly BotPromptPreset[] | null | undefined;
  /** The name of the bot's active preset for this kind, if any. */
  activePreset: string | null | undefined;
  /** The message-level favorite; favoriting a result favorites its message. */
  favorite: { favorited: boolean; busy: boolean; toggle: () => Promise<boolean> };
  /** Re-sends the user message that produced this result. */
  onRegenerate?: () => Promise<void>;
  /** A send or a run is in progress, so a regenerate would wait. */
  regenerateDisabled?: boolean;
}) {
  const { t } = useLingui();
  const [collapsed, setCollapsed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [applyingModelKey, setApplyingModelKey] = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState(false);

  const primary = models?.[0];
  const primaryKey = primary ? modelOptionKey(primary.provider, primary.model) : "";

  const switchModel = useCallback(
    async (entry: BotModelEntry) => {
      if (!botId || applyingModelKey) return;
      const key = modelOptionKey(entry.provider, entry.model);
      if (key === primaryKey) return;
      setApplyingModelKey(key);
      try {
        await rpc.bots.update({
          botId,
          ...(kind === "image"
            ? { imageModels: moveBotModelToFront(models, entry) }
            : { videoModels: moveBotModelToFront(models, entry) }),
        });
        await onBotChanged?.();
      } catch (err) {
        toast(errorText(err, t`Could not switch generation model`));
      } finally {
        setApplyingModelKey(null);
      }
    },
    [applyingModelKey, botId, kind, models, onBotChanged, primaryKey, rpc, t],
  );

  const switchPreset = useCallback(
    async (preset: BotPromptPreset) => {
      if (!botId || applyingPreset) return;
      if (preset.name === activePreset) return;
      setApplyingPreset(true);
      try {
        await rpc.bots.update({
          botId,
          ...(kind === "image"
            ? { activeImagePromptPreset: preset.name }
            : { activeVideoPromptPreset: preset.name }),
        });
        await onBotChanged?.();
      } catch (err) {
        toast(errorText(err, t`Could not switch prompt preset`));
      } finally {
        setApplyingPreset(false);
      }
    },
    [activePreset, applyingPreset, botId, kind, onBotChanged, rpc, t],
  );

  const download = useCallback(async () => {
    setDownloadError(null);
    try {
      await downloadArtifact(target, artifactId, name, mimeType);
    } catch {
      setDownloadError(t`Could not download ${name}. Try again.`);
    }
  }, [artifactId, mimeType, name, t, target]);

  // Share the file itself; when the browser has no share sheet, save it instead.
  // The save reports itself: without a toast the click looks dead, like the
  // translation share did before it got its own copied state.
  const share = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const bytes = await fetchArtifactBytes(target, artifactId);
      const file = new File([new Uint8Array(bytes)], name, { type: mimeType });
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      await downloadArtifact(target, artifactId, name, mimeType);
      toast(t`Downloading ${name}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast(errorText(err, t`Could not share ${name}`));
    } finally {
      setSharing(false);
    }
  }, [artifactId, mimeType, name, sharing, t, target]);

  const toggleFavorite = useCallback(async () => {
    await favorite.toggle();
  }, [favorite]);

  const modelName = mark ? displayName(mark.modelId, t`Model`) : t`Model`;
  const markLine = (
    <p className="text-body-sm text-muted-foreground">
      {t`Current model`}:{" "}
      <ModelSwitchMenu
        label={kind === "image" ? t`Image model` : t`Video model`}
        models={models ?? []}
        currentKey={primaryKey}
        applyingKey={applyingModelKey}
        onSelect={(entry) => void switchModel(entry)}
      >
        {modelName}
      </ModelSwitchMenu>
      {mark?.presetName ? (
        <>
          {" · "}
          <PresetSwitchMenu
            presets={presets ?? []}
            activePreset={activePreset}
            applying={applyingPreset}
            onSelect={(preset) => void switchPreset(preset)}
          >
            {mark.presetName}
          </PresetSwitchMenu>
        </>
      ) : null}
    </p>
  );

  if (collapsed) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {markLine}
        <Button
          variant="text"
          size="xs"
          onClick={() => setCollapsed(false)}
          className="font-normal"
        >
          <Trans>Show</Trans>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {kind === "image" ? (
        <ArtifactImage
          target={target}
          artifactId={artifactId}
          name={name}
          previewOpen={previewOpen}
          onPreviewOpenChange={setPreviewOpen}
        />
      ) : (
        <ArtifactFileCard
          target={target}
          artifactId={artifactId}
          name={name}
          mimeType={mimeType}
          size={size ?? 0}
          previewOpen={previewOpen}
          onPreviewOpenChange={setPreviewOpen}
        />
      )}
      {markLine}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="text"
          size="xs"
          aria-label={t`Preview ${name}`}
          onClick={() => setPreviewOpen(true)}
          className="font-normal"
        >
          <Trans>Preview</Trans>
        </Button>
        <Button
          variant="text"
          size="xs"
          aria-label={t`Download ${name}`}
          onClick={() => void download()}
          className="font-normal"
        >
          <Trans>Download</Trans>
        </Button>
        <Button
          variant="text"
          size="xs"
          onClick={() => void share()}
          disabled={sharing}
          className="font-normal"
        >
          {sharing ? <Trans>Sharing…</Trans> : <Trans>Share</Trans>}
        </Button>
        <Button
          variant="text"
          size="xs"
          aria-label={favorite.favorited ? t`Remove from favorites` : t`Add to favorites`}
          disabled={favorite.busy}
          onClick={() => void toggleFavorite()}
          className="font-normal"
        >
          {favorite.favorited ? <Trans>Favorited</Trans> : <Trans>Favorite</Trans>}
        </Button>
        {onRegenerate ? (
          <Button
            variant="text"
            size="xs"
            disabled={regenerateDisabled}
            onClick={() => void onRegenerate()}
            className="font-normal"
          >
            <Trans>Regenerate</Trans>
          </Button>
        ) : null}
        <Button variant="text" size="xs" onClick={() => setCollapsed(true)} className="font-normal">
          <Trans>Collapse</Trans>
        </Button>
      </div>
      {downloadError ? (
        <div role="alert" className="text-body-sm text-destructive">
          {downloadError}
        </div>
      ) : null}
    </div>
  );
}
