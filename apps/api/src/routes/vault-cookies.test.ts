import { ORPCError } from "@orpc/server";
import { EncryptedSecretStore } from "@rakazo_mickvvw/adapters";
import type { Actor } from "@rakazo_mickvvw/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { botsRoutes } from "./bots.js";

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;
const otherActor = { userId: "user-2", spaceId: "space-1" } as Actor;

type Row = Record<string, unknown>;

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR")
      return (value as Array<Record<string, unknown>>).some((branch) => matches(row, branch));
    if (key === "AND")
      return (value as Array<Record<string, unknown>>).every((branch) => matches(row, branch));
    const field = row[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const cond = value as Record<string, unknown>;
      if ("not" in cond) return field !== cond.not;
      if ("startsWith" in cond) return String(field).startsWith(String(cond.startsWith));
      if ("in" in cond) return (cond.in as unknown[]).includes(field);
      if ("path" in cond) {
        let current: unknown = field;
        for (const segment of cond.path as string[])
          current = (current as Record<string, unknown> | null)?.[segment];
        return current === cond.equals;
      }
    }
    return field === value;
  });
}

/** An in-memory stand-in for the vault_credentials and computers tables. */
function fakePrisma() {
  let vaultRows: Row[] = [];
  const computerRows: Row[] = [];
  let tick = Date.parse("2026-09-01T00:00:00.000Z");
  const now = () => {
    tick += 1000;
    return new Date(tick);
  };
  const vaultCredential = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      vaultRows.find((row) => matches(row, where))
        ? { ...vaultRows.find((row) => matches(row, where))! }
        : null,
    ),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: { name?: string };
      }) => {
        const found = vaultRows
          .filter((row) => matches(row, where ?? {}))
          .map((row) => ({ ...row }));
        if (orderBy?.name) found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return found;
      },
    ),
    count: vi.fn(
      async ({ where }: { where?: Record<string, unknown> }) =>
        vaultRows.filter((row) => matches(row, where ?? {})).length,
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const at = now();
      vaultRows.push({ createdAt: at, updatedAt: at, ...data });
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      Object.assign(vaultRows.find((row) => row.id === where.id)!, data, { updatedAt: now() });
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
      const matched = vaultRows.filter((row) => matches(row, where));
      for (const row of matched) Object.assign(row, data, { updatedAt: now() });
      return { count: matched.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const before = vaultRows.length;
      vaultRows = vaultRows.filter((row) => !matches(row, where));
      return { count: before - vaultRows.length };
    }),
  };
  const client: Record<string, unknown> = {
    vaultCredential,
    computer: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
        computerRows.filter((row) => matches(row, where ?? {})).map((row) => ({ ...row })),
      ),
    },
    spaceSettingOverride: { findUnique: vi.fn(async () => null) },
    secret: { count: vi.fn(async () => 0) },
    botSecret: { count: vi.fn(async () => 0) },
    integrationProviderConfig: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
  };
  let queue: Promise<unknown> = Promise.resolve();
  client.$transaction = (fn: (tx: unknown) => Promise<unknown>) => {
    const next = queue.then(async () => {
      const before = vaultRows.map((row) => ({ ...row }));
      try {
        return await fn(client);
      } catch (error) {
        vaultRows = before;
        throw error;
      }
    });
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    prisma: client,
    vaultRows: () => vaultRows,
    seedVaultRow: (row: Row) => {
      vaultRows.push({ createdAt: now(), updatedAt: now(), ...row });
    },
    addComputer: (row: Row) => {
      computerRows.push(row);
    },
  };
}

const BOTS_PROCEDURES = [
  "archive",
  "claimEmailAddress",
  "create",
  "createFromTemplate",
  "duplicate",
  "emailAddress",
  "emailAddresses",
  "get",
  "importCreate",
  "importPreview",
  "importSetupState",
  "list",
  "listArchived",
  "remove",
  "reorder",
  "restore",
  "restoreInstructions",
  "rotateWebhookSecret",
  "setComputer",
  "templates",
  "testMediaModel",
  "testTranslationModel",
  "translate",
  "update",
] as const;

