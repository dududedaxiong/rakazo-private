import { describe, expect, it } from "vitest";
import {
  buildSwitchModelCard,
  diagnoseModelFailure,
  failureReasonHint,
  failureReasonLabel,
  filterBackupModels,
  isAutoRecoverable,
  PRIMARY_BACKUP_MODELS,
  requiresUserAction,
  switchModelTextMessage,
} from "./model-auto-recovery.js";

describe("model-auto-recovery", () => {
  describe("diagnoseModelFailure", () => {
    it("detects quota exhaustion", () => {
      expect(diagnoseModelFailure(new Error("insufficient_quota: credits exhausted")))
        .toBe("quota_exhausted");
      expect(diagnoseModelFailure(new Error("You have exceeded your current quota")))
        .toBe("quota_exhausted");
    });

    it("detects rate limiting", () => {
      expect(diagnoseModelFailure(new Error("429: rate limit exceeded")))
        .toBe("rate_limited");
      expect(diagnoseModelFailure(new Error("too many requests")))
        .toBe("rate_limited");
    });

    it("detects server errors", () => {
      expect(diagnoseModelFailure(new Error("502 Bad Gateway")))
        .toBe("server_error");
      expect(diagnoseModelFailure(new Error("Service Unavailable")))
        .toBe("server_error");
    });

    it("detects network errors", () => {
      expect(diagnoseModelFailure(new Error("fetch failed: connection refused")))
        .toBe("network_error");
      expect(diagnoseModelFailure(new Error("ECONNRESET")))
        .toBe("network_error");
    });

    it("returns unknown for unrecognized errors", () => {
      expect(diagnoseModelFailure(new Error("some random message"))).toBe("unknown");
    });

    it("handles non-Error values", () => {
      expect(diagnoseModelFailure("timeout waiting")).toBe("timeout");
      expect(diagnoseModelFailure(undefined)).toBe("unknown");
    });
  });

  describe("failureReasonLabel", () => {
    it("returns Chinese labels for all reasons", () => {
      const reasons = [
        "quota_exhausted", "rate_limited", "server_error",
        "credential_rejected", "network_error", "timeout",
        "channel_broken", "unknown",
      ] as const;

      for (const reason of reasons) {
        expect(failureReasonLabel(reason)).toBeTruthy();
      }
    });
  });

  describe("failureReasonHint", () => {
    it("returns actionable hints for each reason", () => {
      const reasons = [
        "quota_exhausted", "rate_limited", "server_error",
        "credential_rejected", "network_error", "timeout",
        "channel_broken", "unknown",
      ] as const;

      for (const reason of reasons) {
        expect(failureReasonHint(reason)).toBeTruthy();
      }
    });
  });

  describe("filterBackupModels", () => {
    it("excludes the failed model", () => {
      const backups = filterBackupModels("google", "gemini-3.8-flash");
      expect(backups.every((b) => b.modelId !== "gemini-3.8-flash")).toBe(true);
    });

    it("prefers different-provider models first", () => {
      const backups = filterBackupModels("google", "gemini-3.8-flash");
      const first = backups[0];
      expect(first?.provider).not.toBe("google");
    });

    it("returns at most 4 options", () => {
      const backups = filterBackupModels("test", "nonexistent");
      expect(backups.length).toBeLessThanOrEqual(4);
    });
  });

  describe("isAutoRecoverable", () => {
    it("identifies auto-recoverable failures", () => {
      expect(isAutoRecoverable("rate_limited")).toBe(true);
      expect(isAutoRecoverable("server_error")).toBe(true);
      expect(isAutoRecoverable("timeout")).toBe(true);
    });

    it("identifies non-recoverable failures", () => {
      expect(isAutoRecoverable("quota_exhausted")).toBe(false);
      expect(isAutoRecoverable("credential_rejected")).toBe(false);
      expect(isAutoRecoverable("network_error")).toBe(false);
    });
  });

  describe("requiresUserAction", () => {
    it("identifies failures needing user intervention", () => {
      expect(requiresUserAction("quota_exhausted")).toBe(true);
      expect(requiresUserAction("credential_rejected")).toBe(true);
    });

    it("transient errors do not need user action", () => {
      expect(requiresUserAction("rate_limited")).toBe(false);
      expect(requiresUserAction("timeout")).toBe(false);
    });
  });

  describe("switchModelTextMessage", () => {
    it("generates readable fallback text", () => {
      const msg = switchModelTextMessage({
        failedModelLabel: "Gemini 3.8 Flash",
        failureReason: "quota_exhausted",
        backups: PRIMARY_BACKUP_MODELS.slice(0, 3),
      });
      expect(msg).toContain("Gemini 3.8 Flash");
      expect(msg).toContain("不可用");
      expect(msg).toContain("DeepSeek Flash");
    });
  });

  describe("PRIMARY_BACKUP_MODELS", () => {
    it("has primary backups at the top", () => {
      const primaries = PRIMARY_BACKUP_MODELS.filter((m) => m.primary);
      expect(primaries.length).toBeGreaterThan(0);
      expect(PRIMARY_BACKUP_MODELS[0]?.primary).toBe(true);
    });
  });
});