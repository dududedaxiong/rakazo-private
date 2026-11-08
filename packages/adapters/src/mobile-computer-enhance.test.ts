import { describe, expect, it } from "vitest";
import {
  backoffDelay,
  buildMobileComputerConfig,
  captchaDetectionInjectedScript,
  isComputerInteractive,
  gestureActionLabel,
  DEFAULT_GESTURE_CONFIG,
  DEFAULT_KEYFRAME_CONFIG,
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_SESSION_CONFIG,
} from "./mobile-computer-enhance.js";

describe("mobile-computer-enhance", () => {
  describe("buildMobileComputerConfig", () => {
    it("returns defaults without overrides", () => {
      const config = buildMobileComputerConfig({});
      expect(config.keyframe.enabled).toBe(true);
      expect(config.gesture.enabled).toBe(true);
      expect(config.reconnect.maxAttempts).toBe(10);
      expect(config.session.enabled).toBe(true);
    });

    it("applies partial overrides", () => {
      const config = buildMobileComputerConfig({
        keyframe: { enabled: false },
        gesture: { longPressDelayMs: 800 },
      });
      expect(config.keyframe.enabled).toBe(false);
      expect(config.gesture.longPressDelayMs).toBe(800);
      expect(config.gesture.pinchZoomSensitivity).toBe(
        DEFAULT_GESTURE_CONFIG.pinchZoomSensitivity,
      );
    });
  });

  describe("backoffDelay", () => {
    it("returns base delay for attempt 0", () => {
      expect(backoffDelay(0, DEFAULT_RECONNECT_CONFIG)).toBe(
        DEFAULT_RECONNECT_CONFIG.baseDelayMs,
      );
    });

    it("applies exponential backoff", () => {
      const delay1 = backoffDelay(1, DEFAULT_RECONNECT_CONFIG);
      const delay2 = backoffDelay(2, DEFAULT_RECONNECT_CONFIG);
      expect(delay1).toBeGreaterThan(DEFAULT_RECONNECT_CONFIG.baseDelayMs);
      expect(delay2).toBeGreaterThan(delay1);
    });

    it("caps at maxBackoffMs", () => {
      const delay = backoffDelay(100, DEFAULT_RECONNECT_CONFIG);
      expect(delay).toBeLessThanOrEqual(DEFAULT_RECONNECT_CONFIG.maxBackoffMs);
    });
  });

  describe("isComputerInteractive", () => {
    it("returns true for running, unbusy status", () => {
      expect(
        isComputerInteractive({ state: "running", botId: "b1", mode: "team" } as any),
      ).toBe(true);
    });

    it("returns false when busy", () => {
      expect(
        isComputerInteractive({
          state: "running",
          botId: "b1",
          mode: "team",
          busyBotName: "Helper",
        } as any),
      ).toBe(false);
    });

    it("returns false for non-running states", () => {
      expect(isComputerInteractive(null)).toBe(false);
      expect(isComputerInteractive({ state: "stopped" } as any)).toBe(false);
    });
  });

  describe("captchaDetectionInjectedScript", () => {
    it("returns a valid JS injection", () => {
      const script = captchaDetectionInjectedScript();
      expect(script).toContain("__rakazoCaptchaCheck");
      expect(script).toContain("function");
    });
  });

  describe("gestureActionLabel", () => {
    it("returns Chinese labels for all gestures", () => {
      const gestures = [
        "tap", "double_tap", "long_press", "pinch_zoom",
        "two_finger_scroll", "edge_swipe_left", "edge_swipe_right",
      ] as const;
      for (const gesture of gestures) {
        expect(gestureActionLabel(gesture)).toBeTruthy();
      }
    });
  });
});