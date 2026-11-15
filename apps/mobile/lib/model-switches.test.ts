import type { ModelSwitchAttempt } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  finalSwitchAttempt,
  finalSwitchProvider,
  hasModelSwitches,
  locateModelChoiceKey,
  modelSwitchTimelineRows,
  parseCurrentModelMark,
  stripCurrentModelMark,
  stripCurrentModelMarkBlocks,
  switchAttemptErrorLabel,
  translationModelSwitches,
} from "./model-switches";

const choices = [
  { key: "openai::model-a", modelId: "model-a", provider: "openai", providerLabel: "主站" },
  { key: "relay::model-a", modelId: "model-a", provider: "relay", providerLabel: "GB中转" },
  { key: "relay::model-b", modelId: "model-b", provider: "relay", providerLabel: "GB中转" },
];

describe("locate model choice key", () => {
  it("prefers the row on the named connection over the same model elsewhere", () => {
    expect(locateModelChoiceKey(choices, { model: "model-a", provider: "GB中转" })).toBe(
      "relay::model-a",
    );
    expect(locateModelChoiceKey(choices, { model: "model-a", provider: "主站" })).toBe(
      "openai::model-a",
    );
  });

  it("falls back to the model id, then to null", () => {
    expect(locateModelChoiceKey(choices, { model: "model-b", provider: "主站" })).toBe(
      "relay::model-b",
    );
    expect(locateModelChoiceKey(choices, { model: "model-z", provider: "主站" })).toBeNull();
    expect(locateModelChoiceKey(choices, null)).toBeNull();
  });
});

const attempts: ModelSwitchAttempt[] = [
  {
    model: "deepseek-v4.1-flash",
    provider: "主站",
    outcome: "failed",
    errorCode: "rate_limit",
    errorMessage: "429 Too Many Requests",
    at: "2026-11-15T10:00:00.000Z",
  },
  {
    model: "deepseek-v4.1-flash",
    provider: "GB中转",
    outcome: "failed",
    errorCode: "connection",
    errorMessage: "connect ECONNREFUSED",
    at: "2026-11-15T10:00:05.000Z",
  },
  {
    model: "krisphyn-DeepSeek-V4-Pro",
    provider: "GB中转",
    outcome: "succeeded",
    at: "2026-11-15T10:00:12.000Z",
  },
];

describe("model-switch timeline rows", () => {
  it("lists failures, switches, and the final model in order", () => {
    expect(modelSwitchTimelineRows({ attempts, finalModel: "krisphyn-DeepSeek-V4-Pro" })).toEqual([
      { kind: "attempt", attempt: attempts[0] },
      { kind: "switch", model: "deepseek-v4.1-flash", provider: "GB中转" },
      { kind: "attempt", attempt: attempts[1] },
      { kind: "switch", model: "krisphyn-DeepSeek-V4-Pro", provider: "GB中转" },
      { kind: "done", model: "krisphyn-DeepSeek-V4-Pro", provider: "GB中转" },
    ]);
  });

  it("shows a single successful try as one done line", () => {
    expect(
      modelSwitchTimelineRows({
        attempts: [attempts[2]!],
        finalModel: "krisphyn-DeepSeek-V4-Pro",
      }),
    ).toEqual([{ kind: "done", model: "krisphyn-DeepSeek-V4-Pro", provider: "GB中转" }]);
  });

  it("still ends with a done line when every try failed", () => {
    const rows = modelSwitchTimelineRows({
      attempts: attempts.slice(0, 2),
      finalModel: "deepseek-v4.1-flash",
    });
    expect(rows.at(-1)).toEqual({
      kind: "done",
      model: "deepseek-v4.1-flash",
      provider: "GB中转",
    });
  });

  it("finds the final attempt and its provider", () => {
    const switches = { attempts, finalModel: "krisphyn-DeepSeek-V4-Pro" };
    expect(finalSwitchAttempt(switches)).toBe(attempts[2]);
    expect(finalSwitchProvider(switches)).toBe("GB中转");
  });
});

