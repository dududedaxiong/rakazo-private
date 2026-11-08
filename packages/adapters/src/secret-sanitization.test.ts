import { describe, expect, it } from "vitest";
import {
  detectCaptcha,
  detectSensitiveFields,
  sanitizeObject,
  sanitizeValue,
} from "./secret-sanitization.js";

describe("secret-sanitization", () => {
  describe("sanitizeValue", () => {
    it("redacts values", () => {
      expect(sanitizeValue("my-secret-password", "redact", "password")).toBe("[REDACTED]");
    });

    it("masks phone numbers", () => {
      const masked = sanitizeValue("13812345678", "mask", "phone");
      expect(masked).toBe("138****5678");
    });

    it("masks emails", () => {
      const masked = sanitizeValue("user@example.com", "mask", "email");
      expect(masked).toContain("***");
      expect(masked).toContain("@example.com");
    });

    it("masks API keys", () => {
      const masked = sanitizeValue("sk-abcdefghijklmnop", "mask", "api_key");
      expect(masked.startsWith("sk")).toBe(true);
      expect(masked.endsWith("op")).toBe(true);
      expect(masked.includes("*")).toBe(true);
    });

    it("replaces with category label", () => {
      expect(sanitizeValue("some token", "replace", "token")).toBe("[TOKEN]");
    });

    it("handles short values", () => {
      const masked = sanitizeValue("ab", "mask", "password");
      expect(masked).toBe("****");
    });
  });

  describe("detectSensitiveFields", () => {
    it("finds password fields in flat objects", () => {
      const obj = { username: "john", password: "secret123", email: "john@test.com" };
      const fields = detectSensitiveFields(obj);
      expect(fields.find((f) => f.field === "password")).toBeTruthy();
      expect(fields.find((f) => f.field === "email")).toBeTruthy();
      expect(fields.find((f) => f.field === "username")).toBeFalsy();
    });

    it("finds nested sensitive fields", () => {
      const obj = {
        config: {
          apiKey: "sk-secret",
          db: { password: "admin123" },
        },
      };
      const fields = detectSensitiveFields(obj);
      expect(fields.some((f) => f.path === "config.apiKey")).toBe(true);
      expect(fields.some((f) => f.path === "config.db.password")).toBe(true);
    });
  });

  describe("sanitizeObject", () => {
    it("masks sensitive fields in an object", () => {
      const obj = {
        username: "john",
        password: "secret123",
        token: "bearer-token-value",
      };
      const sanitized = sanitizeObject(obj) as Record<string, unknown>;
      expect(sanitized.username).toBe("john");
      expect(sanitized.password).not.toBe("secret123");
      expect(sanitized.token).not.toBe("bearer-token-value");
    });

    it("handles null and primitives", () => {
      expect(sanitizeObject(null)).toBeNull();
      expect(sanitizeObject(42)).toBe(42);
      expect(sanitizeObject("hello")).toBe("hello");
    });
  });

  describe("detectCaptcha", () => {
    it("detects Cloudflare challenge", () => {
      const result = detectCaptcha(
        "Just a moment while we verify... Cloudflare security check",
        '<div id="cf-challenge">',
      );
      expect(result.detected).toBe(true);
      expect(result.type).toBe("cloudflare_challenge");
    });

    it("detects hCaptcha", () => {
      // Use explicit hCaptcha markers
      const result = detectCaptcha(
        "Please verify",
        '<div class="h-captcha" data-sitekey="abc"></div>',
      );
      expect(result.detected).toBe(true);
      expect(result.type).toBe("hcaptcha");
    });

    it("detects slider captcha", () => {
      const result = detectCaptcha("请拖动滑块完成验证", "");
      expect(result.detected).toBe(true);
      expect(result.type).toBe("slider");
    });

    it("returns not detected for clean pages", () => {
      const result = detectCaptcha("Welcome to the homepage", "");
      expect(result.detected).toBe(false);
    });

    it("prefers takeover-required captcha when multiple match", () => {
      const result = detectCaptcha(
        "hcaptcha verification required",
        '<div class="h-captcha"><div>Just a moment</div></div>',
      );
      expect(result.requiresTakeover).toBe(true);
    });
  });
});