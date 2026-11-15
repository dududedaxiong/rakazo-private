import { beforeEach, describe, expect, it, vi } from "vitest";
import { showModelErrorAlert } from "./model-error-alert";

const alertMock = vi.hoisted(() => vi.fn());
const openModelSettings = vi.hoisted(() => vi.fn());

vi.mock("react-native", () => ({ Alert: { alert: alertMock } }));
vi.mock("./model-settings", () => ({ openModelSettings }));
vi.mock("./user-error", () => ({
  errorText: (error: unknown) =>
    typeof error === "string" ? error : "Something went wrong. Try again.",
}));
vi.mock("./key-health", () => ({
  keyCheckResultText: (t: (message: string) => string, status: string) => t(`key:${status}`),
}));

const t = (message: string) => message;

describe("showModelErrorAlert", () => {
  beforeEach(() => {
    alertMock.mockClear();
    openModelSettings.mockClear();
  });

  it("offers the provider switch for an invalid key", () => {
    showModelErrorAlert(t, '401: {"error": {"message": "Incorrect API key provided"}}');
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [, message, buttons] = alertMock.mock.calls[0] as [
      string,
      string | undefined,
      { text: string; onPress?: () => void }[],
    ];
    expect(message).toBeUndefined();
    expect(buttons.map((button) => button.text)).toEqual(["Switch provider", "Cancel"]);
    buttons[0]?.onPress?.();
    expect(openModelSettings).toHaveBeenCalledTimes(1);
  });

  it("offers the model change for a missing model", () => {
    showModelErrorAlert(t, '404: {"error": {"message": "model not found"}}');
    const [, , buttons] = alertMock.mock.calls[0] as [
      string,
      string | undefined,
      { text: string }[],
    ];
    expect(buttons.map((button) => button.text)).toEqual(["Change model", "Cancel"]);
  });

  it("dismisses a rate limit with try-again-later and offers another model", () => {
    showModelErrorAlert(t, '429: {"error": {"message": "rate limit exceeded"}}');
    const [, , buttons] = alertMock.mock.calls[0] as [
      string,
      string | undefined,
      { text: string; style?: string }[],
    ];
    expect(buttons.map((button) => button.text)).toEqual(["Try again later", "Change model"]);
    expect(buttons[0]?.style).toBe("cancel");
  });

  it("keeps the original error as the detail for an unknown failure", () => {
    const retry = vi.fn();
    showModelErrorAlert(t, "boom", { retry });
    const [, message, buttons] = alertMock.mock.calls[0] as [
      string,
      string | undefined,
      { text: string; onPress?: () => void }[],
    ];
    expect(message).toBe("boom");
    expect(buttons.map((button) => button.text)).toEqual(["Retry", "Cancel"]);
    buttons[0]?.onPress?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
