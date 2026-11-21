import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { artifactShareFileName, bytesToBase64 } from "./artifact-file";
import {
  loadSaf,
  PromptTemplateFileError,
  pickExportDirectory,
  safDisplayPath,
  safExportDirectory,
  safFolderLabel,
  storedExportDirectory,
} from "./prompt-template-files";

/** Where Android gallery zips land; the user picks this folder once. */
export const GALLERY_EXPORT_DIR_KEY = "rakazo.gallery_export_dir";

/** What the save-directory row shows before the user picks a folder. */
export const DOWNLOAD_DIRECTORY_DEFAULT = "Download/Rakazo";

export type GalleryExportErrorCode = "cancelled" | "write_failed" | "share_failed" | "unavailable";

export class GalleryExportError extends Error {
  constructor(readonly code: GalleryExportErrorCode) {
    super(code);
    this.name = "GalleryExportError";
  }
}

export type GalleryExportResult =
  | { kind: "saved"; path: string }
  | { kind: "shared"; fileName: string };

/** The URI of a file of this name in the folder, if one is already there. */
function findSafFileUri(existing: string[], fileName: string): string | undefined {
  return existing.find((uri) => {
    try {
      return decodeURIComponent(uri).endsWith(`/${fileName}`);
    } catch {
      return false;
    }
  });
}

/**
 * A free name in the folder: the share name first, then a number suffix,
 * the same dedup the app's own folders use.
 */
function uniqueSafFileName(existing: string[], fileName: string, mimeType: string): string {
  const base = artifactShareFileName(fileName, mimeType);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  let n = 2;
  while (findSafFileUri(existing, candidate)) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * The download folder as the settings row shows it: the picked folder's
 * label, or the default when nothing is picked yet. The stored grant is
 * the setting itself, so a change in settings takes effect on the next
 * download and gallery zip without any other write.
 */
export async function downloadDirectoryDisplay(): Promise<string> {
  const stored = await storedExportDirectory(GALLERY_EXPORT_DIR_KEY);
  if (!stored) return DOWNLOAD_DIRECTORY_DEFAULT;
  return safFolderLabel(stored);
}

/**
 * Lets the user pick the download folder (any folder, not only
 * Download/Rakazo) and remembers it for later downloads and gallery zips.
 * Returns the picked folder's label, or null when they back out.
 */
export async function pickDownloadDirectory(): Promise<string | null> {
  const saf = await loadSaf();
  const picked = await pickExportDirectory(saf, GALLERY_EXPORT_DIR_KEY);
  if (!picked) return null;
  return safFolderLabel(picked);
}

/** Android: writes the zip into the download folder (Download/Rakazo by default). */
async function exportViaSaf(bytes: Uint8Array, fileName: string): Promise<GalleryExportResult> {
  try {
    const saf = await loadSaf();
    const directoryUri = await safExportDirectory(saf, GALLERY_EXPORT_DIR_KEY);
    const existing = await saf.readDirectoryAsync(directoryUri).catch(() => [] as string[]);
    const clash = findSafFileUri(existing, fileName);
    if (clash) await saf.deleteAsync(clash).catch(() => undefined);
    const fileUri = await saf.createFileAsync(directoryUri, fileName, "application/zip");
    await saf.writeAsStringAsync(fileUri, bytesToBase64(bytes), { encoding: "base64" });
    const folder = safDisplayPath(directoryUri);
    return { kind: "saved", path: folder ? `${folder}/${fileName}` : fileName };
  } catch (error) {
    if (error instanceof GalleryExportError) throw error;
    if (error instanceof PromptTemplateFileError && error.code === "cancelled")
      throw new GalleryExportError("cancelled");
    throw new GalleryExportError("write_failed");
  }
}

/**
 * Saves one file into the same download folder gallery zips use (asking
 * once for the folder), flat next to the zips with no category subfolders.
 * Unlike the zip export, a name clash gets a number suffix instead of
 * replacing the existing file. Throws GalleryExportError, except
 * "cancelled" when the user backs out of the folder picker.
 */
export async function exportSingleFile(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<{ path: string; fileName: string }> {
  try {
    const saf = await loadSaf();
    const directoryUri = await safExportDirectory(saf, GALLERY_EXPORT_DIR_KEY);
    const existing = await saf.readDirectoryAsync(directoryUri).catch(() => [] as string[]);
    const unique = uniqueSafFileName(existing, fileName, mimeType);
    const fileUri = await saf.createFileAsync(directoryUri, unique, mimeType);
    await saf.writeAsStringAsync(fileUri, bytesToBase64(bytes), { encoding: "base64" });
    const folder = safDisplayPath(directoryUri);
    return { path: folder ? `${folder}/${unique}` : unique, fileName: unique };
  } catch (error) {
    if (error instanceof GalleryExportError) throw error;
    if (error instanceof PromptTemplateFileError && error.code === "cancelled")
      throw new GalleryExportError("cancelled");
    throw new GalleryExportError("write_failed");
  }
}

/** iOS has no shared Download folder, so the zip goes out through the share sheet. */
async function exportViaShare(bytes: Uint8Array, fileName: string): Promise<GalleryExportResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) throw new GalleryExportError("unavailable");
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(bytesToBase64(bytes), { encoding: "base64" });
    await Sharing.shareAsync(file.uri, { mimeType: "application/zip" });
    return { kind: "shared", fileName };
  } catch (error) {
    if (error instanceof GalleryExportError) throw error;
    throw new GalleryExportError("share_failed");
  }
}

/**
 * Saves one zip of gallery files. Android writes it into the download
 * folder (asking once, Download/Rakazo by default); iOS shares it out.
 * Throws GalleryExportError, except "cancelled" when the user backs out
 * of the folder picker.
 */
export async function exportGalleryZip(
  bytes: Uint8Array,
  fileName: string,
): Promise<GalleryExportResult> {
  return Platform.OS === "android"
    ? exportViaSaf(bytes, fileName)
    : exportViaShare(bytes, fileName);
}
