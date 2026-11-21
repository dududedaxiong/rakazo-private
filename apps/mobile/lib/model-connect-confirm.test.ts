import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ alert: vi.fn() }));

vi.mock("react-native", () => ({ Alert: { alert: native.alert } }));

import type { ModelConnectInput } from "@rakazo_mickvvw/contracts";
import { Alert } from "react-native";
import type { t as translate } from "./i18n";
import { saveWithModelRemovalConfirmation } from "./model-connect-confirm";

const t = ((key: string) => key) as unknown as typeof translate;

const input: ModelConnectInput = {
  provider: "openai-compatible",
  modelId: "m-a",
  enabledModelIds: ["m-a"],
};

function conflictError() {
  return Object.assign(
    new Error("正被聊天主模型使用。确认保存将移除这些占用，之后请手动重新设定对应模型。"),
    {
      code: "CONFLICT",
      data: {
        reason: "confirm_model_removal",
        occupancies: [{ kind: "role", role: "main", pool: "main" }],
        removesLastEnabledModel: false,
      },
    },
  );
}

type AlertButton = { text?: string; onPress?: () => void };

function currentAlert() {
  const call = vi.mocked(Alert.alert).mock.calls.at(-1);
  if (!call) throw new Error("Expected a model removal alert");
  return { title: call[0], message: call[1], buttons: (call[2] ?? []) as AlertButton[] };
}

describe("saveWithModelRemovalConfirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves once when the first attempt succeeds", async () => {
    const save = vi.fn(async () => "saved");
    await expect(saveWithModelRemovalConfirmation(input, save, t)).resolves.toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(input);
    expect(native.alert).not.toHaveBeenCalled();
  });

  it("asks and retries with confirmRemovePins when confirmed", async () => {
    const save = vi.fn().mockRejectedValueOnce(conflictError()).mockResolvedValueOnce("saved");
    const pending = saveWithModelRemovalConfirmation(input, save, t);
    await vi.waitFor(() => expect(native.alert).toHaveBeenCalled());
    expect(currentAlert().title).toBe("Save");
    expect(currentAlert().message).toContain("正被聊天主模型使用");
    expect(currentAlert().buttons.map((button) => button.text)).toEqual(["Cancel", "Save"]);
    const confirmButton = currentAlert().buttons[1];
    if (!confirmButton?.onPress) throw new Error("Expected a confirm button");
    confirmButton.onPress();
    await expect(pending).resolves.toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ ...input, confirmRemovePins: true });
  });

  it("rethrows the conflict without retrying when cancelled", async () => {
    const error = conflictError();
    const save = vi.fn().mockRejectedValueOnce(error);
    const pending = saveWithModelRemovalConfirmation(input, save, t);
    await vi.waitFor(() => expect(native.alert).toHaveBeenCalled());
    const cancelButton = currentAlert().buttons[0];
    if (!cancelButton?.onPress) throw new Error("Expected a cancel button");
    cancelButton.onPress();
    await expect(pending).rejects.toBe(error);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("passes a different failure through without asking", async () => {
    const error = Object.assign(new Error("Bad request"), { code: "BAD_REQUEST" });
    const save = vi.fn().mockRejectedValueOnce(error);
    await expect(saveWithModelRemovalConfirmation(input, save, t)).rejects.toBe(error);
    expect(save).toHaveBeenCalledTimes(1);
    expect(native.alert).not.toHaveBeenCalled();
  });

  it("passes a conflict with another reason through without asking", async () => {
    const error = Object.assign(new Error("Something else"), {
      code: "CONFLICT",
      data: { reason: "something_else" },
    });
    const save = vi.fn().mockRejectedValueOnce(error);
    await expect(saveWithModelRemovalConfirmation(input, save, t)).rejects.toBe(error);
    expect(save).toHaveBeenCalledTimes(1);
    expect(native.alert).not.toHaveBeenCalled();
  });
});
