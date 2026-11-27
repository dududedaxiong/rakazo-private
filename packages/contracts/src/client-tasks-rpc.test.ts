import { describe, expect, it } from "vitest";
import { appContract } from "./rpc.js";

describe("clientTasks.complete", () => {
  const complete = appContract.clientTasks.complete["~orpc"].inputSchema!;

  it("accepts every verdict, with or without a result", () => {
    for (const status of ["completed", "failed", "declined"]) {
      expect(complete.safeParse({ taskId: "task-1", status }).success).toBe(true);
    }
    expect(
      complete.safeParse({
        taskId: "task-1",
        status: "completed",
        result: { url: "https://example.com/", title: "Example", text: "hi", truncated: false },
      }).success,
    ).toBe(true);
    expect(
      complete.safeParse({
        taskId: "task-1",
        status: "failed",
        result: {
          url: "https://example.com/",
          title: "",
          text: "",
          truncated: false,
          error: "load failed",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown verdicts and non-URL results", () => {
    expect(complete.safeParse({ taskId: "task-1", status: "pending" }).success).toBe(false);
    expect(
      complete.safeParse({
        taskId: "task-1",
        status: "completed",
        result: { url: "not-a-url", title: "", text: "", truncated: false },
      }).success,
    ).toBe(false);
    expect(complete.safeParse({ status: "completed" }).success).toBe(false);
  });
});

describe("clientTasks.setPreference", () => {
  const setPreference = appContract.clientTasks.setPreference["~orpc"].inputSchema!;

  it("takes only the switch", () => {
    expect(setPreference.safeParse({ enabled: true }).success).toBe(true);
    expect(setPreference.safeParse({ enabled: false }).success).toBe(true);
    expect(setPreference.safeParse({}).success).toBe(false);
    expect(setPreference.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});
