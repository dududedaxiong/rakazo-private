import { shareCardFilename } from "@rakazo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  base64: vi.fn(async () => "AAAABBBB"),
  create: vi.fn(),
  write: vi.fn(),
  getSize: vi.fn(
    (
      _uri: string,
      success: (width: number, height: number) => void,
      _failure: (error: unknown) => void,
    ) => success(800, 600),
  ),
  getThumbnailAsync: vi.fn(async () => ({ uri: "file:///thumb.jpg", width: 640, height: 360 })),
  imageArtifactUri: vi.fn(async () => "file:///image.png"),
  videoArtifactUri: vi.fn(async () => "file:///video.mp4"),
  saveGeneratedMedia: vi.fn(async () => "file:///Rakazo/图片/share-card-20261116T0602.png"),
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    name = "share-card-20261116T0602.png";
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri;
      if (name) this.name = name;
    }
    base64 = mocks.base64;
    create = mocks.create;
    write = mocks.write;
  },
  Paths: { cache: "file:///cache" },
}));

vi.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: mocks.getThumbnailAsync,
}));

vi.mock("react-native", () => ({
  Image: { getSize: mocks.getSize },
}));

vi.mock("./artifact-open", () => ({
  imageArtifactUri: mocks.imageArtifactUri,
  videoArtifactUri: mocks.videoArtifactUri,
}));

vi.mock("./media-folders", () => ({
  saveGeneratedMedia: mocks.saveGeneratedMedia,
}));

import {
  saveShareCardPng,
  shareCardBackgroundInput,
  shareCardImageInput,
  shareCardVideoInput,
  shareCardVideoPoster,
} from "./share-card-media";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shareCardImageInput", () => {
  it("reads the cached picture as a data URL with its size", async () => {
    const input = await shareCardImageInput({ botId: "b_1" }, "a_1", "image/png");
    expect(mocks.imageArtifactUri).toHaveBeenCalledWith({ botId: "b_1" }, "a_1", "image/png");
    expect(input).toEqual({
      dataUrl: "data:image/png;base64,AAAABBBB",
      width: 800,
      height: 600,
    });
  });
});

describe("shareCardVideoInput", () => {
  it("takes the frame one second in as a JPEG data URL", async () => {
    const input = await shareCardVideoInput({ botId: "b_1" }, "v_1", "video/mp4");
    expect(mocks.videoArtifactUri).toHaveBeenCalledWith({ botId: "b_1" }, "v_1", "video/mp4");
    expect(mocks.getThumbnailAsync).toHaveBeenCalledWith("file:///video.mp4", {
      time: 1000,
      quality: 0.9,
    });
    expect(input).toEqual({
      dataUrl: "data:image/jpeg;base64,AAAABBBB",
      width: 640,
      height: 360,
    });
  });
});

describe("shareCardVideoPoster", () => {
  it("takes the frame from an already-downloaded file", async () => {
    const input = await shareCardVideoPoster("file:///video.mp4");
    expect(mocks.videoArtifactUri).not.toHaveBeenCalled();
    expect(mocks.getThumbnailAsync).toHaveBeenCalledWith("file:///video.mp4", {
      time: 1000,
      quality: 0.9,
    });
    expect(input.dataUrl).toBe("data:image/jpeg;base64,AAAABBBB");
  });
});

describe("shareCardBackgroundInput", () => {
  it("reads a picked picture as a data URL", async () => {
    const input = await shareCardBackgroundInput("file:///picked.jpg", "image/jpeg");
    expect(input.dataUrl).toBe("data:image/jpeg;base64,AAAABBBB");
  });
});

describe("saveShareCardPng", () => {
  it("writes the PNG to the cache and saves it into the Rakazo folder", async () => {
    const name = shareCardFilename();
    const uri = await saveShareCardPng("data:image/png;base64,AAAABBBB");
    expect(mocks.write).toHaveBeenCalledWith("AAAABBBB", { encoding: "base64" });
    expect(mocks.saveGeneratedMedia).toHaveBeenCalledWith(
      `file:///cache/${name}`,
      "image/png",
      name,
      undefined,
    );
    expect(uri).toBe("file:///Rakazo/图片/share-card-20261116T0602.png");
  });
});
