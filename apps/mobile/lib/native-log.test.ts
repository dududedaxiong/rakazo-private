import { requireOptionalNativeModule } from "expo-modules-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNativeLog, readNativeMemory } from "./native-log";

vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: vi.fn() }));

type FakeNativeLogModule = {
  readLog: ReturnType<typeof vi.fn>;
  memoryInfo: ReturnType<typeof vi.fn>;
};

let fake: FakeNativeLogModule;

describe("native log", () => {
  beforeEach(() => {
    fake = {
      readLog: vi.fn(async () => ""),
      memoryInfo: vi.fn(async () => ({ memTotalKB: 8_000_000, memAvailableKB: 2_000_000 })),
    };
    vi.mocked(requireOptionalNativeModule).mockReturnValue(fake);
  });

  it("returns the native log lines", async () => {
    fake.readLog.mockResolvedValue("line1\nline2");
    await expect(readNativeLog()).resolves.toBe("line1\nline2");
    expect(fake.readLog).toHaveBeenCalledWith(500);
  });

  it("returns null when the log is empty", async () => {
    fake.readLog.mockResolvedValue("  \n");
    await expect(readNativeLog()).resolves.toBeNull();
  });

  it("returns null when the module is absent", async () => {
    vi.mocked(requireOptionalNativeModule).mockReturnValue(null);
    await expect(readNativeLog()).resolves.toBeNull();
    await expect(readNativeMemory()).resolves.toBeNull();
  });

  it("returns null when the log read throws", async () => {
    fake.readLog.mockRejectedValueOnce(new Error("nope"));
    await expect(readNativeLog()).resolves.toBeNull();
  });

  it("returns memory info", async () => {
    await expect(readNativeMemory()).resolves.toEqual({
      memTotalKB: 8_000_000,
      memAvailableKB: 2_000_000,
    });
  });

  it("returns null when memory info is malformed", async () => {
    fake.memoryInfo.mockResolvedValueOnce({
      memTotalKB: "x",
      memAvailableKB: 0,
    });
    await expect(readNativeMemory()).resolves.toBeNull();
  });

  it("returns null when the memory read throws", async () => {
    fake.memoryInfo.mockRejectedValueOnce(new Error("nope"));
    await expect(readNativeMemory()).resolves.toBeNull();
  });
});
