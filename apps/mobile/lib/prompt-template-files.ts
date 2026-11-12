import type { PromptTemplate } from "@rakazo/contracts";
import { promptTemplateFileName } from "@rakazo/contracts";
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

type Saf = typeof import("expo-file-system/legacy").StorageAccessFramework;

function loadSaf(): Promise<Saf> {
  return import("expo-file-system/legacy").then((module) => module.StorageAccessFramework);
}

/**
 * The export folder, asking once. The system picker opens at Download; the
 * user picks (or creates) the folder, and the grant is kept for later exports.
 * Backing out of the picker is a cancel, not an error.
 */
async function safExportDirectory(saf: Saf): Promise<string> {
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(PROMPT_TEMPLATE_EXPORT_DIR_KEY);
  } catch {
    stored = null;
  }
  if (stored) return stored;
  const initial = saf.getUriForDirectoryInRoot("Download");
  const permission = await saf.requestDirectoryPermissionsAsync(initial);
  if (!permission.granted) throw new PromptTemplateFileError("cancelled");
  try {
    await SecureStore.setItemAsync(PROMPT_TEMPLATE_EXPORT_DIR_KEY, permission.directoryUri);
  } catch {
    // The export still lands; only the remember-me step failed.
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
  const directoryUri = await safExportDirectory(saf);
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
