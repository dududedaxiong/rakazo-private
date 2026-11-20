import { deflateRawSync } from "node:zlib";
import type { ZipEntry } from "@rakazo_mickvvw/core";
import { listZipEntries } from "@rakazo_mickvvw/core";
import { describe, expect, it } from "vitest";
import { readZipEntryText, ZipEntryTooLargeError, ZipEntryUnsupportedError } from "./zip-entry.js";

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

function buildZip(entries: { name: string; data: string; method?: 0 | 8 }[]): Uint8Array {
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const data = textEncoder.encode(entry.data);
    const raw = entry.method === 8 ? deflateRawSync(data) : data;
    fileParts.push(
      concat([
        u32(0x0403_4b50),
        u16(20),
        u16(0),
        u16(entry.method ?? 0),
        u16(0),
        u16(0),
        u32(0),
        u32(raw.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        name,
        raw,
      ]),
    );
    centralParts.push(
      concat([
        u32(0x0201_4b50),
        u16(20),
        u16(20),
        u16(0),
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
    offset += 30 + name.length + raw.length;
  }
  const central = concat(centralParts);
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
      u16(0),
    ]),
  ]);
}

const bundle = buildZip([
  { name: "README.md", data: "# bundle\n" },
  { name: "notes.txt", data: "deflated\n", method: 8 },
]);

function entryNamed(name: string): ZipEntry {
  const entry = listZipEntries(bundle).find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`missing fixture entry ${name}`);
  return entry;
}

describe("readZipEntryText", () => {
  it("reads a stored entry as text", async () => {
    await expect(readZipEntryText(bundle, entryNamed("README.md"))).resolves.toBe("# bundle\n");
  });

  it("inflates a deflated entry as text", async () => {
    await expect(readZipEntryText(bundle, entryNamed("notes.txt"))).resolves.toBe("deflated\n");
  });

  it("rejects entries over the preview limit before reading them", async () => {
    const big: ZipEntry = {
      name: "big.txt",
      isDirectory: false,
      method: 0,
      compressedSize: 4,
      uncompressedSize: 2 * 1024 * 1024,
      localHeaderOffset: 0,
      encrypted: false,
    };
    await expect(readZipEntryText(bundle, big)).rejects.toBeInstanceOf(ZipEntryTooLargeError);
  });

  it("rejects encrypted entries and unknown compression methods", async () => {
    const encrypted = { ...entryNamed("README.md"), encrypted: true };
    await expect(readZipEntryText(bundle, encrypted)).rejects.toBeInstanceOf(
      ZipEntryUnsupportedError,
    );
    const unknownMethod = { ...entryNamed("README.md"), method: 99 };
    await expect(readZipEntryText(bundle, unknownMethod)).rejects.toBeInstanceOf(
      ZipEntryUnsupportedError,
    );
  });
});
