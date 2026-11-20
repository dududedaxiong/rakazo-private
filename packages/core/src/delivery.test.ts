import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInFlightSet,
  deliveryAfterError,
  noReplyMessageIds,
  sanitizeDeliveryStates,
  SEND_HARD_TIMEOUT_MS,
  SendTimeoutError,
  withTimeout,
} from "./delivery.js";

const ACCEPTED_THEN_FAILED = "Sent, but the reply failed; check before resending.";
const INTERRUPTED_SEND = "The app closed before delivery was confirmed.";
const INTERRUPTED_REPLY = "Sent, but the reply had not arrived when the app closed.";

describe("deliveryAfterError", () => {
  it("never reports an accepted message as failed", () => {
    expect(deliveryAfterError(true, "other", "socket closed", ACCEPTED_THEN_FAILED)).toEqual({
      delivery: "no-reply",
      error: `${ACCEPTED_THEN_FAILED} (socket closed)`,
    });
    expect(deliveryAfterError(true, "timeout", "t", ACCEPTED_THEN_FAILED)).toEqual({
      delivery: "no-reply",
      error: ACCEPTED_THEN_FAILED,
    });
  });

  it("reports an unaccepted send as failed with the real error", () => {
    expect(deliveryAfterError(false, "other", "boom", ACCEPTED_THEN_FAILED)).toEqual({
      delivery: "failed",
      error: "boom",
    });
  });

  it("keeps an explicit no-reply kind even before acceptance", () => {
    expect(deliveryAfterError(false, "no-reply", "x", ACCEPTED_THEN_FAILED)).toEqual({
      delivery: "no-reply",
      error: "x",
    });
  });
});

describe("createInFlightSet", () => {
  it("lets only one delivery per id run", () => {
    const set = createInFlightSet();
    expect(set.enter("m1")).toBe(true);
    expect(set.enter("m1")).toBe(false);
    expect(set.has("m1")).toBe(true);
    set.leave("m1");
    expect(set.has("m1")).toBe(false);
    expect(set.enter("m1")).toBe(true);
  });
});

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("rejects with SendTimeoutError and reports a late result", async () => {
    let finish!: (value: number) => void;
    const slow = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const late = vi.fn();
    const raced = withTimeout(slow, 1000, late);
    const assertion = expect(raced).rejects.toBeInstanceOf(SendTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    finish(3);
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith({ ok: true, value: 3 });
  });

  it("reports a late failure for correction too", async () => {
    let fail!: (error: Error) => void;
    const slow = new Promise<number>((_resolve, reject) => {
      fail = reject;
    });
    const late = vi.fn();
    const raced = withTimeout(slow, 1000, late);
    const assertion = expect(raced).rejects.toBeInstanceOf(SendTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    const boom = new Error("boom");
    fail(boom);
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith({ ok: false, error: boom });
  });

  it("passes through rejections before the deadline", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("uses the send hard timeout bound", () => {
    expect(SEND_HARD_TIMEOUT_MS).toBe(120_000);
  });
});

describe("sanitizeDeliveryStates", () => {
  const texts = { interruptedSend: INTERRUPTED_SEND, interruptedReply: INTERRUPTED_REPLY };

  it("turns in-flight sends into failed ones and accepted ones into no-reply", () => {
    const out = sanitizeDeliveryStates(
      {
        bot: [
          { delivery: "sent" as const },
          { delivery: "sending" as const },
          { delivery: "accepted" as const },
        ],
      },
      texts,
    );
    expect(out.bot![0]).toEqual({ delivery: "sent" });
    expect(out.bot![1]).toEqual({ delivery: "failed", error: INTERRUPTED_SEND });
    expect(out.bot![2]).toEqual({ delivery: "no-reply", error: INTERRUPTED_REPLY });
  });

  it("returns the same object when nothing needs fixing", () => {
    const records = { bot: [{ delivery: "sent" as const }] };
    expect(sanitizeDeliveryStates(records, texts)).toBe(records);
  });
});

describe("noReplyMessageIds", () => {
  const user = (id: string, runId: string | null) => ({
    id,
    role: "user",
    runId,
    blocks: [{ kind: "text" as const, text: "hello" }],
  });
  const bot = (id: string, text: string) => ({
    id,
    role: "bot",
    runId: null,
    blocks: [{ kind: "text" as const, text }],
  });

  it("flags a user message whose run failed with no bot reply", () => {
    const ids = noReplyMessageIds([user("u1", "run-1")], [{ id: "run-1", status: "failed" }]);
    expect([...ids]).toEqual(["u1"]);
  });

  it("flags a cancelled run the same way, but not a completed one", () => {
    expect(
      [...noReplyMessageIds([user("u1", "run-1")], [{ id: "run-1", status: "cancelled" }])],
    ).toEqual(["u1"]);
    expect(
      [...noReplyMessageIds([user("u1", "run-1")], [{ id: "run-1", status: "completed" }])],
    ).toEqual([]);
  });

  it("clears the flag once a bot reply with text lands", () => {
    const ids = noReplyMessageIds(
      [user("u1", "run-1"), bot("b1", "here you go")],
      [{ id: "run-1", status: "failed" }],
    );
    expect([...ids]).toEqual([]);
  });

  it("ignores runs that are still working", () => {
    const ids = noReplyMessageIds([user("u1", "run-1")], [{ id: "run-1", status: "running" }]);
    expect([...ids]).toEqual([]);
  });
});
