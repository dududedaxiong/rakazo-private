import { afterEach, describe, expect, it } from "vitest";
import type { GalleryItem } from "./gallery";
import {
  formatGalleryDayLabel,
  gallerySortLabelKey,
  galleryTotalBytes,
  galleryZipFileName,
  groupGalleryItemsByDay,
  isGallerySaveOverLimit,
  isGeneratedMedia,
  matchesGalleryCategory,
  nextGallerySort,
  toggleGallerySelection,
} from "./gallery";
import { resetI18nForTests, t } from "./i18n";

afterEach(() => resetI18nForTests());

function item(overrides: Partial<GalleryItem> & { id?: string }): GalleryItem {
  return {
    id: "x",
    name: "generated-abc.png",
    mimeType: "image/png",
    size: 1024,
    createdAt: "2026-11-19T15:05:00.000Z",
    botId: "bot-1",
    groupId: null,
    ...overrides,
  };
}

describe("nextGallerySort", () => {
  it("cycles date-desc → date-asc → size-desc → size-asc → date-desc", () => {
    expect(nextGallerySort("date-desc")).toBe("date-asc");
    expect(nextGallerySort("date-asc")).toBe("size-desc");
    expect(nextGallerySort("size-desc")).toBe("size-asc");
    expect(nextGallerySort("size-asc")).toBe("date-desc");
  });
});

describe("gallerySortLabelKey", () => {
  it("labels the four sort states", () => {
    expect(gallerySortLabelKey("date-desc")).toBe("Date ↓");
    expect(gallerySortLabelKey("date-asc")).toBe("Date ↑");
    expect(gallerySortLabelKey("size-desc")).toBe("Size ↓");
    expect(gallerySortLabelKey("size-asc")).toBe("Size ↑");
  });
});

describe("isGeneratedMedia", () => {
  it("accepts generated images and videos only", () => {
    expect(isGeneratedMedia(item({ name: "generated-a.png", mimeType: "image/png" }))).toBe(true);
    expect(isGeneratedMedia(item({ name: "generated-b.mp4", mimeType: "video/mp4" }))).toBe(true);
    expect(isGeneratedMedia(item({ name: "photo.png", mimeType: "image/png" }))).toBe(false);
    expect(isGeneratedMedia(item({ name: "generated-c.txt", mimeType: "text/plain" }))).toBe(false);
  });
});

describe("matchesGalleryCategory", () => {
  it("filters by mime type", () => {
    const image = item({ id: "1", mimeType: "image/png" });
    const video = item({ id: "2", mimeType: "video/mp4" });
    expect(matchesGalleryCategory(image, "all")).toBe(true);
    expect(matchesGalleryCategory(video, "all")).toBe(true);
    expect(matchesGalleryCategory(image, "image")).toBe(true);
    expect(matchesGalleryCategory(video, "image")).toBe(false);
    expect(matchesGalleryCategory(image, "video")).toBe(false);
    expect(matchesGalleryCategory(video, "video")).toBe(true);
  });
});

describe("groupGalleryItemsByDay", () => {
  it("groups by local day in first-seen order", () => {
    const groups = groupGalleryItemsByDay([
      item({ id: "1", createdAt: "2026-11-19T15:05:00" }),
      item({ id: "2", createdAt: "2026-11-19T08:03:00" }),
      item({ id: "3", createdAt: "2026-11-18T23:07:00" }),
      item({ id: "4", createdAt: "2025-12-31T23:59:00" }),
    ]);
    expect(groups.map((group) => group.items.map((entry) => entry.id))).toEqual([
      ["1", "2"],
      ["3"],
      ["4"],
    ]);
    expect(groups[0]?.date).toEqual(new Date(2026, 10, 19));
    expect(groups[2]?.date).toEqual(new Date(2025, 11, 31));
  });
});

describe("formatGalleryDayLabel", () => {
  const now = new Date(2026, 10, 19, 18, 0, 0);

  it("labels today, yesterday and older days in English", () => {
    const groups = groupGalleryItemsByDay([
      item({ id: "1", createdAt: "2026-11-19T15:05:00" }),
      item({ id: "2", createdAt: "2026-11-19T08:03:00" }),
      item({ id: "3", createdAt: "2026-11-18T23:07:00" }),
      item({ id: "4", createdAt: "2026-11-17T10:00:00" }),
      item({ id: "5", createdAt: "2025-12-31T23:59:00" }),
    ]);
    expect(groups.map((group) => formatGalleryDayLabel(group, now, "en-US", t))).toEqual([
      "Today · 11/19 · 2 items",
      "Yesterday · 11/18 · 1 item",
      "11/17 · 1 item",
      "12/31/2025 · 1 item",
    ]);
  });

  it("labels the same groups in Chinese", () => {
    resetI18nForTests("zh-CN");
    const groups = groupGalleryItemsByDay([
      item({ id: "1", createdAt: "2026-11-19T15:05:00" }),
      item({ id: "2", createdAt: "2026-11-18T23:07:00" }),
    ]);
    expect(groups.map((group) => formatGalleryDayLabel(group, now, "zh-CN", t))).toEqual([
      "今天 · 11/19 · 1 项",
      "昨天 · 11/18 · 1 项",
    ]);
  });
});

describe("toggleGallerySelection", () => {
  it("adds and removes without mutating the input", () => {
    const selected = new Set(["a"]);
    expect([...toggleGallerySelection(selected, "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleGallerySelection(selected, "a")]).toEqual([]);
    expect([...selected]).toEqual(["a"]);
  });
});

describe("gallery zip", () => {
  it("names the zip rakazo-gallery-YYYYMMDD.zip", () => {
    expect(galleryZipFileName(new Date(2026, 10, 19))).toBe("rakazo-gallery-20261119.zip");
  });

  it("rejects selections over 500 MB, accepts exactly 500 MB", () => {
    const limit = 500 * 1024 * 1024;
    expect(galleryTotalBytes([{ size: limit }, { size: 1 }])).toBe(limit + 1);
    expect(isGallerySaveOverLimit(limit)).toBe(false);
    expect(isGallerySaveOverLimit(limit + 1)).toBe(true);
  });
});
