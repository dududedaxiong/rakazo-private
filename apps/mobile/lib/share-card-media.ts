import { shareCardFilename } from "@rakazo/core";
import { File, Paths } from "expo-file-system";
import { getThumbnailAsync } from "expo-video-thumbnails";
import { Image } from "react-native";
import type { MobileArtifactTarget } from "./artifact-open";
import { imageArtifactUri, videoArtifactUri } from "./artifact-open";
import type { MediaSaveSettings } from "./media-folders";
import { saveGeneratedMedia } from "./media-folders";
import type { ShareCardRenderMedia } from "./share-card-webview";

/** A picture for the card, as a data URL with its size. */
export type ShareCardMediaInput = ShareCardRenderMedia;

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error ?? new Error("could not read image size")),
    );
  });
}

async function dataUrlForFile(uri: string, mimeType: string): Promise<ShareCardMediaInput> {
  const [base64, size] = await Promise.all([new File(uri).base64(), imageSize(uri)]);
  return { dataUrl: `data:${mimeType};base64,${base64}`, ...size };
}

/**
 * The reply's picture, downloaded through the authenticated artifact cache
 * and read as a data URL; the card never sees the artifact id or its URL.
 */
export async function shareCardImageInput(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
): Promise<ShareCardMediaInput> {
  const uri = await imageArtifactUri(target, artifactId, mimeType);
  return dataUrlForFile(uri, mimeType);
}

/**
 * A video's frame one second in, from its local file URI. The poster is a
 * still image; the card itself never plays or links the video file.
 */
export async function shareCardVideoPoster(uri: string): Promise<ShareCardMediaInput> {
  const thumbnail = await getThumbnailAsync(uri, { time: 1000, quality: 0.9 });
  const base64 = await new File(thumbnail.uri).base64();
  return {
    dataUrl: `data:image/jpeg;base64,${base64}`,
    width: thumbnail.width,
    height: thumbnail.height,
  };
}

/**
 * A video's frame one second in, downloaded through the authenticated
 * artifact cache. Prefer shareCardVideoPoster when the local URI is already
 * in hand, for example to read the video's length as well.
 */
export async function shareCardVideoInput(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
): Promise<ShareCardMediaInput> {
  const uri = await videoArtifactUri(target, artifactId, mimeType);
  return shareCardVideoPoster(uri);
}

/** A picked background picture, read as a data URL; never uploaded. */
export async function shareCardBackgroundInput(
  uri: string,
  mimeType: string,
): Promise<ShareCardMediaInput> {
  return dataUrlForFile(uri, mimeType);
}

/**
 * Saves the rendered PNG into the app's Rakazo folder, under 图片, and
 * returns the saved file's URI. A name already taken gets a number suffix.
 */
export async function saveShareCardPng(
  dataUrl: string,
  settings?: MediaSaveSettings | null,
): Promise<string> {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const file = new File(Paths.cache, shareCardFilename());
  file.create({ overwrite: true });
  file.write(base64, { encoding: "base64" });
  return saveGeneratedMedia(file.uri, "image/png", file.name, settings);
}
