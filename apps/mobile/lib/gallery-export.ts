import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { bytesToBase64 } from "./artifact-file";
import {
  loadSaf,
  PromptTemplateFileError,
  safDisplayPath,
  safExportDirectory,
} from "./prompt-template-files";

/** Where Android gallery zips land; the user picks this folder once. */
export const GALLERY_EXPORT_DIR_KEY = "rakazo.gallery_export_dir";

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

/** Android: writes the zip into the granted Download/Rakazo folder. */
async function exportViaSaf(bytes: Uint8Array, fileName: string): Promise<GalleryExportResult> {
  try {
    const saf = await loadSaf();
    const directoryUri = await safExportDirectory(saf, GALLERY_EXPORT_DIR_KEY);
    const existing = await saf.readDirectoryAsync(directoryUri).catch(() => [] as string[]);
    const clash = existing.find((uri) => {
      try {
        return decodeURIComponent(uri).endsWith(`/${fileName}`);
      } catch {
        return false;
      }
    });
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
 * Saves one zip of gallery files. Android writes it into the Download/Rakazo
 * folder (asking once); iOS shares it out. Throws GalleryExportError, except
 * "cancelled" when the user backs out of the folder picker.
 */
export async function exportGalleryZip(
  bytes: Uint8Array,
  fileName: string,
): Promise<GalleryExportResult> {
  return Platform.OS === "android"
    ? exportViaSaf(bytes, fileName)
    : exportViaShare(bytes, fileName);
}
