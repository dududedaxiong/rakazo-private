import type * as Db from "@rakazo/db";
import { installSecurityEventStore } from "@rakazo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { banRegistrationIpAccounts } from "./registration-limits.js";

vi.mock("@rakazo/db", async (original) => ({
  ...(await original<typeof Db>()),
  cancelDeactivatedAccountRuns: vi.fn(async () => 0),
  leaveInvitedSpaces: vi.fn(async () => []),
}));

function accountStatusDeps(updateMany: ReturnType<typeof vi.fn>, scimActive = false) {
  return {
    prisma: {
      user: { updateMany },
      session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      callPushDevice: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      messagingLinkCode: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      bot: { updateMany: vi.fn(async () => ({ count: 0 })) },
      userDevice: { findMany: vi.fn(async () => []) },
      scimUser: { findMany: vi.fn(async () => (scimActive ? [{ active: true }] : [])) },
      scimIdentityTombstone: { count: vi.fn(async () => 0) },
    },
    pushTokens: { remove: vi.fn(async () => undefined) },
    devices: { prisma: { userDevice: { findMany: vi.fn(async () => []) } }, devices: {} },
    events: { notify: vi.fn(async () => undefined) },
    afterDeparture: vi.fn(async () => undefined),
  } as never;
}

describe("banRegistrationIpAccounts", () => {
  afterEach(() => installSecurityEventStore(undefined));

  it("disables every account under the IP and records the collective ban", async () => {
    const securityEventCreate = vi.fn(async () => ({}));
    installSecurityEventStore({ securityEvent: { create: securityEventCreate } } as never);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    await banRegistrationIpAccounts(
      accountStatusDeps(updateMany),
      "203.0.113.1",
      ["user-1", "user-2"],
      false,
    );
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", deactivatedAt: null },
      data: { deactivatedAt: expect.any(Date) },
    });
    expect(securityEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "admin.ip_collective_ban",
        metadata: expect.objectContaining({ banned: 2, skipped: 0, failed: 0 }),
      }),
    });
  });

  it("skips directory-managed accounts without failing the ban", async () => {
    const securityEventCreate = vi.fn(async () => ({}));
    installSecurityEventStore({ securityEvent: { create: securityEventCreate } } as never);
    const updateMany = vi.fn(async () => ({ count: 0 }));
    await banRegistrationIpAccounts(
      accountStatusDeps(updateMany, true),
      "203.0.113.1",
      ["user-1"],
      true,
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(securityEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "admin.ip_collective_ban",
        metadata: expect.objectContaining({ banned: 0, skipped: 1, failed: 0 }),
      }),
    });
  });
});
