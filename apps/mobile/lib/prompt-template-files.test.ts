import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  platformOs: "android",
  picked: null as null | {
    canceled: false;
    assets: Array<{ uri: string; name: string; size?: number }>;
  },
  fileText: "",
  fileTextError: false,
  writtenFiles: [] as Array<{ uri: string; name: string }>,
  sharedUris: [] as string[],
  sharingAvailable: true,
  shareError: false,
  storedDir: null as string | null,
  pickerGranted: true,
  pickerDir:
    "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRakazo%2F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%A8%A1%E6%9D%BF",
  dirFiles: [] as string[],
  createError: false,
  writeError: false,
  deleted: [] as string[],
}));

vi.mock("react-native", () => ({
  get Platform() {
    return { OS: io.platformOs };
  },
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(async () => io.picked ?? { canceled: true }),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => io.storedDir),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    io.storedDir = value;
  }),
  deleteItemAsync: vi.fn(async () => true),
}));

vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async text() {
      if (io.fileTextError) throw new Error("read failed");
      return io.fileText;
    }
    create() {}
    write() {}
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  StorageAccessFramework: {
    getUriForDirectoryInRoot: vi.fn((name: string) => `content://root/${name}`),
    requestDirectoryPermissionsAsync: vi.fn(async () => ({
      granted: io.pickerGranted,
      directoryUri: io.pickerDir,
    })),
    readDirectoryAsync: vi.fn(async () => [...io.dirFiles]),
    createFileAsync: vi.fn(async (_dir: string, name: string) => {
      if (io.createError) throw new Error("create failed");
      const uri = `content://export/${encodeURIComponent(name)}`;
      io.writtenFiles.push({ uri, name });
      return uri;
    }),
    writeAsStringAsync: vi.fn(async () => {
      if (io.writeError) throw new Error("write failed");
    }),
    deleteAsync: vi.fn(async (uri: string) => {
      io.deleted.push(uri);
    }),
  },
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => io.sharingAvailable),
  shareAsync: vi.fn(async (uri: string) => {
    if (io.shareError) throw new Error("share failed");
    io.sharedUris.push(uri);
  }),
}));

import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import {
  exportPromptTemplates,
  PromptTemplateFileError,
  pickExportDirectory,
  pickPromptTemplateFile,
  safDisplayPath,
  safFolderLabel,
  storedExportDirectory,
} from "./prompt-template-files";

const template = (overrides: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: "template-1",
  name: "翻译助手",
  content: "你是一个专业翻译。",
  isBuiltIn: true,
  sourceUrl: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  ...overrides,
});

describe("safDisplayPath", () => {
  it("decodes a Download folder URI", () => {
    expect(
      safDisplayPath(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRakazo%2F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%A8%A1%E6%9D%BF",
      ),
    ).toBe("Download/Rakazo/提示词模板");
  });

  it("returns null when the folder is not on primary storage", () => {
    expect(safDisplayPath("content://com.example/tree/1234%3ADownload")).toBeNull();
    expect(safDisplayPath("not a uri %")).toBeNull();
  });
});

describe("safFolderLabel", () => {
  it("prefers the device path on primary storage", () => {
    expect(
      safFolderLabel(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRakazo",
      ),
    ).toBe("Download/Rakazo");
  });

  it("falls back to the folder name off primary storage", () => {
    expect(safFolderLabel("content://com.example/tree/1234%3AMusic")).toBe("Music");
  });

  it("never falls back to a folder it did not pick", () => {
    expect(safFolderLabel("not a uri %")).toBe("…");
  });
});

describe("storedExportDirectory and pickExportDirectory", () => {
  beforeEach(() => {
    io.storedDir = null;
    io.pickerGranted = true;
  });

  it("returns the remembered folder, or null before the first pick", async () => {
    await expect(storedExportDirectory("rakazo.test_dir")).resolves.toBeNull();
    io.storedDir = io.pickerDir;
    await expect(storedExportDirectory("rakazo.test_dir")).resolves.toBe(io.pickerDir);
  });

  it("asks at Download and remembers the new grant", async () => {
    const { StorageAccessFramework } = await import("expo-file-system/legacy");
    await expect(pickExportDirectory(StorageAccessFramework, "rakazo.test_dir")).resolves.toBe(
      io.pickerDir,
    );
    expect(StorageAccessFramework.requestDirectoryPermissionsAsync).toHaveBeenCalledWith(
      "content://root/Download",
    );
    expect(io.storedDir).toBe(io.pickerDir);
  });

  it("returns null when the user backs out and keeps the old folder", async () => {
    io.storedDir = io.pickerDir;
    io.pickerGranted = false;
    const { StorageAccessFramework } = await import("expo-file-system/legacy");
    await expect(
      pickExportDirectory(StorageAccessFramework, "rakazo.test_dir"),
    ).resolves.toBeNull();
    expect(io.storedDir).toBe(io.pickerDir);
  });
});

