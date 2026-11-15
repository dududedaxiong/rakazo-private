import { describe, expect, it } from "vitest";
import { ModelSwitchAttemptSchema, ModelSwitchesSchema } from "./model-switches.js";

const attempt = {
  model: "deepseek-v4.1-flash",
  provider: "GB中转",
  outcome: "failed" as const,
  errorCode: "rate_limit",
  errorMessage: "429 Too many requests",
  at: "2026-11-15T12:00:00.000Z",
};

describe("model switch timeline schema", () => {
  it("accepts a failed attempt and a finished timeline", () => {
    expect(ModelSwitchAttemptSchema.parse(attempt)).toEqual(attempt);
    expect(
      ModelSwitchesSchema.parse({
        attempts: [
          attempt,
          { ...attempt, model: "krisphyn-Kimi-K2.6", outcome: "succeeded" as const },
        ],
        finalModel: "krisphyn-Kimi-K2.6",
      }),
    ).toBeTruthy();
  });

  it("allows an attempt without a connection name or failure detail", () => {
    expect(
      ModelSwitchAttemptSchema.parse({
        model: "deepseek-v4.1-flash",
        outcome: "succeeded",
        at: "2026-11-15T12:00:00.000Z",
      }),
    ).toBeTruthy();
  });

  it("rejects an empty timeline and an over-long error message", () => {
    expect(ModelSwitchesSchema.safeParse({ attempts: [], finalModel: "x" }).success).toBe(false);
    expect(
      ModelSwitchAttemptSchema.safeParse({ ...attempt, errorMessage: "x".repeat(301) }).success,
    ).toBe(false);
    expect(ModelSwitchAttemptSchema.safeParse({ ...attempt, outcome: "retried" }).success).toBe(
      false,
    );
  });
});
