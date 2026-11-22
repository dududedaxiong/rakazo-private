import { isAttachmentAudioMimeType } from "@rakazo_mickvvw/contracts";
import { stripCurrentModelMark } from "./model-switches";

/**
 * Which actions on generated media a bot shows. The four toggles live on the
 * bot (synced across phones) and default to shown; the thread and the image
 * and artifact viewers all read them through here.
 */
export type MediaDisplaySettings = {
  showMediaFavorite: boolean;
  showMediaShare: boolean;
  showMediaPreview: boolean;
  showMediaDownload: boolean;
};

export type ArtifactActionAttachment = {
  artifactId: string;
  mimeType: string;
  name: string;
  size?: number;
  kind: "image" | "file";
};

type ArtifactMessageLike = {
  id: string;
  role: string;
  blocks: readonly {
    kind: string;
    text?: string | null;
    artifactId?: string | null;
    mimeType?: string | null;
    name?: string | null;
    size?: number | null;
  }[];
};

/**
 * The attachments of a robot message that gets the artifact action row, or
 * null when the generic action row stays. The row replaces the generic one
 * only for robot messages with no body text: a message the user wrote is
 * theirs to edit, and a body means the message is a reply that happens to
 * carry a file. The "current model" label is a text block of its own, so it
 * is stripped first; otherwise every generated image or video would count as
 * having a body. A video file is an artifact too, so the row covers it even
 * though it is stored as a file block.
 */
export function artifactActionAttachments(
  message: ArtifactMessageLike,
): ArtifactActionAttachment[] | null {
  if (message.role !== "bot") return null;
  if (message.id.startsWith("progress:")) return null;
  const attachments: ArtifactActionAttachment[] = [];
  for (const block of message.blocks) {
    // A text block that is only the trailing "当前模型:" mark is not a body:
    // the server appends it to generated media, and counting it would keep
    // the generic row on every generated image and video.
    if (block.kind === "text" && stripCurrentModelMark(block.text ?? "").trim()) return null;
    // Audio keeps the generic row: its own player owns the message, and the
    // artifact row has nothing to say about a voice reply.
    if (block.kind === "file" && isAttachmentAudioMimeType(block.mimeType ?? "")) return null;
    if (
      (block.kind === "image" || block.kind === "file") &&
      block.artifactId &&
      block.mimeType &&
      block.name
    ) {
      attachments.push({
        artifactId: block.artifactId,
        mimeType: block.mimeType,
        name: block.name,
        size: block.kind === "file" ? (block.size ?? undefined) : undefined,
        kind: block.kind,
      });
    }
  }
  return attachments.length > 0 ? attachments : null;
}

export function mediaDisplaySettingsFromBot(
  bot: {
    showMediaFavorite?: boolean | null;
    showMediaShare?: boolean | null;
    showMediaPreview?: boolean | null;
    showMediaDownload?: boolean | null;
  } | null,
): MediaDisplaySettings {
  return {
    showMediaFavorite: bot?.showMediaFavorite ?? true,
    showMediaShare: bot?.showMediaShare ?? true,
    showMediaPreview: bot?.showMediaPreview ?? true,
    showMediaDownload: bot?.showMediaDownload ?? true,
  };
}

type MessageBlocks = {
  role: string;
  blocks: readonly { kind: string; mimeType?: string | null }[];
};

/** A bot reply carrying a generated image (tapping it previews the image). */
export function messageHasGeneratedImage(message: MessageBlocks): boolean {
  return message.role === "bot" && message.blocks.some((block) => block.kind === "image");
}

/** A bot reply carrying generated media (an image, or a video file). */
export function messageHasGeneratedMedia(message: MessageBlocks): boolean {
  return (
    message.role === "bot" &&
    message.blocks.some(
      (block) =>
        block.kind === "image" ||
        (block.kind === "file" && (block.mimeType ?? "").startsWith("video/")),
    )
  );
}
