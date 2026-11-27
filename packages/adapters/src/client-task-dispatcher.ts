import { lookup } from "node:dns/promises";
import type { RealtimeFanout } from "@rakazo_mickvvw/adapter-kit";
import {
  ipVersion,
  isCloudMetadataHost,
  isInternalHostname,
  isNonPublicAddress,
  normalizeHost,
} from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { clientTaskResultTopic, clientTaskTopic, isClientPresent } from "@rakazo_mickvvw/db";

/** What the phone sends back for one fetched page. */
export type ClientFetchResult = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  error?: string;
};

/** Why a fetch fell back to the server browser instead of the phone. */
export type ClientTaskFallbackReason =
  | "disabled"
  | "offline"
  | "timeout"
  | "declined"
  | "rate-limited"
  | "ssrf-denied"
  | "busy"
  | "failed";

/**
 * The phone could not or would not fetch the page; the caller falls back to
 * the server browser. `reason` names why, so the provider never has to parse
 * the message.
 */
export class ClientTaskFallbackError extends Error {
  constructor(
    public readonly reason: ClientTaskFallbackReason,
    message?: string,
  ) {
    super(message ?? `Client task fell back: ${reason}`);
    this.name = "ClientTaskFallback";
  }
}

export interface ClientTaskDispatcherDeps {
  prisma: PrismaClient;
  realtime?: RealtimeFanout;
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** One in-flight task per user: the phone runs a single hidden WebView. */
const MAX_CONCURRENT_TASKS = 1;
/** Dispatches per user per hour, so a runaway run cannot spam the phone. */
const MAX_DISPATCHES_PER_HOUR = 10;
/** How often the wait re-reads the task row when no fanout signal arrives. */
const POLL_MS = 1_000;

function fallback(reason: ClientTaskFallbackReason, message: string): ClientTaskFallbackError {
  return new ClientTaskFallbackError(reason, `Client task fell back: ${reason} (${message})`);
}

/**
 * The server-side SSRF check for a URL the phone would fetch. The phone sits
 * on the user's home network, where its WebView can reach the LAN, so a
 * private destination is refused here, before anything is dispatched.
 * HTTPS only, no userinfo, and every resolved address must be public.
 */
async function assertSafeClientTaskUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw fallback("ssrf-denied", "that URL is not valid");
  }
  if (url.protocol !== "https:") {
    throw fallback("ssrf-denied", "client tasks only fetch HTTPS URLs");
  }
  if (url.username || url.password) {
    throw fallback("ssrf-denied", "the URL must not contain credentials");
  }
  const hostname = normalizeHost(url.hostname);
  if (isCloudMetadataHost(hostname) || isInternalHostname(hostname)) {
    throw fallback("ssrf-denied", `${hostname} is not a public host`);
  }
  if (ipVersion(hostname) !== 0) {
    if (isNonPublicAddress(hostname)) {
      throw fallback("ssrf-denied", `${hostname} is not a public address`);
    }
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw fallback("ssrf-denied", `${hostname} could not be resolved`);
  }
  if (addresses.length === 0 || addresses.some((entry) => isNonPublicAddress(entry.address))) {
    throw fallback("ssrf-denied", `${hostname} resolves to a non-public address`);
  }
  return url;
}

function resultFromRow(row: { result: unknown }, url: string): ClientFetchResult {
  const result =
    row.result && typeof row.result === "object" ? (row.result as Record<string, unknown>) : {};
  return {
    url: typeof result.url === "string" ? result.url : url,
    title: typeof result.title === "string" ? result.title : "",
    text: typeof result.text === "string" ? result.text : "",
    truncated: result.truncated === true,
    ...(typeof result.error === "string" ? { error: result.error } : {}),
  };
}

/**
 * Dispatches one page fetch to the signed-in user's phone and awaits its
 * result. Any failure is a `ClientTaskFallbackError`: the caller falls back
 * to the server browser, never to the user.
 */
export class ClientTaskDispatcher {
  constructor(private readonly deps: ClientTaskDispatcherDeps) {}

  async fetchPage(input: {
    userId: string;
    spaceId: string;
    botId: string;
    runId: string;
    url: string;
    timeoutMs?: number;
  }): Promise<ClientFetchResult> {
    const { prisma, realtime } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const preference = await prisma.clientTaskPreference.findUnique({
      where: { userId: input.userId },
      select: { localTrafficEnabled: true },
    });
    if (!preference?.localTrafficEnabled) {
      throw fallback("disabled", "local traffic is off for this user");
    }
    if (!(await isClientPresent(prisma, input.userId, now))) {
      throw fallback("offline", "the phone is not connected");
    }
    const url = await assertSafeClientTaskUrl(input.url);

    const [concurrent, recent] = await Promise.all([
      prisma.clientTask.count({
        where: { userId: input.userId, status: { in: ["pending", "dispatched"] } },
      }),
      prisma.clientTask.count({
        where: {
          userId: input.userId,
          createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1_000) },
        },
      }),
    ]);
    if (concurrent >= MAX_CONCURRENT_TASKS) {
      throw fallback("busy", "the phone is already fetching a page");
    }
    if (recent >= MAX_DISPATCHES_PER_HOUR) {
      throw fallback("rate-limited", "too many client fetches this hour");
    }

    const task = await prisma.clientTask.create({
      data: {
        userId: input.userId,
        spaceId: input.spaceId,
        botId: input.botId,
        runId: input.runId,
        kind: "fetch",
        url: url.href,
        status: "pending",
        expiresAt: new Date(now.getTime() + timeoutMs),
      },
      select: { id: true },
    });
    // The signal only wakes the phone; the pending row is the source of
    // truth, so a lost publish still lands on the next subscribe re-read.
    await realtime?.publish(clientTaskTopic(input.userId), task.id).catch(() => undefined);

    const deadline = Date.now() + timeoutMs;
    let wake: (() => void) | undefined;
    const unsubscribe = realtime
      ? await realtime
          .subscribe(clientTaskResultTopic(task.id), () => wake?.())
          .catch(() => async () => {})
      : async () => {};
    try {
      while (true) {
        const row = await prisma.clientTask.findUnique({
          where: { id: task.id },
          select: { status: true, result: true },
        });
        if (row?.status === "completed") return resultFromRow(row, url.href);
        if (row?.status === "failed") {
          const result = resultFromRow(row, url.href);
          throw fallback("failed", result.error ?? "the phone could not fetch the page");
        }
        if (row?.status === "declined") {
          throw fallback("declined", "the phone declined the fetch");
        }
        if (row?.status === "expired" || !row) {
          throw fallback("timeout", "the fetch expired before the phone answered");
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (wake === finish) wake = undefined;
            resolve();
          };
          const timer = setTimeout(finish, Math.min(remaining, POLL_MS));
          wake = finish;
        });
      }
    } finally {
      await unsubscribe();
    }
    await prisma.clientTask
      .updateMany({
        where: { id: task.id, status: "pending" },
        data: { status: "expired", completedAt: new Date() },
      })
      .catch(() => undefined);
    throw fallback("timeout", "the phone did not answer in time");
  }
}
