// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
}));

vi.mock("expo-file-system", () => {
  class Node {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    get name() {
      return this.uri.split("/").at(-1)!;
    }
  }
  class File extends Node {
    get exists() {
      return state.files.has(this.uri);
    }
    create() {
      state.files.set(this.uri, "");
    }
    delete() {
      state.files.delete(this.uri);
    }
    info() {
      return { size: state.files.get(this.uri)?.length ?? 0 };
    }
    copySync(target: File) {
      state.files.set(target.uri, state.files.get(this.uri) ?? "");
    }
    write(value: string, options?: { encoding?: string }) {
      state.files.set(
        this.uri,
        options?.encoding === "base64"
          ? Buffer.from(value, "base64").toString("utf8")
          : value,
      );
    }
  }
  class Directory extends Node {
    get exists() {
      return state.dirs.has(this.uri);
    }
    create() {
      state.dirs.add(this.uri);
    }
    delete() {
      const prefix = `${this.uri}/`;
      for (const uri of [...state.files.keys()]) {
        if (uri.startsWith(prefix)) state.files.delete(uri);
      }
      for (const uri of [...state.dirs]) {
        if (uri === this.uri || uri.startsWith(prefix)) state.dirs.delete(uri);
      }
    }
    list(): Array<File | Directory> {
      const prefix = `${this.uri}/`;
      const entries: Array<File | Directory> = [];
      for (const uri of state.files.keys()) {
        if (uri.startsWith(prefix) && !uri.slice(prefix.length).includes("/")) {
          entries.push(new File(uri));
        }
      }
      for (const uri of state.dirs) {
        if (uri.startsWith(prefix) && !uri.slice(prefix.length).includes("/")) {
          entries.push(new Directory(uri));
        }
      }
      return entries;
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///document" } } };
});

import {
  categoryForMimeType,
  clearMediaTemp,
  formatBytes,
  mediaCategoryDirectoryName,
  mediaTempUsage,
  saveGeneratedMedia,
  stageUploadedMedia,
} from "./media-folders";

beforeEach(() => {
  state.files.clear();
  state.dirs.clear();
});

describe("media folders", () => {
  it("classifies files by mime type", () => {
    expect(categoryForMimeType("image/png")).toBe("image");
    expect(categoryForMimeType("video/mp4")).toBe("video");
    expect(categoryForMimeType("application/pdf")).toBe("file");
    expect(categoryForMimeType(null)).toBe("file");
  });

  it("names the category folder from the bot's save directory, or the default", () => {
    expect(mediaCategoryDirectoryName("image", { imageSaveDirectory: "MyImages" })).toBe(
      "MyImages",
    );
    expect(mediaCategoryDirectoryName("image", { imageSaveDirectory: "  " })).toBe("图片");
    expect(mediaCategoryDirectoryName("image", null)).toBe("图片");
    expect(mediaCategoryDirectoryName("video", { videoSaveDirectory: "MyVideos" })).toBe(
      "MyVideos",
    );
    expect(mediaCategoryDirectoryName("file")).toBe("文件");
  });

  it("saves generated images into the image folder, numbering collisions", () => {
    state.files.set("file:///cache/photo.png", "bytes");
    const first = saveGeneratedMedia("file:///cache/photo.png", "image/png", "photo", null);
    expect(first).toBe("file:///document/Rakazo/图片/photo.png");
    const second = saveGeneratedMedia("file:///cache/photo.png", "image/png", "photo", null);
    expect(second).toBe("file:///document/Rakazo/图片/photo (2).png");
    expect(state.files.get(first)).toBe("bytes");
  });

  it("saves generated videos into the bot's video folder", () => {
    state.files.set("file:///cache/clip.mp4", "bytes");
    const saved = saveGeneratedMedia("file:///cache/clip.mp4", "video/mp4", "clip", {
      videoSaveDirectory: "MyVideos",
    });
    expect(saved).toBe("file:///document/Rakazo/MyVideos/clip.mp4");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2_000_000)).toBe("1.9 MB");
    expect(formatBytes(5_000_000_000)).toBe("4.7 GB");
  });

  it("stages uploads into the temp folder under their category", () => {
    const content = Buffer.from("bytes").toString("base64");
    const staged = stageUploadedMedia(content, "image/jpeg", "up");
    expect(staged).toBe("file:///document/Rakazo/临时/图片/up.jpg");
    expect(state.files.get(staged)).toBe("bytes");
    const doc = stageUploadedMedia(content, "application/pdf", "up");
    expect(doc).toBe("file:///document/Rakazo/临时/文件/up.pdf");
  });

  it("counts temp usage and clears only the temp folder", () => {
    state.files.set("file:///cache/a.png", "12345");
    state.files.set("file:///cache/b.mp4", "1234567");
    const content = Buffer.from("12345").toString("base64");
    const videoContent = Buffer.from("1234567").toString("base64");
    saveGeneratedMedia("file:///cache/a.png", "image/png", "a", null);
    stageUploadedMedia(content, "image/png", "a");
    stageUploadedMedia(videoContent, "video/mp4", "b");
    expect(mediaTempUsage()).toEqual({ files: 2, bytes: 12 });
    expect(clearMediaTemp()).toBe(2);
    expect(mediaTempUsage()).toEqual({ files: 0, bytes: 0 });
    // Generated media survives the clear.
    expect(state.files.has("file:///document/Rakazo/图片/a.png")).toBe(true);
  });
});
