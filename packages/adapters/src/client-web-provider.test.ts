import type {
  AdapterContext,
  WebFetchResult,
  WebProvider,
  WebSearchHit,
} from "@rakazo_mickvvw/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientTaskFallbackError } from "./client-task-dispatcher.js";
import { ClientWebProvider, createClientWebProvider } from "./client-web-provider.js";
import { FakeWebProvider } from "./fake-web.js";

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    operationId: "op-1",
    traceId: "trace-1",
    spaceId: "space-1",
    userId: "user-1",
    botId: "bot-1",
    runId: "run-1",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function stubFallback(): WebProvider & {
  fetch: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(
    async (): Promise<WebFetchResult> => ({
      url: "https://server.example/page",
      title: "Server page",
      text: "server page text",
      truncated: false,
    }),
  );
  const search = vi.fn(
    async (): Promise<WebSearchHit[]> => [
      { title: "Server hit", url: "https://server.example/page", snippet: "server" },
    ],
  );
  return {
    describe: () => ({
      id: "keyless-http",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        search: true,
        fetch: true,
        keyless: true,
        native: false,
        readability: true,
      },
    }),
    fetch,
    search,
  };
}

function stubDispatcher(
  fetchPage: (input: unknown) => Promise<unknown> = async () => ({
    url: "https://phone.example/ip",
    title: "Phone page",
    text: "203.0.113.7",
    truncated: false,
  }),
) {
  return { fetchPage: vi.fn(fetchPage) } as unknown as ConstructorParameters<
    typeof ClientWebProvider
  >[0]["dispatcher"];
}

