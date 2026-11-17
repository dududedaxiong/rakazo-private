import type { ModelHealthReport, ModelHealthState } from "@rakazo_mickvvw/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ModelTestItem } from "./model-test-run";
import { createModelTestRunStore } from "./model-test-run";

vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function reportFor(
  rows: Array<{ model: string; state: ModelHealthState; seconds: number; detail?: string }>,
): ModelHealthReport {
  const summary = {
    ok: 0,
    empty: 0,
    limited: 0,
    auth: 0,
    notfound: 0,
    badreq: 0,
    servererr: 0,
    timeout: 0,
    neterr: 0,
  };
  for (const row of rows) summary[row.state] += 1;
  return {
    label: "OpenRouter",
    provider: "openrouter",
    total: rows.length,
    truncated: false,
    ok: rows.filter((row) => row.state === "ok").map((row) => row.model),
    results: rows.map((row) => ({ ...row, detail: row.detail ?? "2" })),
    summary,
  };
}

type DeferredReport = {
  promise: Promise<ModelHealthReport>;
  resolve: (report: ModelHealthReport) => void;
  reject: (error: unknown) => void;
  settled: boolean;
};

function deferredReport(): DeferredReport {
  const deferred = {} as DeferredReport;
  deferred.settled = false;
  deferred.promise = new Promise<ModelHealthReport>((resolve, reject) => {
    deferred.resolve = (report) => {
      deferred.settled = true;
      resolve(report);
    };
    deferred.reject = (error) => {
      deferred.settled = true;
      reject(error);
    };
  });
  return deferred;
}

function itemsFor(credentialId: string, models: string[]): ModelTestItem[] {
  return models.map((modelId) => ({
    key: `openrouter::${modelId}`,
    provider: "openrouter",
    modelId,
    label: modelId,
    credentialId,
  }));
}

