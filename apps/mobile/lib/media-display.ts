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
