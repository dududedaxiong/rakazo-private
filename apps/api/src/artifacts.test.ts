import type { ArtifactStore } from "@rakazo_mickvvw/adapter-kit";
import type { Actor } from "@rakazo_mickvvw/contracts";
import { AttachmentValidationError } from "@rakazo_mickvvw/core";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { IsolationError } from "@rakazo_mickvvw/db";
import { describe, expect, it, vi } from "vitest";
import {
  ArtifactListCursorError,
  createOwnedArtifact,
  deleteArtifactFamily,
  listSpaceArtifacts,
  renameArtifact,
  resolveGroupSendAttachments,
  resolveSendAttachments,
  storeInboundAttachment,
} from "./artifacts.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "owner@example.com",
  isDeploymentOwner: false,
};

function listRow(id: string, familyId: string, createdAt = "2026-09-01T00:00:00.000Z", size = 12) {
  return {
    id,
    familyId,
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: familyId,
    description: null,
    mimeType: "text/markdown",
    size,
    version: 1,
    createdAt: new Date(createdAt),
    versionCount: 1,
  };
}

function cursor(input: {
  createdAt: string;
  id: string;
  botId: string | null;
  asOf?: string;
  sort?: string;
  size?: number;
}) {
  return `v1.${Buffer.from(
    JSON.stringify({
      createdAt: input.createdAt,
      id: input.id,
      botId: input.botId,
      madeByBots: false,
      asOf: input.asOf ?? "2026-09-20T00:00:00.000Z",
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
    }),
    "utf8",
  ).toString("base64url")}`;
}

function decodeCursor(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value.slice("v1.".length), "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function statement(query: { strings: string[] }) {
  return query.strings.join(" ");
}

function scopedClause(query: { strings: string[] }) {
  const text = statement(query);
  return text.slice(text.indexOf("WITH scoped"), text.indexOf("latest AS"));
}

