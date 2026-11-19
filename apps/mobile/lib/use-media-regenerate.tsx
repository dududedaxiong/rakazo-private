import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { MediaEditDialog } from "../components/media-edit-dialog";
import { rpc } from "./api";
import { useI18n } from "./i18n";
import type { MediaRegenerateMode } from "./media-supplementary";
import {
  getSupplementaryPrompt,
  hasEditModels,
  isNoEditModelError,
  needsEditDialog,
  regenerateMedia,
  setSupplementaryPrompt,
  uploadReferenceImage,
} from "./media-supplementary";
import { showModelErrorAlert } from "./model-error-alert";
import type { PickedAttachment } from "./pick-attachments-filter";

/**
 * The dual-mode regenerate flow shared by the image and video previews:
 * Edit details (image-to-image through the edit model) and Generate random
 * (a fresh generation through the preset model). Both are async: the call
 * returns queued and the new file arrives as its own message.
 */
export function useMediaRegenerate({
  artifactId,
  kind,
  botId,
  onNewArtifact,
  onReload,
}: {
  artifactId: string;
  kind: "image" | "video";
  /** The bot that generated the artifact; without one the server enforces the edit rules. */
  botId?: string | null;
  /** A completed regeneration that produced a new file. */
  onNewArtifact?: (artifactId: string) => void;
  /** A completed regeneration that re-rendered the same file. */
  onReload?: () => void;
}): {
  regenerating: boolean;
  startEdit: () => void;
  regenerateRandom: () => void;
  editDialog: ReactNode;
} {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const [editDialog, setEditDialog] = useState<{
    initialPrompt: string;
    savedPrompt: string;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const askToConfigureEditModel = useCallback(
    (id: string) => {
      Alert.alert(
        kind === "image"
          ? t("This bot has no image edit model yet. Add one in Other models first.")
          : t("This bot has no video edit model yet. Add one in Other models first."),
        undefined,
        [
          { text: t("Cancel"), style: "cancel" },
          {
            text: t("Open settings"),
            onPress: () => router.push({ pathname: "/bot-settings", params: { botId: id } }),
          },
        ],
      );
    },
    [kind, router, t],
  );

  const run = useCallback(
    async (mode: MediaRegenerateMode, referenceArtifactId?: string) => {
      if (regenerating) return;
      setRegenerating(true);
      try {
        const result = await regenerateMedia(artifactId, {
          mode,
          ...(referenceArtifactId ? { referenceArtifactId } : {}),
        });
        if (result.status === "queued") {
          Alert.alert(t("Regenerating…"));
          return;
        }
        if (result.artifactId && result.artifactId !== artifactId) {
          onNewArtifact?.(result.artifactId);
          return;
        }
        onReload?.();
      } catch (error) {
        if (mode === "edit" && isNoEditModelError(error) && botId) {
          askToConfigureEditModel(botId);
          return;
        }
        showModelErrorAlert(t, error, {
          retry: () => void run(mode, referenceArtifactId),
          locale,
        });
      } finally {
        setRegenerating(false);
      }
    },
    [artifactId, askToConfigureEditModel, botId, locale, onNewArtifact, onReload, regenerating, t],
  );

  const submitEdit = useCallback(
    async (prompt: string, file: PickedAttachment | null) => {
      if (editBusy || regenerating || !editDialog) return;
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (kind === "video" && !file) return;
      setEditBusy(true);
      try {
        if (trimmed !== editDialog.savedPrompt) {
          await setSupplementaryPrompt(artifactId, trimmed);
        }
        let referenceArtifactId: string | undefined;
        if (kind === "video" && file && botId) {
          referenceArtifactId = await uploadReferenceImage(botId, artifactId, file);
        }
        setEditDialog(null);
        await run("edit", referenceArtifactId);
      } catch (error) {
        if (isNoEditModelError(error) && botId) {
          setEditDialog(null);
          askToConfigureEditModel(botId);
          return;
        }
        showModelErrorAlert(t, error, {
          retry: () => void submitEdit(prompt, file),
          locale,
        });
      } finally {
        setEditBusy(false);
      }
    },
    [
      artifactId,
      askToConfigureEditModel,
      botId,
      editBusy,
      editDialog,
      kind,
      locale,
      regenerating,
      run,
      t,
    ],
  );

  const startEdit = useCallback(async () => {
    if (regenerating || editBusy) return;
    // Check the edit list before spending a call; a failed read must not
    // block the edit, since the server enforces the same rule.
    if (botId) {
      try {
        const bot = await rpc("bots/get", { botId });
        if (!hasEditModels(bot, kind)) {
          askToConfigureEditModel(botId);
          return;
        }
      } catch {
        // fall through to the server check
      }
    }
    let saved = "";
    try {
      saved = (await getSupplementaryPrompt(artifactId)).supplementaryPrompt;
    } catch {
      saved = "";
    }
    if (needsEditDialog(kind, saved)) {
      setEditDialog({ initialPrompt: saved, savedPrompt: saved });
      return;
    }
    await run("edit");
  }, [artifactId, askToConfigureEditModel, botId, editBusy, kind, regenerating, run]);

  const regenerateRandom = useCallback(() => {
    void run("random");
  }, [run]);

  return {
    regenerating,
    startEdit: () => void startEdit(),
    regenerateRandom,
    editDialog: editDialog ? (
      <MediaEditDialog
        kind={kind}
        initialPrompt={editDialog.initialPrompt}
        busy={editBusy}
        onSubmit={(prompt, file) => void submitEdit(prompt, file)}
        onClose={() => {
          if (!editBusy) setEditDialog(null);
        }}
      />
    ) : null,
  };
}
