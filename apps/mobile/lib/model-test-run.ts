import type { ModelHealthReport } from "@rakazo/contracts";
import type { ChatModelChoice } from "@rakazo/core";
import { credentialForModel, modelOptionKey } from "@rakazo/core";
import * as SecureStore from "expo-secure-store";
import { rpc } from "./api";
import type { MobileModelCredential } from "./mobile-types";
import type { ModelTestResult } from "./model-test-result";

/** One model on one connection, ready to test. */
export type ModelTestItem = {
  /** "provider::modelId", the same key the picker rows use. */
  key: string;
  provider: string;
  modelId: string;
  label: string;
  credentialId: string;
};

export type { ModelTestResult };

export type ModelTestRunStatus = "idle" | "running" | "done" | "interrupted";

export type ModelTestRunSnapshot = {
  status: ModelTestRunStatus;
  /** Local day the results belong to; a new day makes them stale. */
  date: string;
  /** Models in the run, including ones that already answered. */
  total: number;
  /** Models with a same-day result. */
  done: number;
  /** The model a probe is on right now, for "正在测试 …". */
  currentKey: string | null;
  currentLabel: string | null;
  results: ReadonlyMap<string, ModelTestResult>;
  /** Keys a single-model retest is running for right now. */
  testingKeys: ReadonlySet<string>;
  /** Items without a result when the run stopped. */
  queuedKeys: readonly string[];
  interruptedAt: number | null;
};

/** Four provider probes run at once, the same as the server-side per-model pool. */
export const MODEL_TEST_RUN_CONCURRENCY = 4;
/** One provider test may run up to 50 models at 60s each across 4 workers. */
export const MODEL_TEST_RUN_TIMEOUT_MS = 900_000;
/** The server caps one probe at 50 models; the run queues no more per connection. */
export const MODEL_TEST_MAX_MODELS_PER_CONNECTION = 50;

const MODEL_TEST_RUN_STORAGE_KEY = "rakazo.model-test-run";
const PERSISTED_VERSION = 1;

export type ModelTestRunDeps = {
  /** Probes a connection; with a modelId only that model is probed. */
  testProvider: (
    credentialId: string,
    signal: AbortSignal,
    modelId?: string,
  ) => Promise<ModelHealthReport>;
  storage: {
    getItemAsync: (key: string) => Promise<string | null>;
    setItemAsync: (key: string, value: string) => Promise<void>;
  };
  now?: () => number;
};

