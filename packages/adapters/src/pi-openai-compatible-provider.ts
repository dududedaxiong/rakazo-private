import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import type { Model, MutableModels, Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { GeneratedMedia, MediaReference } from "@rakazo_mickvvw/adapter-kit";
import { MediaGenerationError } from "@rakazo_mickvvw/adapter-kit";
import type {
  ModelApiProtocol,
  ModelAuthMode,
  ModelHealthReport,
  ModelHealthResult,
  ModelHealthState,
  ModelHealthSummary,
  ProbeOutcome,
} from "@rakazo_mickvvw/contracts";
import {
  ATTACHMENT_MAX_BYTES,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_TOKENS,
  effectiveAuthMode,
  ipVersion,
  isCloudMetadataAddress,
  isLinkLocalAddress,
  isNonPublicAddress,
  MODEL_KEY_REJECTED_ERROR,
  parseModelHeaders,
  withPromptPreset,
} from "@rakazo_mickvvw/contracts";
import { Agent } from "undici";
import { declaredVisionModelIds, inputModalities } from "./model-modalities.js";
import type { ResolveHostname } from "./network-address.js";
import { createAddressCheckedLookup } from "./network-address.js";
import type { OpenAiCompatibleUrlPolicy } from "./openai-compatible-url.js";
import {
  assertAllowedOpenAiCompatibleRequestUrl,
  assertAllowedOpenAiCompatibleUrl,
  assertHttpsForKeyedOpenAiCompatibleUrl,
  isPrivateOpenAiCompatibleHostname,
  normalizeOpenAiCompatibleBaseUrl,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  PRIVATE_MODEL_ENDPOINT_MESSAGE,
} from "./openai-compatible-url.js";
import {
  MODEL_CONNECT_TIMEOUT_MS,
  modelConnectTimeoutMs,
  modelHealthTimeoutMs,
} from "./pi-runtime-limits.js";
import { guardToolCallNames } from "./pi-tool-call-guard.js";
import { dispatcherFetch, fetchPairedWithDispatcher } from "./undici-fetch.js";
import { fetchSafeWebBytes } from "./web-ssrf.js";

export { OPENAI_COMPATIBLE_PROVIDER_ID };

/** Placeholder catalog model id; users enter the real id when connecting. */
export const OPENAI_COMPATIBLE_CATALOG_MODEL_ID = "custom";

/** Model ids this endpoint serves with vision, declared by the operator. */
export const OPENAI_COMPATIBLE_VISION_MODELS_ENV = "RAKAZO_OPENAI_COMPATIBLE_VISION_MODELS";

export function openAiCompatibleVisionModelIds(): ReadonlySet<string> {
  return declaredVisionModelIds(OPENAI_COMPATIBLE_VISION_MODELS_ENV);
}

/** Custom endpoints can be aggregators; keep their discovery bounded below pinned catalogs. */
const MAX_MODELS_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_IDS = 4_000;
/** Pinned catalogs (OpenRouter is ~1 MiB). Custom server URLs stay on the tight caps. */
const CATALOG_MAX_MODELS_RESPONSE_BYTES = 8 * 1024 * 1024;
const CATALOG_MAX_MODEL_IDS = 8_000;
const MAX_MODEL_ID_LENGTH = 256;

function modelsProbeLimits(catalogProbe?: boolean): { maxBytes: number; maxModelIds: number } {
  return catalogProbe
    ? { maxBytes: CATALOG_MAX_MODELS_RESPONSE_BYTES, maxModelIds: CATALOG_MAX_MODEL_IDS }
    : { maxBytes: MAX_MODELS_RESPONSE_BYTES, maxModelIds: MAX_MODEL_IDS };
}

const OPENAI_COMPAT_BASE = "http://127.0.0.1:1/v1";
/** The version the Anthropic SDK pins; mirrored by the keyless-server probe. */
const ANTHROPIC_MESSAGES_VERSION = "2023-06-01";
const resolveHostname: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export function openAiCompatibleModel(
  id: string,
  baseUrl: string,
  reasoning = false,
  acceptsImages = false,
  maxTokens = DEFAULT_MODEL_MAX_TOKENS,
  contextWindow = DEFAULT_MODEL_CONTEXT_WINDOW,
  apiProtocol: ModelApiProtocol = "chat-completions",
): Model<"openai-completions" | "openai-responses" | "anthropic-messages"> {
  return {
    id,
    name: id,
    // "chat-completions" and "anthropic-messages-via-chat-completions" both
    // speak OpenAI chat completions on the wire; the translated protocol only
    // differs in what the operator picked in the form, so it takes the same
    // branch and never the Anthropic API, its /v1 stripping, or its
    // catalog thinking settings.
    api:
      apiProtocol === "responses"
        ? "openai-responses"
        : apiProtocol === "anthropic-messages"
          ? "anthropic-messages"
          : "openai-completions",
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
    baseUrl: apiProtocol === "anthropic-messages" ? anthropicMessagesBaseUrl(baseUrl) : baseUrl,
    reasoning,
    ...(apiProtocol === "anthropic-messages"
      ? // pi-ai derives budget-based thinking from `reasoning` alone, which newer models
        // reject; a model the built-in catalog knows keeps its own thinking settings.
        anthropicCatalogThinking(id)
      : {
          compat: {
            // `store: false` is already the default, and Google's endpoint rejects the field.
            supportsStore: false,
            supportsDeveloperRole: false,
            supportsReasoningEffort: reasoning,
            thinkingFormat: "openai",
          },
          thinkingLevelMap: reasoning
            ? { off: "none", xhigh: "xhigh", max: "max" }
            : { off: "none" },
        }),
    input: inputModalities(acceptsImages),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
}

let anthropicCatalog: ReturnType<typeof builtinModels> | undefined;

/**
 * The built-in Anthropic catalog's thinking settings for the same model id, if any. Only the
 * thinking shape is copied: the catalog's other flags (mid-conversation effort and system
 * messages, fallbacks) describe Anthropic's own API, which a compatible endpoint may not accept.
 */
function anthropicCatalogThinking(
  id: string,
): Pick<Model<"anthropic-messages">, "compat" | "thinkingLevelMap"> {
  anthropicCatalog ??= builtinModels();
  const known = anthropicCatalog.getModel("anthropic", id) as
    | Model<"anthropic-messages">
    | undefined;
  if (known?.api !== "anthropic-messages") return {};
  return {
    ...(known.compat?.forceAdaptiveThinking ? { compat: { forceAdaptiveThinking: true } } : {}),
    ...(known.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {}),
  };
}

/**
 * The Anthropic SDK appends `/v1/messages` itself, so the endpoint it gets must
 * not carry the `/v1` the normalized OpenAI-style base URL ends with.
 */
function anthropicMessagesBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/*$/, "");
  return url.toString().replace(/\/$/, "");
}

function openAiCompatibleProvider(
  models: Model<"openai-completions" | "openai-responses" | "anthropic-messages">[],
  policy: {
    allowPrivate?: boolean;
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    apiKey?: string;
  } = {},
): Provider {
  const api = (protocol: string) =>
    protocol === "openai-responses"
      ? openAIResponsesApi()
      : protocol === "anthropic-messages"
        ? anthropicMessagesApi()
        : openAICompletionsApi();
  // Guard the fetch the caller supplied (the runtime's seam for tests) or the
  // dispatcher-matched default; never the bare global.
  const safeApi: ProviderStreams = {
    stream: (model, context, options) =>
      api(model.api).stream(model, context, {
        ...options,
        fetch: createOpenAiCompatibleFetch(options?.fetch, undefined, policy),
      }),
    streamSimple: (model, context, options) =>
      api(model.api).streamSimple(model, context, {
        ...options,
        fetch: createOpenAiCompatibleFetch(options?.fetch, undefined, policy),
      }),
  };
  return createProvider({
    id: OPENAI_COMPATIBLE_PROVIDER_ID,
    name: "OpenAI-compatible",
    baseUrl: models[0]?.baseUrl ?? OPENAI_COMPAT_BASE,
    auth: {
      apiKey: {
        name: "OpenAI-compatible server",
        resolve: async () => ({
          auth: { apiKey: "local" },
          source: "OpenAI-compatible endpoint",
        }),
      },
    },
    models,
    api: safeApi,
  });
}

export function createOpenAiCompatibleLookup(
  url: URL,
  resolve: ResolveHostname = resolveHostname,
  opts?: { allowPrivate?: boolean },
): LookupFunction {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const privateHostname = isPrivateOpenAiCompatibleHostname(hostname);
  if (privateHostname && opts?.allowPrivate !== true) {
    throw new Error(PRIVATE_MODEL_ENDPOINT_MESSAGE);
  }
  return createAddressCheckedLookup(resolve, (addresses) => {
    if (addresses.length === 0) throw new Error("Model server did not resolve to an address");
    if (addresses.some((entry) => isCloudMetadataAddress(entry.address))) {
      throw new Error("Model server hostname resolved to a blocked metadata address");
    }
    if (privateHostname) {
      if (
        addresses.some(
          (entry) =>
            ipVersion(entry.address) === 0 ||
            !isNonPublicAddress(entry.address) ||
            isLinkLocalAddress(entry.address),
        )
      ) {
        throw new Error("Local model server hostname resolved outside the private network");
      }
      return;
    }
    if (addresses.some((entry) => isNonPublicAddress(entry.address))) {
      throw new Error("Public model server hostname resolved to a private address");
    }
  });
}

function isAuthHeader(name: string, value: string | null | undefined): boolean {
  const lower = name.toLowerCase();
  return (lower === "authorization" || lower === "x-api-key") && Boolean(value);
}

function headersCarryAuthorization(headers: HeadersInit): boolean {
  const entries =
    headers instanceof Headers || Array.isArray(headers) ? [...headers] : Object.entries(headers);
  return entries.some(([name, value]) => isAuthHeader(name, value));
}

/**
 * Rewrites the outgoing auth headers for the connection's auth mode. The SDK
 * may have set a placeholder header; the mode decides what actually goes out.
 * Without an explicit mode or a key, the caller's headers are left alone.
 */
function applyAuthMode(
  headers: Headers,
  opts: { authMode?: ModelAuthMode; apiProtocol?: ModelApiProtocol; apiKey?: string },
): void {
  if (opts.authMode === undefined && opts.apiKey === undefined) return;
  const mode = effectiveAuthMode(opts.authMode, opts.apiProtocol);
  const key = opts.apiKey?.trim();
  headers.delete("authorization");
  headers.delete("x-api-key");
  if (mode === "none" || !key) return;
  if (mode === "bearer" || mode === "both") headers.set("Authorization", `Bearer ${key}`);
  if (mode === "x-api-key" || mode === "both") headers.set("x-api-key", key);
}

/** Matches fetch: when init.headers is set it replaces Request headers entirely. */
function requestCarriesAuthorization(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.headers !== undefined) return headersCarryAuthorization(init.headers);
  return input instanceof Request ? headersCarryAuthorization(input.headers) : false;
}

export function createOpenAiCompatibleFetch(
  baseFetch: typeof globalThis.fetch = dispatcherFetch,
  resolve: ResolveHostname = resolveHostname,
  opts?: OpenAiCompatibleUrlPolicy & {
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    apiKey?: string;
  },
): typeof globalThis.fetch {
  return async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = assertAllowedOpenAiCompatibleRequestUrl(rawUrl, opts);
    const customHeaders = opts?.headers === undefined ? undefined : parseModelHeaders(opts.headers);
    if (requestCarriesAuthorization(input, init) || Object.keys(customHeaders ?? {}).length > 0) {
      assertHttpsForKeyedOpenAiCompatibleUrl(
        url,
        requestCarriesAuthorization(input, init) ? "present" : undefined,
        Object.keys(customHeaders ?? {}).length > 0,
      );
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const dispatcher = new Agent({
      connect: {
        timeout: modelConnectTimeoutMs(),
        ...(ipVersion(hostname) === 0
          ? { lookup: createOpenAiCompatibleLookup(url, resolve, opts) }
          : {}),
      },
    });
    // Node's fetch rejects this package Agent. Use its matching fetch;
    // a caller-supplied fetch stays in charge.
    const transport = fetchPairedWithDispatcher(baseFetch);
    try {
      const requestInit = await requestInitFor(input, init);
      let headers = requestInit.headers;
      if (customHeaders !== undefined && Object.keys(customHeaders).length > 0) {
        const merged = new Headers(headers);
        for (const [name, value] of Object.entries(customHeaders)) merged.set(name, value);
        headers = merged;
      }
      if (opts?.authMode !== undefined || opts?.apiKey !== undefined) {
        const normalized = new Headers(headers);
        applyAuthMode(normalized, {
          authMode: opts.authMode,
          apiProtocol: opts.apiProtocol,
          apiKey: opts.apiKey,
        });
        headers = normalized;
      }
      const response = await transport(url, {
        ...requestInit,
        headers,
        redirect: "error",
        dispatcher,
      } as RequestInit & { dispatcher: Agent });
      return await closeDispatcherWithResponse(response, dispatcher);
    } catch (error) {
      await dispatcher.destroy().catch(() => undefined);
      throw error;
    }
  };
}

/** The base fetch comes from the undici package, which recognizes only its own
 * Request class and reads a global Request as the string "[object Request]".
 * Flatten Request inputs to a URL plus init, with init overriding the
 * Request's fields the way fetch itself merges them. */
async function requestInitFor(input: RequestInfo | URL, init?: RequestInit): Promise<RequestInit> {
  if (!(input instanceof Request)) return init ?? {};
  const request = new Request(input, init);
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  return {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  };
}

async function closeDispatcherWithResponse(
  response: Response,
  dispatcher: Agent,
): Promise<Response> {
  if (!response.body) {
    await dispatcher.close();
    return response;
  }
  const reader = response.body.getReader();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await dispatcher.close().catch(() => undefined);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        await close();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await close();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Always-visible catalog provider with a placeholder model entry. */
export function openAiCompatibleCatalogProvider(): Provider {
  // The vision gate resolves against this catalog, not the per-run registry, so
  // declared vision models are registered here too. A declared placeholder id
  // upgrades the placeholder in place: Models.getModel returns the first match.
  const visionIds = openAiCompatibleVisionModelIds();
  const placeholderAcceptsImages = visionIds.has(OPENAI_COMPATIBLE_CATALOG_MODEL_ID);
  const visionModels = [...visionIds]
    .filter((id) => id !== OPENAI_COMPATIBLE_CATALOG_MODEL_ID)
    .map((id) => openAiCompatibleModel(id, OPENAI_COMPAT_BASE, false, true));
  return openAiCompatibleProvider([
    {
      ...openAiCompatibleModel(
        OPENAI_COMPATIBLE_CATALOG_MODEL_ID,
        OPENAI_COMPAT_BASE,
        false,
        placeholderAcceptsImages,
      ),
      name: "Custom model id",
    },
    ...visionModels,
  ]);
}

export function registerOpenAiCompatibleCatalog(models: MutableModels): MutableModels {
  models.setProvider(openAiCompatibleCatalogProvider());
  return guardToolCallNames(models, OPENAI_COMPATIBLE_PROVIDER_ID);
}

export function registerOpenAiCompatibleRuntime(
  models: MutableModels,
  opts: {
    modelId: string;
    baseUrl: string;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    apiKey?: string;
    headers?: Record<string, string>;
    reasoning?: boolean;
    acceptsImages?: boolean;
    maxTokens?: number;
    contextWindow?: number;
    /** Explicit operator authorization for private endpoints. */
    allowPrivate?: boolean;
  },
): MutableModels {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(opts.baseUrl);
  const modelId = opts.modelId.trim();
  const acceptsImages = opts.acceptsImages || openAiCompatibleVisionModelIds().has(modelId);
  models.setProvider(
    openAiCompatibleProvider(
      [
        openAiCompatibleModel(
          modelId,
          baseUrl,
          opts.reasoning,
          acceptsImages,
          opts.maxTokens,
          opts.contextWindow,
          opts.apiProtocol,
        ),
      ],
      {
        allowPrivate: opts.allowPrivate,
        headers: opts.headers,
        apiProtocol: opts.apiProtocol,
        authMode: opts.authMode,
        apiKey: opts.apiKey,
      },
    ),
  );
  return guardToolCallNames(models, OPENAI_COMPATIBLE_PROVIDER_ID);
}

export type OpenAiCompatibleConnectInput = {
  provider: string;
  baseUrl?: string;
  modelId?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

export function prepareOpenAiCompatibleConnect(
  input: OpenAiCompatibleConnectInput,
  policy?: { allowPrivate?: boolean },
): {
  baseUrl: string;
  modelId: string;
  apiKey?: string;
} {
  const baseUrl = input.baseUrl?.trim();
  const modelId = input.modelId?.trim();
  if (!baseUrl) throw new Error("Base URL is required for OpenAI-compatible models");
  if (!modelId) throw new Error("Model id is required for OpenAI-compatible models");
  const allowed = assertAllowedOpenAiCompatibleUrl(baseUrl, policy);
  const apiKey = input.apiKey?.trim();
  assertHttpsForKeyedOpenAiCompatibleUrl(
    allowed,
    apiKey,
    Object.keys(input.headers ?? {}).length > 0,
  );
  const normalized = allowed.href;
  return apiKey ? { baseUrl: normalized, modelId, apiKey } : { baseUrl: normalized, modelId };
}

export type OpenAiCompatibleModelsResponse = {
  object?: string;
  data?: Array<{ id?: string }>;
  models?: Array<{ id?: string }>;
};

/** Shared suffix: /models probe is optional when the user already knows a model id. */
const OPENAI_COMPAT_PROBE_HAND_FILL_HINT = "You can still Connect with an explicit model id.";

/** Extracts model ids; valid JSON can still be null or lack a list, which gets the actionable missing-list error. */
function probeModelIds(
  body: OpenAiCompatibleModelsResponse,
  opts?: { catalogProbe?: boolean },
): string[] {
  const { maxModelIds } = modelsProbeLimits(opts?.catalogProbe);
  const entries = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : null;
  if (!entries) {
    throw new Error(
      `Model server response did not include a models list. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`,
    );
  }
  const ids: string[] = [];
  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    if (id.length > MAX_MODEL_ID_LENGTH || ids.length >= maxModelIds) {
      throw new Error("Model server returned too many or overly long model ids");
    }
    ids.push(id);
  }
  return ids;
}

async function readBoundedJson(
  response: Response,
  opts?: { catalogProbe?: boolean },
): Promise<OpenAiCompatibleModelsResponse> {
  const { maxBytes } = modelsProbeLimits(opts?.catalogProbe);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Model server response is too large. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`);
  }
  if (!response.body) {
    throw new Error(
      `Model server returned an empty response. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Model server response is too large. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as OpenAiCompatibleModelsResponse;
  } catch {
    throw new Error(`Model server returned invalid JSON. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`);
  }
}

/** Some compatible servers expose their model list without authenticating. */
export async function verifyOpenAiCompatibleApiKey(
  input: { baseUrl: string; apiKey?: string; headers?: Record<string, string> },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  if (new URL(input.baseUrl).hostname !== "ollama.com") return;
  if (!input.apiKey?.trim()) throw new Error(MODEL_KEY_REJECTED_ERROR);
  const safeFetch = createOpenAiCompatibleFetch(fetchImpl);
  let response: Response;
  try {
    response = await safeFetch("https://ollama.com/api/balance", {
      headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(MODEL_CONNECT_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch {
    throw new Error("Could not verify the API key. Try again.");
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) {
    throw new Error(MODEL_KEY_REJECTED_ERROR);
  }
  if (!response.ok) throw new Error("Could not verify the API key. Try again.");
}

export async function probeOpenAiCompatibleModels(
  input: {
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    /** Sent as the User-Agent; some fronted endpoints reject a plain library agent. */
    userAgent?: string;
  },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy & { catalogProbe?: boolean },
): Promise<string[]> {
  const baseUrl = assertAllowedOpenAiCompatibleUrl(input.baseUrl, opts);
  assertHttpsForKeyedOpenAiCompatibleUrl(
    baseUrl,
    input.apiKey,
    Object.keys(input.headers ?? {}).length > 0,
  );
  await verifyOpenAiCompatibleApiKey(input, fetchImpl, signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    // Anthropic Messages authenticates with its own headers, not a Bearer token;
    // the version header is required even when the endpoint needs no key.
    if (input.apiProtocol === "anthropic-messages") {
      headers["anthropic-version"] = ANTHROPIC_MESSAGES_VERSION;
    }
    if (input.userAgent?.trim()) headers["User-Agent"] = input.userAgent.trim();
    const mode = effectiveAuthMode(input.authMode, input.apiProtocol);
    const key = input.apiKey?.trim();
    if (key && mode !== "none") {
      if (mode === "bearer" || mode === "both") headers.Authorization = `Bearer ${key}`;
      if (mode === "x-api-key" || mode === "both") headers["x-api-key"] = key;
    }
    const safeFetch = createOpenAiCompatibleFetch(fetchImpl, undefined, {
      ...opts,
      headers: input.headers,
    });
    const response = await safeFetch(new URL("models", `${baseUrl.href}/`).href, {
      headers,
      redirect: "error",
      signal: merged,
    });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Model server redirects are not allowed. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Model server returned ${response.status}. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`,
      );
    }
    const body = await readBoundedJson(response, opts);
    return probeModelIds(body, opts);
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === "AbortError") ||
      (typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError");
    if (aborted) {
      // Caller-cancelled probes keep the original AbortError; the 5s probe budget gets a hint.
      if (signal?.aborted) throw error;
      throw new Error(`Model server probe timed out. ${OPENAI_COMPAT_PROBE_HAND_FILL_HINT}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * What a key-health probe found. "unsupported" means the key cannot be
 * judged from this endpoint: the list interface is missing and no single
 * model could be named for a one-question fallback.
 */
export type CredentialKeyHealthStatus =
  | "ok"
  | "invalid_key"
  | "unreachable"
  | "timeout"
  | "unsupported";

export type OpenAiCompatibleKeyHealth = {
  status: CredentialKeyHealthStatus;
  /** Models the list returned; absent when no list was read. */
  modelCount?: number;
};

/** One short completion to prove the key when the models list is missing. */
const KEY_HEALTH_FALLBACK_TIMEOUT_MS = 5_000;
const KEY_HEALTH_PROBE_STATUS = /Model server returned (\d{3})\./;

/**
 * Check one key against its models list, spending no tokens. A list that
 * answers proves the key; a 401/403 condemns it; a timeout or other failure
 * says the endpoint could not be reached. When the endpoint has no list
 * interface (404, or a body with no list), one named model gets a single
 * short question instead — a working answer still proves the key.
 */
export async function probeOpenAiCompatibleKeyHealth(
  input: {
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    userAgent?: string;
    /** One model to test when the list interface is missing. */
    modelId?: string;
  },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy & { catalogProbe?: boolean },
): Promise<OpenAiCompatibleKeyHealth> {
  let modelIds: string[];
  try {
    modelIds = await probeOpenAiCompatibleModels(input, fetchImpl, signal, opts);
    return { status: "ok", modelCount: modelIds.length };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/timed out/i.test(message)) return { status: "timeout" };
    const probeStatus = KEY_HEALTH_PROBE_STATUS.exec(message)?.[1];
    if (
      probeStatus === "401" ||
      probeStatus === "403" ||
      message.includes(MODEL_KEY_REJECTED_ERROR)
    ) {
      return { status: "invalid_key" };
    }
    const noList = probeStatus === "404" || /did not include a models list/i.test(message);
    if (!noList) return { status: "unreachable" };
    if (!input.modelId) return { status: "unsupported" };
    const fallbackController = new AbortController();
    const fallbackTimeout = setTimeout(
      () => fallbackController.abort(),
      KEY_HEALTH_FALLBACK_TIMEOUT_MS,
    );
    const fallbackSignal = signal
      ? AbortSignal.any([signal, fallbackController.signal])
      : fallbackController.signal;
    try {
      const report = await probeModelHealth(
        { ...input, models: [input.modelId] },
        fetchImpl,
        fallbackSignal,
        opts,
      );
      const state = report.results[0]?.state;
      // A reply — even an empty or rate-limited one — proves the key works.
      if (state === "ok" || state === "empty" || state === "limited") return { status: "ok" };
      if (state === "auth") return { status: "invalid_key" };
      if (state === "timeout") return { status: "timeout" };
      // The named model does not exist, so the key stays unjudged.
      if (state === "notfound") return { status: "unsupported" };
      return { status: "unreachable" };
    } catch (fallbackError) {
      if (signal?.aborted) throw fallbackError;
      if (fallbackController.signal.aborted) return { status: "timeout" };
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "";
      if (/timed out/i.test(fallbackMessage)) return { status: "timeout" };
      if (
        /returned 401|returned 403/.test(fallbackMessage) ||
        fallbackMessage.includes(MODEL_KEY_REJECTED_ERROR)
      ) {
        return { status: "invalid_key" };
      }
      return { status: "unreachable" };
    } finally {
      clearTimeout(fallbackTimeout);
    }
  }
}

/** One short question every model answers; the reply only has to prove the model runs. */
const MODEL_HEALTH_PROMPT = "1+1等于几？只回数字。";
const MODEL_HEALTH_MAX_TOKENS = 100;
const MODEL_HEALTH_CONCURRENCY = 4;
/** Cap one run: a relay can list thousands of models, and each test is a real request. */
const MAX_MODEL_HEALTH_MODELS = 50;
/** Cap one reply or error body; a health check never needs more than a short answer. */
const MAX_MODEL_HEALTH_RESPONSE_BYTES = 256 * 1024;
/** CF-fronted endpoints reject a plain library agent with 403 error 1010. */
const MODEL_HEALTH_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Display order: usable first, then the states that may recover, then the failures. */
const MODEL_HEALTH_STATE_ORDER: ModelHealthState[] = [
  "ok",
  "empty",
  "limited",
  "auth",
  "notfound",
  "badreq",
  "servererr",
  "timeout",
  "neterr",
];

function healthDetail(text: string, maxLength: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** Reads a bounded body as text; a health reply is short, an error page is not needed whole. */
async function readBoundedHealthText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_MODEL_HEALTH_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The upstream's own error message when it has one, else the raw body, shortened. */
function healthErrorMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const error =
      parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).error
        : undefined;
    const message =
      typeof error === "string"
        ? error
        : error !== null &&
            typeof error === "object" &&
            typeof (error as Record<string, unknown>).message === "string"
          ? ((error as Record<string, unknown>).message as string)
          : typeof (parsed as Record<string, unknown>).message === "string"
            ? ((parsed as Record<string, unknown>).message as string)
            : "";
    if (message.trim()) return healthDetail(message, 120);
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return healthDetail(bodyText, 120);
}

/** The reply text for the protocol, or null when the body carries no reply. */
function healthReplyText(apiProtocol: ModelApiProtocol | undefined, body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const parsed = body as Record<string, unknown>;
  if (apiProtocol === "anthropic-messages") {
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const text = content
      .filter(
        (block): block is Record<string, unknown> =>
          block !== null &&
          typeof block === "object" &&
          (block as Record<string, unknown>).type === "text",
      )
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    return text;
  }
  if (apiProtocol === "responses") {
    if (typeof parsed.output_text === "string") return parsed.output_text;
    const output = Array.isArray(parsed.output) ? parsed.output : [];
    const text = output
      .filter(
        (item): item is Record<string, unknown> =>
          item !== null &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "message",
      )
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter(
        (block): block is Record<string, unknown> =>
          block !== null &&
          typeof block === "object" &&
          (block as Record<string, unknown>).type === "output_text",
      )
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    return text;
  }
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const message =
    choices[0] !== null && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>).message
      : undefined;
  const content =
    message !== null && typeof message === "object"
      ? (message as Record<string, unknown>).content
      : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part !== null &&
        typeof part === "object" &&
        typeof (part as Record<string, unknown>).text === "string"
          ? ((part as Record<string, unknown>).text as string)
          : "",
      )
      .join("");
  }
  return null;
}

/** The error the body carries, if any, as a readable message. */
function healthBodyError(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const parsed = body as Record<string, unknown>;
  if (typeof parsed.error === "string") return parsed.error;
  const error = parsed.error;
  if (error !== null && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  return undefined;
}

function classifyHealthResponse(
  status: number,
  bodyText: string,
  body: unknown,
): { state: ModelHealthState; detail: string } {
  const upstream = healthErrorMessage(bodyText);
  const low = bodyText.toLowerCase();
  if (
    status === 429 ||
    low.includes("rate limit") ||
    low.includes("rate_limit") ||
    low.includes("too many")
  ) {
    return { state: "limited", detail: upstream || "限流" };
  }
  // 402 is a plan/balance failure, not a broken key: the upstream message says what to do.
  if (status === 401 || status === 402 || status === 403) {
    return { state: "auth", detail: upstream || "无权限" };
  }
  if (status === 404 || bodyText.includes("不存在") || bodyText.includes("停用")) {
    return { state: "notfound", detail: upstream || "模型不存在或已停用" };
  }
  if (status === 400) return { state: "badreq", detail: upstream || "请求无效" };
  if (status >= 500) return { state: "servererr", detail: upstream || "上游服务错误" };
  if (status >= 400) return { state: "badreq", detail: upstream || `请求被拒绝（${status}）` };
  // A 200 with an error body: sort it by what the error says, like the status cases above.
  const error = healthBodyError(body);
  if (error) {
    const message = healthDetail(error, 120);
    const lowError = error.toLowerCase();
    if (
      lowError.includes("rate limit") ||
      lowError.includes("rate_limit") ||
      lowError.includes("too many")
    ) {
      return { state: "limited", detail: message };
    }
    return { state: "badreq", detail: message };
  }
  return { state: "badreq", detail: upstream || "请求无效" };
}

/** The chat URL and body for one model, per protocol. */
function healthChatRequest(
  baseUrl: URL,
  apiProtocol: ModelApiProtocol | undefined,
  model: string,
): { url: string; body: Record<string, unknown> } {
  const messages = [{ role: "user", content: MODEL_HEALTH_PROMPT }];
  if (apiProtocol === "anthropic-messages") {
    // The Anthropic SDK posts /v1/messages under its base URL, and this connection's base
    // URL is stored without /v1; the probe must hit the same endpoint real chats use.
    return {
      url: new URL("v1/messages", `${anthropicMessagesBaseUrl(baseUrl.href)}/`).href,
      body: { model, max_tokens: MODEL_HEALTH_MAX_TOKENS, messages, temperature: 0 },
    };
  }
  if (apiProtocol === "responses") {
    return {
      url: new URL("responses", `${baseUrl.href}/`).href,
      body: {
        model,
        input: MODEL_HEALTH_PROMPT,
        max_output_tokens: MODEL_HEALTH_MAX_TOKENS,
        temperature: 0,
      },
    };
  }
  return {
    url: new URL("chat/completions", `${baseUrl.href}/`).href,
    body: { model, messages, max_tokens: MODEL_HEALTH_MAX_TOKENS, temperature: 0 },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

/** Sends one model the health question and classifies the answer. */
async function probeOneModelHealth(
  safeFetch: typeof globalThis.fetch,
  baseUrl: URL,
  input: {
    apiKey?: string;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
  },
  model: string,
  signal?: AbortSignal,
): Promise<ModelHealthResult> {
  const started = Date.now();
  const seconds = () => Math.round(((Date.now() - started) / 1000) * 10) / 10;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelHealthTimeoutMs());
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": MODEL_HEALTH_BROWSER_USER_AGENT,
    };
    if (input.apiProtocol === "anthropic-messages") {
      headers["anthropic-version"] = ANTHROPIC_MESSAGES_VERSION;
    }
    const mode = effectiveAuthMode(input.authMode, input.apiProtocol);
    const key = input.apiKey?.trim();
    if (key && mode !== "none") {
      if (mode === "bearer" || mode === "both") headers.Authorization = `Bearer ${key}`;
      if (mode === "x-api-key" || mode === "both") headers["x-api-key"] = key;
    }
    const { url, body } = healthChatRequest(baseUrl, input.apiProtocol, model);
    const response = await safeFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: merged,
    });
    const bodyText = await readBoundedHealthText(response);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const classified = classifyHealthResponse(response.status, bodyText, parsed);
      return { model, ...classified, seconds: seconds() };
    }
    if (parsed === null) {
      return { model, state: "badreq", detail: "返回不是 JSON", seconds: seconds() };
    }
    const reply = healthReplyText(input.apiProtocol, parsed);
    if (reply === null) {
      const classified = classifyHealthResponse(response.status, bodyText, parsed);
      return { model, ...classified, seconds: seconds() };
    }
    const text = reply.trim();
    return text
      ? { model, state: "ok", detail: healthDetail(text, 60), seconds: seconds() }
      : { model, state: "empty", detail: "空回复", seconds: seconds() };
  } catch (error) {
    // The caller's own cancel aborts the whole run; a per-model timeout is one result.
    if (signal?.aborted) throw error;
    if (isAbortError(error)) {
      return { model, state: "timeout", detail: "请求超时", seconds: seconds() };
    }
    const message = error instanceof Error ? error.message : "";
    return {
      model,
      state: "neterr",
      detail: message ? healthDetail(`网络错误：${message}`, 120) : "网络错误",
      seconds: seconds(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tests every model on an OpenAI-compatible endpoint with one real question each, and
 * classifies the answers. A `/models` list is not proof a model works: relays list the
 * whole catalogue and only enable a few, so each id gets a real request. `models` tests
 * a given list (a connection's enabled models); without it the list comes from the
 * server, capped at MAX_MODEL_HEALTH_MODELS with `truncated` set.
 */
export async function probeModelHealth(
  input: {
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    models?: string[];
  },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy & { catalogProbe?: boolean },
): Promise<Omit<ModelHealthReport, "label" | "provider">> {
  const baseUrl = assertAllowedOpenAiCompatibleUrl(input.baseUrl, opts);
  assertHttpsForKeyedOpenAiCompatibleUrl(
    baseUrl,
    input.apiKey,
    Object.keys(input.headers ?? {}).length > 0,
  );
  await verifyOpenAiCompatibleApiKey(input, fetchImpl, signal);
  const listed =
    input.models && input.models.length > 0
      ? input.models
      : await probeOpenAiCompatibleModels(
          { ...input, userAgent: MODEL_HEALTH_BROWSER_USER_AGENT },
          fetchImpl,
          signal,
          opts,
        );
  const truncated = listed.length > MAX_MODEL_HEALTH_MODELS;
  const tested = listed.slice(0, MAX_MODEL_HEALTH_MODELS);
  const safeFetch = createOpenAiCompatibleFetch(fetchImpl, undefined, {
    ...opts,
    headers: input.headers,
  });
  const queue = [...tested];
  const results: ModelHealthResult[] = [];
  const workers = Array.from(
    { length: Math.min(MODEL_HEALTH_CONCURRENCY, tested.length) },
    async () => {
      while (queue.length > 0) {
        const model = queue.shift();
        if (model === undefined) return;
        results.push(await probeOneModelHealth(safeFetch, baseUrl, input, model, signal));
      }
    },
  );
  await Promise.all(workers);
  results.sort(
    (left, right) =>
      MODEL_HEALTH_STATE_ORDER.indexOf(left.state) -
        MODEL_HEALTH_STATE_ORDER.indexOf(right.state) || left.model.localeCompare(right.model),
  );
  const summary = Object.fromEntries(
    MODEL_HEALTH_STATE_ORDER.map((state) => [
      state,
      results.filter((result) => result.state === state).length,
    ]),
  ) as ModelHealthSummary;
  return {
    total: listed.length,
    truncated,
    ok: results.filter((result) => result.state === "ok").map((result) => result.model),
    results,
    summary,
  };
}

/** What the media probe asks for; the reply only has to carry the media, not be good. */
export const MEDIA_MODEL_PROBE_PROMPTS = {
  image: "画一只猫",
  video: "生成一段猫走路的短视频",
} as const;

export type MediaModelProbeKind = "image" | "video";

export interface MediaModelProbeResult {
  /** True when the probe reply actually carried an image (or a video). */
  supported: boolean;
  /** What the probe established; `supported` is false for both other outcomes. */
  outcome: ProbeOutcome;
  /** Seconds the probe took, one decimal. */
  seconds: number;
  /** Short reason: what was found, or why it did not count as supported. */
  detail: string;
}

const MEDIA_MODEL_MAX_TOKENS = 1024;

/** One chat call to a media model; the probe and the runtime generator share it. */
export interface ChatMediaModelInput {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  apiProtocol?: ModelApiProtocol;
  authMode?: ModelAuthMode;
  model: string;
  kind: MediaModelProbeKind;
  prompt: string;
  /** Reference media for an edit; absent, the call is a fresh generation. */
  references?: MediaReference[];
}

/** A reference image as a data URL, for a chat message part. */
function referenceDataUrl(reference: MediaReference): string {
  return `data:${reference.mimeType};base64,${Buffer.from(reference.bytes).toString("base64")}`;
}

async function requestChatMedia(
  input: ChatMediaModelInput,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy,
): Promise<{ status: number; parsed: unknown; bodyText: string }> {
  const baseUrl = assertAllowedOpenAiCompatibleUrl(input.baseUrl, opts);
  assertHttpsForKeyedOpenAiCompatibleUrl(
    baseUrl,
    input.apiKey,
    Object.keys(input.headers ?? {}).length > 0,
  );
  const safeFetch = createOpenAiCompatibleFetch(fetchImpl, undefined, {
    ...opts,
    headers: input.headers,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelHealthTimeoutMs());
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": MODEL_HEALTH_BROWSER_USER_AGENT,
    };
    if (input.apiProtocol === "anthropic-messages") {
      headers["anthropic-version"] = ANTHROPIC_MESSAGES_VERSION;
    }
    const mode = effectiveAuthMode(input.authMode, input.apiProtocol);
    const key = input.apiKey?.trim();
    if (key && mode !== "none") {
      if (mode === "bearer" || mode === "both") headers.Authorization = `Bearer ${key}`;
      if (mode === "x-api-key" || mode === "both") headers["x-api-key"] = key;
    }
    const messages = [{ role: "user", content: input.prompt }];
    let url: string;
    let body: Record<string, unknown>;
    if (input.apiProtocol === "anthropic-messages") {
      url = new URL("v1/messages", `${anthropicMessagesBaseUrl(baseUrl.href)}/`).href;
      body = {
        model: input.model,
        max_tokens: MEDIA_MODEL_MAX_TOKENS,
        messages: input.references?.length
          ? [
              {
                role: "user",
                content: [
                  { type: "text", text: input.prompt },
                  ...input.references.map((reference) => ({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: reference.mimeType,
                      data: Buffer.from(reference.bytes).toString("base64"),
                    },
                  })),
                ],
              },
            ]
          : messages,
        temperature: 0,
      };
    } else if (input.apiProtocol === "responses") {
      if (input.references?.length) throw new MediaGenerationError("unsupported");
      url = new URL("responses", `${baseUrl.href}/`).href;
      body = {
        model: input.model,
        input: input.prompt,
        max_output_tokens: MEDIA_MODEL_MAX_TOKENS,
        temperature: 0,
      };
    } else {
      url = new URL("chat/completions", `${baseUrl.href}/`).href;
      body = {
        model: input.model,
        messages: input.references?.length
          ? [
              {
                role: "user",
                content: [
                  { type: "text", text: input.prompt },
                  ...input.references.map((reference) => ({
                    type: "image_url",
                    image_url: { url: referenceDataUrl(reference) },
                  })),
                ],
              },
            ]
          : messages,
        max_tokens: MEDIA_MODEL_MAX_TOKENS,
        temperature: 0,
      };
    }
    const response = await safeFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: merged,
    });
    const bodyText = await readBoundedHealthText(response);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      parsed = null;
    }
    return { status: response.status, parsed, bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Probes one model for media generation: asks it to make one small image or
 * video, then checks the reply actually carries that kind of media. A text-only
 * reply is not support, even when the model answered the prompt in words.
 */
export async function probeMediaModel(
  input: {
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    model: string;
    kind: MediaModelProbeKind;
    /** The bot's active prompt preset for this kind; the probe tests with it applied. */
    presetPrompt?: string;
  },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy,
): Promise<MediaModelProbeResult> {
  const started = Date.now();
  const seconds = () => Math.round(((Date.now() - started) / 1000) * 10) / 10;
  try {
    const { status, parsed, bodyText } = await requestChatMedia(
      {
        ...input,
        prompt: withPromptPreset(input.presetPrompt, MEDIA_MODEL_PROBE_PROMPTS[input.kind]),
      },
      fetchImpl,
      signal,
      opts,
    );
    if (status < 200 || status >= 300) {
      if (input.kind === "video" && isSyncCallRejected(status, bodyText)) {
        return probeAsyncVideo(input, fetchImpl, signal, opts, seconds);
      }
      const classified = classifyHealthResponse(status, bodyText, parsed);
      // An error status is never a verdict on the model's capability: the
      // call never reached a model that could answer.
      return {
        supported: false,
        outcome: "unknown",
        seconds: seconds(),
        detail: classified.detail,
      };
    }
    if (parsed === null) {
      return {
        supported: false,
        outcome: "unknown",
        seconds: seconds(),
        detail: "返回不是 JSON",
      };
    }
    const found = extractMediaFromReply(parsed, input.kind) !== null;
    if (found) {
      return {
        supported: true,
        outcome: "supported",
        seconds: seconds(),
        detail: input.kind === "image" ? "返回了图片" : "返回了视频",
      };
    }
    return {
      supported: false,
      outcome: "unsupported",
      seconds: seconds(),
      detail: input.kind === "image" ? "只回了文字，没有图片" : "只回了文字，没有视频",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isAbortError(error)) {
      return { supported: false, outcome: "unknown", seconds: seconds(), detail: "请求超时" };
    }
    const message = error instanceof Error ? error.message : "";
    return {
      supported: false,
      outcome: "unknown",
      seconds: seconds(),
      detail: message ? healthDetail(`网络错误：${message}`, 120) : "网络错误",
    };
  }
}

/**
 * Asks a chat model to generate one image or video and returns the bytes it
 * produced. The reply must carry the media; a text-only reply is a failure,
 * not a result. Remote URLs are downloaded through the SSRF-safe fetch and
 * capped at the attachment limit.
 */
export interface AsyncVideoConnection {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  apiProtocol?: ModelApiProtocol;
  authMode?: ModelAuthMode;
  model: string;
}

export type AsyncVideoPollStatus = "queued" | "running" | "completed" | "failed";

/**
 * Whether a failed synchronous media call was refused because the model needs
 * an async submission: the upstream error says the model does not support a
 * synchronous call. Only video models go async; an image model keeps the error.
 */
function isSyncCallRejected(status: number, bodyText: string): boolean {
  if (status < 400 || status >= 500) return false;
  return /sync/i.test(healthErrorMessage(bodyText));
}

async function requestAsyncVideo(
  input: AsyncVideoConnection,
  path: string,
  method: "GET" | "POST",
  body: Record<string, unknown> | undefined,
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal | undefined,
  opts: OpenAiCompatibleUrlPolicy | undefined,
): Promise<{ status: number; parsed: unknown; bodyText: string }> {
  const baseUrl = assertAllowedOpenAiCompatibleUrl(input.baseUrl, opts);
  assertHttpsForKeyedOpenAiCompatibleUrl(
    baseUrl,
    input.apiKey,
    Object.keys(input.headers ?? {}).length > 0,
  );
  const safeFetch = createOpenAiCompatibleFetch(fetchImpl, undefined, {
    ...opts,
    headers: input.headers,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelHealthTimeoutMs());
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": MODEL_HEALTH_BROWSER_USER_AGENT,
    };
    const mode = effectiveAuthMode(input.authMode, input.apiProtocol);
    const key = input.apiKey?.trim();
    if (key && mode !== "none") {
      if (mode === "bearer" || mode === "both") headers.Authorization = `Bearer ${key}`;
      if (mode === "x-api-key" || mode === "both") headers["x-api-key"] = key;
    }
    const url = new URL(path, `${baseUrl.href}/`).href;
    const response = await safeFetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: merged,
    });
    const bodyText = await readBoundedHealthText(response);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      parsed = null;
    }
    return { status: response.status, parsed, bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

function asyncVideoError(status: number): MediaGenerationError {
  if (status === 401 || status === 403) return new MediaGenerationError("authentication");
  if (status === 429) return new MediaGenerationError("rate_limit");
  return new MediaGenerationError("provider_failure");
}

/**
 * Submits a video generation task to an OpenAI-compatible connection's async
 * video endpoint and returns the task id. The video itself arrives later, via
 * pollAsyncVideo; a submit that succeeds has already started (and, on a
 * per-generation provider, billed) a video.
 */
export async function submitAsyncVideo(
  input: AsyncVideoConnection & { prompt: string; firstFrame?: MediaReference },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy,
): Promise<{ taskId: string }> {
  const { status, parsed } = await requestAsyncVideo(
    input,
    "videos/generations",
    "POST",
    {
      model: input.model,
      prompt: input.prompt,
      // A reference frame for an edit, as a data URL; the endpoint decides
      // whether it honors it. Only the first frame is sent: the last frame
      // needs server-side extraction, which is not available yet.
      ...(input.firstFrame
        ? {
            image_url: `data:${input.firstFrame.mimeType};base64,${Buffer.from(input.firstFrame.bytes).toString("base64")}`,
          }
        : {}),
    },
    fetchImpl,
    signal,
    opts,
  );
  if (status < 200 || status >= 300) throw asyncVideoError(status);
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const taskId = typeof record.id === "string" ? record.id : "";
  if (!taskId) throw new MediaGenerationError("provider_failure");
  return { taskId };
}

/**
 * Checks one submitted async video task. A task still working reports running;
 * a finished one reports completed with the video URL to download; a failed
 * one reports failed with an error string in our own format (the model plus
 * a provider failure; the documented async-result fields carry no failure
 * reason). An unexpected result shape is a provider failure, not a status
 * to keep polling.
 */
export async function pollAsyncVideo(
  input: AsyncVideoConnection & { taskId: string },
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy,
): Promise<{ status: AsyncVideoPollStatus; url?: string; error?: string }> {
  const { status, parsed } = await requestAsyncVideo(
    input,
    `async-result/${encodeURIComponent(input.taskId)}`,
    "GET",
    undefined,
    fetchImpl,
    signal,
    opts,
  );
  if (status < 200 || status >= 300) throw asyncVideoError(status);
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const taskStatus = typeof record.task_status === "string" ? record.task_status.toUpperCase() : "";
  if (taskStatus === "SUCCESS") {
    const results = Array.isArray(record.video_result) ? record.video_result : [];
    const first =
      results.length > 0 && typeof results[0] === "object" && results[0] !== null
        ? (results[0] as Record<string, unknown>)
        : {};
    const url = typeof first.url === "string" ? first.url : "";
    if (!url) throw new MediaGenerationError("provider_failure");
    return { status: "completed", url };
  }
  if (taskStatus === "FAIL" || taskStatus === "FAILED") {
    // The documented async-result fields carry no failure reason (only
    // task_status / video_result), so the reason is the model plus a
    // provider failure; the summary renders "<model> 服务异常". If a real
    // FAIL body ever shows a reason field, map it here and nowhere else.
    return {
      status: "failed",
      error: new MediaGenerationError("provider_failure", `${input.model} (provider error)`)
        .message,
    };
  }
  if (taskStatus) return { status: "running" };
  throw new MediaGenerationError("provider_failure");
}

/** Downloads a finished async video by URL, through the SSRF-safe fetch. */
export async function downloadAsyncVideoUrl(
  url: string,
  signal?: AbortSignal,
): Promise<GeneratedMedia> {
  return materializeMediaReference({ kind: "url", url }, "video", "video/mp4", signal);
}

/**
 * Probes a video model through its async endpoint: submits the probe video,
 * then checks briefly. A task the endpoint accepts proves the model supports
 * async video even when it is still generating when the probe window ends;
 * the submission itself starts (and bills, where billed per generation) a
 * real short video, like the image probe's real generation.
 */
async function probeAsyncVideo(
  input: {
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
    apiProtocol?: ModelApiProtocol;
    authMode?: ModelAuthMode;
    model: string;
    kind: MediaModelProbeKind;
    presetPrompt?: string;
  },
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal | undefined,
  opts: OpenAiCompatibleUrlPolicy | undefined,
  seconds: () => number,
): Promise<MediaModelProbeResult> {
  const prompt = withPromptPreset(input.presetPrompt, MEDIA_MODEL_PROBE_PROMPTS.video);
  let taskId: string;
  try {
    ({ taskId } = await submitAsyncVideo({ ...input, prompt }, fetchImpl, signal, opts));
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof MediaGenerationError) {
      return { ...asyncVideoProbeResult(error), seconds: seconds() };
    }
    throw error;
  }
  const deadline = AbortSignal.timeout(modelHealthTimeoutMs());
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (;;) {
    if (stop.aborted) {
      return {
        supported: true,
        outcome: "supported",
        seconds: seconds(),
        detail: "任务已提交，正在生成",
      };
    }
    try {
      const polled = await pollAsyncVideo({ ...input, taskId }, fetchImpl, stop, opts);
      if (polled.status === "completed") {
        return { supported: true, outcome: "supported", seconds: seconds(), detail: "返回了视频" };
      }
      if (polled.status === "failed") {
        // The task was accepted, so the model takes video work; the
        // generation itself failed — not a verdict on capability.
        return {
          supported: false,
          outcome: "unknown",
          seconds: seconds(),
          detail: "视频生成失败",
        };
      }
    } catch (error) {
      if (stop.aborted) {
        return {
          supported: true,
          outcome: "supported",
          seconds: seconds(),
          detail: "任务已提交，正在生成",
        };
      }
      if (error instanceof MediaGenerationError) {
        return { ...asyncVideoProbeResult(error), seconds: seconds() };
      }
      throw error;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      stop.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

/**
 * A failed async-video submission, classified like the sync probe: only an
 * explicit unsupported verdict counts as unsupported; anything upstream or
 * transient is unknown.
 */
function asyncVideoProbeResult(error: MediaGenerationError): {
  supported: false;
  outcome: ProbeOutcome;
  detail: string;
} {
  if (error.code === "unsupported") {
    return { supported: false, outcome: "unsupported", detail: "不支持视频生成" };
  }
  switch (error.code) {
    case "authentication":
      return { supported: false, outcome: "unknown", detail: "认证失败" };
    case "rate_limit":
      return { supported: false, outcome: "unknown", detail: "限流" };
    case "timeout":
      return { supported: false, outcome: "unknown", detail: "请求超时" };
    default:
      return { supported: false, outcome: "unknown", detail: "上游服务错误" };
  }
}

/**
 * Asks a chat model to generate one image or video and returns the bytes it
 * produced. The reply must carry the media; a text-only reply is a failure,
 * not a result. Remote URLs are downloaded through the SSRF-safe fetch and
 * capped at the attachment limit.
 */
/**
 * Model families that only generate from text and take no image input. They
 * are named here, in the adapter, so an edit call never reaches them: sent
 * an image anyway, such a model would silently return a fresh image instead
 * of editing the one given. Matched by model id so it holds behind relays
 * that hide the upstream host.
 */
const TEXT_TO_IMAGE_ONLY_MODEL_PATTERN = /^(cogview-|glm-image(-|$))/i;
function isTextToImageOnlyModel(modelId: string): boolean {
  return TEXT_TO_IMAGE_ONLY_MODEL_PATTERN.test(modelId.trim());
}

export async function generateMediaWithChatModel(
  input: ChatMediaModelInput,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  opts?: OpenAiCompatibleUrlPolicy,
): Promise<GeneratedMedia> {
  // An edit sends the original image as input; a text-to-image-only model
  // cannot take it, so fail fast here instead of silently re-randomizing.
  // The chain records it as a failed attempt and tries the next edit model.
  if (input.references?.length && isTextToImageOnlyModel(input.model)) {
    throw new MediaGenerationError("unsupported");
  }
  const mimeType = input.kind === "image" ? "image/png" : "video/mp4";
  try {
    const { status, parsed, bodyText } = await requestChatMedia(input, fetchImpl, signal, opts);
    if (status === 401 || status === 403) throw new MediaGenerationError("authentication");
    if (status === 429) throw new MediaGenerationError("rate_limit");
    if (input.kind === "video" && isSyncCallRejected(status, bodyText))
      throw new MediaGenerationError("async_required");
    if (status < 200 || status >= 300) throw new MediaGenerationError("provider_failure");
    const reference = parsed === null ? null : extractMediaFromReply(parsed, input.kind);
    if (!reference) throw new MediaGenerationError("provider_failure");
    return await materializeMediaReference(reference, input.kind, mimeType, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof MediaGenerationError) throw error;
    // The caller's signal is untouched here, so an abort is the probe's own
    // timeout, not a cancellation.
    if (isAbortError(error)) throw new MediaGenerationError("timeout");
    throw new MediaGenerationError("provider_failure");
  }
}

async function materializeMediaReference(
  reference: ReplyMediaReference,
  kind: MediaModelProbeKind,
  mimeType: GeneratedMedia["mimeType"],
  signal?: AbortSignal,
): Promise<GeneratedMedia> {
  if (reference.kind === "dataUri" || reference.kind === "b64") {
    const bytes = Buffer.from(reference.data, "base64");
    if (!bytes.byteLength) throw new MediaGenerationError("provider_failure");
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new MediaGenerationError("output_limit");
    return { bytes, mimeType };
  }
  const downloaded = await fetchSafeWebBytes(reference.url, {
    maxBytes: ATTACHMENT_MAX_BYTES,
    signal,
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new MediaGenerationError("provider_failure");
  });
  const contentType = downloaded.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType && !contentType.startsWith(kind === "image" ? "image/" : "video/")) {
    throw new MediaGenerationError("provider_failure");
  }
  if (!downloaded.body.byteLength) throw new MediaGenerationError("provider_failure");
  return { bytes: downloaded.body, mimeType };
}

/** A media payload found in a chat reply: inline bytes or a URL to download. */
export type ReplyMediaReference =
  | { kind: "dataUri"; mimeType: string; data: string }
  | { kind: "b64"; data: string }
  | { kind: "url"; url: string };

const MEDIA_DATA_URI_PATTERN = /data:(image|video)\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/;
const MEDIA_IMAGE_URL_PATTERN = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|avif)(?:[?#]\S*)?/i;
const MEDIA_IMAGE_MARKDOWN_PATTERN = /!\[[^\]]*\]\(([^)\s]+)\)/;
const MEDIA_VIDEO_URL_PATTERN = /https?:\/\/\S+\.(?:mp4|webm|mov|m3u8|avi|mkv)(?:[?#]\S*)?/i;
const MEDIA_HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>)]+/;
const MEDIA_IMAGE_TYPES = new Set([
  "image_url",
  "input_image",
  "output_image",
  "image",
  "image_generation_call",
]);
const MEDIA_VIDEO_TYPES = new Set(["video_url", "video", "output_video", "video_generation_call"]);

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** The media a string carries for the requested kind, if it carries any. */
function mediaReferenceFromString(
  value: string,
  kind: MediaModelProbeKind,
): ReplyMediaReference | null {
  const data = MEDIA_DATA_URI_PATTERN.exec(value);
  if (data) {
    const mediaKind = data[1];
    const subtype = data[2];
    const payload = data[3];
    if (mediaKind && subtype && payload && (kind === "image") === (mediaKind === "image")) {
      return { kind: "dataUri", mimeType: `${mediaKind}/${subtype}`, data: payload };
    }
  }
  if (kind === "image") {
    const markdown = MEDIA_IMAGE_MARKDOWN_PATTERN.exec(value);
    if (markdown?.[1]) {
      const target = markdown[1];
      const embedded = target.startsWith("data:image/")
        ? MEDIA_DATA_URI_PATTERN.exec(target)
        : null;
      if (embedded) {
        const mediaKind = embedded[1];
        const subtype = embedded[2];
        const payload = embedded[3];
        if (mediaKind && subtype && payload) {
          return { kind: "dataUri", mimeType: `${mediaKind}/${subtype}`, data: payload };
        }
      }
      if (isHttpUrl(target)) return { kind: "url", url: target };
    }
    const url = MEDIA_IMAGE_URL_PATTERN.exec(value);
    if (url) return { kind: "url", url: url[0] };
    return null;
  }
  const url = MEDIA_VIDEO_URL_PATTERN.exec(value);
  if (url) return { kind: "url", url: url[0] };
  if (value.includes("video_url")) {
    const any = MEDIA_HTTP_URL_PATTERN.exec(value);
    if (any) return { kind: "url", url: any[0] };
  }
  return null;
}

/**
 * Walks a chat reply for media of the requested kind and returns the first
 * usable payload: typed content parts (image_url, image blocks, generated-image
 * output) and inline media the chat renders (data URIs, markdown images, media
 * URLs). A plain text reply, even one that talks about an image, carries none.
 */
export function extractMediaFromReply(
  body: unknown,
  kind: MediaModelProbeKind,
): ReplyMediaReference | null {
  const stack: unknown[] = [body];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      const found = mediaReferenceFromString(value, kind);
      if (found) return found;
      continue;
    }
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";
      if (kind === "image") {
        if (typeof record.b64_json === "string" && record.b64_json.length > 0) {
          return { kind: "b64", data: record.b64_json };
        }
        const imageUrl = record.image_url;
        if (typeof imageUrl === "string") {
          const found =
            mediaReferenceFromString(imageUrl, kind) ??
            (isHttpUrl(imageUrl) ? { kind: "url", url: imageUrl } : null);
          if (found) return found;
        } else if (imageUrl !== null && typeof imageUrl === "object") {
          const url = (imageUrl as Record<string, unknown>).url;
          if (typeof url === "string") {
            const found =
              mediaReferenceFromString(url, kind) ?? (isHttpUrl(url) ? { kind: "url", url } : null);
            if (found) return found;
          }
        }
        if (
          MEDIA_IMAGE_TYPES.has(type) &&
          typeof record.url === "string" &&
          isHttpUrl(record.url)
        ) {
          return { kind: "url", url: record.url };
        }
      } else {
        const videoUrl = record.video_url;
        if (typeof videoUrl === "string" && isHttpUrl(videoUrl)) {
          return { kind: "url", url: videoUrl };
        }
        if (videoUrl !== null && typeof videoUrl === "object") {
          const url = (videoUrl as Record<string, unknown>).url;
          if (typeof url === "string" && isHttpUrl(url)) return { kind: "url", url };
        }
        if (
          MEDIA_VIDEO_TYPES.has(type) &&
          typeof record.url === "string" &&
          isHttpUrl(record.url)
        ) {
          return { kind: "url", url: record.url };
        }
      }
      stack.push(...Object.values(record));
    }
  }
  return null;
}
