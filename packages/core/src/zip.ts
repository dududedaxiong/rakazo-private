/**
 * Reading the file list of a zip archive without decompressing it.
 *
 * Listing only reads the end-of-central-directory record and the central
 * directory, so a large archive costs one small scan instead of a full
 * decompress. Single entries are extracted on demand by the caller, using
 * {@link zipEntryDataRange} to find the compressed data.
 */

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipArchiveError";
  }
}

export type ZipEntry = {
  name: string;
  isDirectory: boolean;
  /** Compression method: 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's local file header. */
  localHeaderOffset: number;
  encrypted: boolean;
};

const END_OF_CENTRAL_DIRECTORY = 0x0605_4b50;
const CENTRAL_DIRECTORY_HEADER = 0x0201_4b50;
const LOCAL_FILE_HEADER = 0x0403_4b50;
const MAX_COMMENT_LENGTH = 0xffff;

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function readSignature(bytes: Uint8Array, offset: number): number {
  return readU32(bytes, offset);
}

/**
 * Lists the entries of a zip archive from its central directory.
 * Throws {@link ZipArchiveError} for truncated input, multi-disk archives,
 * and Zip64 archives (central-directory offsets that do not fit 32 bits).
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) throw new ZipArchiveError("File is too small to be a zip archive.");
  const end = findEndOfCentralDirectory(bytes);
  const disk = readU16(bytes, end + 4);
  const centralDisk = readU16(bytes, end + 6);
  const entriesOnDisk = readU16(bytes, end + 8);
  const totalEntries = readU16(bytes, end + 10);
  const centralSize = readU32(bytes, end + 12);
  const centralOffset = readU32(bytes, end + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipArchiveError("Multi-disk zip archives are not supported.");
  }
  if (totalEntries === MAX_COMMENT_LENGTH || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new ZipArchiveError("Zip64 archives are not supported.");
  }
  if (centralOffset + centralSize > bytes.length) {
    throw new ZipArchiveError("Zip central directory is truncated.");
  }
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.length || readSignature(bytes, offset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new ZipArchiveError("Zip central directory is truncated.");
    }
    const flags = readU16(bytes, offset + 8);
    const method = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    const uncompressedSize = readU32(bytes, offset + 24);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localHeaderOffset = readU32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > bytes.length) {
      throw new ZipArchiveError("Zip central directory is truncated.");
    }
    const name = decodeEntryName(bytes.subarray(nameStart, nameEnd));
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      encrypted: (flags & 0x1) !== 0,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // The record is 22 bytes plus a comment of up to 64 KiB, so it sits in the
  // last 64 KiB + 22 bytes. Scan backwards and take the first candidate whose
  // comment length lands exactly on the end of the file, so an identical
  // signature inside file data is not mistaken for the record.
  const earliest = Math.max(0, bytes.length - MAX_COMMENT_LENGTH - 22);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (readSignature(bytes, offset) !== END_OF_CENTRAL_DIRECTORY) continue;
    if (offset + 22 + readU16(bytes, offset + 20) === bytes.length) return offset;
  }
  throw new ZipArchiveError("Could not find the zip central directory.");
}

function decodeEntryName(nameBytes: Uint8Array): string {
  // Bit 11 marks UTF-8 names. Anything else is decoded as UTF-8 with
  // replacement characters; legacy CP437 names may mojibake, which only
  // affects the displayed name, never the listing itself.
  return new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);
}

/**
 * Locates the compressed data of one entry: parses its local file header and
 * returns the byte range holding the compressed data. Uses the sizes from the
 * central directory, which stay correct when the entry was written with a
 * data descriptor (flag bit 3 zeroes the sizes in the local header).
 */
export function zipEntryDataRange(
  bytes: Uint8Array,
  entry: ZipEntry,
): { start: number; end: number } {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || readSignature(bytes, offset) !== LOCAL_FILE_HEADER) {
    throw new ZipArchiveError("Zip local file header is missing.");
  }
  const nameLength = readU16(bytes, offset + 26);
  const extraLength = readU16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipArchiveError("Zip entry data is truncated.");
  return { start, end };
}
