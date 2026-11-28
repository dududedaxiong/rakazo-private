import { describe, expect, it } from "vitest";
import type { ModelCatalogEntry } from "./model-connections.js";
import { ModelRoleSchema, modelSupportsRole } from "./model-roles.js";

function entry(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    provider: "openai-compatible",
    id: "vision-model",
    label: "Vision Model",
    billing: "test",
    ...overrides,
  };
}

describe("model roles", () => {
  it("accepts the image and video purposes", () => {
    expect(ModelRoleSchema.parse("image")).toBe("image");
    expect(ModelRoleSchema.parse("video")).toBe("video");
    expect(ModelRoleSchema.options).toEqual(["main", "approval", "computer", "image", "video"]);
    expect(ModelRoleSchema.safeParse("bogus").success).toBe(false);
  });

  it("lets the image and video roles run only on models that read images", () => {
    for (const role of ["image", "video"] as const) {
      expect(modelSupportsRole(entry({ images: true }), role)).toBe(true);
      // A connection that never said either way still counts: the per-model
      // vision list decides at run time.
      expect(modelSupportsRole(entry({}), role)).toBe(true);
      expect(modelSupportsRole(entry({ images: false }), role)).toBe(false);
      expect(modelSupportsRole(entry({ images: true, protocol: "decisions" }), role)).toBe(false);
    }
  });

  it("keeps the older roles' gates", () => {
    expect(modelSupportsRole(entry({ images: false }), "main")).toBe(true);
    expect(modelSupportsRole(entry({ images: false }), "approval")).toBe(true);
    expect(modelSupportsRole(entry({ images: false }), "computer")).toBe(false);
    expect(modelSupportsRole(entry({ images: true }), "computer")).toBe(true);
    expect(modelSupportsRole(entry({ protocol: "decisions" }), "main")).toBe(false);
    expect(modelSupportsRole(entry({ protocol: "decisions" }), "approval")).toBe(true);
  });
});
