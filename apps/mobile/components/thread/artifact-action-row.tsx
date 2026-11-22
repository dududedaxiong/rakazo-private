import { ARTIFACT_NAME_MAX_LENGTH, artifactPreviewKind } from "@rakazo_mickvvw/contracts";
import { Alert, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { isInlineImageMimeType } from "../../lib/inline-image";
import type { ArtifactActionAttachment, MediaDisplaySettings } from "../../lib/media-display";
import { useMobileTokens } from "../../lib/native";
import { errorText } from "../../lib/user-error";
import type { ImageArtifactPreviewTarget } from "../image-artifact-viewer";
import { useTextEditDialog } from "../profile-edit-dialog";
import { ActionTile, useActionTileColors } from "./message-action-tiles";

/** The target a delete or open call addresses: this bot's thread, or a group. */
export type ArtifactActionTarget = { botId: string } | { groupId: string };

export type ArtifactActions = {
  /** The attachments of this message that get a row, in message order. */
  attachments: ArtifactActionAttachment[];
  /** Toggles this message's favorite; absent where favorites are unavailable. */
  favorite?: () => void;
  /** This message is in the thread's favorites. */
  favorited: boolean;
  /** Reloads the thread, so a rename or a delete shows up at once. */
  refresh?: () => void;
  /** Read-only history: rename and delete stay hidden, the rest stay. */
  readOnly: boolean;
  /** The bot's media toggles; generated media only, other files ignore them. */
  settings: MediaDisplaySettings;
};

/**
 * The six artifact actions under one attachment card: rename, download,
 * share, favorite, open, delete, in that order, delete pushed to the right.
 * One row per attachment; the favorite state is the whole message's, so every
 * card in a multi-attachment message shows the same favorite tile. Every
 * action reuses the detail page's or the artifacts list's path; the row adds
 * no new behavior of its own.
 */
export function ArtifactActionRow({
  attachment,
  messageId,
  target,
  actions,
  isLast,
  onPreviewFile,
  onPreviewImage,
}: {
  attachment: ArtifactActionAttachment;
  messageId: string;
  target: ArtifactActionTarget;
  actions: ArtifactActions;
  /** This is the message's only artifact attachment. */
  isLast: boolean;
  onPreviewFile: (artifactId: string) => void;
  onPreviewImage: (target: ImageArtifactPreviewTarget) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const { tile, plain, favoriteTile } = useActionTileColors(actions.favorited);
  const rename = useTextEditDialog(t("Rename"), ARTIFACT_NAME_MAX_LENGTH);

  // Generated media (an image, or a video file) follows the bot's four media
  // toggles; any other file always shows all six tiles. The toggles default
  // to shown, so the confirmed layout is the default.
  const generated = attachment.kind === "image" || attachment.mimeType.startsWith("video/");
  const showDownload = !generated || actions.settings.showMediaDownload;
  const showShare = !generated || actions.settings.showMediaShare;
  const showFavorite = !generated || actions.settings.showMediaFavorite;
  const showOpen = !generated || actions.settings.showMediaPreview;

  const askRename = () => {
    rename.ask(attachment.name, (name) => {
      if (!name.trim()) return;
      void (async () => {
        try {
          const { renameArtifact } = await import("../../lib/artifacts");
          await renameArtifact(attachment.artifactId, name);
          actions.refresh?.();
        } catch {
          Alert.alert(t("Could not rename {name}. Try again.", { name: attachment.name }));
        }
      })();
    });
  };

  const download = async () => {
    try {
      // Loaded on tap, not at row mount: artifact-open pulls in the native
      // file-system modules, which the bot-profile tests do not mock.
      const { downloadMobileArtifact } = await import("../../lib/artifact-open");
      const saved = await downloadMobileArtifact(attachment.artifactId);
      Alert.alert(t("Saved {name} locally", { name: saved.name }));
    } catch {
      Alert.alert(t("Could not save {name}. Try again.", { name: attachment.name }));
    }
  };

  const share = async () => {
    try {
      const { getArtifactById } = await import("../../lib/artifacts");
      const { writeArtifactCacheFile, shareLocalFile } = await import("../../lib/artifact-open");
      const artifact = await getArtifactById(attachment.artifactId);
      const file = writeArtifactCacheFile(artifact.id, artifact.mimeType, artifact.contentBase64);
      await shareLocalFile(file.uri, artifact.mimeType, artifact.name);
    } catch (error) {
      Alert.alert(t("Could not share this artifact"), errorText(error, t("Try again.")));
    }
  };

  const open = () => {
    if (attachment.kind === "image") {
      // A raster image opens in the viewer, where its edit and regenerate
      // buttons live; an SVG has no viewer, so it takes the share panel.
      if (isInlineImageMimeType(attachment.mimeType)) {
        onPreviewImage({
          artifactId: attachment.artifactId,
          name: attachment.name,
          mimeType: attachment.mimeType,
        });
        return;
      }
      void openViaSharePanel("image");
      return;
    }
    // Video and documents open in their preview; anything else takes the
    // share panel, exactly like tapping the card itself.
    if (artifactPreviewKind(attachment.mimeType) !== "none") {
      onPreviewFile(attachment.artifactId);
      return;
    }
    void openViaSharePanel("file");
  };

  const openViaSharePanel = async (which: "image" | "file") => {
    try {
      const { openMobileArtifact } = await import("../../lib/artifact-open");
      await openMobileArtifact(target, attachment.artifactId, attachment.name, attachment.mimeType);
    } catch (error) {
      Alert.alert(
        which === "image" ? t("Could not open image") : t("Could not open file"),
        errorText(error, t("Try again.")),
      );
    }
  };

  const confirmDelete = () => {
    Alert.alert(t('Delete "{name}"?', { name: attachment.name }), t("This can't be undone."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () => void deleteAttachment(),
      },
    ]);
  };

  const deleteAttachment = async () => {
    try {
      const { rpc } = await import("../../lib/api");
      // The message goes first, so a retry is never blocked by a card that
      // points at an artifact that is already gone. The last attachment
      // takes the whole message with it; any other one just leaves it.
      if (isLast) {
        await rpc("threads/deleteMessage", { ...target, messageId });
      } else {
        await rpc("threads/deleteMessageAttachment", {
          ...target,
          messageId,
          artifactId: attachment.artifactId,
        });
      }
    } catch (error) {
      Alert.alert(t("Could not delete this artifact"), errorText(error, t("Try again.")));
      return;
    }
    try {
      const { removeArtifact } = await import("../../lib/artifacts");
      await removeArtifact(attachment.artifactId);
    } catch (error) {
      // The message is already gone server-side; refresh so the stale card
      // leaves, then say the artifact itself is still there.
      actions.refresh?.();
      Alert.alert(t("Could not delete this artifact"), errorText(error, t("Try again.")));
      return;
    }
    actions.refresh?.();
  };

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {!actions.readOnly ? (
          <ActionTile
            label={t("Rename")}
            ios="pencil"
            android="pencil-outline"
            background={tile.background}
            color={tile.icon}
            onPress={askRename}
          />
        ) : null}
        {showDownload ? (
          <ActionTile
            label={t("Download")}
            ios="square.and.arrow.down"
            android="download-outline"
            background={tile.background}
            color={tile.icon}
            onPress={() => void download()}
          />
        ) : null}
        {showShare ? (
          <ActionTile
            label={t("Share")}
            ios="square.and.arrow.up"
            android="share-social-outline"
            background={tile.background}
            color={tile.icon}
            onPress={() => void share()}
          />
        ) : null}
        {showFavorite && actions.favorite ? (
          <ActionTile
            label={actions.favorited ? t("Unfavorite") : t("Favorite")}
            ios={actions.favorited ? "bookmark.fill" : "bookmark"}
            android={actions.favorited ? "bookmark" : "bookmark-outline"}
            background={favoriteTile.background}
            color={favoriteTile.icon}
            onPress={actions.favorite}
          />
        ) : null}
        {showOpen ? (
          <ActionTile
            label={t("Open")}
            ios="arrow.up.forward.app"
            android="open-outline"
            background={tile.background}
            color={tile.icon}
            onPress={open}
          />
        ) : null}
        {!actions.readOnly ? (
          <>
            <View style={{ flex: 1 }} />
            <ActionTile
              label={t("Delete")}
              ios="trash"
              android="trash-outline"
              background={plain.background}
              color={tokens.destructive}
              onPress={confirmDelete}
            />
          </>
        ) : null}
      </View>
      {rename.dialog}
    </>
  );
}
