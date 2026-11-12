import { describe, expect, it } from "vitest";
import {
  formatModelTestClock,
  formatModelTestSeconds,
  formatModelTestTime,
  modelTestLineColor,
  modelTestReason,
  modelTestRowLine,
  modelTestStateLabel,
} from "./model-test-result";

const t = (message: string, values?: Record<string, string | number>) =>
  message.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));

describe("model test result presentation", () => {
  it("labels every probe state", () => {
    expect(
      (
        [
          "ok",
          "empty",
          "limited",
          "auth",
          "notfound",
          "timeout",
          "badreq",
          "servererr",
          "neterr",
        ] as const
      ).map((state) => modelTestStateLabel(state, t)),
    ).toEqual([
      "Usable",
      "Empty reply",
      "Rate limited",
      "No permission",
      "Not found",
      "Timed out",
      "Invalid request",
      "Upstream error",
      "Network error",
    ]);
  });

  it("formats seconds without a trailing decimal", () => {
    expect(formatModelTestSeconds(0.8)).toBe("0.8");
    expect(formatModelTestSeconds(1.2)).toBe("1.2");
    expect(formatModelTestSeconds(8.6)).toBe("8.6");
    expect(formatModelTestSeconds(60)).toBe("60");
  });

  it("formats test times with the year and clocks with hours and minutes", () => {
    const at = new Date(2026, 10, 12, 7, 46).getTime();
    expect(formatModelTestTime(at)).toBe("07:46 12/11/26");
    expect(formatModelTestClock(at)).toBe("07:46");
  });

  it("paints fast results green, slow blue, mid-range gray, failures red", () => {
    const tokens = { success: "green", link: "blue", destructive: "red", mutedForeground: "gray" };
    expect(
      modelTestLineColor(
        modelTestRowLine({
          result: { state: "ok", seconds: 0.8, testedAt: 0 },
          testing: false,
          interrupted: false,
          interruptedAt: null,
          images: false,
          t,
        })!.tone,
        tokens,
      ),
    ).toBe("green");
    expect(
      modelTestLineColor(
        modelTestRowLine({
          result: { state: "ok", seconds: 3.1, testedAt: 0 },
          testing: false,
          interrupted: false,
          interruptedAt: null,
          images: false,
          t,
        })!.tone,
        tokens,
      ),
    ).toBe("gray");
    expect(
      modelTestLineColor(
        modelTestRowLine({
          result: { state: "ok", seconds: 8.6, testedAt: 0 },
          testing: false,
          interrupted: false,
          interruptedAt: null,
          images: false,
          t,
        })!.tone,
        tokens,
      ),
    ).toBe("blue");
    expect(
      modelTestLineColor(
        modelTestRowLine({
          result: { state: "timeout", seconds: 60, testedAt: 0 },
          testing: false,
          interrupted: false,
          interruptedAt: null,
          images: false,
          t,
        })!.tone,
        tokens,
      ),
    ).toBe("red");
  });

  it("writes the row line the way the user reads it", () => {
    const at = new Date(2026, 10, 12, 7, 46).getTime();
    expect(
      modelTestRowLine({
        result: { state: "ok", seconds: 0.8, testedAt: at },
        testing: false,
        interrupted: false,
        interruptedAt: null,
        images: false,
        t,
      }),
    ).toEqual({ text: "✓ Usable · Latency 0.8s · Text · 07:46 12/11/26", tone: "fast" });
    expect(
      modelTestRowLine({
        result: { state: "timeout", seconds: 60, testedAt: at },
        testing: false,
        interrupted: false,
        interruptedAt: null,
        images: false,
        t,
      }),
    ).toEqual({ text: "✕ Timed out · 60s · Text · 07:46 12/11/26", tone: "failed" });
  });

  it("marks testing, interrupted, and untested rows", () => {
    expect(
      modelTestRowLine({
        result: null,
        testing: true,
        interrupted: false,
        interruptedAt: null,
        images: false,
        t,
      }),
    ).toEqual({ text: "Testing…", tone: "running" });
    expect(
      modelTestRowLine({
        result: null,
        testing: false,
        interrupted: true,
        interruptedAt: new Date(2026, 10, 12, 9, 36).getTime(),
        images: false,
        t,
      }),
    ).toEqual({ text: "Interrupted at 09:36", tone: "muted" });
    expect(
      modelTestRowLine({
        result: null,
        testing: false,
        interrupted: false,
        interruptedAt: null,
        images: false,
        t,
      }),
    ).toEqual({ text: "Not tested", tone: "muted" });
  });

  it("explains failures and keeps the upstream's own detail when it adds more", () => {
    expect(modelTestReason("ok", "2", t)).toBeNull();
    expect(modelTestReason("timeout", "请求超时", t)).toContain("60 seconds");
    expect(modelTestReason("timeout", "请求超时", t)).not.toContain("（请求超时）");
    const auth = modelTestReason("auth", "Incorrect API key provided", t);
    expect(auth).toContain("Incorrect API key provided");
    expect(modelTestReason("auth", "无权限", t)).not.toContain("（无权限）");
    expect(modelTestReason("notfound", "模型不存在或已停用", t)).toContain("does not exist");
  });
});
