import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  generation: 1,
  enabled: false,
  onTask: undefined as undefined | ((frame: unknown) => void),
  prefListeners: new Set<() => void>(),
  bridge: undefined as undefined | { injectJavaScript: (js: string) => void },
  injected: [] as string[],
  rpc: vi.fn(),
  subscribeCalls: 0,
  failSubscribeOnce: false,
}));
vi.mock("./api", () => ({ rpc: fake.rpc }));
vi.mock("./api-live", () => ({
  subscribeClientTaskEvents: async (onTask: (frame: unknown) => void, signal: AbortSignal) => {
    fake.subscribeCalls += 1;
    if (fake.failSubscribeOnce) {
      fake.failSubscribeOnce = false;
      throw new Error("stream dropped");
    }
    fake.onTask = onTask;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  },
}));
vi.mock("./computer-local-traffic", () => ({
  localTrafficEnabled: () => fake.enabled,
  subscribeLocalTraffic: (listener: () => void) => {
    fake.prefListeners.add(listener);
    return () => {
      fake.prefListeners.delete(listener);
    };
  },
}));
vi.mock("./session", () => ({
  currentSessionGeneration: () => fake.generation,
  registerSessionDiskCache: vi.fn(),
}));

import {
  CLIENT_TASK_EXTRACTION_SCRIPT,
  CLIENT_TASK_SETTLE_MS,
  CLIENT_TASK_TIMEOUT_MS,
  clientTaskWebViewError,
  clientTaskWebViewLoaded,
  clientTaskWebViewMessage,
  getClientTaskState,
  setClientTaskBridge,
  startClientTaskRunner,
  stopClientTask,
  stopClientTaskRunner,
} from "./client-task-runner";

const taskFrame = (overrides: Record<string, unknown> = {}) => ({
  type: "client.task.requested",
  taskId: "task-1",
  url: "https://example.test/page",
  kind: "fetch",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const completeCalls = () => fake.rpc.mock.calls.filter(([proc]) => proc === "clientTasks/complete");
const preferenceCalls = () =>
  fake.rpc.mock.calls.filter(([proc]) => proc === "clientTasks/setPreference");

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  fake.generation = 1;
  fake.enabled = false;
  fake.onTask = undefined;
  fake.prefListeners.clear();
  fake.injected.length = 0;
  fake.subscribeCalls = 0;
  fake.failSubscribeOnce = false;
  vi.clearAllMocks();
  fake.rpc.mockImplementation(async () => ({ ok: true }));
  fake.bridge = {
    injectJavaScript: (js: string) => {
      fake.injected.push(js);
    },
  };
  setClientTaskBridge(fake.bridge);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  stopClientTaskRunner();
  setClientTaskBridge(undefined);
  vi.useRealTimers();
});
async function start() {
  stop = startClientTaskRunner();
  await tick();
  expect(fake.onTask).toBeTypeOf("function");
}

