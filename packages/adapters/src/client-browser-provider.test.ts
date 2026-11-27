import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AdapterContext,
  BrowserActResult,
  BrowserNavigateResult,
  BrowserProvider,
  BrowserSnapshotResult,
  ComputerRef,
} from "@rakazo_mickvvw/adapter-kit";
import { ClientBrowserProvider, createClientBrowserProvider } from "./client-browser-provider.js";
import { ClientTaskFallbackError } from "./client-task-dispatcher.js";
import { FakeBrowserProvider } from "./fake-browser.js";

const COMPUTER: ComputerRef = {
  id: "computer-1",
  botId: "bot-1",
  kind: "desktop",
  providerRef: "computer-1",
};

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

function stubFallback(): BrowserProvider & {
  navigate: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  act: ReturnType<typeof vi.fn>;
  purchaseCheck: ReturnType<typeof vi.fn>;
} {
  const navigate = vi.fn(
    async (): Promise<BrowserNavigateResult> => ({
      url: "https://server.example/page",
      title: "Server page",
      tree: "server tree",
      elements: [{ ref: "e1", role: "link", name: "Server link" }],
    }),
  );
  const snapshot = vi.fn(
    async (): Promise<BrowserSnapshotResult> => ({
      url: "https://server.example/page",
      title: "Server page",
      tree: "server tree",
      elements: [{ ref: "e1", role: "link", name: "Server link" }],
    }),
  );
  const act = vi.fn(
    async (): Promise<BrowserActResult> => ({
      ok: true,
      completed: 1,
      url: "https://server.example/page",
      title: "Server page",
      tree: "server tree",
      elements: [],
    }),
  );
  const purchaseCheck = vi.fn(async () => ({ purchase: null }));
  return {
    describe: () => ({
      id: "computer",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { page: true, refs: true, keyless: true },
    }),
    navigate,
    snapshot,
    act,
    purchaseCheck,
  };
}

function stubDispatcher(
  fetchPage: (input: unknown) => Promise<unknown> = async () => ({
    url: "https://phone.example/page",
    title: "Phone page",
    text: "phone page text",
    truncated: false,
  }),
) {
  return { fetchPage: vi.fn(fetchPage) } as unknown as ConstructorParameters<
    typeof ClientBrowserProvider
  >[0]["dispatcher"];
}

