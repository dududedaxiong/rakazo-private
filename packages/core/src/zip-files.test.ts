import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { zipFiles } from "./zip-files.js";

const text = new TextDecoder();

describe("zipFiles", () => {
  it("packs files so they unzip with the same names and bytes", () => {
    const archive = zipFiles([
      { name: "sunset.png", data: new Uint8Array([1, 2, 3]) },
      { name: "clip.mp4", data: new Uint8Array([4, 5]) },
    ]);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual(["clip.mp4", "sunset.png"]);
    expect(text.decode(entries["sunset.png"])).toBe(text.decode(new Uint8Array([1, 2, 3])));
    expect(entries["clip.mp4"]).toEqual(new Uint8Array([4, 5]));
  });

  it("numbers duplicate names instead of overwriting an entry", () => {
    const archive = zipFiles([
      { name: "photo.png", data: new Uint8Array([1]) },
      { name: "photo.png", data: new Uint8Array([2]) },
      { name: "photo.png", data: new Uint8Array([3]) },
      { name: "notes", data: new Uint8Array([4]) },
      { name: "notes", data: new Uint8Array([5]) },
    ]);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual([
      "notes",
      "notes (2)",
      "photo (2).png",
      "photo (3).png",
      "photo.png",
    ]);
    expect(entries["photo (2).png"]).toEqual(new Uint8Array([2]));
    expect(entries["notes (2)"]).toEqual(new Uint8Array([5]));
  });

  it("packs an empty list into a valid empty archive", () => {
    expect(unzipSync(zipFiles([]))).toEqual({});
  });
});
