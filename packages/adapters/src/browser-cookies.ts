import type { BrowserCookie } from "@rakazo_mickvvw/adapter-kit";

/**
 * Browser cookies a person exports from their own browser and saves in the vault, so the bot's
 * browser opens a site already signed in. Values here are only ever the test fixtures'
 * `"test-value"`; a real person's cookies never reach this module's tests or logs.
 */

/** Raw pasted export content is capped before parsing, so a mistaken paste cannot grow the store. */
export const BROWSER_COOKIE_IMPORT_MAX_BYTES = 65_536;
/** How many cookies one site's import may hold. */
export const BROWSER_COOKIE_MAX_COUNT = 200;
/** One cookie's value is capped, so a single runaway field cannot eat the whole import. */
export const BROWSER_COOKIE_VALUE_MAX_LENGTH = 8192;

export type BrowserCookieSkipReason = "域名不符" | "已过期" | "格式不对" | "数量上限" | "值过长";

export interface BrowserCookieImport {
  cookies: BrowserCookie[];
  imported: number;
  skipped: Array<{ reason: BrowserCookieSkipReason; count: number }>;
  earliestExpiry: number | null;
}

export type BrowserCookieImportResult =
  | ({ ok: true } & BrowserCookieImport)
  | { ok: false; error: string };

/** The earliest expiry among cookies that have one, or null when none expires. */
export function earliestExpiry(cookies: readonly BrowserCookie[]): number | null {
  let earliest: number | null = null;
  for (const cookie of cookies) {
    if (cookie.expires === undefined) continue;
    if (earliest === null || cookie.expires < earliest) earliest = cookie.expires;
  }
  return earliest;
}

function percentEncoded(value: string): string | undefined {
  try {
    return encodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Redaction forms of cookie values, so a page echoing one is scrubbed from results. */
export function browserCookieRedactions(cookies: readonly BrowserCookie[]): string[] {
  const forms = new Set<string>();
  for (const cookie of cookies) {
    if (!cookie.value) continue;
    forms.add(cookie.value);
    const encoded = percentEncoded(cookie.value);
    if (encoded !== undefined && encoded !== cookie.value) forms.add(encoded);
  }
  return [...forms];
}

/**
 * Whether a cookie's domain covers a host, RFC 6265: a leading dot (or an explicit domain
 * cookie) matches the host itself and its subdomains; without one it is host-only and must
 * match exactly. `evil-example.com` never matches `example.com`.
 */
export function cookieDomainMatches(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.toLowerCase();
  const target = host.toLowerCase();
  if (!domain || !target) return false;
  if (domain.startsWith(".")) {
    const bare = domain.slice(1);
    return target === bare || target.endsWith(domain);
  }
  return target === domain;
}

/** Whether a request path may receive a cookie set for `cookiePath`, RFC 6265 path-match. */
export function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith("/")) return true;
  return requestPath.length === cookiePath.length || requestPath[cookiePath.length] === "/";
}

/**
 * The cookies a navigation to `url` may receive: unexpired, domain- and path-matching, and a
 * secure cookie only over HTTPS.
 */
export function filterCookiesForNavigation(
  cookies: readonly BrowserCookie[],
  url: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): BrowserCookie[] {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return [];
  }
  const requestPath = target.pathname || "/";
  return cookies.filter(
    (cookie) =>
      (cookie.expires === undefined || cookie.expires > nowSeconds) &&
      cookieDomainMatches(cookie.domain, target.hostname) &&
      cookiePathMatches(cookie.path, requestPath) &&
      (!cookie.secure || target.protocol === "https:"),
  );
}

function normalizeSameSite(value: unknown): BrowserCookie["sameSite"] | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "lax":
      return "Lax";
    case "strict":
      return "Strict";
    case "none":
    case "no_restriction":
      return "None";
    default:
      return undefined;
  }
}

function normalizeDomain(domain: string, hostOnly: boolean | undefined): string {
  const lowered = domain.trim().toLowerCase();
  if (hostOnly === true) return lowered.replace(/^\./, "");
  if (hostOnly === false && !lowered.startsWith(".")) return `.${lowered}`;
  return lowered;
}

type RawCookie = {
  name: unknown;
  value: unknown;
  domain: unknown;
  path?: unknown;
  secure?: unknown;
  httpOnly?: unknown;
  sameSite?: unknown;
  expirationDate?: unknown;
  expires?: unknown;
  session?: unknown;
  hostOnly?: unknown;
};

