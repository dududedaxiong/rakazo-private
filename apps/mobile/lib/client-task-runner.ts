import { abortableDelay, isRetryableError, retryDelayMs } from "@rakazo_mickvvw/core";
import { rpc } from "./api";
import type { ClientTaskRequestFrame } from "./api-live";
import { subscribeClientTaskEvents } from "./api-live";
import { localTrafficEnabled, subscribeLocalTraffic } from "./computer-local-traffic";
import { currentSessionGeneration, registerSessionDiskCache } from "./session";

export type ClientTaskStatus = "completed" | "failed" | "declined";
export type ClientTaskResult = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  error?: string;
};
export type ClientTaskRequest = {
  taskId: string;
  url: string;
  kind: "fetch";
  expiresAt: string;
};
export type ClientTaskPhase = "loading" | "settling" | "extracting";
export type ClientTaskState = {
  task: ClientTaskRequest | null;
  phase: ClientTaskPhase | null;
};
/** The host component's handle for injecting the extraction snippet into the task WebView. */
export type ClientTaskBridge = {
  injectJavaScript: (js: string) => void;
};

/** Shorter than the server's 30s task timeout, so the server always falls back cleanly. */
export const CLIENT_TASK_TIMEOUT_MS = 25_000;
/** Settle delay after onLoad before extracting, so late-rendering pages have a chance. */
export const CLIENT_TASK_SETTLE_MS = 1_500;
export const MAX_CLIENT_TASK_TEXT = 65_536;

/**
 * Reads the loaded page's title and text and posts it back over the WebView bridge. Only the
 * extraction snippet ever runs in the task page — never the page's own scripts beyond loading
 * it, and never any secret.
 */
export const CLIENT_TASK_EXTRACTION_SCRIPT = `(function(){try{var text=(document.body?document.body.innerText:"")||"";window.ReactNativeWebView.postMessage(JSON.stringify({type:"result",url:location.href,title:document.title,text:text.slice(0,${MAX_CLIENT_TASK_TEXT}),truncated:text.length>${MAX_CLIENT_TASK_TEXT}}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:"error",error:String((e&&e.message)||e)}));}})();true;`;

const listeners = new Set<() => void>();
let state: ClientTaskState = { task: null, phase: null };
let feed: AbortController | undefined;
let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let bridge: ClientTaskBridge | undefined;
/** Last preference value the server confirmed receiving; null until the first sync. */
let lastSyncedEnabled: boolean | null = null;
let preferenceUnsubscribe: (() => void) | undefined;