describe("ClientWebProvider", () => {
  it("describes the wrapped chain under the client id", () => {
    const provider = new ClientWebProvider({
      fallback: stubFallback(),
      dispatcher: stubDispatcher(),
    });
    expect(provider.describe().id).toBe("client");
    expect(provider.describe().capabilities).toEqual({
      search: true,
      fetch: true,
      keyless: true,
      native: false,
      readability: true,
    });
  });

  it("fetches via the phone and returns its text in the fetch shape", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientWebProvider({ fallback, dispatcher });
    const result = await provider.fetch({ url: "https://phone.example/ip" }, context());
    expect(dispatcher.fetchPage).toHaveBeenCalledWith({
      userId: "user-1",
      spaceId: "space-1",
      botId: "bot-1",
      runId: "run-1",
      url: "https://phone.example/ip",
    });
    expect(fallback.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      url: "https://phone.example/ip",
      title: "Phone page",
      text: "203.0.113.7",
      truncated: false,
    });
  });

  it("keeps the phone's truncation flag", async () => {
    const provider = new ClientWebProvider({
      fallback: stubFallback(),
      dispatcher: stubDispatcher(async () => ({
        url: "https://phone.example/page",
        title: "Phone page",
        text: "cut",
        truncated: true,
      })),
    });
    const result = await provider.fetch({ url: "https://phone.example/page" }, context());
    expect(result.text).toBe("cut");
    expect(result.truncated).toBe(true);
  });

  it("windows phone text to maxChars and offset, naming the next offset", async () => {
    const text = "0123456789".repeat(15);
    const provider = new ClientWebProvider({
      fallback: stubFallback(),
      dispatcher: stubDispatcher(async () => ({
        url: "https://phone.example/page",
        title: "Phone page",
        text,
        truncated: false,
      })),
    });
    const first = await provider.fetch(
      { url: "https://phone.example/page", maxChars: 100 },
      context(),
    );
    expect(first.text).toBe(
      `${text.slice(0, 100)}\n\n[Content truncated; continue with offset 100]`,
    );
    expect(first.truncated).toBe(true);
    const rest = await provider.fetch(
      { url: "https://phone.example/page", maxChars: 100, offset: 100 },
      context({ runId: "run-2" }),
    );
    expect(rest.text).toBe(text.slice(100));
    expect(rest.truncated).toBe(false);
  });

  it.each([
    "disabled",
    "offline",
    "timeout",
    "declined",
    "failed",
    "rate-limited",
    "ssrf-denied",
    "busy",
  ] as const)("falls back to the server chain when the phone says %s", async (reason) => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher(async () => {
      throw new ClientTaskFallbackError(reason);
    });
    const provider = new ClientWebProvider({ fallback, dispatcher });
    const result = await provider.fetch({ url: "https://phone.example/ip" }, context());
    expect(fallback.fetch).toHaveBeenCalledWith(
      { url: "https://phone.example/ip" },
      expect.anything(),
    );
    expect(result.url).toBe("https://server.example/page");
    expect(result.text).toBe("server page text");
  });

  it("does not dispatch fetches without a bot or run", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientWebProvider({ fallback, dispatcher });
    await provider.fetch({ url: "https://x.example/" }, context({ botId: undefined }));
    await provider.fetch({ url: "https://x.example/" }, context({ runId: undefined }));
    expect(dispatcher.fetchPage).not.toHaveBeenCalled();
    expect(fallback.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an offset past the read limit before ringing the phone", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientWebProvider({ fallback, dispatcher });
    await expect(
      provider.fetch({ url: "https://x.example/", offset: 6 * 1024 * 1024 }, context()),
    ).rejects.toThrow("at most");
    expect(dispatcher.fetchPage).not.toHaveBeenCalled();
    expect(fallback.fetch).not.toHaveBeenCalled();
  });

  it("lets unexpected dispatcher errors propagate instead of hiding them", async () => {
    const fallback = stubFallback();
    const provider = new ClientWebProvider({
      fallback,
      dispatcher: stubDispatcher(async () => {
        throw new Error("database is down");
      }),
    });
    await expect(provider.fetch({ url: "https://phone.example/ip" }, context())).rejects.toThrow(
      "database is down",
    );
    expect(fallback.fetch).not.toHaveBeenCalled();
  });

  it("stops waiting when the run is cancelled", async () => {
    const controller = new AbortController();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const dispatcher = stubDispatcher(() => pending as Promise<unknown>);
    const provider = new ClientWebProvider({ fallback: stubFallback(), dispatcher });
    const fetching = provider.fetch(
      { url: "https://phone.example/ip" },
      context({ signal: controller.signal }),
    );
    controller.abort(new Error("run cancelled"));
    await expect(fetching).rejects.toThrow("run cancelled");
    // The orphaned dispatch settling later must not surface anywhere.
    release({ url: "https://phone.example/ip", title: "Late", text: "late", truncated: false });
    await Promise.resolve();
  });

  it("does not dispatch when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    const dispatcher = stubDispatcher();
    const provider = new ClientWebProvider({ fallback: stubFallback(), dispatcher });
    await expect(
      provider.fetch({ url: "https://phone.example/ip" }, context({ signal: controller.signal })),
    ).rejects.toThrow("already cancelled");
    expect(dispatcher.fetchPage).not.toHaveBeenCalled();
  });

  it("search stays on the server chain and never dispatches", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientWebProvider({ fallback, dispatcher });
    const hits = await provider.search({ query: "q" }, context());
    expect(dispatcher.fetchPage).not.toHaveBeenCalled();
    expect(fallback.search).toHaveBeenCalled();
    expect(hits).toEqual([
      { title: "Server hit", url: "https://server.example/page", snippet: "server" },
    ]);
  });
});

describe("createClientWebProvider", () => {
  const previousProvider = process.env.WEB_PROVIDER;

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.WEB_PROVIDER;
    else process.env.WEB_PROVIDER = previousProvider;
  });

  it("does not wrap the fake provider used for offline conformance", () => {
    process.env.WEB_PROVIDER = "fake";
    const provider = createClientWebProvider(undefined, {
      prisma: {} as never,
    });
    expect(provider).toBeInstanceOf(FakeWebProvider);
  });

  it("wraps the default chain by default", () => {
    delete process.env.WEB_PROVIDER;
    const provider = createClientWebProvider(undefined, {
      prisma: {} as never,
    });
    expect(provider.describe().id).toBe("client");
  });
});