function normalizeCookie(
  raw: RawCookie,
  nowSeconds: number,
): { cookie: BrowserCookie } | { skip: BrowserCookieSkipReason } {
  if (
    typeof raw.name !== "string" ||
    raw.name.length === 0 ||
    typeof raw.value !== "string" ||
    typeof raw.domain !== "string" ||
    raw.domain.length === 0
  )
    return { skip: "格式不对" };
  if (raw.value.length > BROWSER_COOKIE_VALUE_MAX_LENGTH) return { skip: "值过长" };
  const hostOnly = typeof raw.hostOnly === "boolean" ? raw.hostOnly : undefined;
  const domain = normalizeDomain(raw.domain, hostOnly);
  if (!domain || domain === ".") return { skip: "格式不对" };
  const expiresRaw =
    typeof raw.expirationDate === "number"
      ? raw.expirationDate
      : typeof raw.expires === "number"
        ? raw.expires
        : undefined;
  const session = raw.session === true;
  const expires = session || expiresRaw === undefined ? undefined : Math.floor(expiresRaw);
  if (expires !== undefined && !(expires > 0)) return { skip: "格式不对" };
  if (expires !== undefined && expires <= nowSeconds) return { skip: "已过期" };
  const sameSite = normalizeSameSite(raw.sameSite);
  return {
    cookie: {
      name: raw.name,
      value: raw.value,
      domain,
      path: typeof raw.path === "string" && raw.path.startsWith("/") ? raw.path : "/",
      secure: raw.secure === true,
      httpOnly: raw.httpOnly === true,
      ...(sameSite ? { sameSite } : {}),
      ...(expires !== undefined ? { expires } : {}),
    },
  };
}

function parseJsonExport(
  content: string,
  nowSeconds: number,
): { cookies: BrowserCookie[]; skipped: BrowserCookieSkipReason[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return { error: "Cookie 内容不是有效的 JSON" };
  }
  if (!Array.isArray(parsed)) return { error: "Cookie JSON 应该是一个数组" };
  const cookies: BrowserCookie[] = [];
  const skipped: BrowserCookieSkipReason[] = [];
  for (const entry of parsed) {
    if (cookies.length >= BROWSER_COOKIE_MAX_COUNT) {
      skipped.push("数量上限");
      continue;
    }
    if (typeof entry !== "object" || entry === null) {
      skipped.push("格式不对");
      continue;
    }
    const normalized = normalizeCookie(entry as RawCookie, nowSeconds);
    if ("skip" in normalized) skipped.push(normalized.skip);
    else cookies.push(normalized.cookie);
  }
  return { cookies, skipped };
}

function splitNetscapeLine(line: string): string[] | undefined {
  const tabbed = line.split("\t");
  if (tabbed.length >= 7) {
    // The value is the rest of the line: a Tab inside a value must not split the row.
    return [...tabbed.slice(0, 6), tabbed.slice(6).join("\t")];
  }
  const spaced = line.split(/\s+/);
  if (spaced.length < 7) return undefined;
  return [...spaced.slice(0, 6), spaced.slice(6).join(" ")];
}

function parseNetscapeExport(
  content: string,
  nowSeconds: number,
): { cookies: BrowserCookie[]; skipped: BrowserCookieSkipReason[] } {
  const cookies: BrowserCookie[] = [];
  const skipped: BrowserCookieSkipReason[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let httpOnly = false;
    let body = line;
    if (body.startsWith("#HttpOnly_")) {
      httpOnly = true;
      body = body.slice("#HttpOnly_".length);
    } else if (body.startsWith("#")) {
      continue;
    }
    const fields = splitNetscapeLine(body);
    if (!fields) {
      skipped.push("格式不对");
      continue;
    }
    const [domain, flag, path, secure, expiration, name, value] = fields;
    const expires = Number(expiration);
    if (cookies.length >= BROWSER_COOKIE_MAX_COUNT) {
      skipped.push("数量上限");
      continue;
    }
    const normalized = normalizeCookie(
      {
        name,
        value,
        domain,
        path,
        secure: secure === "TRUE",
        httpOnly,
        expires: Number.isFinite(expires) && expires > 0 ? expires : undefined,
        session: expires === 0,
        hostOnly: flag === "TRUE" ? false : flag === "FALSE" ? true : undefined,
      },
      nowSeconds,
    );
    if ("skip" in normalized) skipped.push(normalized.skip);
    else cookies.push(normalized.cookie);
  }
  return { cookies, skipped };
}

