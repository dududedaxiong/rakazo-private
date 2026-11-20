import { DEFAULT_UPLOAD_EXTENSIONS } from "@rakazo_mickvvw/contracts";
import { DEFAULT_ARTIFACT_CATEGORY_MAPPING } from "@rakazo_mickvvw/core";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MISC_SETTINGS,
  getSpaceMiscSettings,
  getStoredUploadExtensions,
  parseMiscSettings,
} from "./misc-config.js";

const categories = {
  image: ["png"],
  video: ["mp4"],
  archive: ["zip"],
  script: ["py"],
  document: ["md"],
  software: { desktop: ["exe"], apple: ["dmg"], android: ["apk"], other: ["iso"] },
};
const stored = { categories, uploadExtensions: ["png", "py"] };

describe("misc settings storage", () => {
  it("parses stored settings and normalizes extensions", () => {
    expect(parseMiscSettings({ ...stored, uploadExtensions: ["PNG", ".Py"] })).toEqual({
      categories,
      uploadExtensions: ["png", "py"],
    });
  });

  it("reads invalid stored JSON as no saved settings", () => {
    expect(parseMiscSettings(null)).toBeNull();
    expect(parseMiscSettings({ categories, uploadExtensions: ["env"] })).toBeNull();
    expect(parseMiscSettings({ categories: { ...categories, image: "png" } })).toBeNull();
  });

  it("defaults to the built-in mapping and upload list", () => {
    expect(DEFAULT_MISC_SETTINGS.categories).toEqual(DEFAULT_ARTIFACT_CATEGORY_MAPPING);
    expect(DEFAULT_MISC_SETTINGS.uploadExtensions).toEqual([...DEFAULT_UPLOAD_EXTENSIONS]);
  });

  it("returns stored settings when the space saved them, defaults otherwise", async () => {
    const prisma = {
      spaceMiscConfig: {
        findUnique: vi.fn(async ({ where }: { where: { spaceId: string } }) =>
          where.spaceId === "space-1" ? { settings: stored } : null,
        ),
      },
    } as never;
    expect(await getSpaceMiscSettings(prisma, "space-1")).toEqual(stored);
    expect(await getSpaceMiscSettings(prisma, "space-2")).toEqual(DEFAULT_MISC_SETTINGS);
  });

  it("returns the stored upload list, or undefined without saved settings", async () => {
    const prisma = {
      spaceMiscConfig: {
        findUnique: vi.fn(async ({ where }: { where: { spaceId: string } }) =>
          where.spaceId === "space-1" ? { settings: stored } : null,
        ),
      },
    } as never;
    expect(await getStoredUploadExtensions(prisma, "space-1")).toEqual(["png", "py"]);
    expect(await getStoredUploadExtensions(prisma, "space-2")).toBeUndefined();
  });

  it("falls back to the built-in list when the settings read fails", async () => {
    const prisma = {
      spaceMiscConfig: {
        findUnique: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as never;
    expect(await getStoredUploadExtensions(prisma, "space-1")).toBeUndefined();
  });
});
