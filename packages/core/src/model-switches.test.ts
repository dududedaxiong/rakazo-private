import type { ModelSwitchAttempt } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import {
  buildModelSwitches,
  createModelSwitchAttempt,
  modelSwitchErrorCode,
  recordModelSwitchAttempt,
} from "./model-switches.js";

describe("modelSwitchErrorCode", () => {
  it("maps the run-error kinds to timeline codes", () => {
    expect(modelSwitchErrorCode('429: {"message": "Too many requests"}')).toBe("rate_limit");
    expect(modelSwitchErrorCode('401: {"message": "Incorrect API key provided"}')).toBe(
      "authentication",
    );
    expect(modelSwitchErrorCode("The model hit its output limit before finishing its reply.")).toBe(
      "output_error",
    );
  });

  it("names kind-less provider faults from the message", () => {
    expect(modelSwitchErrorCode("Connection error.")).toBe("connection");
    expect(modelSwitchErrorCode("fetch failed")).toBe("timeout");
    expect(modelSwitchErrorCode("503 Service Unavailable")).toBe("unavailable");
    expect(modelSwitchErrorCode("something nobody recognizes")).toBeUndefined();
  });
});

describe("createModelSwitchAttempt", () => {
  it("collapses and truncates the failure detail to 300 characters", () => {
    const attempt = createModelSwitchAttempt({
      model: "model-a",
      provider: "GB中转",
      outcome: "failed",
      error: `line one\n  line   two ${"x".repeat(400)}`,
    });
    expect(attempt.errorMessage).toBe(`line one line two ${"x".repeat(400)}`.slice(0, 300).trim());
    expect(attempt.errorCode).toBeUndefined();
    expect(attempt.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("classifies the code from the error when not given", () => {
    const attempt = createModelSwitchAttempt({
      model: "model-a",
      outcome: "failed",
      error: '429: {"message": "Too many requests"}',
    });
    expect(attempt.errorCode).toBe("rate_limit");
    expect(attempt.provider).toBeUndefined();
  });
});

describe("recordModelSwitchAttempt and buildModelSwitches", () => {
  it("keeps one entry per model, latest outcome wins", () => {
    const attempts: ModelSwitchAttempt[] = [];
    recordModelSwitchAttempt(
      attempts,
      createModelSwitchAttempt({ model: "model-a", outcome: "failed", error: "boom" }),
    );
    recordModelSwitchAttempt(
      attempts,
      createModelSwitchAttempt({ model: "model-a", outcome: "succeeded" }),
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("succeeded");
  });

  it("returns a timeline only when another model failed before the final one", () => {
    const switched = [
      createModelSwitchAttempt({
        model: "model-a",
        provider: "主站",
        outcome: "failed",
        error: "429 Too many requests",
      }),
      createModelSwitchAttempt({
        model: "model-b",
        provider: "GB中转",
        outcome: "succeeded",
      }),
    ];
    expect(buildModelSwitches(switched)).toEqual({
      attempts: switched,
      finalModel: "model-b",
    });
  });

  it("returns nothing for a first-model answer or a same-model retry", () => {
    expect(
      buildModelSwitches([createModelSwitchAttempt({ model: "model-a", outcome: "succeeded" })]),
    ).toBeUndefined();
    expect(
      buildModelSwitches([
        createModelSwitchAttempt({ model: "model-a", outcome: "failed", error: "boom" }),
        createModelSwitchAttempt({ model: "model-a", outcome: "succeeded" }),
      ]),
    ).toBeUndefined();
    expect(buildModelSwitches([])).toBeUndefined();
  });

  it("keeps same-named models on different connections apart", () => {
    const attempts = [
      createModelSwitchAttempt({
        model: "deepseek-v4.1-flash",
        provider: "主站",
        outcome: "failed",
        error: "429 Too many requests",
      }),
      createModelSwitchAttempt({
        model: "deepseek-v4.1-flash",
        provider: "GB中转",
        outcome: "succeeded",
      }),
    ];
    expect(buildModelSwitches(attempts)?.finalModel).toBe("deepseek-v4.1-flash");
    expect(buildModelSwitches(attempts)?.attempts).toHaveLength(2);
  });
});
