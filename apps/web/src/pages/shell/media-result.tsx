import { Trans, useLingui } from "@lingui/react/macro";
import type { BotModelEntry, BotPromptPreset, ModelSwitches } from "@rakazo_mickvvw/contracts";
import { moveBotModelToFront } from "@rakazo_mickvvw/contracts";
import { displayName, inferAttachmentMimeType, modelOptionKey } from "@rakazo_mickvvw/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  toast,
} from "@rakazo_mickvvw/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { downloadArtifact, fetchArtifactBytes } from "../../lib/artifact-open";
import type { MediaMark } from "../../lib/media-mark";
import {
  getSupplementaryPrompt,
  regenerateMedia,
  setSupplementaryPrompt as saveSupplementaryPromptRemote,
} from "../../lib/media-rpc";
import type { ModelLocateTarget } from "../../lib/model-locate";
import { readFileAsBase64 } from "../../lib/pending-attachments";
import { prepareImage } from "../../lib/prepare-image";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { ArtifactImage } from "./message-cards";
import { toastModelError } from "./model-error-actions";
import { ModelSwitchHistoryDialog } from "./model-switch-history-dialog";
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
  showFavorite = true,
  showShare = true,
  showPreview = true,
  showDownload = true,
  modelSwitches,
  onLocateModel,
  regenerateDisabled,
  onOpenModelSettings,
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
  /** The bot's media action toggles; absent means shown. */
  showFavorite?: boolean;
  /** The bot's media action toggles; absent means shown. */
  showShare?: boolean;
  /** The bot's media action toggles; absent means shown. */
  showPreview?: boolean;
  /** The bot's media action toggles; absent means shown. */
  showDownload?: boolean;
  /** The switch timeline for this message; only present when a switch happened. */
  modelSwitches?: ModelSwitches | null;
  /** Opens the bot's settings at the model named in a switch timeline. */
  onLocateModel?: (target: ModelLocateTarget) => void;
  /** A send or a run is in progress, so a regenerate would wait. */
  regenerateDisabled?: boolean;
  /** Opens the supplier settings, for a quota failure's provider switch. */
  onOpenModelSettings?: () => void;
}) {
  const { t } = useLingui();
  const [collapsed, setCollapsed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [applyingModelKey, setApplyingModelKey] = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  /** The saved supplementary prompt for this artifact; null until loaded. */
  const [supplementaryPrompt, setSupplementaryPrompt] = useState<string | null>(null);

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

  // The supplementary prompt loads when the preview opens; a failed read is
  // empty, never an error. The rpc identity is read through a ref so a new
  // client object does not re-fire the load.
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  useEffect(() => {
    if (!previewOpen) return;
    let cancelled = false;
    void getSupplementaryPrompt(rpcRef.current, artifactId).then((value) => {
      if (!cancelled) setSupplementaryPrompt(value);
    });
    return () => {
      cancelled = true;
    };
  }, [previewOpen, artifactId]);

  const saveSupplementaryPrompt = useCallback(
    async (value: string) => {
      try {
        await saveSupplementaryPromptRemote(rpc, artifactId, value);
        setSupplementaryPrompt(value);
      } catch (err) {
        toast(errorText(err, t`Could not save supplementary prompt`));
        throw err;
      }
    },
    [artifactId, rpc, t],
  );

  // The edit dialog: the supplementary prompt, and for a video a reference
  // image to edit from. It opens when the prompt is empty (an edit needs
  // one) or for a video (an upload is needed every time).
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  // Re-renders this artifact: a random generation replays the raw prompt
  // with the active preset plus the supplementary prompt; an edit reworks
  // the original from the supplementary prompt alone. The new file arrives
  // as a fresh result in the chat.
  const regenerateMediaResult = useCallback(
    async (mode: "edit" | "random", referenceArtifactId?: string) => {
      if (regenerating) return;
      setRegenerating(true);
      try {
        const result = await regenerateMedia(rpc, artifactId, {
          mode,
          ...(referenceArtifactId ? { referenceArtifactId } : {}),
        });
        toast(result.status === "queued" ? t`Regenerating…` : t`Regenerated`);
      } catch (err) {
        toastModelError(err, {
          rpc,
          provider: primary?.provider,
          model: primary?.model,
          botId,
          kind,
          onLocateModel,
          onOpenModelSettings,
          onRetry: () => void regenerateMediaResult(mode, referenceArtifactId),
        });
      } finally {
        setRegenerating(false);
      }
    },
    [artifactId, botId, kind, onLocateModel, onOpenModelSettings, primary, regenerating, rpc, t],
  );

  // An edit needs a supplementary prompt; a video edit also needs a
  // reference image, uploaded in the dialog. The prompt loads on demand:
  // the preview may never have opened, so the saved value may not be in state.
  const startEdit = useCallback(async () => {
    if (regenerating) return;
    const saved = supplementaryPrompt ?? (await getSupplementaryPrompt(rpc, artifactId));
    if (supplementaryPrompt === null) setSupplementaryPrompt(saved);
    if (kind === "video" || !saved.trim()) {
      setEditDraft(saved);
      setEditFile(null);
      setEditDialogOpen(true);
      return;
    }
    await regenerateMediaResult("edit");
  }, [artifactId, kind, regenerating, regenerateMediaResult, rpc, supplementaryPrompt]);

  const submitEdit = useCallback(async () => {
    if (editBusy || regenerating) return;
    const prompt = editDraft.trim();
    if (!prompt) return;
    if (kind === "video" && !editFile) return;
    setEditBusy(true);
    try {
      if (prompt !== (supplementaryPrompt ?? "")) {
        await saveSupplementaryPromptRemote(rpc, artifactId, prompt);
        setSupplementaryPrompt(prompt);
      }
      let referenceArtifactId: string | undefined;
      if (kind === "video" && editFile && botId) {
        const mimeType = inferAttachmentMimeType(editFile.name, editFile.type);
        if (!mimeType) throw new Error(t`Unsupported file type: ${editFile.name}`);
        const file = await prepareImage(editFile);
        const contentBase64 = await readFileAsBase64(file);
        const reference = await rpc.artifacts.create({
          botId,
          name: editFile.name,
          mimeType,
          contentBase64,
          clientNonce: `reference:${artifactId}:${crypto.randomUUID()}`,
        });
        referenceArtifactId = reference.id;
      }
      setEditDialogOpen(false);
      await regenerateMediaResult("edit", referenceArtifactId);
    } catch (err) {
      toastModelError(err, {
        rpc,
        provider: primary?.provider,
        model: primary?.model,
        botId,
        kind,
        onLocateModel,
        onOpenModelSettings,
        onRetry: () => void submitEdit(),
      });
    } finally {
      setEditBusy(false);
    }
  }, [
    artifactId,
    botId,
    editBusy,
    editDraft,
    editFile,
    kind,
    onLocateModel,
    onOpenModelSettings,
    primary,
    regenerateMediaResult,
    regenerating,
    rpc,
    supplementaryPrompt,
    t,
  ]);

  const modelName = mark ? displayName(mark.modelId, t`Model`) : t`Model`;
  const primaryModelName = primary ? displayName(primary.model, t`Model`) : modelName;
  const previewTitleBar = botId ? (
    <MediaPreviewTitleBar
      kind={kind}
      models={models ?? []}
      currentKey={primaryKey}
      applyingKey={applyingModelKey}
      onSelectModel={(entry) => void switchModel(entry)}
      modelName={primaryModelName}
      presets={presets ?? []}
      activePreset={activePreset}
      applyingPreset={applyingPreset}
      onSelectPreset={(preset) => void switchPreset(preset)}
      supplementaryPrompt={supplementaryPrompt ?? ""}
      onSaveSupplementaryPrompt={saveSupplementaryPrompt}
    />
  ) : undefined;
  const previewRegenerateActions = botId ? (
    <>
      <Button
        variant="text"
        size="xs"
        disabled={regenerating}
        onClick={() => void startEdit()}
        className="font-normal"
      >
        <Trans>Edit details</Trans>
      </Button>
      <Button
        variant="text"
        size="xs"
        disabled={regenerating}
        onClick={() => void regenerateMediaResult("random")}
        className="font-normal"
      >
        <Trans>Generate random</Trans>
      </Button>
    </>
  ) : undefined;
  const markLine = (
    <div className="flex flex-wrap items-center gap-x-1 text-body-sm text-muted-foreground">
      <span>
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
      </span>
      {mark?.presetName ? (
        <span>
          {" · "}
          <PresetSwitchMenu
            presets={presets ?? []}
            activePreset={activePreset}
            applying={applyingPreset}
            onSelect={(preset) => void switchPreset(preset)}
          >
            {mark.presetName}
          </PresetSwitchMenu>
        </span>
      ) : null}
      {modelSwitches ? (
        <>
          <Button
            variant="text"
            size="xs"
            onClick={() => setHistoryOpen(true)}
            className="ms-auto font-normal"
          >
            <Trans>Switch history</Trans>
          </Button>
          <ModelSwitchHistoryDialog
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            attempts={modelSwitches.attempts}
            finalModel={modelSwitches.finalModel}
            kind={kind}
            botId={botId ?? ""}
            onLocateModel={botId && onLocateModel ? onLocateModel : undefined}
          />
        </>
      ) : null}
    </div>
  );

  if (collapsed) {
    // The folded result keeps its title and model line, so the folded row
    // still says what was folded; only the preview and actions hide.
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="block max-w-44 truncate text-body-sm font-medium text-foreground">
          {name}
        </span>
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
          onPreviewOpenChange={showPreview ? setPreviewOpen : () => {}}
          previewHeaderActions={previewRegenerateActions}
          previewTitleBar={previewTitleBar}
        />
      ) : (
        <ArtifactFileCard
          target={target}
          artifactId={artifactId}
          name={name}
          mimeType={mimeType}
          size={size ?? 0}
          inlineVideo
          previewOpen={previewOpen}
          onPreviewOpenChange={showPreview ? setPreviewOpen : () => {}}
          previewHeaderActions={previewRegenerateActions}
          previewTitleBar={previewTitleBar}
        />
      )}
      {markLine}
      <div className="flex flex-wrap items-center gap-1">
        {showPreview ? (
          <Button
            variant="text"
            size="xs"
            aria-label={t`Preview ${name}`}
            onClick={() => setPreviewOpen(true)}
            className="font-normal"
          >
            <Trans>Preview</Trans>
          </Button>
        ) : null}
        {showDownload ? (
          <Button
            variant="text"
            size="xs"
            aria-label={t`Download ${name}`}
            onClick={() => void download()}
            className="font-normal"
          >
            <Trans>Download</Trans>
          </Button>
        ) : null}
        {showShare ? (
          <Button
            variant="text"
            size="xs"
            onClick={() => void share()}
            disabled={sharing}
            className="font-normal"
          >
            {sharing ? <Trans>Sharing…</Trans> : <Trans>Share</Trans>}
          </Button>
        ) : null}
        {showFavorite ? (
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
        ) : null}
        {botId ? (
          <>
            <Button
              variant="text"
              size="xs"
              disabled={regenerateDisabled || regenerating}
              onClick={() => void startEdit()}
              className="font-normal"
            >
              <Trans>Edit details</Trans>
            </Button>
            <Button
              variant="text"
              size="xs"
              disabled={regenerateDisabled || regenerating}
              onClick={() => void regenerateMediaResult("random")}
              className="font-normal"
            >
              <Trans>Generate random</Trans>
            </Button>
          </>
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
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent data-testid="media-edit-dialog" size="md" className="gap-0 p-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
            <DialogTitle className="text-body-lg font-semibold">
              <Trans>Edit details</Trans>
            </DialogTitle>
          </div>
          <div className="space-y-3 px-5 py-4">
            <label htmlFor="media-edit-prompt" className="block space-y-1 text-body-sm">
              <span className="text-muted-foreground">
                <Trans>Supplementary prompt</Trans>
              </span>
              <Input
                autoFocus
                id="media-edit-prompt"
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
                aria-label={t`Supplementary prompt`}
              />
            </label>
            {kind === "video" ? (
              <label htmlFor="media-edit-reference" className="block space-y-1 text-body-sm">
                <span className="text-muted-foreground">
                  <Trans>Reference image</Trans>
                </span>
                <Input
                  type="file"
                  id="media-edit-reference"
                  accept="image/*"
                  onChange={(event) => setEditFile(event.target.files?.[0] ?? null)}
                  aria-label={t`Reference image`}
                />
                {editFile ? (
                  <span className="block truncate text-foreground">{editFile.name}</span>
                ) : null}
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="text"
                size="sm"
                onClick={() => setEditDialogOpen(false)}
                className="font-normal"
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                size="sm"
                disabled={editBusy || !editDraft.trim() || (kind === "video" && !editFile)}
                onClick={() => void submitEdit()}
              >
                {editBusy ? <Trans>Starting…</Trans> : <Trans>Start edit</Trans>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The title bar inside an image or video preview: the prompt preset, the
 * supplementary prompt for this generation, and the model. Switching a
 * preset or a model only changes the bot for later generations; the
 * supplementary prompt is saved per artifact and used by the next
 * regeneration. One flex row that wraps: the longest segment drops to the
 * second line on its own.
 */
function MediaPreviewTitleBar({
  kind,
  models,
  currentKey,
  applyingKey,
  onSelectModel,
  modelName,
  presets,
  activePreset,
  applyingPreset,
  onSelectPreset,
  supplementaryPrompt,
  onSaveSupplementaryPrompt,
}: {
  kind: "image" | "video";
  models: readonly BotModelEntry[];
  currentKey: string;
  applyingKey: string | null;
  onSelectModel: (entry: BotModelEntry) => void;
  modelName: string;
  presets: readonly BotPromptPreset[];
  activePreset: string | null | undefined;
  applyingPreset: boolean;
  onSelectPreset: (preset: BotPromptPreset) => void;
  supplementaryPrompt: string;
  onSaveSupplementaryPrompt: (value: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [editingSupp, setEditingSupp] = useState(false);
  const [suppDraft, setSuppDraft] = useState("");
  const [savingSupp, setSavingSupp] = useState(false);
  const presetName = activePreset ?? t`Default`;
  return (
    <div
      data-testid="media-preview-title-bar"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted-foreground"
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">
          {kind === "image" ? t`Image generation` : t`Video generation`}:
        </span>
        {presets.length ? (
          <PresetSwitchMenu
            presets={presets}
            activePreset={activePreset}
            applying={applyingPreset}
            onSelect={(preset) => void onSelectPreset(preset)}
          >
            <span className="block max-w-44 truncate">{presetName}</span>
          </PresetSwitchMenu>
        ) : (
          <span className="block max-w-44 truncate text-foreground">{presetName}</span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">
          <Trans>Supplementary prompt</Trans>:
        </span>
        <button
          type="button"
          onClick={() => {
            setSuppDraft(supplementaryPrompt);
            setEditingSupp(true);
          }}
          className="block max-w-44 truncate rounded-sm text-foreground underline decoration-dotted underline-offset-2"
        >
          {supplementaryPrompt || t`+ Add`}
        </button>
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">
          <Trans>Model</Trans>:
        </span>
        {models.length ? (
          <ModelSwitchMenu
            label={kind === "image" ? t`Image model` : t`Video model`}
            models={models}
            currentKey={currentKey}
            applyingKey={applyingKey}
            onSelect={(entry) => void onSelectModel(entry)}
          >
            <span className="wrap-anywhere text-foreground">{modelName}</span>
          </ModelSwitchMenu>
        ) : (
          <span className="wrap-anywhere text-foreground">{modelName}</span>
        )}
      </span>
      {editingSupp ? (
        <div className="flex w-full items-center gap-2 pt-1">
          <Input
            autoFocus
            value={suppDraft}
            onChange={(event) => setSuppDraft(event.target.value)}
            aria-label={t`Supplementary prompt`}
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            disabled={savingSupp}
            onClick={() => {
              setSavingSupp(true);
              void onSaveSupplementaryPrompt(suppDraft.trim())
                .then(() => setEditingSupp(false))
                .finally(() => setSavingSupp(false));
            }}
          >
            <Trans>Save</Trans>
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={() => setEditingSupp(false)}
            className="font-normal"
          >
            <Trans>Cancel</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
