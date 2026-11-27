import { describe, expect, it } from "vitest";
import {
  BROWSER_COOKIE_MAX_COUNT,
  cookieDomainMatches,
  cookiePathMatches,
  decodeBrowserCookieSet,
  earliestExpiry,
  encodeBrowserCookieSet,
  filterCookiesForNavigation,
  importBrowserCookies,
  parseCookieExport,
} from "./browser-cookies.js";

/** Every value below is fake: example.com and "test-value" only, never a real cookie. */
const NOW = 1_800_000_000;

function jsonCookie(overrides: Record<string, unknown> = {}) {
  return {
    name: "sessionid",
    value: "test-value",
    domain: "example.com",
    path: "/",
    expirationDate: 1_900_000_000,
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    ...overrides,
  };
}

describe("parseCookieExport (JSON)", () => {
  it("parses a Cookie-Editor array and normalizes sameSite", () => {
    const parsed = parseCookieExport(JSON.stringify([jsonCookie()]), NOW);
    expect(parsed).toEqual({
      cookies: [
        {
          name: "sessionid",
          value: "test-value",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
          expires: 1_900_000_000,
        },
      ],
      skipped: [],
    });
  });

  it("maps every sameSite spelling, and drops unspecified", () => {
    const parsed = parseCookieExport(
      JSON.stringify([
        jsonCookie({ name: "a", sameSite: "no_restriction" }),
        jsonCookie({ name: "b", sameSite: "strict" }),
        jsonCookie({ name: "c", sameSite: "unspecified" }),
        jsonCookie({ name: "d", sameSite: "bogus" }),
      ]),
      NOW,
    );
    if ("error" in parsed) throw new Error("unexpected parse error");
    expect(parsed.cookies.map((cookie) => cookie.sameSite)).toEqual([
      "None",
      "Strict",
      undefined,
      undefined,
    ]);
    expect(parsed.skipped).toEqual([]);
  });

  it("keeps a session cookie with no expiry", () => {
    const { expirationDate, ...session } = jsonCookie();
    const parsed = parseCookieExport(JSON.stringify([{ ...session, session: true }]), NOW);
    if ("error" in parsed) throw new Error("unexpected parse error");
    expect(parsed.cookies).toHaveLength(1);
    expect(parsed.cookies[0]?.expires).toBeUndefined();
  });

  it("skips expired, nameless and valueless entries one by one", () => {
    const parsed = parseCookieExport(
      JSON.stringify([
        jsonCookie({ name: "old", expirationDate: 1_700_000_000 }),
        jsonCookie({ name: "" }),
        { domain: "example.com", path: "/" },
        jsonCookie({ name: "good" }),
      ]),
      NOW,
    );
    if ("error" in parsed) throw new Error("unexpected parse error");
    expect(parsed.cookies.map((cookie) => cookie.name)).toEqual(["good"]);
    expect(parsed.skipped).toEqual(["已过期", "格式不对", "格式不对"]);
  });

  it("caps the count and reports the rest", () => {
    const entries = Array.from({ length: BROWSER_COOKIE_MAX_COUNT + 2 }, (_, index) =>
      jsonCookie({ name: `c${index}` }),
    );
    const parsed = parseCookieExport(JSON.stringify(entries), NOW);
    if ("error" in parsed) throw new Error("unexpected parse error");
    expect(parsed.cookies).toHaveLength(BROWSER_COOKIE_MAX_COUNT);
    expect(parsed.skipped).toEqual(["数量上限", "数量上限"]);
  });

  it("rejects malformed JSON, a non-array, empty content and an oversized paste", () => {
    expect(parseCookieExport("{nope", NOW)).toEqual({ error: "Cookie 内容不是有效的 JSON" });
    expect(parseCookieExport(JSON.stringify({ name: "x" }), NOW)).toEqual({
      error: "Cookie JSON 应该是一个数组",
    });
    expect(parseCookieExport("  \n ", NOW)).toEqual({ error: "Cookie 内容是空的" });
    expect(parseCookieExport(`[${" ".repeat(70_000)}]`, NOW)).toEqual({
      error: "Cookie 内容超过 64 KB",
    });
  });
});

describe("parseCookieExport (Netscape)", () => {
  const netscape = [
    "# Netscape HTTP Cookie File",
    ".example.com\tTRUE\t/\tTRUE\t1900000000\tsessionid\ttest-value",
    "#HttpOnly_.example.com\tTRUE\t/\tFALSE\t1900000000\tother\ttest-value",
    "example.com\tFALSE\t/\tFALSE\t0\thostonly\ttest-value",
    "example.com\tFALSE\t/\tFALSE\t1700000000\told\ttest-value",
    "bad line",
    "",
  ].join("\n");

  it("parses domain, flag, path, secure, expiry and the HttpOnly prefix", () => {
    const parsed = parseCookieExport(netscape, NOW);
    if ("error" in parsed) throw new Error("unexpected parse error");
    expect(parsed.cookies).toEqual([
      {
        name: "sessionid",
        value: "test-value",
        domain: ".example.com",
        path: "/",
        secure: true,
        httpOnly: false,
        expires: 1_900_000_000,
      },
      {
        name: "other",
        value: "test-value",
        domain: ".example.com",
        path: "/",
        secure: false,
        httpOnly: true,
        expires: 1_900_000_000,
      },
      {
        name: "hostonly",
        value: "test-value",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
      },
    ]);
    expect(parsed.skipped).toEqual(["已过期", "格式不对"]);
  });

  it("keeps a Tab inside the value: the value is the rest of the line", () => {
    const parsed = parseCookieExport(".example.com\tTRUE\t/\tFALSE\t1900000000\ttabbed\ta\tb", NOW);
    if ("error" in parsed) throw new Error("unexpected parse error");
    expect(parsed.cookies[0]?.value).toBe("a\tb");
  });
});

