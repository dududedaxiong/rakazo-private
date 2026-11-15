import type * as Adapters from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelsRoutes } from "./models.js";

vi.mock("@rakazo/adapters", async (original) => {
  const actual = await original<typeof Adapters>();
  return {
    ...actual,
    checkModelCredentialKeyHealth: vi.fn(),
  };
});

const mockedAdapters = vi.mocked(await import("@rakazo/adapters"));

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;

/** A route handler, unwrapped from its oRPC procedure for direct calls. */
type Handler = (args: { context: { actor: Actor }; input: unknown }) => Promise<unknown>;

const credential = (overrides: Record<string, unknown> = {}) => ({
  id: "cred-1",
  provider: "openai-compatible",
  label: "Local server",
  secretId: "sec-1",
  supportsImages: false,
  createdAt: new Date("2026-11-15T00:00:00.000Z"),
  updatedAt: new Date("2026-11-15T00:00:00.000Z"),
  ...overrides,
});

const storedSecret = JSON.stringify({
  kind: "openai_compatible",
  baseUrl: "https://api.example.invalid/v1",
  apiKey: "fixture-key",
  enabledModelIds: ["fixture-model"],
});

function setup() {
  const handler = (fn: (args: { context: { actor: Actor }; input: unknown }) => unknown) => fn;
  // modelsRoutes builds every models procedure up front, so each needs a stub.
  const authed = {
    models: Object.fromEntries(
      [
        "forRole",
        "role",
        "setRole",
        "list",
        "credentials",
        "backups",
        "setBackups",
        "connect",
        "probeOpenAiCompatible",
        "probeCatalog",
        "testProvider",
        "checkKey",
        "checkKeys",
        "beginOAuth",
        "submitOAuthCode",
        "completeOAuth",
        "finishOAuth",
        "cancelOAuth",
        "setDefault",
        "rename",
        "disconnect",
      ].map((name) => [name, { handler }]),
    ),
  };
  const credentials = [credential(), credential({ id: "cred-2", secretId: "sec-2" })];
  const prisma = {
    userModelCredential: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
        where.userId === "user-1" ? (credentials.find((row) => row.id === where.id) ?? null) : null,
      ),
      findMany: vi.fn(async ({ where }: { where: { userId?: string; id?: { in?: string[] } } }) =>
        where.userId === "user-1"
          ? credentials.filter((row) => !where.id?.in || where.id.in.includes(row.id))
          : [],
      ),
      update: vi.fn(async () => ({})),
    },
    secret: {
      findFirst: vi.fn(async () => ({ ciphertext: "enc" })),
    },
    userModelPreference: {
      findFirst: vi.fn(async () => null),
    },
  };
  const ctx = {
    deps: {
      prisma,
      secrets: { load: vi.fn(async () => storedSecret) },
      env: {},
    },
    authed,
  };
  return { routes: modelsRoutes(ctx as never), ctx, prisma };
}

describe("models checkKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAdapters.checkModelCredentialKeyHealth.mockResolvedValue({
      status: "ok",
      checkedAt: "2026-11-15T12:00:00.000Z",
      modelCount: 3,
    });
  });

  it("probes one connection and persists the outcome", async () => {
    const { routes, prisma } = setup();
    const result = await (routes.models.checkKey as unknown as Handler)({
      context: { actor },
      input: { credentialId: "cred-1" },
    });
    expect(result).toEqual({
      credentialId: "cred-1",
      status: "ok",
      checkedAt: "2026-11-15T12:00:00.000Z",
      modelCount: 3,
    });
    expect(mockedAdapters.checkModelCredentialKeyHealth).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        provider: "openai-compatible",
        modelId: "fixture-model",
      }),
    );
    expect(prisma.userModelCredential.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "cred-1" },
      data: {
        keyHealthStatus: "ok",
        keyHealthCheckedAt: new Date("2026-11-15T12:00:00.000Z"),
      },
    });
  });

  it("refuses a connection owned by someone else", async () => {
    const { routes } = setup();
    await expect(
      (routes.models.checkKey as unknown as Handler)({
        context: { actor: { userId: "user-2", spaceId: "space-1" } as Actor },
        input: { credentialId: "cred-1" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockedAdapters.checkModelCredentialKeyHealth).not.toHaveBeenCalled();
  });
});

describe("models checkKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes every connection concurrently instead of one by one", async () => {
    const { routes } = setup();
    const started: string[] = [];
    const release = { first: () => {}, second: () => {} };
    mockedAdapters.checkModelCredentialKeyHealth
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            started.push("first");
            release.first = () =>
              resolve({ status: "ok" as const, checkedAt: "2026-11-15T12:00:00.000Z" });
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            started.push("second");
            release.second = () =>
              resolve({ status: "timeout" as const, checkedAt: "2026-11-15T12:00:00.000Z" });
          }),
      );
    const pending = (routes.models.checkKeys as unknown as Handler)({
      context: { actor },
      input: {},
    });
    // Both probes started before either finished: the batch waits on the
    // slowest connection, not on each in turn.
    await vi.waitFor(() =>
      expect(mockedAdapters.checkModelCredentialKeyHealth).toHaveBeenCalledTimes(2),
    );
    expect(started).toEqual(["first", "second"]);
    release.first();
    release.second();
    await expect(pending).resolves.toEqual({
      results: [
        { credentialId: "cred-1", status: "ok", checkedAt: "2026-11-15T12:00:00.000Z" },
        { credentialId: "cred-2", status: "timeout", checkedAt: "2026-11-15T12:00:00.000Z" },
      ],
    });
  });

  it("checks only the named connections when ids are given", async () => {
    const { routes, prisma } = setup();
    mockedAdapters.checkModelCredentialKeyHealth.mockResolvedValue({
      status: "unsupported",
      checkedAt: "2026-11-15T12:00:00.000Z",
    });
    const result = await (routes.models.checkKeys as unknown as Handler)({
      context: { actor },
      input: { credentialIds: ["cred-2"] },
    });
    expect(result).toEqual({
      results: [
        { credentialId: "cred-2", status: "unsupported", checkedAt: "2026-11-15T12:00:00.000Z" },
      ],
    });
    expect(prisma.userModelCredential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", id: { in: ["cred-2"] } } }),
    );
  });
});
