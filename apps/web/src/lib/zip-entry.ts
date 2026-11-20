import type { ZipEntry } from "@rakazo_mickvvw/core";
import { zipEntryDataRange } from "@rakazo_mickvvw/core";

/** Largest uncompressed entry read into the preview. */
export const ZIP_ENTRY_PREVIEW_MAX_BYTES = 1024 * 1024;

export class ZipEntryTooLargeError extends Error {
  constructor() {
    super("zip entry exceeds the preview limit");
    this.name = "ZipEntryTooLargeError";
  }
}

export class ZipEntryUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ZipEntryUnsupportedError";
  }
}

/**
 * Reads one zip entry as text: stored entries are sliced out directly,
 * deflated entries go through the browser's DecompressionStream. Only the
 * one entry is decompressed, never the whole archive.
 */
export async function readZipEntryText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  if (entry.encrypted) throw new ZipEntryUnsupportedError("zip entry is encrypted");
  if (entry.uncompressedSize > ZIP_ENTRY_PREVIEW_MAX_BYTES) throw new ZipEntryTooLargeError();
  const { start, end } = zipEntryDataRange(bytes, entry);
  const compressed = bytes.subarray(start, end);
  let raw: Uint8Array;
  if (entry.method === 0) {
    raw = compressed;
  } else if (entry.method === 8) {
    raw = await inflateDeflate(compressed);
  } else {
    throw new ZipEntryUnsupportedError(`unsupported zip compression method ${entry.method}`);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(raw);
}

async function inflateDeflate(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
