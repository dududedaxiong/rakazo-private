import type { ModelSwitchAttempt } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import {
  currentModelBar,
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

  it("prefers the bot's current model row for a locate without a connection", () => {
    // The same model on two connections, the other one first in the list:
    // a trailing mark names only the model, so the model alone would land
    // on the wrong connection.
    const shared = [
      { key: "relay::model-a", modelId: "model-a", provider: "relay", providerLabel: "GB中转" },
      { key: "openai::model-a", modelId: "model-a", provider: "openai", providerLabel: "主站" },
    ];
    expect(locateModelChoiceKey(shared, { model: "model-a", provider: null })).toBe(
      "relay::model-a",
    );
    expect(
      locateModelChoiceKey(shared, { model: "model-a", provider: null }, "openai::model-a"),
    ).toBe("openai::model-a");
    // A preferred row for another model does not win.
    expect(
      locateModelChoiceKey(shared, { model: "model-a", provider: null }, "relay::model-b"),
    ).toBe("relay::model-a");
    // A named connection still outranks the preferred row.
    expect(
      locateModelChoiceKey(shared, { model: "model-a", provider: "GB中转" }, "openai::model-a"),
    ).toBe("relay::model-a");
  });

  it("bridges an API id and its catalog id on a third-party connection", () => {
    const deepseekChoices = [
      {
        key: "openai-compatible::deepseek-v4.1-flash",
        modelId: "deepseek-v4.1-flash",
        provider: "openai-compatible",
        providerLabel: "测试",
      },
    ];
    // The mark carries the API id; the list carries the catalog id.
    expect(locateModelChoiceKey(deepseekChoices, { model: "deepseek-flash", provider: null })).toBe(
      "openai-compatible::deepseek-v4.1-flash",
    );
    // And the other way round: the list carries the API id, the mark the catalog id.
    expect(
      locateModelChoiceKey(
        [
          {
            key: "openai-compatible::deepseek-flash",
            modelId: "deepseek-flash",
            provider: "openai-compatible",
            providerLabel: "测试",
          },
        ],
        { model: "deepseek-v4.1-flash", provider: "测试" },
      ),
    ).toBe("openai-compatible::deepseek-flash");
    // A different DeepSeek model still does not match.
    expect(
      locateModelChoiceKey(deepseekChoices, { model: "deepseek-v4-pro", provider: null }),
    ).toBeNull();
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

describe("current-model bar", () => {
  const mark = { modelId: "deepseek-flash" };
  const markedPreset = { modelId: "model-x", presetName: "默认预设" };
  const withTimeline = {
    role: "bot",
    modelSwitches: { attempts, finalModel: "krisphyn-DeepSeek-V4-Pro" },
  };

  it("opens the timeline when the message carries switches", () => {
    expect(currentModelBar(withTimeline, mark)).toEqual({
      kind: "timeline",
      switches: withTimeline.modelSwitches,
    });
    expect(currentModelBar(withTimeline, markedPreset)).toEqual({
      kind: "timeline",
      switches: withTimeline.modelSwitches,
      presetName: "默认预设",
    });
  });

  it("opens the model list when the message only carries the mark", () => {
    expect(currentModelBar({ role: "bot" }, mark)).toEqual({
      kind: "mark",
      model: "deepseek-flash",
    });
    expect(currentModelBar({ role: "bot" }, markedPreset)).toEqual({
      kind: "mark",
      model: "model-x",
      presetName: "默认预设",
    });
    // An empty timeline is no timeline: the mark still opens the list.
    expect(
      currentModelBar({ role: "bot", modelSwitches: { attempts: [], finalModel: "x" } }, mark),
    ).toEqual({ kind: "mark", model: "deepseek-flash" });
  });

  it("shows no bar without a mark, or on a user message", () => {
    expect(currentModelBar(withTimeline, null)).toBeNull();
    expect(currentModelBar({ role: "bot" }, null)).toBeNull();
    expect(currentModelBar({ role: "user" }, mark)).toBeNull();
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
