import { describe, expect, it } from "vitest";
import {
  buildModelMultimodeProfile,
  formatContextWindow,
  modelMultimodeSummary,
  resolveModelContextWindow,
  resolveModelSpeedTier,
  speedTierLabel,
} from "./model-multimode-display.js";

describe("model-multimode-display", () => {
  describe("resolveModelSpeedTier", () => {
    it("identifies flash models by ID", () => {
      expect(resolveModelSpeedTier("gemini-3.8-flash", "google")).toBe("flash");
      expect(resolveModelSpeedTier("deepseek-flash", "openrouter")).toBe("flash");
    });

    it("identifies deep reasoning models by ID", () => {
      expect(resolveModelSpeedTier("gemini-3.7-flash-thinking", "google")).toBe("deep");
      expect(resolveModelSpeedTier("claude-opus-4", "anthropic")).toBe("deep");
    });

    it("defaults to standard for unknown models", () => {
      expect(resolveModelSpeedTier("some-new-model", "openrouter")).toBe("standard");
    });

    it("detects flash from name pattern", () => {
      expect(resolveModelSpeedTier("any-flash-lite", "test")).toBe("flash");
    });
  });

  describe("resolveModelContextWindow", () => {
    it("returns known window sizes", () => {
      expect(resolveModelContextWindow("gemini-2.0-flash")).toBe(1_048_576);
      expect(resolveModelContextWindow("deepseek-chat")).toBe(131_072);
    });

    it("returns default for unknown models", () => {
      expect(resolveModelContextWindow("unknown-model", 200_000)).toBe(200_000);
      expect(resolveModelContextWindow("unknown-model")).toBe(131_072);
    });
  });

  describe("formatContextWindow", () => {
    it("formats 1M+", () => {
      expect(formatContextWindow(1_048_576)).toBe("1M");
      expect(formatContextWindow(2_097_152)).toBe("2.1M");
    });

    it("formats thousands", () => {
      expect(formatContextWindow(131_072)).toBe("131K");
      expect(formatContextWindow(200_000)).toBe("200K");
    });
  });

  describe("buildModelMultimodeProfile", () => {
    it("returns text modality by default", () => {
      const profile = buildModelMultimodeProfile({
        provider: "google",
        modelId: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        reasoning: true,
      });
      expect(profile.modalities).toContain("text");
    });

    it("adds vision when supportsVision is true", () => {
      const profile = buildModelMultimodeProfile({
        provider: "google",
        modelId: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        reasoning: true,
        supportsVision: true,
      });
      expect(profile.modalities).toContain("vision");
    });

    it("assigns thinking levels for reasoning models", () => {
      const profile = buildModelMultimodeProfile({
        provider: "openrouter",
        modelId: "deepseek-flash",
        label: "DeepSeek Flash",
        reasoning: false,
      });
      expect(profile.thinkingLevels).toEqual(["off"]);
    });

    it("marks recommended models", () => {
      const profile = buildModelMultimodeProfile({
        provider: "google",
        modelId: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        reasoning: true,
      });
      expect(profile.recommended).toBe(true);
    });
  });

  describe("speedTierLabel", () => {
    it("returns Chinese labels", () => {
      expect(speedTierLabel("flash")).toContain("极速");
      expect(speedTierLabel("standard")).toContain("均衡");
      expect(speedTierLabel("deep")).toContain("深度");
    });
  });

  describe("modelMultimodeSummary", () => {
    it("generates a readable summary for a flash model", () => {
      const profile = buildModelMultimodeProfile({
        provider: "google",
        modelId: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        reasoning: true,
        supportsVision: true,
        thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      });
      const summary = modelMultimodeSummary(profile);
      expect(summary).toContain("Gemini 3.8 Flash");
      expect(summary).toContain("极速");
      expect(summary).toContain("1M");
      expect(summary).toContain("视觉");
    });
  });
});