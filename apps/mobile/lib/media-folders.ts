import { Directory, File, Paths } from "expo-file-system";
import { artifactShareFileName } from "./artifact-file";

/**
 * The App's own local folder: generated media and uploads live under it,
 * sorted by category, so the files stay browsable and the temporary ones
 * stay clearable instead of piling up in the cache.
 *
 *     Rakazo/
 *       图片/            generated images (or the bot's image directory)
 *       视频/            generated videos (or the bot's video directory)
 *       文件/            other generated files
 *       临时/
 *         图片/          uploaded images
 *         视频/          uploaded videos
 *         文件/          uploaded files
 *
 * The category names for generated media come from the bot's save directory
 * settings (synced across phones); the temp categories always use the
 * defaults. The root is created on first use, never by hand.
 */
export const MEDIA_ROOT_NAME = "Rakazo";
export const MEDIA_TEMP_NAME = "临时";
export const DEFAULT_IMAGE_DIRECTORY = "图片";
export const DEFAULT_VIDEO_DIRECTORY = "视频";
export const DEFAULT_FILE_DIRECTORY = "文件";

export type MediaCategory = "image" | "video" | "file";

/** The per-bot save directory settings that name the generated-media folders. */
export type MediaSaveSettings = {
  imageSaveDirectory?: string | null;
  videoSaveDirectory?: string | null;
};

export function categoryForMimeType(mimeType: string | null | undefined): MediaCategory {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return "file";
}

/** The folder name for one category; an empty setting means the default. */
export function mediaCategoryDirectoryName(
  category: MediaCategory,
  settings?: MediaSaveSettings | null,
): string {
  if (category === "image") return settings?.imageSaveDirectory?.trim() || DEFAULT_IMAGE_DIRECTORY;
  if (category === "video") return settings?.videoSaveDirectory?.trim() || DEFAULT_VIDEO_DIRECTORY;
  return DEFAULT_FILE_DIRECTORY;
}

/** The App's local folder, created on first use. */
export function mediaRootDirectory(): Directory {
  const root = new Directory(Paths.document, MEDIA_ROOT_NAME);
  if (!root.exists) root.create();
  return root;
}

/** The folder generated media of one kind saves into, created on first use. */
export function mediaCategoryDirectory(
  category: MediaCategory,
  settings?: MediaSaveSettings | null,
): Directory {
  const directory = new Directory(
    mediaRootDirectory(),
    mediaCategoryDirectoryName(category, settings),
  );
  if (!directory.exists) directory.create();
  return directory;
}

/** The temp folder one kind of upload stages into, created on first use. */
export function mediaTempDirectory(category: MediaCategory): Directory {
  const temp = new Directory(mediaRootDirectory(), MEDIA_TEMP_NAME);
  if (!temp.exists) temp.create();
  const directory = new Directory(temp, mediaCategoryDirectoryName(category));
  if (!directory.exists) directory.create();
  return directory;
}

function uniqueFileIn(directory: Directory, name: string, mimeType: string): File {
  const base = artifactShareFileName(name, mimeType);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  let n = 2;
  while (new File(directory, candidate).exists) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  return new File(directory, candidate);
}

/**
 * Save a generated file into its category folder; returns the saved file's
 * URI. A name already taken in that folder gets a number suffix.
 */
export function saveGeneratedMedia(
  sourceUri: string,
  mimeType: string,
  name: string,
  settings?: MediaSaveSettings | null,
): string {
  const directory = mediaCategoryDirectory(categoryForMimeType(mimeType), settings);
  const target = uniqueFileIn(directory, name, mimeType);
  new File(sourceUri).copySync(target);
  return target.uri;
}

/**
 * Stage an uploaded file into the temp folder under its category; returns
 * the staged file's URI. Uploads are expendable, so they live apart from
 * generated media and can be cleared in one go. The upload still sends the
 * attachment's base64 content; this is only the local copy.
 */
export function stageUploadedMedia(contentBase64: string, mimeType: string, name: string): string {
  const directory = mediaTempDirectory(categoryForMimeType(mimeType));
  const target = uniqueFileIn(directory, name, mimeType);
  target.create();
  target.write(contentBase64, { encoding: "base64" });
  return target.uri;
}

export type MediaTempUsage = { files: number; bytes: number };

/** Bytes as a short human size (B, KB, MB, GB); units need no translation. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function usageUnder(directory: Directory): MediaTempUsage {
  let files = 0;
  let bytes = 0;
  if (!directory.exists) return { files, bytes };
  for (const entry of directory.list()) {
    if (entry instanceof Directory) {
      const child = usageUnder(entry);
      files += child.files;
      bytes += child.bytes;
    } else if (entry instanceof File) {
      files += 1;
      const size = entry.info().size;
      if (typeof size === "number" && Number.isSafeInteger(size) && size >= 0) bytes += size;
    }
  }
  return { files, bytes };
}

/** How much the temp folder holds, so the user can see it growing. */
export function mediaTempUsage(): MediaTempUsage {
  return usageUnder(new Directory(mediaRootDirectory(), MEDIA_TEMP_NAME));
}

/**
 * Remove everything under the temp folder; returns how many files were
 * removed. Uploads are copies of files the user still has, so clearing them
 * only frees space.
 */
export function clearMediaTemp(): number {
  const { files } = mediaTempUsage();
  const temp = new Directory(mediaRootDirectory(), MEDIA_TEMP_NAME);
  if (temp.exists) temp.delete();
  return files;
}
