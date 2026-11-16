import { describe, expect, it } from "vitest";
import { locateModelChoiceKey } from "./model-locate";

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
  });

  it("prefers the bot's current model row for a locate without a connection", () => {
    const shared = [
      { key: "relay::model-a", modelId: "model-a", provider: "relay", providerLabel: "GB中转" },
      { key: "openai::model-a", modelId: "model-a", provider: "openai", providerLabel: "主站" },
    ];
    expect(locateModelChoiceKey(shared, { model: "model-a" })).toBe("relay::model-a");
    expect(locateModelChoiceKey(shared, { model: "model-a" }, "openai::model-a")).toBe(
      "openai::model-a",
    );
    // A preferred row for another model does not win.
    expect(locateModelChoiceKey(shared, { model: "model-a" }, "relay::model-b")).toBe(
      "relay::model-a",
    );
    // A named connection still outranks the preferred row.
    expect(
      locateModelChoiceKey(shared, { model: "model-a", provider: "GB中转" }, "openai::model-a"),
    ).toBe("relay::model-a");
  });

  it("bridges an API id and its catalog id on a third-party connection, either way", () => {
    const deepseekChoices = [
      {
        key: "openai-compatible::deepseek-v4.1-flash",
        modelId: "deepseek-v4.1-flash",
        provider: "openai-compatible",
        providerLabel: "测试",
      },
      {
        key: "openai-compatible::deepseek-flash",
        modelId: "deepseek-flash",
        provider: "openai-compatible",
        providerLabel: "GB大佬",
      },
    ];
    // The mark carries the API id; the list carries the catalog id, on the
    // named connection — not the same id on the other connection.
    expect(
      locateModelChoiceKey(deepseekChoices, { model: "deepseek-flash", provider: "测试" }),
    ).toBe("openai-compatible::deepseek-v4.1-flash");
    // And the other way round: the list carries the API id, the mark the catalog id.
    expect(
      locateModelChoiceKey(deepseekChoices, { model: "deepseek-v4.1-flash", provider: "GB大佬" }),
    ).toBe("openai-compatible::deepseek-flash");
    // A different DeepSeek model still does not match.
    expect(
      locateModelChoiceKey(deepseekChoices, { model: "deepseek-v4-pro", provider: "测试" }),
    ).toBeNull();
  });
});