describe("listSpaceArtifacts", () => {
  it("pages families in the database instead of slicing a fixed newest-row snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
    try {
      const queryRaw = vi
        .fn()
        .mockResolvedValue([
          listRow("version-a", "family-a"),
          listRow("version-b", "family-b"),
          listRow("version-c", "family-c"),
        ]);
      const page = await listSpaceArtifacts(
        {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        },
        actor,
        { limit: 2 },
      );

      const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
      const text = statement(sql);
      expect(text).toContain("DISTINCT ON");
      expect(text).toContain("LIMIT");
      expect(text).not.toMatch(/\b500\b/);
      expect(scopedClause(sql)).toContain('"createdAt" <=');
      expect(sql.values).toContain(3);
      expect(sql.values).toContainEqual(new Date("2026-09-20T12:00:00.000Z"));
      expect(page.items.map((item) => item.id)).toEqual(["family-a", "family-b"]);
      expect(page.nextCursor).toBe(
        cursor({
          createdAt: "2026-09-01T00:00:00.000Z",
          id: "version-b",
          botId: null,
          asOf: "2026-09-20T12:00:00.000Z",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an unseen family on a later page when it gains a version after page one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
    try {
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([
          listRow("version-a", "family-a", "2026-09-03T00:00:00.000Z"),
          listRow("version-b", "family-b", "2026-09-02T00:00:00.000Z"),
          listRow("version-c", "family-c", "2026-09-01T00:00:00.000Z"),
        ])
        .mockResolvedValueOnce([listRow("version-c", "family-c", "2026-09-01T00:00:00.000Z")]);
      const deps = {
        prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
          PrismaClient,
          "artifact" | "$queryRaw"
        >,
      };
      const first = await listSpaceArtifacts(deps, actor, { limit: 2 });
      vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
      const second = await listSpaceArtifacts(deps, actor, {
        cursor: first.nextCursor ?? undefined,
        limit: 2,
      });

      const continuation = queryRaw.mock.calls[1]?.[0] as { strings: string[]; values: unknown[] };
      expect(scopedClause(continuation)).toContain('"createdAt" <=');
      expect(continuation.values).toContainEqual(new Date("2026-09-20T12:00:00.000Z"));
      expect(continuation.values).not.toContainEqual(new Date("2026-09-21T12:00:00.000Z"));
      expect(continuation.values).toContain("version-b");
      expect(second.items.map((item) => item.id)).toEqual(["family-c"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a cursor that has no version snapshot", async () => {
    const legacy = `v1.${Buffer.from(
      JSON.stringify({
        createdAt: "2026-08-01T00:00:00.000Z",
        id: "version-b",
        botId: null,
      }),
      "utf8",
    ).toString("base64url")}`;
    const queryRaw = vi.fn();
    await expect(
      listSpaceArtifacts(
        {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        },
        actor,
        { cursor: legacy, limit: 2 },
      ),
    ).rejects.toBeInstanceOf(ArtifactListCursorError);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("keeps paging from a cursor whose row was deleted", async () => {
    const pageCursor = cursor({
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "version-b",
      botId: null,
    });
    const findFirst = vi.fn();
    const queryRaw = vi.fn().mockResolvedValue([]);
    await listSpaceArtifacts(
      {
        prisma: { artifact: { findFirst }, $queryRaw: queryRaw } as unknown as Pick<
          PrismaClient,
          "artifact" | "$queryRaw"
        >,
      },
      actor,
      { cursor: pageCursor, limit: 2 },
    );

    expect(findFirst).not.toHaveBeenCalled();
    const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(statement(sql)).toContain('latest."createdAt", latest.id');
    expect(scopedClause(sql)).toContain('"createdAt" <=');
    expect(sql.values).toContainEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(sql.values).toContainEqual(new Date("2026-09-20T00:00:00.000Z"));
    expect(sql.values).toContain("version-b");
  });

  it("rejects a cursor from a different bot filter instead of replaying the first page", async () => {
    const queryRaw = vi.fn();
    await expect(
      listSpaceArtifacts(
        {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        },
        actor,
        {
          botId: "bot-2",
          cursor: cursor({
            createdAt: "2026-08-01T00:00:00.000Z",
            id: "version-b",
            botId: "bot-1",
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ArtifactListCursorError);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reads a cursor issued before the made-by-bots filter as the full list", async () => {
    const issuedBefore = `v1.${Buffer.from(
      JSON.stringify({
        createdAt: "2026-08-01T00:00:00.000Z",
        id: "version-b",
        botId: null,
        asOf: "2026-09-20T00:00:00.000Z",
      }),
      "utf8",
    ).toString("base64url")}`;
    const queryRaw = vi.fn().mockResolvedValue([]);
    const deps = {
      prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
        PrismaClient,
        "artifact" | "$queryRaw"
      >,
    };
    await listSpaceArtifacts(deps, actor, { cursor: issuedBefore });
    expect(queryRaw.mock.calls[0]?.[0].values).toContain("version-b");
    await expect(
      listSpaceArtifacts(deps, actor, { madeByBots: true, cursor: issuedBefore }),
    ).rejects.toBeInstanceOf(ArtifactListCursorError);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("applies a bot-scoped cursor with that bot filter", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const pageCursor = cursor({
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "version-b",
      botId: "bot-1",
    });
    await listSpaceArtifacts(
      {
        prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
          PrismaClient,
          "artifact" | "$queryRaw"
        >,
      },
      actor,
      { botId: "bot-1", cursor: pageCursor, limit: 2 },
    );

    const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    const text = sql.strings.join(" ");
    expect(text).toContain('"botId"');
    expect(text).not.toContain('"botId" IS NULL');
    expect(sql.values).toContain("bot-1");
    expect(sql.values).toContain("version-b");
  });

  it.each([
    ["date-desc", 'ORDER BY latest."createdAt" DESC, latest.id DESC', "<"],
    ["date-asc", 'ORDER BY latest."createdAt" ASC, latest.id ASC', ">"],
    ["size-desc", 'ORDER BY latest."size" DESC, latest.id DESC', "<"],
    ["size-asc", 'ORDER BY latest."size" ASC, latest.id ASC', ">"],
  ] as const)(
    "orders by %s and pages with a cursor that compares in the same direction",
    async (sort, orderBy, direction) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
      try {
        const rows = [
          listRow("version-a", "family-a", "2026-09-03T00:00:00.000Z", 300),
          listRow("version-b", "family-b", "2026-09-02T00:00:00.000Z", 200),
          listRow("version-c", "family-c", "2026-09-01T00:00:00.000Z", 100),
        ];
        const queryRaw = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
        const deps = {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        };
        const first = await listSpaceArtifacts(deps, actor, { sort, limit: 2 });
        expect(first.items.map((item) => item.id)).toEqual(["family-a", "family-b"]);
        expect(first.nextCursor).not.toBeNull();
        const firstSql = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
        expect(statement(firstSql)).toContain(orderBy);

        const cursorRecord = decodeCursor(first.nextCursor!);
        if (sort.startsWith("size")) {
          expect(cursorRecord.sort).toBe(sort);
          expect(cursorRecord.size).toBe(200);
        } else {
          expect(cursorRecord.sort ?? "date-desc").toBe(sort);
        }

        await listSpaceArtifacts(deps, actor, {
          sort,
          cursor: first.nextCursor ?? undefined,
          limit: 2,
        });
        const secondSql = queryRaw.mock.calls[1]?.[0] as { strings: string[]; values: unknown[] };
        const secondText = statement(secondSql);
        expect(secondText).toContain(orderBy);
        if (sort.startsWith("size")) {
          expect(secondText).toContain('latest."size", latest.id');
          expect(secondText).toContain(`) ${direction} (`);
          expect(secondSql.values).toContain(200);
        } else {
          expect(secondText).toContain('latest."createdAt", latest.id');
          expect(secondText).toContain(`) ${direction} (`);
          expect(secondSql.values).toContainEqual(new Date("2026-09-02T00:00:00.000Z"));
        }
        expect(secondSql.values).toContain("version-b");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("rejects a cursor whose sort differs from the requested sort", async () => {
    const queryRaw = vi.fn();
    await expect(
      listSpaceArtifacts(
        {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        },
        actor,
        {
          sort: "date-desc",
          cursor: cursor({
            createdAt: "2026-08-01T00:00:00.000Z",
            id: "version-b",
            botId: null,
            sort: "size-desc",
            size: 200,
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ArtifactListCursorError);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a size cursor without a size position", async () => {
    const queryRaw = vi.fn();
    await expect(
      listSpaceArtifacts(
        {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        },
        actor,
        {
          sort: "size-desc",
          cursor: cursor({
            createdAt: "2026-08-01T00:00:00.000Z",
            id: "version-b",
            botId: null,
            sort: "size-desc",
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ArtifactListCursorError);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reads a cursor issued before sorting as newest first", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await listSpaceArtifacts(
      {
        prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
          PrismaClient,
          "artifact" | "$queryRaw"
        >,
      },
      actor,
      {
        cursor: cursor({
          createdAt: "2026-08-01T00:00:00.000Z",
          id: "version-b",
          botId: null,
        }),
      },
    );
    const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    expect(statement(sql)).toContain('ORDER BY latest."createdAt" DESC, latest.id DESC');
    await expect(
      listSpaceArtifacts(
        {
          prisma: { artifact: { findFirst: vi.fn() }, $queryRaw: queryRaw } as unknown as Pick<
            PrismaClient,
            "artifact" | "$queryRaw"
          >,
        },
        actor,
        {
          sort: "date-asc",
          cursor: cursor({
            createdAt: "2026-08-01T00:00:00.000Z",
            id: "version-b",
            botId: null,
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ArtifactListCursorError);
  });
});

describe("renameArtifact", () => {
  function renameClient(
    anchor: { id: string; rootArtifactId: string | null } | null,
    latest: {
      id: string;
      name: string;
    } | null,
  ) {
    const findFirst = vi.fn().mockResolvedValueOnce(anchor).mockResolvedValueOnce(latest);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = {
      prisma: { artifact: { findFirst, updateMany } } as unknown as Pick<PrismaClient, "artifact">,
    };
    return { deps, findFirst, updateMany };
  }

  it("renames the latest version and keeps the original extension", async () => {
    const { deps, updateMany } = renameClient(
      { id: "family-1", rootArtifactId: null },
      { id: "version-2", name: "generated-abc.png" },
    );
    await expect(
      renameArtifact(deps, actor, { artifactId: "family-1", name: "sunset" }),
    ).resolves.toEqual({ ok: true, name: "sunset.png" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "version-2", spaceId: "space-1" },
      data: { name: "sunset.png" },
    });
  });

  it("drops a different typed extension instead of changing the file kind", async () => {
    const { deps, updateMany } = renameClient(
      { id: "family-1", rootArtifactId: null },
      { id: "version-2", name: "generated-abc.png" },
    );
    await renameArtifact(deps, actor, { artifactId: "family-1", name: "sunset.jpg" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "version-2", spaceId: "space-1" },
      data: { name: "sunset.png" },
    });
  });

  it("keeps the name when it already ends with the original extension", async () => {
    const { deps, updateMany } = renameClient(
      { id: "family-1", rootArtifactId: null },
      { id: "version-2", name: "generated-abc.mp4" },
    );
    await renameArtifact(deps, actor, { artifactId: "family-1", name: "clip.mp4" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "version-2", spaceId: "space-1" },
      data: { name: "clip.mp4" },
    });
  });

  it("renames the latest version of a family with several versions", async () => {
    const { deps, findFirst, updateMany } = renameClient(
      { id: "root-1", rootArtifactId: "root-1" },
      { id: "version-3", name: "generated-abc.png" },
    );
    await renameArtifact(deps, actor, { artifactId: "root-1", name: "sunset" });
    expect(findFirst.mock.calls[1]?.[0]).toMatchObject({
      where: { spaceId: "space-1", OR: [{ id: "root-1" }, { rootArtifactId: "root-1" }] },
      orderBy: { version: "desc" },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "version-3", spaceId: "space-1" },
      data: { name: "sunset.png" },
    });
  });

  it.each(["   ", ".png", "a/b", "a\\b"])("rejects an invalid name %s", async (name) => {
    const { deps, updateMany } = renameClient(
      { id: "family-1", rootArtifactId: null },
      { id: "version-2", name: "generated-abc.png" },
    );
    await expect(
      renameArtifact(deps, actor, { artifactId: "family-1", name }),
    ).rejects.toBeInstanceOf(AttachmentValidationError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a name that is too long once the extension is kept", async () => {
    const { deps, updateMany } = renameClient(
      { id: "family-1", rootArtifactId: null },
      { id: "version-2", name: "generated-abc.png" },
    );
    await expect(
      renameArtifact(deps, actor, { artifactId: "family-1", name: "a".repeat(300) }),
    ).rejects.toBeInstanceOf(AttachmentValidationError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a family outside the caller's space", async () => {
    const { deps, updateMany } = renameClient(null, null);
    await expect(
      renameArtifact(deps, actor, { artifactId: "family-1", name: "sunset" }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects the rename when the row vanished before the update", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "family-1", rootArtifactId: null })
      .mockResolvedValueOnce({ id: "version-2", name: "generated-abc.png" });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const deps = {
      prisma: { artifact: { findFirst, updateMany } } as unknown as Pick<PrismaClient, "artifact">,
    };
    await expect(
      renameArtifact(deps, actor, { artifactId: "family-1", name: "sunset" }),
    ).rejects.toBeInstanceOf(IsolationError);
  });
});

describe("deleteArtifactFamily", () => {
  function familyClient(listings: Array<Array<{ id: string; storageKey: string; botId: string }>>) {
    const calls: string[] = [];
    let read = 0;
    let rootChecks = 0;
    const deferRootDeletes = { count: 0 };
    const prisma = {
      artifact: {
        findFirst: vi.fn(async () => ({ id: "root", rootArtifactId: null, botId: "bot-1" })),
        findMany: vi.fn(async () => {
          const page = listings[Math.min(read, listings.length - 1)] ?? [];
          read += 1;
          return page;
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          calls.push(`delete:${where.id}`);
        }),
      },
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<void>) => {
        await run({
          $queryRaw: vi.fn(async () => [{ id: "root" }]),
          artifact: {
            findFirst: vi.fn(async () => {
              rootChecks += 1;
              return rootChecks <= deferRootDeletes.count ? { id: "v2" } : null;
            }),
            delete: vi.fn(async ({ where }: { where: { id: string } }) => {
              calls.push(`delete:${where.id}`);
            }),
          },
        });
      }),
    };
    return { calls, deferRootDeletes, prisma: prisma as unknown as PrismaClient };
  }

  it("removes each blob before its row and versions before the root", async () => {
    const client = familyClient([
      [
        { id: "root", storageKey: "blob-root", botId: "bot-1" },
        { id: "v2", storageKey: "blob-v2", botId: "bot-1" },
      ],
      [{ id: "root", storageKey: "blob-root", botId: "bot-1" }],
      [],
    ]);
    const remove = vi.fn(async (id: string) => {
      client.calls.push(`remove:${id}`);
    });

    await expect(
      deleteArtifactFamily(
        {
          prisma: client.prisma,
          artifacts: { remove } as unknown as ArtifactStore,
        },
        actor,
        { familyId: "root" },
      ),
    ).resolves.toEqual({ ok: true });

    expect(client.calls).toEqual([
      "remove:blob-v2",
      "delete:v2",
      "remove:blob-root",
      "delete:root",
    ]);
  });

  it("leaves the row in place when blob removal fails", async () => {
    const client = familyClient([[{ id: "root", storageKey: "blob-root", botId: "bot-1" }]]);
    const remove = vi.fn(async () => {
      throw new Error("storage down");
    });

    await expect(
      deleteArtifactFamily(
        {
          prisma: client.prisma,
          artifacts: { remove } as unknown as ArtifactStore,
        },
        actor,
        { familyId: "root" },
      ),
    ).rejects.toThrow("storage down");
    expect(client.calls).toEqual([]);
  });

  it("does not remove the root blob when a version appears before the root is deleted", async () => {
    const client = familyClient([
      [{ id: "root", storageKey: "blob-root", botId: "bot-1" }],
      [
        { id: "root", storageKey: "blob-root", botId: "bot-1" },
        { id: "v2", storageKey: "blob-v2", botId: "bot-1" },
      ],
      [{ id: "root", storageKey: "blob-root", botId: "bot-1" }],
      [],
    ]);
    client.deferRootDeletes.count = 1;
    const remove = vi.fn(async (id: string) => {
      client.calls.push(`remove:${id}`);
    });

    await deleteArtifactFamily(
      {
        prisma: client.prisma,
        artifacts: { remove } as unknown as ArtifactStore,
      },
      actor,
      { familyId: "root" },
    );

    expect(client.calls).toEqual([
      "remove:blob-v2",
      "delete:v2",
      "remove:blob-root",
      "delete:root",
    ]);
  });

  it("finishes a retry when the blob was already removed", async () => {
    const client = familyClient([[{ id: "root", storageKey: "blob-root", botId: "bot-1" }]]);
    const remove = vi.fn(async (id: string) => {
      client.calls.push(`remove:${id}`);
      const missing = new Error("missing");
      Object.assign(missing, { code: "ENOENT" });
      throw missing;
    });

    await expect(
      deleteArtifactFamily(
        {
          prisma: client.prisma,
          artifacts: { remove } as unknown as ArtifactStore,
        },
        actor,
        { familyId: "root" },
      ),
    ).resolves.toEqual({ ok: true });
    expect(client.calls).toEqual(["remove:blob-root", "delete:root"]);
  });
});

describe("configured artifact upload limit", () => {
  it("normalizes uploads before validation/storage", async () => {
    const reachedStorage = new Error("reached storage");
    const put = vi.fn().mockRejectedValue(reachedStorage);
    const deps = { prisma: {} as PrismaClient, artifacts: { put } as unknown as ArtifactStore };
    await expect(
      createOwnedArtifact(deps, actor, {
        botId: "bot-1",
        name: "song.m4a",
        mimeType: "audio/aac",
        contentBase64: "YXVkaW8=",
      }),
    ).rejects.toBe(reachedStorage);
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "audio/mp4" }),
      expect.anything(),
    );
    put.mockClear();
    await expect(
      createOwnedArtifact(deps, actor, {
        botId: "bot-1",
        name: "song.flac",
        mimeType: "audio/flac",
        contentBase64: "YXVkaW8=",
      }),
    ).rejects.toThrow("Unsupported attachment type");
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects oversized attachments before storage and accepts uploads above the old cap", async () => {
    const stored = new Error("reached storage");
    const put = vi.fn().mockRejectedValue(stored);
    const deps = {
      prisma: {} as PrismaClient,
      artifacts: { put } as unknown as ArtifactStore,
      maxUploadSizeBytes: 12 * 1024 * 1024,
    };
    const upload = (size: number) =>
      createOwnedArtifact(deps, actor, {
        botId: "bot-1",
        name: "notes.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.alloc(size).toString("base64"),
      });
    await expect(upload(deps.maxUploadSizeBytes + 1)).rejects.toThrow("12 MiB limit");
    expect(put).not.toHaveBeenCalled();
    await expect(upload(deps.maxUploadSizeBytes)).rejects.toBe(stored);
    expect(put).toHaveBeenCalledOnce();
  });
});

describe("storeInboundAttachment", () => {
  const reachedStorage = new Error("reached storage");
  function setup(existing: unknown = null) {
    const put = vi.fn().mockRejectedValue(reachedStorage);
    const findFirst = vi.fn(async () => existing);
    const deps = {
      prisma: { artifact: { findFirst } } as unknown as PrismaClient,
      artifacts: { put } as unknown as ArtifactStore,
      maxUploadSizeBytes: 8,
    };
    const store = (
      attachment: Parameters<typeof storeInboundAttachment>[2]["attachment"],
      downloadDeadline?: number,
    ) =>
      storeInboundAttachment(deps, actor, {
        botId: "bot-1",
        attachment,
        clientNonce: "nonce-1",
        downloadDeadline,
      });
    return { put, store, findFirst };
  }

  it("bounds a stalled download and does not store its late result", async () => {
    vi.useFakeTimers();
    try {
      const { put, store } = setup();
      let finish!: (bytes: Uint8Array) => void;
      const download = new Promise<Uint8Array>((resolve) => {
        finish = resolve;
      });
      const result = store({ name: "a.png", mimeType: "image/png", fetch: () => download });
      const rejected = expect(result).rejects.toThrow("Attachment download timed out");
      await vi.advanceTimersByTimeAsync(2_000);
      await rejected;
      finish(new Uint8Array(3));
      await Promise.resolve();
      expect(put).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start another download after the shared deadline", async () => {
    const { put, store } = setup();
    const fetch = vi.fn(async () => new Uint8Array(3));
    await expect(
      store({ name: "a.png", mimeType: "image/png", fetch }, Date.now() - 1),
    ).rejects.toThrow("Attachment download timed out");
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("skips the download when the platform reports an oversize file", async () => {
    const { put, store } = setup();
    const fetch = vi.fn(async () => new Uint8Array(4));
    await expect(store({ name: "a.png", mimeType: "image/png", size: 9, fetch })).rejects.toThrow(
      "limit",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("stores a CSV that a chat platform labelled as Excel as CSV", async () => {
    const { put, store } = setup();
    const fetch = vi.fn(async () => new Uint8Array(4));
    await expect(
      store({ name: "sales.csv", mimeType: "application/vnd.ms-excel", fetch }),
    ).rejects.toBe(reachedStorage);
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "text/csv" }),
      expect.anything(),
    );
  });

  it("rejects unsupported types and oversize downloads before storage", async () => {
    const { put, store } = setup();
    const fetch = vi.fn(async () => new Uint8Array(9));
    await expect(
      store({ name: "a.exe", mimeType: "application/x-msdownload", fetch }),
    ).rejects.toThrow("Unsupported");
    await expect(store({ name: "a.png", mimeType: "image/png", fetch })).rejects.toThrow("limit");
    expect(put).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Uint8Array(8));
    await expect(store({ name: "a.png", mimeType: "image/png", fetch })).rejects.toBe(
      reachedStorage,
    );
  });

  it("reuses the artifact an earlier delivery of the same file stored", async () => {
    const { put, store, findFirst } = setup({
      id: "artifact-1",
      botId: "bot-1",
      groupId: null,
      runId: null,
      name: "a.png",
      description: null,
      mimeType: "image/png",
      size: 3,
      version: 1,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    const fetch = vi.fn(async () => new Uint8Array(3));
    const replayed = await store({ name: "a.png", mimeType: "image/png", fetch }, Date.now() - 1);
    expect(replayed).toMatchObject({
      id: "artifact-1",
    });
    expect(replayed.bytes).toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { spaceId: actor.spaceId, userId: actor.userId, clientNonce: "nonce-1" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("returns the downloaded bytes with a freshly stored artifact", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const row = {
      id: "artifact-9",
      botId: "bot-1",
      groupId: null,
      runId: null,
      name: "voice.oga",
      description: null,
      mimeType: "audio/ogg",
      size: bytes.byteLength,
      version: 1,
      createdAt: new Date(0),
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      artifact: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(row),
      },
    };
    const deps = {
      prisma: {
        artifact: { findFirst: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      } as unknown as PrismaClient,
      artifacts: { put: vi.fn().mockResolvedValue({ id: "store-1" }) } as unknown as ArtifactStore,
    };
    const stored = await storeInboundAttachment(deps, actor, {
      botId: "bot-1",
      attachment: { name: "voice.oga", mimeType: "audio/ogg", fetch: async () => bytes },
      clientNonce: "nonce-2",
    });
    expect(stored).toMatchObject({ id: "artifact-9", mimeType: "audio/ogg" });
    expect(stored.bytes).toBe(bytes);
  });
});

describe("send attachment count", () => {
  it.each(["bot", "group"])("enforces the deployment limit for %s attachments", async (target) => {
    const findMany = vi.fn().mockImplementation(async ({ where }) =>
      where.id.in.map((id: string) => ({
        id,
        name: `${id}.txt`,
        mimeType: "text/plain",
        size: 1,
        storageKey: id,
      })),
    );
    const prisma = { artifact: { findMany } } as unknown as PrismaClient;
    const send = (maxAttachmentsPerMessage: number | undefined, count: number) => {
      const deps = { prisma, maxAttachmentsPerMessage };
      const ids = Array.from({ length: count }, (_, i) => `artifact-${i}`);
      return target === "bot"
        ? resolveSendAttachments(deps, actor, "bot-1", ids)
        : resolveGroupSendAttachments(deps, actor, "group-1", ["bot-1"], ids);
    };
    for (const limit of [undefined, 1, 8, 100]) {
      findMany.mockClear();
      const effective = limit ?? 4;
      await expect(send(limit, effective + 1)).rejects.toThrow(
        `At most ${effective} attachments per message`,
      );
      expect(findMany).not.toHaveBeenCalled();
      await expect(send(limit, effective)).resolves.toMatchObject({ blocks: expect.any(Array) });
      expect(findMany).toHaveBeenCalledOnce();
    }
  });
});
