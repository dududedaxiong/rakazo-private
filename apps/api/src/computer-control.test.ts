import { beforeEach, describe, expect, it, vi } from "vitest";
import { pauseActiveRunForTakeover } from "./computer-control.js";
import type { RouterDeps } from "./router.js";

describe("pauseActiveRunForTakeover", () => {
  const findRun = vi.fn();
  const findAttempt = vi.fn();
  const pauseRunForTakeover = vi.fn();
  const deps = {
    prisma: { run: { findUnique: findRun }, attempt: { findFirst: findAttempt } },
    events: { pauseRunForTakeover },
  } as unknown as RouterDeps;
  const input = {
    spaceId: "space-1",
    botId: "bot-1",
    computerId: "computer-1",
    runId: "run-1",
  };
  const runningRun = {
    status: "running",
    threadId: "thread-1",
    leaseOwner: "worker-1",
    leaseFence: 1,
  };

  beforeEach(() => {
    findRun.mockReset();
    findAttempt.mockReset();
    pauseRunForTakeover.mockReset();
    findRun.mockResolvedValue(runningRun);
    findAttempt.mockResolvedValue({ id: "attempt-1", fence: 1 });
    pauseRunForTakeover.mockResolvedValue(true);
  });

  it("pauses a running run through the existing takeover pause", async () => {
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("paused");
    expect(pauseRunForTakeover).toHaveBeenCalledWith({
      spaceId: "space-1",
      threadId: "thread-1",
      botId: "bot-1",
      runId: "run-1",
      attemptId: "attempt-1",
      leaseOwner: "worker-1",
      leaseFence: 1,
      reason: "The user took over the computer.",
      computerId: "computer-1",
    });
  });

  it("grants as idle when the run is gone or finished", async () => {
    findRun.mockResolvedValueOnce(null);
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("idle");
    expect(pauseRunForTakeover).not.toHaveBeenCalled();

    findRun.mockResolvedValueOnce({ ...runningRun, status: "completed" });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("idle");
    expect(pauseRunForTakeover).not.toHaveBeenCalled();
  });

  it("binds the wait instead of pausing when the run already waits for takeover", async () => {
    findRun.mockResolvedValueOnce({ ...runningRun, status: "waiting_takeover" });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("waiting");
    expect(pauseRunForTakeover).not.toHaveBeenCalled();
  });

  it("refuses when the run is still active but not pausable yet", async () => {
    findRun.mockResolvedValueOnce({ ...runningRun, status: "leased" });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("changed");
    expect(pauseRunForTakeover).not.toHaveBeenCalled();

    findRun.mockResolvedValueOnce({ ...runningRun, leaseOwner: null });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("changed");

    findAttempt.mockResolvedValueOnce(null);
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("changed");

    findAttempt.mockResolvedValueOnce({ id: "attempt-2", fence: 2 });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("changed");
  });

  it("re-reads the run when the pause reports it is no longer pausable", async () => {
    pauseRunForTakeover.mockResolvedValueOnce(false);
    findRun.mockResolvedValueOnce(runningRun).mockResolvedValueOnce(runningRun);
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("changed");

    pauseRunForTakeover.mockResolvedValueOnce(false);
    findRun.mockResolvedValueOnce(runningRun).mockResolvedValueOnce({ status: "completed" });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("idle");

    pauseRunForTakeover.mockResolvedValueOnce(false);
    findRun.mockResolvedValueOnce(runningRun).mockResolvedValueOnce({ status: "waiting_takeover" });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("waiting");
  });

  it("grants as idle when the run was already released while pausing", async () => {
    pauseRunForTakeover.mockResolvedValueOnce({ continuationRunId: "run-1" });
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("idle");
  });

  it("treats a missing attempt at pause time like a failed pause", async () => {
    pauseRunForTakeover.mockRejectedValueOnce(
      new Error("Active run attempt was not available to pause"),
    );
    findRun.mockResolvedValueOnce(runningRun).mockResolvedValueOnce(runningRun);
    await expect(pauseActiveRunForTakeover(deps, input)).resolves.toBe("changed");
  });

  it("rethrows any other pause failure", async () => {
    pauseRunForTakeover.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(pauseActiveRunForTakeover(deps, input)).rejects.toThrow("database unavailable");
  });
});
