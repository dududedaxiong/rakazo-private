import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  platformOs: "android",
  dirUri: "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRakazo",
  dirFiles: [] as string[],
  written: [] as Array<{ uri: string; name: string; mimeType: string; base64: string }>,
  deleted: [] as string[],
  exportDirError: null as null | Error,
  createError: false,
  writeError: false,
  storedDirUri: null as string | null,
  pickedDirUri: null as string | null,
  folderLabel: "Download/Rakazo",
}));

vi.mock("react-native", () => ({
  get Platform() {
    return { OS: io.platformOs };
  },
}));

vi.mock("./prompt-template-files", () => {
  class PromptTemplateFileError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.name = "PromptTemplateFileError";
      this.code = code;
    }
  }
  const saf = {
    readDirectoryAsync: vi.fn(async () => [...io.dirFiles]),
    createFileAsync: vi.fn(async (_dir: string, name: string, mimeType: string) => {
      if (io.createError) throw new Error("create failed");
      const uri = `content://export/${encodeURIComponent(name)}`;
      io.written.push({ uri, name, mimeType, base64: "" });
      return uri;
    }),
    writeAsStringAsync: vi.fn(async (uri: string, base64: string) => {
      if (io.writeError) throw new Error("write failed");
      const entry = io.written.find((item) => item.uri === uri);
      if (entry) entry.base64 = base64;
    }),
    deleteAsync: vi.fn(async (uri: string) => {
      io.deleted.push(uri);
    }),
  };
  return {
    PromptTemplateFileError,
    loadSaf: vi.fn(async () => saf),
    safExportDirectory: vi.fn(async () => {
      if (io.exportDirError) throw io.exportDirError;
      return io.dirUri;
    }),
    safDisplayPath: () => "Download/Rakazo",
    safFolderLabel: () => io.folderLabel,
    storedExportDirectory: vi.fn(async () => io.storedDirUri),
    pickExportDirectory: vi.fn(async () => io.pickedDirUri),
  };
});

vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache", document: "file:///document" },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    create() {}
    write() {}
  },
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => undefined),
}));

import {
  downloadDirectoryDisplay,
  exportGalleryZip,
  exportSingleFile,
  GalleryExportError,
  pickDownloadDirectory,
} from "./gallery-export";
import { PromptTemplateFileError } from "./prompt-template-files";

const dirFileUri = (name: string) =>
  `content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRakazo%2F${encodeURIComponent(name)}`;

beforeEach(() => {
  io.platformOs = "android";
  io.dirFiles = [];
  io.written = [];
  io.deleted = [];
  io.exportDirError = null;
  io.createError = false;
  io.writeError = false;
  io.storedDirUri = null;
  io.pickedDirUri = null;
  io.folderLabel = "Download/Rakazo";
});

describe("downloadDirectoryDisplay", () => {
  it("shows the default before the user picks a folder", async () => {
    await expect(downloadDirectoryDisplay()).resolves.toBe("Download/Rakazo");
  });

  it("shows the picked folder's label", async () => {
    io.storedDirUri = "content://com.example/tree/primary%3ADownload%2FPhotos";
    io.folderLabel = "Download/Photos";
    await expect(downloadDirectoryDisplay()).resolves.toBe("Download/Photos");
  });
});

describe("pickDownloadDirectory", () => {
  it("returns the picked folder's label", async () => {
    io.pickedDirUri = "content://com.example/tree/primary%3ADownload%2FPhotos";
    io.folderLabel = "Download/Photos";
    await expect(pickDownloadDirectory()).resolves.toBe("Download/Photos");
  });

  it("returns null when the user backs out", async () => {
    await expect(pickDownloadDirectory()).resolves.toBeNull();
  });
});

describe("exportSingleFile", () => {
  it("writes one file into the granted Download folder with its mime type", async () => {
    const saved = await exportSingleFile(
      new TextEncoder().encode("hello"),
      "notes.txt",
      "text/plain",
    );
    expect(saved).toEqual({ path: "Download/Rakazo/notes.txt", fileName: "notes.txt" });
    expect(io.written).toHaveLength(1);
    expect(io.written[0]).toMatchObject({ name: "notes.txt", mimeType: "text/plain" });
    expect(io.written[0]!.base64).toBe("aGVsbG8=");
    expect(io.deleted).toEqual([]);
  });

  it("numbers a clash instead of replacing the existing file", async () => {
    io.dirFiles = [dirFileUri("report.pdf")];
    const saved = await exportSingleFile(
      new TextEncoder().encode("hello"),
      "report.pdf",
      "application/pdf",
    );
    expect(saved).toEqual({ path: "Download/Rakazo/report (2).pdf", fileName: "report (2).pdf" });
    expect(io.written[0]!.name).toBe("report (2).pdf");
    expect(io.deleted).toEqual([]);
  });

  it("numbers past a second clash", async () => {
    io.dirFiles = [dirFileUri("report.pdf"), dirFileUri("report (2).pdf")];
    const saved = await exportSingleFile(
      new TextEncoder().encode("hello"),
      "report.pdf",
      "application/pdf",
    );
    expect(saved.fileName).toBe("report (3).pdf");
  });

  it("reports a cancelled picker instead of a write failure", async () => {
    io.exportDirError = new PromptTemplateFileError("cancelled");
    let caught: unknown;
    try {
      await exportSingleFile(new TextEncoder().encode("hello"), "notes.txt", "text/plain");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GalleryExportError);
    expect((caught as GalleryExportError).code).toBe("cancelled");
  });

  it("maps a write failure", async () => {
    io.writeError = true;
    let caught: unknown;
    try {
      await exportSingleFile(new TextEncoder().encode("hello"), "notes.txt", "text/plain");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GalleryExportError);
    expect((caught as GalleryExportError).code).toBe("write_failed");
  });
});

describe("exportGalleryZip clash handling", () => {
  it("still replaces a zip of the same name", async () => {
    io.dirFiles = [dirFileUri("gallery.zip")];
    const saved = await exportGalleryZip(new TextEncoder().encode("zip"), "gallery.zip");
    expect(saved).toEqual({ kind: "saved", path: "Download/Rakazo/gallery.zip" });
    expect(io.deleted).toEqual([dirFileUri("gallery.zip")]);
  });
});