function localDateString(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function groupByCredential(
  items: readonly ModelTestItem[],
): Array<{ credentialId: string; items: ModelTestItem[] }> {
  const groups: Array<{ credentialId: string; items: ModelTestItem[] }> = [];
  for (const item of items) {
    const group = groups.find((entry) => entry.credentialId === item.credentialId);
    if (group) group.items.push(item);
    else groups.push({ credentialId: item.credentialId, items: [item] });
  }
  return groups;
}

/**
 * The connection a picker row belongs to: same provider and same connection
 * label, preferring the connection whose saved list holds the model. The
 * per-model credential helper cannot see catalog models that are neither
 * the connection's default nor in a saved list, yet the probe covers them.
 */
function credentialForChoice(
  credentials: readonly MobileModelCredential[],
  choice: ChatModelChoice,
): MobileModelCredential | undefined {
  if (!choice.provider || !choice.providerLabel || !choice.modelId) return undefined;
  const candidates = credentials.filter(
    (item) => item.provider === choice.provider && item.label === choice.providerLabel,
  );
  return (
    candidates.find((item) => item.enabledModelIds?.includes(choice.modelId as string)) ??
    candidates.find((item) => item.modelId === choice.modelId) ??
    candidates[0]
  );
}

/**
 * The picker rows a run can test: one item per model, on the connection that
 * runs it. Only connections the probe can test count — a managed catalog
 * connection rejects every probe, so its models never enter the total.
 * The space default's own model is included when no row lists it.
 */
export function buildModelTestItems(
  choices: readonly ChatModelChoice[],
  credentials: readonly MobileModelCredential[],
  me: { defaultProvider?: string | null; defaultModel?: string | null } | null,
): ModelTestItem[] {
  const items: ModelTestItem[] = [];
  const seen = new Set<string>();
  const perCredential = new Map<string, number>();
  const add = (
    provider: string,
    modelId: string,
    label: string,
    credential: MobileModelCredential | undefined,
  ) => {
    if (!credential) return;
    if (credential.authKind !== undefined && credential.authKind !== "openai_compatible") return;
    const count = perCredential.get(credential.id) ?? 0;
    if (count >= MODEL_TEST_MAX_MODELS_PER_CONNECTION) return;
    const key = modelOptionKey(provider, modelId);
    if (seen.has(key)) return;
    seen.add(key);
    perCredential.set(credential.id, count + 1);
    items.push({ key, provider, modelId, label, credentialId: credential.id });
  };
  for (const choice of choices) {
    if (choice.provider && choice.modelId) {
      add(
        choice.provider,
        choice.modelId,
        choice.modelId,
        credentialForChoice(credentials, choice),
      );
    }
  }
  if (me?.defaultProvider && me?.defaultModel) {
    add(
      me.defaultProvider,
      me.defaultModel,
      me.defaultModel,
      credentialForModel(credentials, me.defaultProvider, me.defaultModel),
    );
  }
  return items;
}

/** The one item a row's menu retests, or null when the row cannot be tested. */
export function testItemForChoice(
  choice: ChatModelChoice,
  credentials: readonly MobileModelCredential[],
  me: { defaultProvider?: string | null; defaultModel?: string | null } | null,
): ModelTestItem | null {
  if (choice.provider && choice.modelId) {
    const credential = credentialForChoice(credentials, choice);
    if (!credential) return null;
    if (credential.authKind !== undefined && credential.authKind !== "openai_compatible") {
      return null;
    }
    return {
      key: modelOptionKey(choice.provider, choice.modelId),
      provider: choice.provider,
      modelId: choice.modelId,
      label: choice.modelId,
      credentialId: credential.id,
    };
  }
  // The space default has no provider of its own: the default model's credential runs it.
  const provider = me?.defaultProvider ?? null;
  const modelId = me?.defaultModel ?? null;
  if (!provider || !modelId) return null;
  const credential = credentialForModel(credentials, provider, modelId);
  if (!credential) return null;
  if (credential.authKind !== undefined && credential.authKind !== "openai_compatible") {
    return null;
  }
  return {
    key: modelOptionKey(provider, modelId),
    provider,
    modelId,
    label: modelId,
    credentialId: credential.id,
  };
}

/** The store's result key for a row; "" when the row has no model behind it. */
export function modelKeyForChoice(
  choice: ChatModelChoice,
  me: { defaultProvider?: string | null; defaultModel?: string | null } | null,
): string {
  const provider = choice.provider ?? me?.defaultProvider ?? null;
  const modelId = choice.modelId ?? me?.defaultModel ?? null;
  if (!provider || !modelId) return "";
  return modelOptionKey(provider, modelId);
}

type PersistedRun = {
  version: number;
  date: string;
  status: ModelTestRunStatus;
  total: number;
  results: ModelTestResult[];
  queuedKeys: string[];
  interruptedAt: number | null;
  savedAt: number;
  items: ModelTestItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePersistedRun(value: unknown): PersistedRun | null {
  if (!isRecord(value) || value.version !== PERSISTED_VERSION) return null;
  if (typeof value.date !== "string" || typeof value.total !== "number") return null;
  if (!Array.isArray(value.results) || !Array.isArray(value.queuedKeys)) return null;
  if (!Array.isArray(value.items) || typeof value.savedAt !== "number") return null;
  const status = value.status;
  if (status !== "done" && status !== "interrupted" && status !== "running") return null;
  const results: ModelTestResult[] = [];
  for (const row of value.results) {
    if (!isRecord(row) || typeof row.key !== "string" || typeof row.modelId !== "string") {
      return null;
    }
    if (
      typeof row.provider !== "string" ||
      typeof row.state !== "string" ||
      typeof row.detail !== "string" ||
      typeof row.seconds !== "number" ||
      typeof row.testedAt !== "number"
    ) {
      return null;
    }
    results.push({
      key: row.key,
      provider: row.provider,
      modelId: row.modelId,
      state: row.state as ModelTestResult["state"],
      detail: row.detail,
      seconds: row.seconds,
      testedAt: row.testedAt,
    });
  }
  const items: ModelTestItem[] = [];
  for (const row of value.items) {
    if (
      !isRecord(row) ||
      typeof row.key !== "string" ||
      typeof row.provider !== "string" ||
      typeof row.modelId !== "string" ||
      typeof row.label !== "string" ||
      typeof row.credentialId !== "string"
    ) {
      return null;
    }
    items.push({
      key: row.key,
      provider: row.provider,
      modelId: row.modelId,
      label: row.label,
      credentialId: row.credentialId,
    });
  }
  return {
    version: PERSISTED_VERSION,
    date: value.date,
    status,
    total: value.total,
    results,
    queuedKeys: value.queuedKeys.filter((key): key is string => typeof key === "string"),
    interruptedAt: typeof value.interruptedAt === "number" ? value.interruptedAt : null,
    savedAt: value.savedAt,
    items,
  };
}

export type ModelTestRunStore = ReturnType<typeof createModelTestRunStore>;

/**
 * The background test run: module-level so closing the picker never stops it.
 * One run at a time, four provider probes in parallel, results kept for the
 * local day. A probe that rejects (an untestable connection) leaves its
 * models without results and the run still finishes; only an abort — or the
 * app dying mid-run — leaves a run interrupted with models left to resume.
 */
export function createModelTestRunStore(deps: ModelTestRunDeps) {
  const now = deps.now ?? (() => Date.now());
  const initialSnapshot = (): ModelTestRunSnapshot => ({
    status: "idle",
    date: localDateString(now()),
    total: 0,
    done: 0,
    currentKey: null,
    currentLabel: null,
    results: new Map(),
    testingKeys: new Set(),
    queuedKeys: [],
    interruptedAt: null,
  });

  let snapshot = initialSnapshot();
  const listeners = new Set<() => void>();
  let hydrated = false;
  let hydrating = false;
  let runGeneration = 0;
  let itemsByKey = new Map<string, ModelTestItem>();
  let failedKeys = new Set<string>();
  let credentialGroups: Array<{ credentialId: string; items: ModelTestItem[] }> = [];
  const inFlight = new Set<string>();
  const abortControllers = new Set<AbortController>();

  function countDone(results: ReadonlyMap<string, ModelTestResult>): number {
    let done = 0;
    for (const key of itemsByKey.keys()) if (results.has(key)) done += 1;
    return done;
  }

  function persistSnapshot(): void {
    const persisted: PersistedRun = {
      version: PERSISTED_VERSION,
      date: snapshot.date,
      status: snapshot.status,
      total: snapshot.total,
      results: [...snapshot.results.values()],
      queuedKeys: [...snapshot.queuedKeys],
      interruptedAt: snapshot.interruptedAt,
      savedAt: now(),
      items: [...itemsByKey.values()],
    };
    void Promise.resolve(
      deps.storage.setItemAsync(MODEL_TEST_RUN_STORAGE_KEY, JSON.stringify(persisted)),
    ).catch(() => undefined);
  }

  function setSnapshot(next: ModelTestRunSnapshot): void {
    snapshot = next;
    for (const listener of [...listeners]) listener();
    persistSnapshot();
  }

  async function hydrate(): Promise<void> {
    if (hydrated || hydrating) return;
    hydrating = true;
    try {
      const raw = await deps.storage.getItemAsync(MODEL_TEST_RUN_STORAGE_KEY);
      if (!raw) return;
      const restored = parsePersistedRun(JSON.parse(raw) as unknown);
      if (!restored || restored.date !== localDateString(now())) return;
      itemsByKey = new Map(restored.items.map((item) => [item.key, item]));
      const status = restored.status === "running" ? "interrupted" : restored.status;
      const resultKeys = new Set(restored.results.map((result) => result.key));
      setSnapshot({
        status,
        date: restored.date,
        total: restored.total,
        done: restored.items.filter((item) => resultKeys.has(item.key)).length,
        currentKey: null,
        currentLabel: null,
        results: new Map(restored.results.map((result) => [result.key, result])),
        testingKeys: new Set(),
        queuedKeys:
          status === "interrupted"
            ? restored.items.filter((item) => !resultKeys.has(item.key)).map((item) => item.key)
            : [],
        interruptedAt: restored.interruptedAt ?? restored.savedAt,
      });
    } catch {
      return;
    } finally {
      hydrated = true;
      hydrating = false;
    }
  }

  function refreshCurrent(): void {
    for (const group of credentialGroups) {
      if (!inFlight.has(group.credentialId)) continue;
      const next = group.items.find((item) => !snapshot.results.has(item.key));
      if (next) {
        if (snapshot.currentKey !== next.key) {
          setSnapshot({ ...snapshot, currentKey: next.key, currentLabel: next.label });
        }
        return;
      }
    }
  }

  async function probeCredential(
    group: { credentialId: string; items: ModelTestItem[] },
    generation: number,
  ): Promise<void> {
    const controller = new AbortController();
    abortControllers.add(controller);
    inFlight.add(group.credentialId);
    refreshCurrent();
    try {
      const report = await deps.testProvider(group.credentialId, controller.signal);
      if (generation !== runGeneration) return;
      const byModel = new Map(report.results.map((row) => [row.model, row]));
      const results = new Map(snapshot.results);
      let changed = false;
      for (const item of group.items) {
        const row = byModel.get(item.modelId);
        if (!row) continue;
        results.set(item.key, {
          key: item.key,
          provider: item.provider,
          modelId: item.modelId,
          state: row.state,
          detail: row.detail,
          seconds: row.seconds,
          testedAt: now(),
        });
        changed = true;
      }
      if (changed) {
        setSnapshot({ ...snapshot, results, done: countDone(results) });
      }
    } catch {
      if (generation !== runGeneration) return;
      for (const item of group.items) failedKeys.add(item.key);
    } finally {
      abortControllers.delete(controller);
      inFlight.delete(group.credentialId);
      if (generation === runGeneration && snapshot.status === "running") refreshCurrent();
    }
  }

  async function runWorkers(
    groups: Array<{ credentialId: string; items: ModelTestItem[] }>,
    generation: number,
  ): Promise<void> {
    credentialGroups = groups;
    const queue = [...groups];
    const workers = Array.from(
      { length: Math.min(MODEL_TEST_RUN_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          if (generation !== runGeneration) return;
          const group = queue.shift();
          if (!group) return;
          await probeCredential(group, generation);
        }
      },
    );
    await Promise.all(workers);
    if (generation !== runGeneration) return;
    if (snapshot.status === "running") {
      setSnapshot({
        ...snapshot,
        status: "done",
        currentKey: null,
        currentLabel: null,
        queuedKeys: [],
      });
    }
  }

  function start(items: ModelTestItem[], opts?: { resume?: boolean }): boolean {
    if (snapshot.status === "running") return false;
    const today = localDateString(now());
    const sameDay = snapshot.date === today;
    const keptResults =
      opts?.resume && sameDay ? snapshot.results : new Map<string, ModelTestResult>();
    itemsByKey = new Map(items.map((item) => [item.key, item]));
    failedKeys = new Set();
    const queued = items.filter((item) => !keptResults.has(item.key));
    runGeneration += 1;
    const generation = runGeneration;
    setSnapshot({
      status: queued.length === 0 ? "done" : "running",
      date: today,
      total: items.length,
      done: items.filter((item) => keptResults.has(item.key)).length,
      currentKey: null,
      currentLabel: null,
      results: keptResults,
      testingKeys: new Set(),
      queuedKeys: queued.map((item) => item.key),
      interruptedAt: null,
    });
    if (queued.length === 0) return true;
    void runWorkers(groupByCredential(queued), generation);
    return true;
  }

  function abort(): void {
    if (snapshot.status !== "running") return;
    runGeneration += 1;
    for (const controller of abortControllers) controller.abort();
    abortControllers.clear();
    inFlight.clear();
    const remaining = [...itemsByKey.values()]
      .filter((item) => !snapshot.results.has(item.key) && !failedKeys.has(item.key))
      .map((item) => item.key);
    setSnapshot({
      ...snapshot,
      status: snapshot.done === snapshot.total ? "done" : "interrupted",
      currentKey: null,
      currentLabel: null,
      queuedKeys: remaining,
      interruptedAt: now(),
    });
  }

  async function retestOne(item: ModelTestItem): Promise<boolean> {
    if (snapshot.status === "running" || snapshot.testingKeys.has(item.key)) return false;
    const controller = new AbortController();
    setSnapshot({ ...snapshot, testingKeys: new Set([...snapshot.testingKeys, item.key]) });
    try {
      const report = await deps.testProvider(item.credentialId, controller.signal, item.modelId);
      const current = getSnapshot();
      if (current.status === "running" || !current.testingKeys.has(item.key)) return false;
      const row = report.results.find((entry) => entry.model === item.modelId);
      const testingKeys = new Set(current.testingKeys);
      testingKeys.delete(item.key);
      if (!row) {
        setSnapshot({ ...current, testingKeys });
        return true;
      }
      const results = new Map(current.results);
      results.set(item.key, {
        key: item.key,
        provider: item.provider,
        modelId: item.modelId,
        state: row.state,
        detail: row.detail,
        seconds: row.seconds,
        testedAt: now(),
      });
      if (!itemsByKey.has(item.key)) itemsByKey.set(item.key, item);
      setSnapshot({
        ...current,
        results,
        total: itemsByKey.size,
        done: countDone(results),
        testingKeys,
      });
      return true;
    } catch {
      const current = getSnapshot();
      if (current.status !== "running" && current.testingKeys.has(item.key)) {
        const testingKeys = new Set(current.testingKeys);
        testingKeys.delete(item.key);
        setSnapshot({ ...current, testingKeys });
      }
      return false;
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!hydrated) void hydrate();
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): ModelTestRunSnapshot {
    return snapshot;
  }

  /** Tests only: drops the run back to idle so one test cannot leak into the next. */
  function reset(): void {
    runGeneration += 1;
    for (const controller of abortControllers) controller.abort();
    abortControllers.clear();
    inFlight.clear();
    itemsByKey = new Map();
    failedKeys = new Set();
    credentialGroups = [];
    hydrated = true;
    snapshot = initialSnapshot();
  }

  return { subscribe, getSnapshot, start, abort, retestOne, reset };
}

let singleton: ModelTestRunStore | null = null;

/** The shared run the picker sheet drives; created once with the live RPC and storage. */
export function getModelTestRunStore(): ModelTestRunStore {
  singleton ??= createModelTestRunStore({
    testProvider: (credentialId, signal, modelId) =>
      rpc("models/testProvider", modelId ? { credentialId, modelId } : { credentialId }, {
        timeoutMs: MODEL_TEST_RUN_TIMEOUT_MS,
        signal,
      }),
    storage: SecureStore,
  });
  return singleton;
}

/** Tests only: resets the shared run so one test cannot leak into the next. */
export function resetModelTestRunStore(): void {
  singleton?.reset();
}