/**
 * Parse a pasted cookie export (JSON array or Netscape cookies.txt) into normalized cookies.
 * Bad entries are skipped one by one with a reason; a malformed whole file is an error.
 */
export function parseCookieExport(
  content: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { cookies: BrowserCookie[]; skipped: BrowserCookieSkipReason[] } | { error: string } {
  if (!content.trim()) return { error: "Cookie 内容是空的" };
  if (content.length > BROWSER_COOKIE_IMPORT_MAX_BYTES) return { error: "Cookie 内容超过 64 KB" };
  const trimmed = content.trimStart();
  // JSON-looking content goes to the JSON parser so a malformed paste gets a clear error
  // instead of silently falling through to the line parser.
  return trimmed.startsWith("[") || trimmed.startsWith("{")
    ? parseJsonExport(content, nowSeconds)
    : parseNetscapeExport(content, nowSeconds);
}

/**
 * The full import for one site: parse, keep only cookies whose domain covers the site, and
 * summarize what was imported and what was skipped, and why.
 */
export function importBrowserCookies(input: {
  content: string;
  origin: string;
  nowSeconds?: number;
}): BrowserCookieImportResult {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  let originHost: string;
  try {
    const origin = new URL(input.origin);
    if (origin.protocol !== "https:") return { ok: false, error: "网站地址必须是 HTTPS" };
    originHost = origin.hostname;
  } catch {
    return { ok: false, error: "网站地址不对" };
  }
  const parsed = parseCookieExport(input.content, nowSeconds);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const cookies: BrowserCookie[] = [];
  const skipped: BrowserCookieSkipReason[] = [...parsed.skipped];
  for (const cookie of parsed.cookies) {
    if (!cookieDomainMatches(cookie.domain, originHost)) {
      skipped.push("域名不符");
      continue;
    }
    cookies.push(cookie);
  }
  if (cookies.length === 0 && skipped.length === 0) {
    return { ok: false, error: "没有找到 Cookie" };
  }
  const byReason = new Map<BrowserCookieSkipReason, number>();
  for (const reason of skipped) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  return {
    ok: true,
    cookies,
    imported: cookies.length,
    skipped: [...byReason.entries()].map(([reason, count]) => ({ reason, count })),
    earliestExpiry: earliestExpiry(cookies),
  };
}

/** The encrypted value: a versioned JSON envelope holding the cookie list. */
export function encodeBrowserCookieSet(cookies: readonly BrowserCookie[]): string {
  return JSON.stringify({ v: 1, cookies });
}

/** Decode a stored cookie set. Throws without naming the value when the shape is wrong. */
export function decodeBrowserCookieSet(plaintext: string): BrowserCookie[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    throw new Error("Invalid browser cookies");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    !Array.isArray((parsed as { cookies?: unknown }).cookies)
  )
    throw new Error("Invalid browser cookies");
  const cookies: BrowserCookie[] = [];
  for (const entry of (parsed as { cookies: unknown[] }).cookies) {
    if (typeof entry !== "object" || entry === null) throw new Error("Invalid browser cookies");
    const raw = entry as RawCookie;
    if (
      typeof raw.name !== "string" ||
      typeof raw.value !== "string" ||
      typeof raw.domain !== "string" ||
      typeof raw.path !== "string" ||
      typeof raw.secure !== "boolean" ||
      typeof raw.httpOnly !== "boolean" ||
      (raw.sameSite !== undefined &&
        raw.sameSite !== "None" &&
        raw.sameSite !== "Lax" &&
        raw.sameSite !== "Strict") ||
      (raw.expires !== undefined && typeof raw.expires !== "number")
    )
      throw new Error("Invalid browser cookies");
    cookies.push({
      name: raw.name,
      value: raw.value,
      domain: raw.domain,
      path: raw.path,
      secure: raw.secure,
      httpOnly: raw.httpOnly,
      ...(raw.sameSite ? { sameSite: raw.sameSite as BrowserCookie["sameSite"] } : {}),
      ...(raw.expires !== undefined ? { expires: raw.expires } : {}),
    });
  }
  return cookies;
}