describe("ClientBrowserProvider", () => {
  it("describes the phone fetch: page yes, refs no", () => {
    const provider = new ClientBrowserProvider({
      fallback: stubFallback(),
      dispatcher: stubDispatcher(),
    });
    expect(provider.describe().id).toBe("client");
    expect(provider.describe().capabilities).toEqual({
      page: true,
      refs: false,
      keyless: true,
    });
  });

  it("navigates via the phone and returns its text with no refs", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientBrowserProvider({ fallback, dispatcher });
    const result = await provider.navigate(
      COMPUTER,
      { url: "https://phone.example/page" },
      context(),
    );
    expect(dispatcher.fetchPage).toHaveBeenCalledWith({
      userId: "user-1",
      spaceId: "space-1",
      botId: "bot-1",
      runId: "run-1",
      url: "https://phone.example/page",
    });
    expect(fallback.navigate).not.toHaveBeenCalled();
    expect(result.url).toBe("https://phone.example/page");
    expect(result.title).toBe("Phone page");
    expect(result.tree).toBe("phone page text");
    expect(result.elements).toEqual([]);
    expect(result.fallback).toBeUndefined();
    expect(result.note).toContain("user's phone");
  });

  it("notes a cut page in the navigate result", async () => {
    const provider = new ClientBrowserProvider({
      fallback: stubFallback(),
      dispatcher: stubDispatcher(async () => ({
        url: "https://phone.example/page",
        title: "Phone page",
        text: "cut",
        truncated: true,
      })),
    });
    const result = await provider.navigate(
      COMPUTER,
      { url: "https://phone.example/page" },
      context(),
    );
    expect(result.tree).toBe("cut");
    expect(result.note).toContain("cut to fit");
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
  ] as const)("falls back to the server browser when the phone says %s", async (reason) => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher(async () => {
      throw new ClientTaskFallbackError(reason);
    });
    const provider = new ClientBrowserProvider({ fallback, dispatcher });
    const result = await provider.navigate(
      COMPUTER,
      { url: "https://phone.example/page" },
      context(),
    );
    expect(fallback.navigate).toHaveBeenCalledWith(
      COMPUTER,
      { url: "https://phone.example/page" },
      expect.anything(),
    );
    expect(result.url).toBe("https://server.example/page");
  });

  it("navigates via the phone even when a downloads folder is set", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientBrowserProvider({ fallback, dispatcher });
    const result = await provider.navigate(
      COMPUTER,
      { url: "https://phone.example/page", downloads: "dl" },
      context(),
    );
    // `downloads` is only the folder a download would be saved to; it is
    // set on every navigation, so it must not skip the phone.
    expect(dispatcher.fetchPage).toHaveBeenCalledWith({
      userId: "user-1",
      spaceId: "space-1",
      botId: "bot-1",
      runId: "run-1",
      url: "https://phone.example/page",
    });
    expect(fallback.navigate).not.toHaveBeenCalled();
    expect(result.tree).toBe("phone page text");
  });

  it("does not dispatch when navigating without a bot or run", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher();
    const provider = new ClientBrowserProvider({ fallback, dispatcher });
    await provider.navigate(COMPUTER, { url: "https://x.example/" }, context({ botId: undefined }));
    await provider.navigate(COMPUTER, { url: "https://x.example/" }, context({ runId: undefined }));
    expect(dispatcher.fetchPage).not.toHaveBeenCalled();
    expect(fallback.navigate).toHaveBeenCalledTimes(2);
  });

  it("lets unexpected dispatcher errors propagate instead of hiding them", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({
      fallback,
      dispatcher: stubDispatcher(async () => {
        throw new Error("database is down");
      }),
    });
    await expect(
      provider.navigate(COMPUTER, { url: "https://phone.example/page" }, context()),
    ).rejects.toThrow("database is down");
    expect(fallback.navigate).not.toHaveBeenCalled();
  });

  it("stops waiting when the run is cancelled", async () => {
    const controller = new AbortController();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const dispatcher = stubDispatcher(() => pending as Promise<unknown>);
    const provider = new ClientBrowserProvider({ fallback: stubFallback(), dispatcher });
    const navigating = provider.navigate(
      COMPUTER,
      { url: "https://phone.example/page" },
      context({ signal: controller.signal }),
    );
    controller.abort(new Error("run cancelled"));
    await expect(navigating).rejects.toThrow("run cancelled");
    // The orphaned dispatch settling later must not surface anywhere.
    release({ url: "https://phone.example/page", title: "Late", text: "late", truncated: false });
    await Promise.resolve();
  });

  it("does not dispatch when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    const dispatcher = stubDispatcher();
    const provider = new ClientBrowserProvider({ fallback: stubFallback(), dispatcher });
    await expect(
      provider.navigate(
        COMPUTER,
        { url: "https://phone.example/page" },
        context({ signal: controller.signal }),
      ),
    ).rejects.toThrow("already cancelled");
    expect(dispatcher.fetchPage).not.toHaveBeenCalled();
  });

  it("snapshot after a phone navigate answers computer_act, not the server page", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({ fallback, dispatcher: stubDispatcher() });
    await provider.navigate(COMPUTER, { url: "https://phone.example/page" }, context());
    const result = await provider.snapshot(COMPUTER, {}, context());
    expect(fallback.snapshot).not.toHaveBeenCalled();
    expect(result.fallback).toBe("computer_act");
    expect(result.elements).toEqual([]);
    expect(result.error).toContain("user's phone");
  });

  it("snapshot delegates to the server browser when the phone was not used", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({ fallback, dispatcher: stubDispatcher() });
    const result = await provider.snapshot(COMPUTER, {}, context());
    expect(fallback.snapshot).toHaveBeenCalled();
    expect(result.tree).toBe("server tree");
  });

  it("snapshot delegates again after a fallback navigate", async () => {
    const fallback = stubFallback();
    const dispatcher = stubDispatcher(async () => {
      throw new ClientTaskFallbackError("offline");
    });
    const provider = new ClientBrowserProvider({ fallback, dispatcher });
    await provider.navigate(COMPUTER, { url: "https://phone.example/page" }, context());
    await provider.snapshot(COMPUTER, {}, context());
    expect(fallback.snapshot).toHaveBeenCalled();
  });

  it("act after a phone navigate answers computer_act", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({ fallback, dispatcher: stubDispatcher() });
    await provider.navigate(COMPUTER, { url: "https://phone.example/page" }, context());
    const result = await provider.act(COMPUTER, { actions: [] }, context());
    expect(fallback.act).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, completed: 0, fallback: "computer_act" });
  });

  it("act delegates to the server browser when the phone was not used", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({ fallback, dispatcher: stubDispatcher() });
    const result = await provider.act(COMPUTER, { actions: [] }, context());
    expect(fallback.act).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("purchaseCheck cannot tell after a phone navigate", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({ fallback, dispatcher: stubDispatcher() });
    await provider.navigate(COMPUTER, { url: "https://phone.example/page" }, context());
    await expect(provider.purchaseCheck(COMPUTER, {}, context())).resolves.toEqual({
      purchase: null,
    });
    expect(fallback.purchaseCheck).not.toHaveBeenCalled();
  });

  it("purchaseCheck delegates when the phone was not used", async () => {
    const fallback = stubFallback();
    const provider = new ClientBrowserProvider({ fallback, dispatcher: stubDispatcher() });
    await provider.purchaseCheck(COMPUTER, {}, context());
    expect(fallback.purchaseCheck).toHaveBeenCalled();
  });
});

describe("createClientBrowserProvider", () => {
  const previousProvider = process.env.BROWSER_PROVIDER;

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.BROWSER_PROVIDER;
    else process.env.BROWSER_PROVIDER = previousProvider;
  });

  it("does not wrap the fake provider used for offline conformance", () => {
    process.env.BROWSER_PROVIDER = "fake";
    const provider = createClientBrowserProvider(undefined, {
      prisma: {} as never,
    });
    expect(provider).toBeInstanceOf(FakeBrowserProvider);
  });

  it("wraps the computer provider by default", () => {
    delete process.env.BROWSER_PROVIDER;
    const provider = createClientBrowserProvider(undefined, {
      prisma: {} as never,
    });
    expect(provider.describe().id).toBe("client");
  });
});
