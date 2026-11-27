import type {
  AdapterContext,
  RealtimeFanout,
  WebFetchRequest,
  WebFetchResult,
  WebProvider,
  WebSearchHit,
  WebSearchRequest,
} from "@rakazo_mickvvw/adapter-kit";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import {
  awaitWithAbort,
  ClientTaskDispatcher,
  ClientTaskFallbackError,
} from "./client-task-dispatcher.js";
import { clampMaxChars, clampOffset, pageWindow } from "./web-limits.js";
import { createWebProvider, resolveWebProviderKind } from "./web-provider-factory.js";

export interface ClientWebProviderDeps {
  fallback: WebProvider;
  dispatcher: ClientTaskDispatcher;
}

/**
 * Tries the user's phone first for a page fetch, then the server web chain.
 * Only `fetch` can go to the phone (minimal version: fetch URL + return page
 * text). `search` stays on the server chain — it reads a search index, not a
 * page. Secrets never leave the server: the task envelope carries only the
 * URL (see client-task-dispatcher).
 */
export class ClientWebProvider implements WebProvider {
  private readonly fallback: WebProvider;
  private readonly dispatcher: ClientTaskDispatcher;

  constructor(deps: ClientWebProviderDeps) {
    this.fallback = deps.fallback;
    this.dispatcher = deps.dispatcher;
  }

  describe() {
    // The wrapper changes where fetch executes, not what search/fetch can
    // do, so it advertises the wrapped chain's capabilities under its own id.
    return { ...this.fallback.describe(), id: "client" };
  }

  search(request: WebSearchRequest, context: AdapterContext): Promise<WebSearchHit[]> {
    return this.fallback.search(request, context);
  }

  async fetch(request: WebFetchRequest, context: AdapterContext): Promise<WebFetchResult> {
    // A task needs a bot and a run to attribute it to; both go straight to
    // the server chain.
    if (!context.botId || !context.runId) {
      return this.fallback.fetch(request, context);
    }
    // Validate before dispatching, like the server chain does: an offset
    // past the read limit must fail without ever ringing the phone.
    const maxChars = clampMaxChars(request.maxChars);
    const offset = clampOffset(request.offset);
    const signal = request.signal ?? context.signal;
    signal.throwIfAborted();
    try {
      const result = await awaitWithAbort(
        this.dispatcher.fetchPage({
          userId: context.userId,
          spaceId: context.spaceId,
          botId: context.botId,
          runId: context.runId,
          url: request.url,
        }),
        signal,
      );
      const windowed = pageWindow(result.text.slice(offset), maxChars, offset);
      return {
        url: result.url,
        title: result.title,
        ...windowed,
        truncated: result.truncated || windowed.truncated,
      };
    } catch (error) {
      // Any phone-side failure is a fallback, never a user-facing error: the
      // server chain gets the same fetch instead.
      if (error instanceof ClientTaskFallbackError) {
        return this.fallback.fetch(request, context);
      }
      throw error;
    }
  }
}

export function createClientWebProvider(
  kind: string | undefined,
  options: {
    prisma: PrismaClient;
    realtime?: RealtimeFanout;
  },
): WebProvider {
  const fallback = createWebProvider(kind);
  const resolved = (kind ?? resolveWebProviderKind()).trim() || resolveWebProviderKind();
  // Fake exists for offline conformance: no phone dispatch there.
  if (resolved === "fake") return fallback;
  return new ClientWebProvider({
    fallback,
    dispatcher: new ClientTaskDispatcher({ prisma: options.prisma, realtime: options.realtime }),
  });
}