export function subscribeClientTaskState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getClientTaskState(): ClientTaskState {
  return state;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function clearTimers() {
  clearTimeout(timeoutTimer);
  clearTimeout(settleTimer);
  timeoutTimer = undefined;
  settleTimer = undefined;
}

function emptyResult(url: string): ClientTaskResult {
  return { url, title: "", text: "", truncated: false };
}

function declinedResult(url: string, reason: string): ClientTaskResult {
  return { ...emptyResult(url), error: reason };
}

/**
 * Reports a task outcome. A failed report is logged, never retried: the server falls back on
 * its own timeout.
 */
async function reportComplete(
  taskId: string,
  status: ClientTaskStatus,
  result?: ClientTaskResult,
): Promise<void> {
  try {
    await rpc("clientTasks/complete", { taskId, status, result });
  } catch (error) {
    console.warn("Client task report failed", error);
  }
}

/** Finishes the running task, if any, and reports its outcome. */
function finishActive(status: ClientTaskStatus, result: ClientTaskResult): void {
  const task = state.task;
  if (!task) return;
  clearTimers();
  state = { task: null, phase: null };
  emit();
  void reportComplete(task.taskId, status, result);
}

async function handleTask(frame: ClientTaskRequestFrame): Promise<void> {
  const task: ClientTaskRequest = {
    taskId: frame.taskId,
    url: frame.url,
    kind: frame.kind,
    expiresAt: frame.expiresAt,
  };
  if (Date.parse(task.expiresAt) <= Date.now()) {
    await reportComplete(task.taskId, "declined", declinedResult(task.url, "expired"));
    return;
  }
  if (!localTrafficEnabled()) {
    await reportComplete(task.taskId, "declined", declinedResult(task.url, "disabled"));
    return;
  }
  if (state.task) {
    await reportComplete(task.taskId, "declined", declinedResult(task.url, "busy"));
    return;
  }
  state = { task, phase: "loading" };
  emit();
  timeoutTimer = setTimeout(
    () => finishActive("failed", { ...emptyResult(task.url), error: "timeout" }),
    CLIENT_TASK_TIMEOUT_MS,
  );
}

/** Follows the task stream; every frame is a single task, so reconnects need no replay. */
async function follow(controller: AbortController) {
  const generation = currentSessionGeneration();
  let retry = 250;
  let failure: unknown;
  while (!controller.signal.aborted && generation === currentSessionGeneration()) {
    try {
      await subscribeClientTaskEvents((frame) => {
        if (controller.signal.aborted || feed !== controller) return;
        void handleTask(frame);
      }, controller.signal);
      retry = 250;
      failure = undefined;
    } catch (error) {
      if (controller.signal.aborted || !isRetryableError(error)) return;
      failure = error;
    }
    await abortableDelay(retryDelayMs(failure, retry), controller.signal).catch(() => undefined);
    retry = Math.min(retry * 2, 5000);
  }
}

/** Sends the toggle to the server; only on change, except `force` (start) which repairs drift. */
async function syncPreference(force = false): Promise<void> {
  const enabled = localTrafficEnabled();
  if (!force && lastSyncedEnabled === enabled) return;
  try {
    await rpc("clientTasks/setPreference", { enabled });
    lastSyncedEnabled = enabled;
  } catch {
    // Best-effort: the next change or restart retries. The local toggle still gates tasks.
  }
}

function onPreferenceChanged(): void {
  if (!localTrafficEnabled() && state.task)
    finishActive("declined", declinedResult(state.task.url, "disabled"));
  void syncPreference();
}

/** The host component registers its WebView handle here; cleared when the host unmounts. */
export function setClientTaskBridge(next: ClientTaskBridge | undefined): void {
  bridge = next;
}

/** The task page finished loading: wait for it to settle, then extract its text. */
export function clientTaskWebViewLoaded(taskId: string): void {
  if (state.task?.taskId !== taskId || state.phase !== "loading") return;
  state = { ...state, phase: "settling" };
  emit();
  settleTimer = setTimeout(() => {
    if (state.task?.taskId !== taskId) return;
    state = { ...state, phase: "extracting" };
    emit();
    bridge?.injectJavaScript(CLIENT_TASK_EXTRACTION_SCRIPT);
  }, CLIENT_TASK_SETTLE_MS);
}

/** A bridge message from the task WebView: the extraction result, or its failure. */
export function clientTaskWebViewMessage(taskId: string, data: string): void {
  const task = state.task;
  if (!task || task.taskId !== taskId) return;
  let message: unknown;
  try {
    message = JSON.parse(data) as unknown;
  } catch {
    return;
  }
  if (!message || typeof message !== "object") return;
  const { type, url, title, text, truncated, error } = message as {
    type?: unknown;
    url?: unknown;
    title?: unknown;
    text?: unknown;
    truncated?: unknown;
    error?: unknown;
  };
  if (type === "result") {
    const body = typeof text === "string" ? text : "";
    finishActive("completed", {
      url: typeof url === "string" && url ? url : task.url,
      title: typeof title === "string" ? title : "",
      text: body.slice(0, MAX_CLIENT_TASK_TEXT),
      truncated: truncated === true || body.length > MAX_CLIENT_TASK_TEXT,
    });
  } else if (type === "error") {
    finishActive("failed", {
      ...emptyResult(task.url),
      error: typeof error === "string" && error ? error : "extraction failed",
    });
  }
  // Any other bridge message is ignored.
}

/** The task page failed to load. */
export function clientTaskWebViewError(taskId: string): void {
  const task = state.task;
  if (!task || task.taskId !== taskId) return;
  finishActive("failed", { ...emptyResult(task.url), error: "load failed" });
}

/** Stops the running task (banner Stop button) and reports it declined. */
export function stopClientTask(): void {
  const task = state.task;
  if (!task) return;
  finishActive("declined", declinedResult(task.url, "stopped"));
}

export function stopClientTaskRunner(): void {
  feed?.abort();
  feed = undefined;
  preferenceUnsubscribe?.();
  preferenceUnsubscribe = undefined;
  clearTimers();
  bridge = undefined;
  state = { task: null, phase: null };
  for (const listener of [...listeners]) listener();
}
registerSessionDiskCache(stopClientTaskRunner);

export function startClientTaskRunner(): () => void {
  const controller = new AbortController();
  feed = controller;
  preferenceUnsubscribe?.();
  preferenceUnsubscribe = subscribeLocalTraffic(onPreferenceChanged);
  void syncPreference(true);
  void follow(controller).catch(() => undefined);
  return () => stopClientTaskRunner();
}