const OTHER_PROCEDURES: Record<string, readonly string[]> = {
  groups: [
    "archive",
    "create",
    "duplicate",
    "get",
    "list",
    "listArchived",
    "remove",
    "restore",
    "update",
  ],
  botSections: ["create", "list", "remove", "update"],
  botSecrets: ["list", "put", "remove"],
  agentSecrets: ["list", "put", "remove"],
  vault: ["list", "put", "remove", "reveal", "importCookies"],
};

type CallContext = { actor: Actor; sessionId?: string };

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: { context: CallContext; input: unknown }) => Promise<unknown>;

function setup() {
  const handler = (fn: (args: { context: CallContext; input: unknown }) => unknown) => fn;
  const authed = {
    bots: Object.fromEntries(BOTS_PROCEDURES.map((name) => [name, { handler }])),
    ...Object.fromEntries(
      Object.entries(OTHER_PROCEDURES).map(([section, names]) => [
        section,
        Object.fromEntries(names.map((name) => [name, { handler }])),
      ]),
    ),
  };
  const db = fakePrisma();
  const pageBrowser = vi.fn(async (_ref: unknown, _request: unknown, _context: unknown) => ({
    ok: true,
  }));
  const ctx = {
    deps: {
      prisma: db.prisma,
      secrets: new EncryptedSecretStore("test-only-encryption-key"),
      auth: { hasRecentIdentityConfirmation: vi.fn(async () => true) },
      sandbox: { pageBrowser },
      env: {},
    },
    repos: {
      getBot: vi.fn(async () => ({ id: "bot-1", spaceId: "space-1" })),
      listBots: vi.fn(async () => []),
    },
    botModelValidation: () => ({}) as never,
    removeBot: vi.fn(async () => undefined),
    agentImportServices: {},
    groupRepos: {},
    authed,
  };
  const routes = botsRoutes(ctx as never);
  const call = (
    section: "vault" | "botSecrets",
    procedure: string,
    context: CallContext,
    input: unknown,
  ) =>
    (routes[section] as unknown as Record<string, Handler>)[procedure]!({
      context,
      input,
    });
  return { routes, ctx, db, pageBrowser, call };
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const jsonCookie = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify([
    {
      name: "session",
      value: "test-value",
      domain: "example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      expirationDate: 2_000_000_000,
      ...overrides,
    },
  ]);

const importInput = (overrides: Record<string, unknown> = {}) => ({
  origin: "https://example.com",
  content: jsonCookie(),
  ...overrides,
});

describe("vault.importCookies", () => {
  it("imports a JSON export and lists metadata only", async () => {
    const { call } = setup();
    const result = await call("vault", "importCookies", { actor }, importInput());
    expect(result).toEqual({
      name: "example-com",
      imported: 1,
      skipped: [],
      cookieCount: 1,
      earliestExpiry: 2_000_000_000,
    });
    const listed = await call("vault", "list", { actor }, {});
    expect(listed).toHaveLength(1);
    const [item] = listed as Array<Record<string, unknown>>;
    expect(item?.name).toBe("example-com");
    expect(item?.origin).toBe("https://example.com");
    expect(item?.auth).toEqual({
      type: "browser_cookies",
      cookieCount: 1,
      earliestExpiry: 2_000_000_000,
    });
    expect(item).not.toHaveProperty("ciphertext");
    expect(JSON.stringify(listed)).not.toContain("test-value");
  });

  it("imports a Netscape cookies.txt export", async () => {
    const { call } = setup();
    const result = await call(
      "vault",
      "importCookies",
      { actor },
      importInput({
        content: ".example.com\tTRUE\t/\tTRUE\t2000000000\tsession\ttest-value\n",
      }),
    );
    expect(result).toMatchObject({ name: "example-com", imported: 1, cookieCount: 1 });
  });

  it("returns a domain-mismatch summary for cookies of another site", async () => {
    const { call } = setup();
    const content = JSON.stringify([
      {
        name: "session",
        value: "test-value",
        domain: "example.com",
        path: "/",
        expirationDate: 2_000_000_000,
      },
      {
        name: "other",
        value: "test-value",
        domain: "other.com",
        path: "/",
        expirationDate: 2_000_000_000,
      },
    ]);
    const result = await call("vault", "importCookies", { actor }, importInput({ content }));
    expect(result).toEqual({
      name: "example-com",
      imported: 1,
      skipped: [{ reason: "域名不符", count: 1 }],
      cookieCount: 1,
      earliestExpiry: 2_000_000_000,
    });
  });

  it("rejects oversized content and a plain-HTTP origin", async () => {
    const { call } = setup();
    const oversized = await captureError(() =>
      call("vault", "importCookies", { actor }, importInput({ content: "x".repeat(65_537) })),
    );
    expect(oversized).toBeInstanceOf(ORPCError);
    expect((oversized as { code: unknown }).code).toBe("BAD_REQUEST");
    expect((oversized as Error).message).toBe("Cookie 内容超过 64 KB");
    const http = await captureError(() =>
      call("vault", "importCookies", { actor }, importInput({ origin: "http://example.com" })),
    );
    expect((http as { code: unknown }).code).toBe("BAD_REQUEST");
    expect((http as Error).message).toBe("网站地址必须是 HTTPS");
  });

  it("rejects an import with nothing usable", async () => {
    const { call } = setup();
    const expired = await captureError(() =>
      call(
        "vault",
        "importCookies",
        { actor },
        importInput({ content: jsonCookie({ expirationDate: 1_000_000_000 }) }),
      ),
    );
    expect((expired as { code: unknown }).code).toBe("BAD_REQUEST");
    expect((expired as Error).message).toBe("没有导入任何 Cookie");
  });

  it("keeps each user's vault separate", async () => {
    const { call, db } = setup();
    await call("vault", "importCookies", { actor }, importInput());
    await call("vault", "importCookies", { actor: otherActor }, importInput());
    expect(db.vaultRows()).toHaveLength(2);
    expect(
      db
        .vaultRows()
        .map((row) => row.userId)
        .sort(),
    ).toEqual(["user-1", "user-2"]);
    const listed = await call("vault", "list", { actor }, {});
    expect(listed).toHaveLength(1);
  });

  it("re-import updates the same row, including count, expiry and user agent", async () => {
    const { call, db } = setup();
    const first = await call(
      "vault",
      "importCookies",
      { actor },
      importInput({ userAgent: "TestAgent/1" }),
    );
    const second = await call(
      "vault",
      "importCookies",
      { actor },
      importInput({
        content: jsonCookie({ expirationDate: 2_100_000_000 }),
        userAgent: "TestAgent/2",
      }),
    );
    expect((second as Record<string, unknown>).name).toBe((first as Record<string, unknown>).name);
    expect(db.vaultRows()).toHaveLength(1);
    expect(db.vaultRows()[0]?.auth).toEqual({
      type: "browser_cookies",
      cookieCount: 1,
      earliestExpiry: 2_100_000_000,
      userAgent: "TestAgent/2",
    });
    expect((second as Record<string, unknown>).earliestExpiry).toBe(2_100_000_000);
  });

  it("uses an explicit name and re-imports under it", async () => {
    const { call, db } = setup();
    await call("vault", "importCookies", { actor }, importInput({ name: "my-cookies" }));
    await call(
      "vault",
      "importCookies",
      { actor },
      importInput({ name: "my-cookies", content: jsonCookie({ expirationDate: 2_100_000_000 }) }),
    );
    expect(db.vaultRows()).toHaveLength(1);
    expect(db.vaultRows()[0]?.name).toBe("my-cookies");
  });
});

describe("vault.reveal for browser cookies", () => {
  it("returns the saved cookies as fields after identity confirmation", async () => {
    const { call } = setup();
    await call("vault", "importCookies", { actor }, importInput());
    const revealed = await call(
      "vault",
      "reveal",
      { actor, sessionId: "session-1" },
      { name: "example-com" },
    );
    expect(revealed).toEqual({
      fields: [{ label: "session", value: "test-value", hidden: true }],
    });
  });

  it("still reports a missing item as not found", async () => {
    const { call } = setup();
    const error = await captureError(() =>
      call("vault", "reveal", { actor, sessionId: "session-1" }, { name: "no-such-item" }),
    );
    expect((error as { code: unknown }).code).toBe("NOT_FOUND");
  });

  it("reports another user's item as not found", async () => {
    const { call } = setup();
    await call("vault", "importCookies", { actor }, importInput());
    const error = await captureError(() =>
      call(
        "vault",
        "reveal",
        { actor: otherActor, sessionId: "session-1" },
        { name: "example-com" },
      ),
    );
    expect((error as { code: unknown }).code).toBe("NOT_FOUND");
  });
});

describe("vault.remove for browser cookies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function runningComputer(overrides: Record<string, unknown> = {}) {
    return {
      id: "computer-1",
      homeKey: "bot-1",
      kind: "docker",
      providerRef: "provider-ref-1",
      state: "running",
      userId: "user-1",
      spaceId: "space-1",
      ...overrides,
    };
  }

  it("deletes the row and clears the cookies from each running computer", async () => {
    const { call, db, pageBrowser } = setup();
    db.addComputer(runningComputer());
    db.addComputer(
      runningComputer({
        id: "computer-2",
        homeKey: "bot-2",
        providerRef: "provider-ref-2",
        spaceId: "space-2",
      }),
    );
    // This Space's shared computer, owned by someone else.
    db.addComputer(
      runningComputer({
        id: "computer-3",
        homeKey: "team",
        providerRef: "provider-ref-3",
        userId: "user-9",
      }),
    );
    // A stopped computer has no live browser to clear.
    db.addComputer(
      runningComputer({
        id: "computer-4",
        homeKey: "bot-4",
        providerRef: "provider-ref-4",
        state: "stopped",
      }),
    );
    await call("vault", "importCookies", { actor }, importInput());
    const result = await call("vault", "remove", { actor }, { name: "example-com" });
    expect(result).toEqual({ ok: true });
    expect(db.vaultRows()).toHaveLength(0);
    expect(pageBrowser).toHaveBeenCalledTimes(3);
    for (const [ref, request] of pageBrowser.mock.calls) {
      expect((ref as Record<string, unknown>).providerRef).toMatch(/^provider-ref-[123]$/);
      expect(request).toEqual({
        command: "clear_cookies",
        cookies: [{ name: "session", domain: "example.com", path: "/" }],
      });
      expect(JSON.stringify(request)).not.toContain("test-value");
    }
  });

  it("still deletes the row when the clear fails", async () => {
    const { call, db, pageBrowser } = setup();
    db.addComputer(runningComputer());
    pageBrowser.mockRejectedValueOnce(new Error("browser unreachable"));
    await call("vault", "importCookies", { actor }, importInput());
    const result = await call("vault", "remove", { actor }, { name: "example-com" });
    expect(result).toEqual({ ok: true });
    expect(db.vaultRows()).toHaveLength(0);
  });

  it("does not call the browser when removing a non-cookie item", async () => {
    const { call, db, pageBrowser } = setup();
    db.addComputer(runningComputer());
    db.seedVaultRow({
      id: "login-1",
      userId: "user-1",
      spaceId: null,
      name: "login-1",
      origin: "https://example.com",
      auth: { type: "login" },
      ciphertext: "v2:unused",
    });
    const result = await call("vault", "remove", { actor }, { name: "login-1" });
    expect(result).toEqual({ ok: true });
    expect(db.vaultRows()).toHaveLength(0);
    expect(pageBrowser).not.toHaveBeenCalled();
  });
});