describe("switch attempt error labels", () => {
  it("maps rate-limit, connection, timeout, and skipped codes", () => {
    expect(switchAttemptErrorLabel(attempts[0]!)).toBe("Rate limit (429)");
    expect(switchAttemptErrorLabel(attempts[1]!)).toBe("Connection error");
    expect(
      switchAttemptErrorLabel({
        model: "m",
        outcome: "failed",
        errorCode: "timeout",
        at: "2026-11-15T10:00:00.000Z",
      }),
    ).toBe("Timed out");
    expect(
      switchAttemptErrorLabel({
        model: "m",
        outcome: "skipped",
        at: "2026-11-15T10:00:00.000Z",
      }),
    ).toBe("Skipped");
    expect(
      switchAttemptErrorLabel({
        model: "m",
        outcome: "failed",
        errorMessage: "boom 429",
        at: "2026-11-15T10:00:00.000Z",
      }),
    ).toBe("Rate limit (429)");
    expect(
      switchAttemptErrorLabel({
        model: "m",
        outcome: "failed",
        at: "2026-11-15T10:00:00.000Z",
      }),
    ).toBe("Failed");
  });
});

describe("current-model mark parsing", () => {
  it("parses the trailing mark with and without a preset", () => {
    expect(parseCurrentModelMark("正文\n当前模型: backup-a")).toEqual({ modelId: "backup-a" });
    expect(parseCurrentModelMark("当前模型: model-x · 默认预设")).toEqual({
      modelId: "model-x",
      presetName: "默认预设",
    });
    expect(parseCurrentModelMark("当前模型: model-x")).toEqual({ modelId: "model-x" });
  });

  it("ignores a mark that is not the last line", () => {
    expect(parseCurrentModelMark("当前模型: backup-a\n还有正文")).toBeNull();
    expect(parseCurrentModelMark("没有 mark 的正文")).toBeNull();
  });

  it("strips only the trailing mark line", () => {
    expect(stripCurrentModelMark("正文\n当前模型: backup-a")).toBe("正文");
    expect(stripCurrentModelMark("当前模型: model-x · 默认预设")).toBe("");
    expect(stripCurrentModelMark("当前模型: backup-a\n还有正文")).toBe(
      "当前模型: backup-a\n还有正文",
    );
  });

  it("drops or trims the last block carrying the mark", () => {
    expect(
      stripCurrentModelMarkBlocks([
        { kind: "text", text: "正文" },
        { kind: "text", text: "当前模型: backup-a" },
      ]),
    ).toEqual([{ kind: "text", text: "正文" }]);
    expect(
      stripCurrentModelMarkBlocks([{ kind: "text", text: "正文\n当前模型: backup-a" }]),
    ).toEqual([{ kind: "text", text: "正文" }]);
    expect(stripCurrentModelMarkBlocks([{ kind: "text", text: "没有 mark" }])).toEqual([
      { kind: "text", text: "没有 mark" },
    ]);
  });

  it("reports whether a message carries a timeline", () => {
    expect(hasModelSwitches({ modelSwitches: { attempts, finalModel: "x" } })).toBe(true);
    expect(hasModelSwitches({ modelSwitches: { attempts: [], finalModel: "x" } })).toBe(false);
    expect(hasModelSwitches({})).toBe(false);
  });
});

describe("translation model switches", () => {
  it("uses the returned attempts when present", () => {
    expect(
      translationModelSwitches({ modelId: "krisphyn-DeepSeek-V4-Pro", attempts }, "GB中转"),
    ).toEqual({ attempts, finalModel: "krisphyn-DeepSeek-V4-Pro" });
  });

  it("synthesizes one succeeded attempt when the server sent none", () => {
    const switches = translationModelSwitches({ modelId: "deepseek-v4.1-flash" }, "主站");
    expect(switches.finalModel).toBe("deepseek-v4.1-flash");
    expect(switches.attempts).toHaveLength(1);
    expect(switches.attempts[0]).toMatchObject({
      model: "deepseek-v4.1-flash",
      provider: "主站",
      outcome: "succeeded",
    });
    expect(modelSwitchTimelineRows(switches)).toEqual([
      { kind: "done", model: "deepseek-v4.1-flash", provider: "主站" },
    ]);
  });
});