function harness(nowMs: number) {
  const map = new Map<string, string>();
  const storage = {
    getItemAsync: async (key: string) => map.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
  const calls: Array<{ credentialId: string; modelId?: string }> = [];
  const pending = new Map<string, DeferredReport>();
  let active = 0;
  let maxActive = 0;
  const testProvider = async (credentialId: string, _signal: AbortSignal, modelId?: string) => {
    calls.push({ credentialId, modelId });
    active += 1;
    maxActive = Math.max(maxActive, active);
    const deferred = deferredReport();
    pending.set(credentialId, deferred);
    try {
      return await deferred.promise;
    } finally {
      active -= 1;
    }
  };
  const store = createModelTestRunStore({ testProvider, storage, now: () => nowMs });
  const resolveCredential = (credentialId: string, models: string[]) => {
    pending
      .get(credentialId)
      ?.resolve(reportFor(models.map((model) => ({ model, state: "ok" as const, seconds: 0.8 }))));
  };
  const resolveAll = async (byCredential: Map<string, string[]>) => {
    for (let round = 0; round < 10; round++) {
      const open = [...pending].filter(([, deferred]) => !deferred.settled);
      if (open.length === 0) return;
      for (const [credentialId] of open) {
        resolveCredential(credentialId, byCredential.get(credentialId) ?? []);
      }
      await flush();
      await flush();
      if (store.getSnapshot().status !== "running") return;
    }
  };
  return {
    store,
    storage,
    testProvider,
    calls,
    pending,
    resolveCredential,
    resolveAll,
    get maxActive() {
      return maxActive;
    },
  };
}

const DAY = new Date("2026-11-12T07:46:00").getTime();

describe("model test run store", () => {
  it("tests four providers at once and records every model's result", async () => {
    const h = harness(DAY);
    const byCredential = new Map([
      ["cred-1", ["m1", "m2"]],
      ["cred-2", ["m3"]],
      ["cred-3", ["m4"]],
      ["cred-4", ["m5"]],
      ["cred-5", ["m6"]],
      ["cred-6", ["m7"]],
    ]);
    const items = [...byCredential].flatMap(([credentialId, models]) =>
      itemsFor(credentialId, models),
    );
    expect(h.store.start(items)).toBe(true);
    expect(h.calls).toHaveLength(4);
    expect(h.maxActive).toBe(4);
    await h.resolveAll(byCredential);
    const snapshot = h.store.getSnapshot();
    expect(snapshot.status).toBe("done");
    expect(snapshot.done).toBe(7);
    expect(snapshot.total).toBe(7);
    expect(h.calls).toHaveLength(6);
    expect(snapshot.results.get("openrouter::m1")?.state).toBe("ok");
  });

  it("aborts keep finished results and stops starting new probes", async () => {
    const h = harness(DAY);
    const items = [
      ...itemsFor("cred-1", ["m1", "m2"]),
      ...itemsFor("cred-2", ["m3"]),
      ...itemsFor("cred-3", ["m4"]),
    ];
    h.store.start(items);
    expect(h.calls).toHaveLength(3);
    h.pending.get("cred-1")?.resolve(
      reportFor([
        { model: "m1", state: "ok", seconds: 0.8 },
        { model: "m2", state: "timeout", seconds: 60 },
      ]),
    );
    await flush();
    await flush();
    expect(h.store.getSnapshot().done).toBe(2);
    h.store.abort();
    const snapshot = h.store.getSnapshot();
    expect(snapshot.status).toBe("interrupted");
    expect(snapshot.done).toBe(2);
    expect(snapshot.queuedKeys).toEqual(["openrouter::m3", "openrouter::m4"]);
    expect(snapshot.interruptedAt).toBe(DAY);
    // Late probes land after the abort and are discarded.
    h.pending.get("cred-2")?.resolve(reportFor([{ model: "m3", state: "ok", seconds: 1 }]));
    h.pending.get("cred-3")?.resolve(reportFor([{ model: "m4", state: "ok", seconds: 1 }]));
    await flush();
    await flush();
    expect(h.store.getSnapshot().done).toBe(2);
    expect(h.calls).toHaveLength(3);
  });

  it("resumes only the remaining models after an abort", async () => {
    const h = harness(DAY);
    const items = [
      ...itemsFor("cred-1", ["m1", "m2"]),
      ...itemsFor("cred-2", ["m3"]),
      ...itemsFor("cred-3", ["m4"]),
    ];
    h.store.start(items);
    h.pending.get("cred-1")?.resolve(reportFor([{ model: "m1", state: "ok", seconds: 0.8 }]));
    await flush();
    await flush();
    h.store.abort();
    expect(h.store.getSnapshot().done).toBe(1);
    expect(h.store.start(items, { resume: true })).toBe(true);
    // m2 never answered, so its connection is probed again too.
    expect(h.calls).toHaveLength(6);
    await h.resolveAll(
      new Map([
        ["cred-1", ["m2"]],
        ["cred-2", ["m3"]],
        ["cred-3", ["m4"]],
      ]),
    );
    const snapshot = h.store.getSnapshot();
    expect(snapshot.status).toBe("done");
    expect(snapshot.done).toBe(4);
    expect(snapshot.results.get("openrouter::m1")?.seconds).toBe(0.8);
  });

  it("retesting all clears same-day results", async () => {
    const h = harness(DAY);
    const items = itemsFor("cred-1", ["m1", "m2"]);
    h.store.start(items);
    await h.resolveAll(new Map([["cred-1", ["m1", "m2"]]]));
    expect(h.store.getSnapshot().status).toBe("done");
    h.store.start(items);
    expect(h.store.getSnapshot().done).toBe(0);
    expect(h.store.getSnapshot().status).toBe("running");
    await h.resolveAll(new Map([["cred-1", ["m1", "m2"]]]));
    expect(h.store.getSnapshot().done).toBe(2);
  });

  it("a rejected probe leaves its models untested and the run still finishes", async () => {
    const h = harness(DAY);
    const items = [...itemsFor("cred-1", ["m1"]), ...itemsFor("cred-2", ["m2"])];
    h.store.start(items);
    h.pending.get("cred-1")?.resolve(reportFor([{ model: "m1", state: "ok", seconds: 1 }]));
    h.pending.get("cred-2")?.reject(new Error("offline"));
    await flush();
    await flush();
    const snapshot = h.store.getSnapshot();
    expect(snapshot.status).toBe("done");
    expect(snapshot.done).toBe(1);
    expect(snapshot.results.has("openrouter::m2")).toBe(false);
  });

  it("retests one model without touching the others", async () => {
    const h = harness(DAY);
    const items = itemsFor("cred-1", ["m1", "m2"]);
    h.store.start(items);
    h.pending.get("cred-1")?.resolve(
      reportFor([
        { model: "m1", state: "ok", seconds: 0.8 },
        { model: "m2", state: "timeout", seconds: 60 },
      ]),
    );
    await flush();
    await flush();
    expect(h.store.getSnapshot().status).toBe("done");
    const target = items[1]!;
    const done = h.store.retestOne(target);
    expect(h.store.getSnapshot().testingKeys.has(target.key)).toBe(true);
    // The retest probes only that model, not the whole connection.
    expect(h.calls.at(-1)).toEqual({ credentialId: "cred-1", modelId: "m2" });
    expect(h.calls[0]).toEqual({ credentialId: "cred-1", modelId: undefined });
    h.pending.get("cred-1")?.resolve(reportFor([{ model: "m2", state: "ok", seconds: 1.5 }]));
    await expect(done).resolves.toBe(true);
    await flush();
    const snapshot = h.store.getSnapshot();
    expect(snapshot.results.get(target.key)?.state).toBe("ok");
    expect(snapshot.results.get(target.key)?.seconds).toBe(1.5);
    expect(snapshot.results.get(items[0]!.key)?.seconds).toBe(0.8);
    expect(snapshot.testingKeys.size).toBe(0);
  });

  it("does not retest one model while a run is running", async () => {
    const h = harness(DAY);
    const items = itemsFor("cred-1", ["m1"]);
    h.store.start(items);
    await expect(h.store.retestOne(items[0]!)).resolves.toBe(false);
  });

  it("drops yesterday's results on load", async () => {
    const storage = {
      map: new Map<string, string>(),
      getItemAsync: async (key: string) => storage.map.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        storage.map.set(key, value);
      },
    };
    const ok = async () => reportFor([{ model: "m1", state: "ok" as const, seconds: 0.8 }]);
    const first = createModelTestRunStore({ testProvider: ok, storage, now: () => DAY });
    first.start(itemsFor("cred-1", ["m1"]));
    await flush();
    await flush();
    expect(first.getSnapshot().status).toBe("done");
    expect(storage.map.size).toBe(1);
    const second = createModelTestRunStore({
      testProvider: ok,
      storage,
      now: () => DAY + 24 * 60 * 60 * 1000,
    });
    second.subscribe(() => undefined);
    await flush();
    await flush();
    expect(second.getSnapshot().status).toBe("idle");
    expect(second.getSnapshot().results.size).toBe(0);
  });

  it("restores an interrupted run from the same day", async () => {
    const h = harness(DAY);
    const items = [...itemsFor("cred-1", ["m1"]), ...itemsFor("cred-2", ["m2"])];
    h.store.start(items);
    h.pending.get("cred-1")?.resolve(reportFor([{ model: "m1", state: "ok", seconds: 1 }]));
    await flush();
    await flush();
    h.store.abort();
    expect(h.store.getSnapshot().status).toBe("interrupted");
    const second = createModelTestRunStore({
      testProvider: h.testProvider,
      storage: h.storage,
      now: () => DAY,
    });
    second.subscribe(() => undefined);
    await flush();
    await flush();
    const snapshot = second.getSnapshot();
    expect(snapshot.status).toBe("interrupted");
    expect(snapshot.done).toBe(1);
    expect(snapshot.queuedKeys).toEqual(["openrouter::m2"]);
    expect(snapshot.results.get("openrouter::m1")?.state).toBe("ok");
  });

  it("restores a killed run as interrupted", async () => {
    const h = harness(DAY);
    const items = [...itemsFor("cred-1", ["m1"]), ...itemsFor("cred-2", ["m2"])];
    h.store.start(items);
    h.pending.get("cred-1")?.resolve(reportFor([{ model: "m1", state: "ok", seconds: 1 }]));
    await flush();
    await flush();
    // The run is still going (cred-2 never answered) when the app dies.
    const second = createModelTestRunStore({
      testProvider: h.testProvider,
      storage: h.storage,
      now: () => DAY,
    });
    second.subscribe(() => undefined);
    await flush();
    await flush();
    const snapshot = second.getSnapshot();
    expect(snapshot.status).toBe("interrupted");
    expect(snapshot.done).toBe(1);
    expect(snapshot.queuedKeys).toEqual(["openrouter::m2"]);
  });
});

