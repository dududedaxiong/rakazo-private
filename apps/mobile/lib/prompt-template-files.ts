import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import { promptTemplateFileName } from "@rakazo_mickvvw/contracts";
import * as DocumentPicker from "expo-document-picker";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Where Android exports land; the user picks this folder once. */
export const PROMPT_TEMPLATE_EXPORT_DIR_KEY = "rakazo.prompt_template_export_dir";
/** A subscription file holds at most what the server accepts for one fetch. */
const PROMPT_TEMPLATE_IMPORT_MAX_BYTES = 2_000_000;
const PROMPT_TEMPLATE_IMPORT_EXTENSIONS = [".txt", ".md", ".json"];

export type PromptTemplateFileErrorCode =
  | "cancelled"
  | "too_large"
  | "invalid"
  | "read_failed"
  | "write_failed"
  | "share_failed"
  | "unavailable";

export class PromptTemplateFileError extends Error {
  constructor(readonly code: PromptTemplateFileErrorCode) {
    super(code);
    this.name = "PromptTemplateFileError";
  }
}

export type PromptTemplateExportResult =
  | { kind: "saved"; path: string }
  | { kind: "shared"; fileName: string };

/** A local .txt/.md/.json file the user picked to import, as text. Null when they back out. */
export async function pickPromptTemplateFile(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset || !/^(?:file|content):\/\//.test(asset.uri))
    throw new PromptTemplateFileError("read_failed");
  const name = (asset.name ?? "").trim();
  if (!PROMPT_TEMPLATE_IMPORT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
    throw new PromptTemplateFileError("invalid");
  if (typeof asset.size === "number" && asset.size > PROMPT_TEMPLATE_IMPORT_MAX_BYTES)
    throw new PromptTemplateFileError("too_large");
  try {
    const { File } = await import("expo-file-system");
    const text = await new File(asset.uri).text();
    if (text.length > PROMPT_TEMPLATE_IMPORT_MAX_BYTES)
      throw new PromptTemplateFileError("too_large");
    return { name, text };
  } catch (error) {
    if (error instanceof PromptTemplateFileError) throw error;
    throw new PromptTemplateFileError("read_failed");
  }
}

/** The device path a granted SAF folder URI decodes to, such as Download/Rakazo/提示词模板. */
export function safDisplayPath(directoryUri: string): string | null {
  try {
    const decoded = decodeURIComponent(directoryUri);
    const marker = "primary:";
    const index = decoded.indexOf(marker);
    if (index === -1) return null;
    const path = decoded.slice(index + marker.length).replace(/^\/+/, "");
    return path || null;
  } catch {
    return null;
  }
}

/**
 * A short label for a granted SAF folder: its device path when it is on
 * primary storage, otherwise the folder's own name (an SD-card folder's
 * URI carries no primary path). Always a real label, never the default:
 * a row showing this must not claim the default folder for one the user
 * actually picked elsewhere.
 */
export function safFolderLabel(directoryUri: string): string {
  const path = safDisplayPath(directoryUri);
  if (path) return path;
  try {
    const tail = decodeURIComponent(directoryUri).split("/").filter(Boolean).pop() ?? "";
    const leaf = tail.split(":").pop() ?? "";
    if (leaf) return leaf;
  } catch {
    // Falls through to the placeholder below.
  }
  return "…";
}

export type Saf = typeof import("expo-file-system/legacy").StorageAccessFramework;

export function loadSaf(): Promise<Saf> {
  return import("expo-file-system/legacy").then((module) => module.StorageAccessFramework);
}

/**
 * The export folder, asking once. The system picker opens at Download; the
 * user picks (or creates) the folder, and the grant is kept for later exports
 * under `key`, so each export kind keeps its own folder. Backing out of the
 * picker is a cancel, not an error.
 */
export async function safExportDirectory(saf: Saf, key: string): Promise<string> {
  const stored = await storedExportDirectory(key);
  if (stored) return stored;
  const initial = saf.getUriForDirectoryInRoot("Download");
  const permission = await saf.requestDirectoryPermissionsAsync(initial);
  if (!permission.granted) throw new PromptTemplateFileError("cancelled");
  try {
    await SecureStore.setItemAsync(key, permission.directoryUri);
  } catch {
    // The export still lands; only the remember-me step failed.
  }
  return permission.directoryUri;
}

/**
 * The folder remembered under `key`, if the user already picked one. The
 * stored URI is the grant itself, so it lives on this device only and is
 * never synced anywhere.
 */
export async function storedExportDirectory(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/**
 * Always asks for the export folder, starting at Download, and remembers
 * the new grant under `key`. Returns the picked folder URI, or null when
 * the user backs out. Unlike safExportDirectory this never reuses the
 * stored folder: it is the "change folder" path.
 */
export async function pickExportDirectory(saf: Saf, key: string): Promise<string | null> {
  const initial = saf.getUriForDirectoryInRoot("Download");
  const permission = await saf.requestDirectoryPermissionsAsync(initial);
  if (!permission.granted) return null;
  try {
    await SecureStore.setItemAsync(key, permission.directoryUri);
  } catch {
    // The pick still stands; only the remember-me step failed.
  }
  return permission.directoryUri;
}

/** Writes one file into the export folder, replacing a file of the same name. */
async function writeSafFile(saf: Saf, directoryUri: string, fileName: string, content: string) {
  try {
    const existing = await saf.readDirectoryAsync(directoryUri).catch(() => [] as string[]);
    const clash = existing.find((uri) => {
      try {
        return decodeURIComponent(uri).endsWith(`/${fileName}`);
      } catch {
        return false;
      }
    });
    if (clash) await saf.deleteAsync(clash).catch(() => undefined);
    const fileUri = await saf.createFileAsync(directoryUri, fileName, "text/plain");
    await saf.writeAsStringAsync(fileUri, content);
  } catch (error) {
    if (error instanceof PromptTemplateFileError) throw error;
    throw new PromptTemplateFileError("write_failed");
  }
}

/** Android: every template as its own .txt in the export folder. */
async function exportViaSaf(templates: PromptTemplate[]): Promise<PromptTemplateExportResult> {
  const saf = await loadSaf();
  const directoryUri = await safExportDirectory(saf, PROMPT_TEMPLATE_EXPORT_DIR_KEY);
  for (const template of templates) {
    await writeSafFile(saf, directoryUri, promptTemplateFileName(template.name), template.content);
  }
  const folder = safDisplayPath(directoryUri);
  if (templates.length === 1) {
    const fileName = promptTemplateFileName(templates[0]!.name);
    return { kind: "saved", path: folder ? `${folder}/${fileName}` : fileName };
  }
  return { kind: "saved", path: folder ?? promptTemplateFileName(templates[0]!.name) };
}

/** iOS has no shared Download folder, so each file goes out through the share sheet. */
async function exportViaShare(templates: PromptTemplate[]): Promise<PromptTemplateExportResult> {
  try {
    const [{ File, Paths }, Sharing] = await Promise.all([
      import("expo-file-system"),
      import("expo-sharing"),
    ]);
    if (!(await Sharing.isAvailableAsync())) throw new PromptTemplateFileError("unavailable");
    let firstName = "";
    for (const template of templates) {
      const fileName = promptTemplateFileName(template.name);
      if (!firstName) firstName = fileName;
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write(template.content);
      await Sharing.shareAsync(file.uri, { mimeType: "text/plain" });
    }
    return { kind: "shared", fileName: firstName };
  } catch (error) {
    if (error instanceof PromptTemplateFileError) throw error;
    throw new PromptTemplateFileError("share_failed");
  }
}

/**
 * Exports templates as .txt files named after the template. Android writes
 * them into the export folder and reports the path; other platforms share
 * them out one by one. Throws PromptTemplateFileError, except "cancelled"
 * when the user backs out.
 */
export async function exportPromptTemplates(
  templates: PromptTemplate[],
): Promise<PromptTemplateExportResult> {
  if (templates.length === 0) throw new PromptTemplateFileError("unavailable");
  return Platform.OS === "android" ? exportViaSaf(templates) : exportViaShare(templates);
}
