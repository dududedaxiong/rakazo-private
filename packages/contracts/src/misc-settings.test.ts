import { describe, expect, it } from "vitest";
import { appContract, DEFAULT_UPLOAD_EXTENSIONS, MiscSettingsSchema } from "./index.js";

const categories = {
  image: ["png", "jpg"],
  video: ["mp4"],
  archive: ["zip"],
  script: ["py"],
  document: ["md"],
  software: { desktop: ["exe"], apple: ["dmg"], android: ["apk"], other: ["iso"] },
};

describe("misc settings contracts", () => {
  it("accepts a full settings object", () => {
    expect(
      MiscSettingsSchema.safeParse({ categories, uploadExtensions: ["png", "py"] }).success,
    ).toBe(true);
  });

  it("normalizes extensions to lowercase without the dot", () => {
    const parsed = MiscSettingsSchema.safeParse({
      categories: { ...categories, image: ["PNG", ".Jpg", " gif "] },
      uploadExtensions: [".PY", "Md"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.categories.image).toEqual(["png", "jpg", "gif"]);
      expect(parsed.data.uploadExtensions).toEqual(["py", "md"]);
    }
  });

  it("refuses .env in the upload list", () => {
    expect(
      MiscSettingsSchema.safeParse({ categories, uploadExtensions: ["png", "env"] }).success,
    ).toBe(false);
  });

  it("refuses extensions with other characters", () => {
    for (const bad of ["", "a-b", "a b", "a/b", "toolongextensionname"]) {
      expect(MiscSettingsSchema.safeParse({ categories, uploadExtensions: [bad] }).success).toBe(
        false,
      );
    }
  });

  it("requires every category list", () => {
    const { image, ...rest } = categories;
    expect(MiscSettingsSchema.safeParse({ categories: rest, uploadExtensions: [] }).success).toBe(
      false,
    );
    void image;
  });

  it("exposes the settings through the miscSettings RPC", () => {
    const inputSchema = appContract.miscSettings.set["~orpc"].inputSchema!;
    expect(inputSchema.safeParse({ categories, uploadExtensions: ["png"] }).success).toBe(true);
    expect(inputSchema.safeParse({ categories, uploadExtensions: ["env"] }).success).toBe(false);
    const outputSchema = appContract.miscSettings.get["~orpc"].outputSchema!;
    expect(outputSchema.safeParse({ categories, uploadExtensions: [] }).success).toBe(true);
  });

  it("ships the default upload extensions, unique, none of them env", () => {
    expect(DEFAULT_UPLOAD_EXTENSIONS).toHaveLength(59);
    expect(new Set(DEFAULT_UPLOAD_EXTENSIONS).size).toBe(59);
    expect(DEFAULT_UPLOAD_EXTENSIONS).not.toContain("env");
    for (const extension of DEFAULT_UPLOAD_EXTENSIONS) {
      expect(extension).toMatch(/^[a-z0-9]+$/);
    }
  });
});
