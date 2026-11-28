import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "./api";
import { cancelAttentionBots } from "./cancel-attention";

vi.mock("./api", () => ({
  rpc: vi.fn(),
}));

describe("cancelAttentionBots", () => {
  beforeEach(() => vi.mocked(rpc).mockClear());

  it("stops each waiting bot once with the thread's stop call, then refreshes", async () => {
    const order: string[] = [];
    vi.mocked(rpc).mockImplementation(async () => {
      order.push("stop");
      return undefined as never;
    });
    const refresh = vi.fn(async () => {
      order.push("refresh");
    });
    await expect(cancelAttentionBots(["bot-1", "bot-2", "bot-1"], refresh)).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "threads/stop", { botId: "bot-1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "threads/stop", { botId: "bot-2" });
    expect(refresh).toHaveBeenCalledOnce();
    expect(order).toEqual(["stop", "stop", "refresh"]);
  });

  it("still refreshes when a stop fails, and reports the bot that failed", async () => {
    vi.mocked(rpc)
      .mockRejectedValueOnce(new Error("gone"))
      .mockImplementation(async () => undefined as never);
    const refresh = vi.fn(async () => undefined);
    await expect(cancelAttentionBots(["bot-1", "bot-2"], refresh)).resolves.toEqual(["bot-1"]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does nothing for an empty pill", async () => {
    const refresh = vi.fn(async () => undefined);
    await expect(cancelAttentionBots([], refresh)).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
