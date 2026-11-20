import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { listZipEntries, ZipArchiveError, zipEntryDataRange } from "./zip.js";

type FixtureEntry = {
  name: string;
  data: string;
  method?: 0 | 8;
  /** Writes zero sizes in the local header and a data descriptor after the data. */
  useDataDescriptor?: boolean;
};

const textEncoder = new TextEncoder();

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Builds a structurally real zip: local headers, central directory, EOCD. */
function buildZip(entries: FixtureEntry[], comment = ""): Uint8Array {
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const data = textEncoder.encode(entry.data);
    const raw = entry.method === 8 ? deflateRawSync(data) : data;
    const flags = entry.useDataDescriptor ? 0x08 : 0x00;
    const localHeader = concat([
      u32(0x0403_4b50),
      u16(20),
      u16(flags),
      u16(entry.method ?? 0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.useDataDescriptor ? 0 : raw.length),
      u32(entry.useDataDescriptor ? 0 : data.length),
      u16(name.length),
      u16(0),
    ]);
    fileParts.push(localHeader, name, raw);
    if (entry.useDataDescriptor) {
      fileParts.push(concat([u32(0x0807_4b50), u32(0), u32(raw.length), u32(data.length)]));
    }
    centralParts.push(
      concat([
        u32(0x0201_4b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(entry.method ?? 0),
        u16(0),
        u16(0),
        u32(0),
        u32(raw.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += localHeader.length + name.length + raw.length + (entry.useDataDescriptor ? 16 : 0);
  }
  const central = concat(centralParts);
  const commentBytes = textEncoder.encode(comment);
  return concat([
    ...fileParts,
    central,
    concat([
      u32(0x0605_4b50),
      u16(0),
      u16(0),
      u16(entries.length),
      u16(entries.length),
      u32(central.length),
      u32(offset),
      u16(commentBytes.length),
      commentBytes,
    ]),
  ]);
}

const bundle = buildZip([
  { name: "skills/", data: "" },
  { name: "skills/tvbox/SKILL.md", data: "# tvbox\n", method: 8 },
  { name: "README.md", data: "hello\n" },
]);

describe("listZipEntries", () => {
  it("lists stored and deflated entries with sizes and directory flags", () => {
    const entries = listZipEntries(bundle);
    expect(entries.map((entry) => entry.name)).toEqual([
      "skills/",
      "skills/tvbox/SKILL.md",
      "README.md",
    ]);
    expect(entries[0]?.isDirectory).toBe(true);
    expect(entries[0]?.uncompressedSize).toBe(0);
    expect(entries[1]?.isDirectory).toBe(false);
    expect(entries[1]?.method).toBe(8);
    expect(entries[1]?.uncompressedSize).toBe("# tvbox\n".length);
    expect(entries[2]?.method).toBe(0);
    expect(entries[2]?.uncompressedSize).toBe("hello\n".length);
  });

  it("resolves data ranges that round-trip stored and deflated content", () => {
    const entries = listZipEntries(bundle);
    const deflated = entries[1]!;
    const stored = entries[2]!;
    const deflatedRange = zipEntryDataRange(bundle, deflated);
    expect(inflateRawSync(bundle.subarray(deflatedRange.start, deflatedRange.end)).toString()).toBe(
      "# tvbox\n",
    );
    const storedRange = zipEntryDataRange(bundle, stored);
    expect(new TextDecoder().decode(bundle.subarray(storedRange.start, storedRange.end))).toBe(
      "hello\n",
    );
  });

  it("trusts the central directory when the local header uses a data descriptor", () => {
    const zip = buildZip([{ name: "notes.txt", data: "descriptor\n", useDataDescriptor: true }]);
    const [entry] = listZipEntries(zip);
    expect(entry?.uncompressedSize).toBe("descriptor\n".length);
    expect(entry?.compressedSize).toBe("descriptor\n".length);
    const range = zipEntryDataRange(zip, entry!);
    expect(new TextDecoder().decode(zip.subarray(range.start, range.end))).toBe("descriptor\n");
  });

  it("finds the real end record past an archive comment and a fake signature in file data", () => {
    const fakeSignature = `${String.fromCharCode(0x50, 0x4b, 0x05, 0x06)}junk`;
    const zip = buildZip([{ name: "trap.txt", data: fakeSignature }], "archive comment");
    expect(listZipEntries(zip).map((entry) => entry.name)).toEqual(["trap.txt"]);
  });

  it("rejects empty input, random bytes, and a truncated central directory", () => {
    expect(() => listZipEntries(new Uint8Array(0))).toThrow(ZipArchiveError);
    expect(() => listZipEntries(textEncoder.encode("not a zip at all"))).toThrow(ZipArchiveError);
    expect(() => listZipEntries(bundle.subarray(0, bundle.length - 10))).toThrow(ZipArchiveError);
  });

  it("rejects Zip64 and multi-disk markers", () => {
    const zip64 = bundle.slice();
    // Central-directory offset in the end record (22-byte record at the tail).
    new DataView(zip64.buffer).setUint32(zip64.length - 6, 0xffff_ffff, true);
    expect(() => listZipEntries(zip64)).toThrow(ZipArchiveError);
    const multiDisk = bundle.slice();
    new DataView(multiDisk.buffer).setUint16(multiDisk.length - 18, 1, true);
    expect(() => listZipEntries(multiDisk)).toThrow(ZipArchiveError);
  });

  it("rejects a data range whose local header is missing", () => {
    const [entry] = listZipEntries(bundle);
    expect(() =>
      zipEntryDataRange(bundle, { ...entry!, localHeaderOffset: bundle.length - 5 }),
    ).toThrow(ZipArchiveError);
  });
});