describe("buildModelTestItems", () => {
  it("skips connections the probe cannot test and deduplicates models", async () => {
    const { buildModelTestItems } = await import("./model-test-run");
    const thirdParty = {
      id: "cred-gb",
      provider: "openai-compatible",
      label: "gb大佬",
      modelId: "krisphyn-Kimi-K2.6",
      enabledModelIds: ["krisphyn-Kimi-K2.6", "krisphyn-DeepSeek-4.1"],
      authKind: "openai_compatible",
      hasKey: true,
      isDefault: false,
    };
    const catalog = {
      id: "cred-or",
      provider: "openrouter",
      label: "OpenRouter",
      modelId: "vendor/model-1",
      authKind: "api_key",
      hasKey: true,
      isDefault: true,
    };
    const choices = [
      {
        key: "openai-compatible::krisphyn-Kimi-K2.6",
        provider: "openai-compatible",
        modelId: "krisphyn-Kimi-K2.6",
        providerLabel: "gb大佬",
        label: "krisphyn-Kimi-K2.6",
      },
      {
        key: "openai-compatible::krisphyn-Kimi-K2.6",
        provider: "openai-compatible",
        modelId: "krisphyn-Kimi-K2.6",
        providerLabel: "gb大佬",
        label: "krisphyn-Kimi-K2.6",
      },
      {
        key: "openai-compatible::krisphyn-DeepSeek-4.1",
        provider: "openai-compatible",
        modelId: "krisphyn-DeepSeek-4.1",
        providerLabel: "gb大佬",
        label: "krisphyn-DeepSeek-4.1",
      },
      {
        key: "openrouter::vendor/model-1",
        provider: "openrouter",
        modelId: "vendor/model-1",
        providerLabel: "OpenRouter",
        label: "vendor/model-1",
      },
    ];
    const items = buildModelTestItems(choices, [thirdParty, catalog] as never, null);
    expect(items.map((item) => item.key)).toEqual([
      "openai-compatible::krisphyn-Kimi-K2.6",
      "openai-compatible::krisphyn-DeepSeek-4.1",
    ]);
    expect(items[0]?.credentialId).toBe("cred-gb");
  });

  it("caps each connection at 50 models and includes the space default's model", async () => {
    const { buildModelTestItems } = await import("./model-test-run");
    const models = Array.from({ length: 55 }, (_, index) => `model-${index + 1}`);
    const credential = {
      id: "cred-gb",
      provider: "openai-compatible",
      label: "gb大佬",
      modelId: "model-1",
      enabledModelIds: models,
      authKind: "openai_compatible",
      hasKey: true,
      isDefault: false,
    };
    const choices = models.map((modelId) => ({
      key: `openai-compatible::${modelId}`,
      provider: "openai-compatible",
      modelId,
      providerLabel: "gb大佬",
      label: modelId,
    }));
    const items = buildModelTestItems(choices, [credential] as never, {
      defaultProvider: "openai-compatible",
      defaultModel: "model-1",
    });
    expect(items).toHaveLength(50);
  });
});
