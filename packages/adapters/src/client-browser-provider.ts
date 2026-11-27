import type {
  AdapterContext,
  BrowserActRequest,
  BrowserActResult,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserProvider,
  BrowserPurchaseCheckRequest,
  BrowserPurchaseCheckResult,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
  ComputerRef,
  RealtimeFanout,
  SandboxProvider,
} from "@rakazo_mickvvw/adapter-kit";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { createBrowserProvider, resolveBrowserProviderKind } from "./browser-provider-factory.js";
import {
  awaitWithAbort,
  ClientTaskDispatcher,
  ClientTaskFallbackError,
} from "./client-task-dispatcher.js";

/**
 * The phone fetch is read-only: the page text comes back, but the server
 * browser never opened the page, so nothing on it can be clicked or filled
 * from here. A run that needs interaction navigates again on the server
 * browser instead.
 */
const CLIENT_NAVIGATE_NOTE =
  "Fetched on the user's phone over their local network (page text only, no clickable elements). " +
  "The server browser never opened this page, so snapshot and act cannot see it — " +
  "navigate again on the server browser if interaction is needed.";

/** Why snapshot/act cannot run after a phone fetch. */
const PHONE_PAGE_ERROR =
  "The page was fetched on the user's phone; the server browser never opened it.";

export interface ClientBrowserProviderDeps {
  fallback: BrowserProvider;
  dispatcher: ClientTaskDispatcher;
}

/**
 * Tries the user's phone first for a page fetch, then the server browser.
 * Only `navigate` can go to the phone (minimal version: fetch URL + return
 * page text). `snapshot` and `act` run on the server browser — except when
 * the run's last page came from the phone, where they answer the established
 * `computer_act` fallback instead of showing the server browser's unrelated
 * page. Secrets never leave the server: the task envelope carries only the
 * URL (see client-task-dispatcher).
 */
export class ClientBrowserProvider implements BrowserProvider {
  private readonly fallback: BrowserProvider;
  private readonly dispatcher: ClientTaskDispatcher;
  /** Run ids whose last successful navigate came from the phone. */
  private readonly clientNavigatedRuns = new Map<string, true>();

  constructor(deps: ClientBrowserProviderDeps) {
    this.fallback = deps.fallback;
    this.dispatcher = deps.dispatcher;
  }

  describe() {
    return {
      id: "client",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { page: true, refs: false, keyless: true },
    };
  }

  async navigate(
    computer: ComputerRef,
    request: BrowserNavigateRequest,
    context: AdapterContext,
  ): Promise<BrowserNavigateResult> {
    // A task needs a bot and a run to attribute it to; without them, go
    // straight to the server browser. `request.downloads` is only the folder
    // a download would be saved to — it is set on every navigation, so it
    // must not skip the phone: a genuine download fails fast on the phone
    // and falls back to the server browser, which saves the file normally.
    if (!context.botId || !context.runId) {
      this.clientNavigatedRuns.delete(context.runId ?? "");
      return this.fallback.navigate(computer, request, context);
    }
    context.signal.throwIfAborted();
    try {
      const result = await awaitWithAbort(
        this.dispatcher.fetchPage({
          userId: context.userId,
          spaceId: context.spaceId,
          botId: context.botId,
          runId: context.runId,
          url: request.url,
        }),
        context.signal,
      );
      this.markClientNavigated(context.runId);
      return {
        url: result.url,
        title: result.title,
        tree: result.text,
        elements: [],
        note: result.truncated
          ? `${CLIENT_NAVIGATE_NOTE} The page text was cut to fit.`
          : CLIENT_NAVIGATE_NOTE,
      };
    } catch (error) {
      // Any phone-side failure is a fallback, never a user-facing error: the
      // server browser gets the same navigation instead.
      if (error instanceof ClientTaskFallbackError) {
        this.clientNavigatedRuns.delete(context.runId);
        return this.fallback.navigate(computer, request, context);
      }
      throw error;
    }
  }

  async snapshot(
    computer: ComputerRef,
    request: BrowserSnapshotRequest,
    context: AdapterContext,
  ): Promise<BrowserSnapshotResult> {
    if (this.lastNavigateWasClient(context.runId)) {
      return {
        url: "",
        title: "",
        tree: "",
        elements: [],
        fallback: "computer_act",
        error: PHONE_PAGE_ERROR,
      };
    }
    return this.fallback.snapshot(computer, request, context);
  }

  async act(
    computer: ComputerRef,
    request: BrowserActRequest,
    context: AdapterContext,
  ): Promise<BrowserActResult> {
    if (this.lastNavigateWasClient(context.runId)) {
      return {
        ok: false,
        completed: 0,
        url: "",
        title: "",
        fallback: "computer_act",
        error: PHONE_PAGE_ERROR,
      };
    }
    return this.fallback.act(computer, request, context);
  }

  async purchaseCheck(
    computer: ComputerRef,
    request: BrowserPurchaseCheckRequest,
    context: AdapterContext,
  ): Promise<BrowserPurchaseCheckResult> {
    if (this.lastNavigateWasClient(context.runId)) return { purchase: null };
    if (!this.fallback.purchaseCheck) return { purchase: null };
    return this.fallback.purchaseCheck(computer, request, context);
  }

  private lastNavigateWasClient(runId: string | undefined): boolean {
    return runId !== undefined && this.clientNavigatedRuns.has(runId);
  }

  private markClientNavigated(runId: string): void {
    this.clientNavigatedRuns.set(runId, true);
    // The provider outlives runs; keep the map bounded.
    if (this.clientNavigatedRuns.size > 128) {
      const oldest = this.clientNavigatedRuns.keys().next().value;
      if (oldest !== undefined) this.clientNavigatedRuns.delete(oldest);
    }
  }
}

export function createClientBrowserProvider(
  kind: string | undefined,
  options: {
    sandbox?: SandboxProvider;
    prisma: PrismaClient;
    realtime?: RealtimeFanout;
  },
): BrowserProvider {
  const fallback = createBrowserProvider(kind, { sandbox: options.sandbox });
  const resolved = (kind ?? resolveBrowserProviderKind()).trim() || resolveBrowserProviderKind();
  // Fake and emulator exist for offline conformance: no phone dispatch there.
  if (resolved !== "computer" && resolved !== "sandbox" && resolved !== "") return fallback;
  return new ClientBrowserProvider({
    fallback,
    dispatcher: new ClientTaskDispatcher({ prisma: options.prisma, realtime: options.realtime }),
  });
}
