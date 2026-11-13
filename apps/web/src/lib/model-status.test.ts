import { afterEach, describe, expect, it } from "vitest";
import { modelStatusFromProbe, readModelStatus, recordModelStatus } from "./model-status";

const storage = new Map<string, string>();

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
}

afterEach(() => storage.clear());

describe("modelStatusFromProbe", () => {
  it("marks an unsupported model unavailable", () => {
    expect(modelStatusFromProbe({ supported: false, seconds: 1 })).toEqual({
      state: "unavailable",
      seconds: 1,
    });
  });

  it("marks a fast probe ok and a slow one slow", () => {
    expect(modelStatusFromProbe({ supported: true, seconds: 2 }).state).toBe("ok");
    expect(modelStatusFromProbe({ supported: true, seconds: 45 }).state).toBe("slow");
  });
});

describe("model status cache", () => {
  it("returns null for a model never probed", () => {
    expect(readModelStatus("provider::model", memoryStorage())).toBeNull();
  });

  it("round-trips a recorded status for the model key", () => {
    const store = memoryStorage();
    recordModelStatus("provider::model", { state: "slow", seconds: 45 }, store);
    const status = readModelStatus("provider::model", store);
    expect(status?.state).toBe("slow");
    expect(status?.seconds).toBe(45);
    expect(typeof status?.checkedAt).toBe("number");
    // A different model key is unaffected.
    expect(readModelStatus("provider::other", store)).toBeNull();
  });

  it("overwrites a stale status for the same key", () => {
    const store = memoryStorage();
    recordModelStatus("provider::model", { state: "unavailable", seconds: 1 }, store);
    recordModelStatus("provider::model", { state: "ok", seconds: 2 }, store);
    expect(readModelStatus("provider::model", store)?.state).toBe("ok");
  });
});