describe("mobile client task runner", () => {
  it("syncs the preference once on start", async () => {
    await start();
    expect(preferenceCalls()).toEqual([["clientTasks/setPreference", { enabled: false }]]);
  });

  it("syncs the preference when the toggle changes", async () => {
    await start();
    fake.enabled = true;
    for (const listener of [...fake.prefListeners]) listener();
    await tick();
    expect(preferenceCalls()).toEqual([
      ["clientTasks/setPreference", { enabled: false }],
      ["clientTasks/setPreference", { enabled: true }],
    ]);
  });

  it("declines a task while the toggle is off", async () => {
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()).toEqual([
      [
        "clientTasks/complete",
        {
          taskId: "task-1",
          status: "declined",
          result: {
            url: "https://example.test/page",
            title: "",
            text: "",
            truncated: false,
            error: "disabled",
          },
        },
      ],
    ]);
  });

  it("declines an already-expired task", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()[0]?.[1]).toMatchObject({ status: "declined" });
    expect(completeCalls()[0]?.[1].result.error).toBe("expired");
  });

  it("declines a second task while one runs", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    expect(getClientTaskState().task?.taskId).toBe("task-1");
    fake.onTask?.(taskFrame({ taskId: "task-2" }));
    await tick();
    expect(getClientTaskState().task?.taskId).toBe("task-1");
    expect(completeCalls()).toHaveLength(1);
    expect(completeCalls()[0]?.[1]).toMatchObject({ taskId: "task-2", status: "declined" });
    expect(completeCalls()[0]?.[1].result.error).toBe("busy");
  });

  it("runs a task: load, settle, inject, result", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    expect(getClientTaskState().task?.taskId).toBe("task-1");
    expect(fake.injected).toHaveLength(0);
    clientTaskWebViewLoaded("task-1");
    expect(fake.injected).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(CLIENT_TASK_SETTLE_MS);
    expect(fake.injected).toEqual([CLIENT_TASK_EXTRACTION_SCRIPT]);
    expect(CLIENT_TASK_EXTRACTION_SCRIPT).toContain("ReactNativeWebView.postMessage");
    expect(CLIENT_TASK_EXTRACTION_SCRIPT).toContain("65536");
    clientTaskWebViewMessage(
      "task-1",
      JSON.stringify({
        type: "result",
        url: "https://example.test/page",
        title: "Example",
        text: "hello",
        truncated: false,
      }),
    );
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()).toEqual([
      [
        "clientTasks/complete",
        {
          taskId: "task-1",
          status: "completed",
          result: {
            url: "https://example.test/page",
            title: "Example",
            text: "hello",
            truncated: false,
          },
        },
      ],
    ]);
  });

  it("marks long extracted text truncated", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    clientTaskWebViewLoaded("task-1");
    await vi.advanceTimersByTimeAsync(CLIENT_TASK_SETTLE_MS);
    clientTaskWebViewMessage(
      "task-1",
      JSON.stringify({
        type: "result",
        url: "https://example.test/page",
        title: "Long",
        text: "x".repeat(70_000),
        truncated: true,
      }),
    );
    await tick();
    const result = completeCalls()[0]?.[1].result as { text: string; truncated: boolean };
    expect(result.text).toHaveLength(65_536);
    expect(result.truncated).toBe(true);
  });

  it("ignores bridge messages for other tasks and malformed ones", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    clientTaskWebViewMessage("task-2", JSON.stringify({ type: "result", text: "nope" }));
    clientTaskWebViewMessage("task-1", "not-json");
    clientTaskWebViewMessage("task-1", JSON.stringify({ type: "navigated" }));
    await tick();
    expect(getClientTaskState().task?.taskId).toBe("task-1");
    expect(completeCalls()).toHaveLength(0);
  });

  it("fails a task when the page errors", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    clientTaskWebViewError("task-1");
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()[0]?.[1]).toMatchObject({ status: "failed" });
    expect(completeCalls()[0]?.[1].result.error).toBe("load failed");
  });

  it("fails a task on timeout, before the server's own timeout", async () => {
    expect(CLIENT_TASK_TIMEOUT_MS).toBeLessThan(30_000);
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    await vi.advanceTimersByTimeAsync(CLIENT_TASK_TIMEOUT_MS);
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()[0]?.[1]).toMatchObject({ status: "failed" });
    expect(completeCalls()[0]?.[1].result.error).toBe("timeout");
  });

  it("stops a running task from the banner and reports declined", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    stopClientTask();
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()[0]?.[1]).toMatchObject({ status: "declined" });
    expect(completeCalls()[0]?.[1].result.error).toBe("stopped");
  });

  it("cancels a running task when the toggle turns off", async () => {
    fake.enabled = true;
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    fake.enabled = false;
    for (const listener of [...fake.prefListeners]) listener();
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()[0]?.[1]).toMatchObject({ status: "declined" });
    expect(completeCalls()[0]?.[1].result.error).toBe("disabled");
    expect(preferenceCalls()).toContainEqual(["clientTasks/setPreference", { enabled: false }]);
  });

  it("logs a failed report instead of retrying it", async () => {
    fake.enabled = true;
    fake.rpc.mockImplementation(async (proc: string) => {
      if (proc === "clientTasks/complete") throw new Error("gone");
      return { ok: true };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await start();
    fake.onTask?.(taskFrame());
    await tick();
    stopClientTask();
    await tick();
    expect(getClientTaskState().task).toBeNull();
    expect(completeCalls()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("Client task report failed", expect.any(Error));
    warn.mockRestore();
  });

  it("reconnects the stream after a dropped connection", async () => {
    fake.failSubscribeOnce = true;
    stop = startClientTaskRunner();
    await vi.advanceTimersByTimeAsync(250);
    await tick();
    expect(fake.subscribeCalls).toBe(2);
    expect(fake.onTask).toBeTypeOf("function");
  });

  it("stops following when the runner stops", async () => {
    await start();
    const onTask = fake.onTask;
    stop?.();
    stop = undefined;
    await tick();
    // A late frame on the stopped feed is ignored.
    onTask?.(taskFrame());
    await tick();
    expect(completeCalls()).toHaveLength(0);
    expect(getClientTaskState().task).toBeNull();
  });
});
