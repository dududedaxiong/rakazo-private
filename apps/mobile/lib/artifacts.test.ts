import { describe, expect, it, vi } from "vitest";
import { artifactThreadTarget, matchesArtifactCategory, matchesArtifactQuery } from "./artifacts";

vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
vi.mock("./api-server", () => ({}));
vi.mock("./api-auth", () => ({}));
vi.mock("./api-live", () => ({}));
vi.mock("./api", () => ({ rpc: vi.fn() }));

describe("matchesArtifactQuery", () => {
  const item = { name: "Landing page draft.html", description: "Hero + pricing section" };

  it("matches an empty query", () => {
    expect(matchesArtifactQuery(item, "")).toBe(true);
    expect(matchesArtifactQuery(item, "   ")).toBe(true);
  });

  it("matches case-insensitively against the name or description", () => {
    expect(matchesArtifactQuery(item, "LANDING")).toBe(true);
    expect(matchesArtifactQuery(item, "pricing")).toBe(true);
    expect(matchesArtifactQuery(item, "nope")).toBe(false);
  });

  it("handles a null description", () => {
    expect(matchesArtifactQuery({ name: "Notes.md", description: null }, "notes")).toBe(true);
    expect(matchesArtifactQuery({ name: "Notes.md", description: null }, "hero")).toBe(false);
  });
});

describe("artifactThreadTarget", () => {
  it("points at the bot or the group the artifact belongs to", () => {
    expect(artifactThreadTarget({ botId: "bot-1", groupId: null })).toEqual({ botId: "bot-1" });
    expect(artifactThreadTarget({ botId: null, groupId: "group-1" })).toEqual({
      groupId: "group-1",
    });
  });

  it("prefers the group when both are set, and has no target when neither is", () => {
    expect(artifactThreadTarget({ botId: "bot-1", groupId: "group-1" })).toEqual({
      groupId: "group-1",
    });
    expect(artifactThreadTarget({ botId: null, groupId: null })).toBeNull();
  });
});

describe("matchesArtifactCategory", () => {
  const items = [
    { name: "photo.png", mimeType: "image/png" },
    { name: "clip.mp4", mimeType: "video/mp4" },
    { name: "backup.zip", mimeType: "application/zip" },
    { name: "hello.py", mimeType: "text/x-python" },
    { name: "notes.md", mimeType: "text/markdown" },
    { name: "setup.exe", mimeType: "application/octet-stream" },
    { name: "app.apk", mimeType: "application/octet-stream" },
    { name: "song.mp3", mimeType: "audio/mpeg" },
  ];

  it("passes everything for all", () => {
    for (const item of items) {
      expect(matchesArtifactCategory(item, "all", "all")).toBe(true);
    }
  });

  it("filters by category", () => {
    expect(items.filter((item) => matchesArtifactCategory(item, "image", "all"))).toEqual([
      items[0],
    ]);
    expect(items.filter((item) => matchesArtifactCategory(item, "script", "all"))).toEqual([
      items[3],
    ]);
    expect(items.filter((item) => matchesArtifactCategory(item, "software", "all"))).toEqual([
      items[5],
      items[6],
    ]);
    expect(items.filter((item) => matchesArtifactCategory(item, "archive", "all"))).toEqual([
      items[2],
    ]);
  });

  it("splits software by kind", () => {
    expect(items.filter((item) => matchesArtifactCategory(item, "software", "desktop"))).toEqual([
      items[5],
    ]);
    expect(items.filter((item) => matchesArtifactCategory(item, "software", "android"))).toEqual([
      items[6],
    ]);
    expect(items.filter((item) => matchesArtifactCategory(item, "software", "apple"))).toEqual([]);
  });

  it("leaves uncategorized files out of every category", () => {
    for (const category of [
      "image",
      "video",
      "archive",
      "script",
      "document",
      "software",
    ] as const) {
      expect(matchesArtifactCategory(items[7]!, category, "all")).toBe(false);
    }
  });

  it("follows a saved mapping", () => {
    const mapping = {
      image: [],
      video: [],
      archive: [],
      script: [],
      document: ["apk"],
      software: { desktop: [], apple: [], android: [], other: [] },
    };
    expect(matchesArtifactCategory(items[6]!, "document", "all", mapping)).toBe(true);
    expect(matchesArtifactCategory(items[6]!, "software", "all", mapping)).toBe(false);
  });
});
