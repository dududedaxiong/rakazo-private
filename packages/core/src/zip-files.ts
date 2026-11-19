import { zipSync } from "fflate";

/** One entry of a zip archive: the file name and its bytes. */
export type ZipFileEntry = {
  name: string;
  data: Uint8Array;
};

/**
 * Packs files into a zip archive in memory. Duplicate names get a numbered suffix
 * before the extension, so no entry silently overwrites another.
 */
export function zipFiles(files: ZipFileEntry[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const file of files) {
    const name = uniqueZipName(file.name, used);
    used.add(name);
    entries[name] = file.data;
  }
  return zipSync(entries);
}

function uniqueZipName(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  for (;;) {
    const candidate = `${base} (${index})${extension}`;
    if (!used.has(candidate)) return candidate;
    index += 1;
  }
}