describe("pickPromptTemplateFile", () => {
  beforeEach(() => {
    io.picked = null;
    io.fileText = "";
    io.fileTextError = false;
  });

  it("returns null when the picker is cancelled", async () => {
    await expect(pickPromptTemplateFile()).resolves.toBeNull();
  });

  it("reads a picked text file", async () => {
    io.picked = {
      canceled: false,
      assets: [{ uri: "file:///tmp/travel.txt", name: "travel.txt", size: 12 }],
    };
    io.fileText = "你是一个旅行规划师。";
    await expect(pickPromptTemplateFile()).resolves.toEqual({
      name: "travel.txt",
      text: "你是一个旅行规划师。",
    });
  });

  it("rejects other file types", async () => {
    io.picked = {
      canceled: false,
      assets: [{ uri: "file:///tmp/photo.png", name: "photo.png", size: 12 }],
    };
    await expect(pickPromptTemplateFile()).rejects.toMatchObject({
      code: "invalid",
    } satisfies { code: string });
  });

  it("rejects oversized files", async () => {
    io.picked = {
      canceled: false,
      assets: [{ uri: "file:///tmp/big.txt", name: "big.txt", size: 3_000_000 }],
    };
    await expect(pickPromptTemplateFile()).rejects.toMatchObject({ code: "too_large" });
  });

  it("reports an unreadable file", async () => {
    io.picked = {
      canceled: false,
      assets: [{ uri: "file:///tmp/broken.txt", name: "broken.txt", size: 12 }],
    };
    io.fileTextError = true;
    await expect(pickPromptTemplateFile()).rejects.toMatchObject({ code: "read_failed" });
  });
});

describe("exportPromptTemplates on Android", () => {
  beforeEach(() => {
    io.platformOs = "android";
    io.writtenFiles = [];
    io.deleted = [];
    io.dirFiles = [];
    io.storedDir = null;
    io.pickerGranted = true;
    io.createError = false;
    io.writeError = false;
  });

  it("writes one file and reports its Download path", async () => {
    io.storedDir =
      "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FRakazo%2F%E6%8F%90%E7%A4%BA%E8%AF%8D%E6%A8%A1%E6%9D%BF";
    await expect(exportPromptTemplates([template()])).resolves.toEqual({
      kind: "saved",
      path: "Download/Rakazo/提示词模板/翻译助手.txt",
    });
    expect(io.writtenFiles.map((file) => file.name)).toEqual(["翻译助手.txt"]);
  });

  it("writes every file for an export-all and reports the folder", async () => {
    io.storedDir = io.pickerDir;
    await expect(
      exportPromptTemplates([
        template(),
        template({ id: "template-2", name: "写作助手", content: "写作。" }),
      ]),
    ).resolves.toEqual({ kind: "saved", path: "Download/Rakazo/提示词模板" });
    expect(io.writtenFiles.map((file) => file.name)).toEqual(["翻译助手.txt", "写作助手.txt"]);
  });

  it("asks for the folder once and remembers the grant", async () => {
    const { StorageAccessFramework } = await import("expo-file-system/legacy");
    await exportPromptTemplates([template()]);
    expect(StorageAccessFramework.requestDirectoryPermissionsAsync).toHaveBeenCalledWith(
      "content://root/Download",
    );
    expect(io.storedDir).toBe(io.pickerDir);
  });

  it("treats backing out of the folder picker as a cancel", async () => {
    io.pickerGranted = false;
    await expect(exportPromptTemplates([template()])).rejects.toMatchObject({
      code: "cancelled",
    } satisfies { code: string });
    expect(io.writtenFiles).toEqual([]);
  });

  it("replaces a file of the same name", async () => {
    io.storedDir = io.pickerDir;
    io.dirFiles = ["content://export/%E7%BF%BB%E8%AF%91%E5%8A%A9%E6%89%8B.txt"];
    await exportPromptTemplates([template()]);
    expect(io.deleted).toEqual(["content://export/%E7%BF%BB%E8%AF%91%E5%8A%A9%E6%89%8B.txt"]);
  });

  it("reports a failed write", async () => {
    io.storedDir = io.pickerDir;
    io.writeError = true;
    await expect(exportPromptTemplates([template()])).rejects.toBeInstanceOf(
      PromptTemplateFileError,
    );
    await expect(exportPromptTemplates([template()])).rejects.toMatchObject({
      code: "write_failed",
    });
  });
});

describe("exportPromptTemplates on iOS", () => {
  beforeEach(() => {
    io.platformOs = "ios";
    io.sharedUris = [];
    io.sharingAvailable = true;
    io.shareError = false;
  });

  it("shares each file through the share sheet", async () => {
    await expect(
      exportPromptTemplates([
        template(),
        template({ id: "template-2", name: "写作助手", content: "写作。" }),
      ]),
    ).resolves.toEqual({ kind: "shared", fileName: "翻译助手.txt" });
    expect(io.sharedUris).toHaveLength(2);
  });

  it("reports when sharing is unavailable", async () => {
    io.sharingAvailable = false;
    await expect(exportPromptTemplates([template()])).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