describe("domain and path matching", () => {
  it("matches a parent domain and its subdomains, never a look-alike", () => {
    expect(cookieDomainMatches(".example.com", "example.com")).toBe(true);
    expect(cookieDomainMatches(".example.com", "www.example.com")).toBe(true);
    expect(cookieDomainMatches(".example.com", "evil-example.com")).toBe(false);
    expect(cookieDomainMatches("example.com", "example.com")).toBe(true);
    expect(cookieDomainMatches("example.com", "www.example.com")).toBe(false);
    expect(cookieDomainMatches("EXAMPLE.com", "example.com")).toBe(true);
  });

  it("matches a path on its own segment", () => {
    expect(cookiePathMatches("/", "/anything")).toBe(true);
    expect(cookiePathMatches("/app", "/app/page")).toBe(true);
    expect(cookiePathMatches("/app", "/app")).toBe(true);
    expect(cookiePathMatches("/app", "/apple")).toBe(false);
  });

  it("filters a navigation to what that page may receive", () => {
    const cookies = [
      jsonCookie({ name: "ok", domain: "example.com", secure: false }),
      jsonCookie({ name: "sub", domain: ".example.com", secure: false }),
      jsonCookie({
        name: "old",
        domain: "example.com",
        secure: false,
        expirationDate: 1_700_000_000,
      }),
      jsonCookie({ name: "other-site", domain: "other.com", secure: false }),
      jsonCookie({ name: "secure-only", domain: ".example.com", secure: true }),
    ].map((raw) => ({
      name: raw.name,
      value: raw.value,
      domain: raw.domain,
      path: raw.path,
      secure: raw.secure,
      httpOnly: raw.httpOnly,
      ...(typeof raw.expirationDate === "number" ? { expires: raw.expirationDate } : {}),
    }));
    expect(
      filterCookiesForNavigation(cookies, "http://example.com/", NOW).map((cookie) => cookie.name),
    ).toEqual(["ok", "sub"]);
    expect(
      filterCookiesForNavigation(cookies, "https://www.example.com/", NOW).map(
        (cookie) => cookie.name,
      ),
    ).toEqual(["sub", "secure-only"]);
  });
});

describe("importBrowserCookies", () => {
  it("imports one site and reports domain mismatches by reason", () => {
    const result = importBrowserCookies({
      content: JSON.stringify([
        jsonCookie({ name: "mine" }),
        jsonCookie({ name: "theirs", domain: "other.com" }),
      ]),
      origin: "https://example.com",
      nowSeconds: NOW,
    });
    expect(result).toEqual({
      ok: true,
      cookies: [
        {
          name: "mine",
          value: "test-value",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
          expires: 1_900_000_000,
        },
      ],
      imported: 1,
      skipped: [{ reason: "域名不符", count: 1 }],
      earliestExpiry: 1_900_000_000,
    });
  });

  it("refuses a non-HTTPS origin and a bad origin", () => {
    expect(
      importBrowserCookies({ content: "[]", origin: "http://example.com", nowSeconds: NOW }),
    ).toEqual({ ok: false, error: "网站地址必须是 HTTPS" });
    expect(importBrowserCookies({ content: "[]", origin: "not a url", nowSeconds: NOW })).toEqual({
      ok: false,
      error: "网站地址不对",
    });
  });

  it("reports no cookies found for an empty array", () => {
    expect(
      importBrowserCookies({ content: "[]", origin: "https://example.com", nowSeconds: NOW }),
    ).toEqual({ ok: false, error: "没有找到 Cookie" });
  });
});

describe("cookie set encoding", () => {
  it("round-trips and rejects a bad shape without naming the value", () => {
    const cookies = [
      {
        name: "sessionid",
        value: "test-value",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: false,
        expires: 1_900_000_000,
      },
    ];
    expect(decodeBrowserCookieSet(encodeBrowserCookieSet(cookies))).toEqual(cookies);
    expect(() => decodeBrowserCookieSet(JSON.stringify({ v: 2, cookies }))).toThrow(
      "Invalid browser cookies",
    );
    expect(() =>
      decodeBrowserCookieSet(
        JSON.stringify({ v: 1, cookies: [{ name: "x", value: "test-value" }] }),
      ),
    ).toThrow("Invalid browser cookies");
    expect(() => decodeBrowserCookieSet("not json")).toThrow("Invalid browser cookies");
  });

  it("earliestExpiry is the minimum, or null for session-only cookies", () => {
    expect(
      earliestExpiry([
        {
          name: "a",
          value: "test-value",
          domain: "example.com",
          path: "/",
          secure: false,
          httpOnly: false,
          expires: 1_900_000_100,
        },
        {
          name: "b",
          value: "test-value",
          domain: "example.com",
          path: "/",
          secure: false,
          httpOnly: false,
          expires: 1_900_000_050,
        },
        {
          name: "c",
          value: "test-value",
          domain: "example.com",
          path: "/",
          secure: false,
          httpOnly: false,
        },
      ]),
    ).toBe(1_900_000_050);
    expect(
      earliestExpiry([
        {
          name: "c",
          value: "test-value",
          domain: "example.com",
          path: "/",
          secure: false,
          httpOnly: false,
        },
      ]),
    ).toBeNull();
  });
});
