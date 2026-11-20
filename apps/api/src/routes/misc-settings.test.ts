import { createRouterClient } from "@orpc/server";
import type * as Db from "@rakazo_mickvvw/db";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import { DEFAULT_MISC_SETTINGS } from "@rakazo_mickvvw/db";
import { describe, expect, it, vi } from "vitest";
import type { AccountStatusDeps } from "../account-status.js";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

vi.mock("@rakazo_mickvvw/db", async (original) => ({
  ...(await original<typeof Db>()),
  cancelDeactivatedAccountRuns: vi.fn(async () => 0),
  leaveInvitedSpaces: vi.fn(async () => []),
}));

vi.mock("../account-deletion.js", () => ({
  deleteAccountContent: vi.fn(async () => undefined),
  deleteOrganization: vi.fn(async () => undefined),
  finishStalledOrganizationDeletions: vi.fn(async () => undefined),
}));

const categories = {
  image: ["png", "jpg"],
  video: ["mp4"],
  archive: ["zip"],
  script: ["py"],
  document: ["md"],
  software: { desktop: ["exe"], apple: ["dmg"], android: ["apk"], other: ["iso"] },
};
const saved = { categories, uploadExtensions: ["png", "py"] };

function miscDeps() {
  let row: { settings: unknown } | null = null;
  const prisma = {
    spaceMiscConfig: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async ({ create }: { create: { settings: unknown } }) => {
        row = { settings: create.settings };
        return row;
      }),
    },
  } as unknown as PrismaClient;
  const accountStatus = {
    prisma,
    pushTokens: { remove: vi.fn(async () => undefined) },
    devices: { prisma: { userDevice: { findMany: vi.fn(async () => []) } }, devices: {} },
    events: { notify: vi.fn(async () => undefined) },
    afterDeparture: vi.fn(async () => undefined),
  } as unknown as AccountStatusDeps;
  const deps = {
    prisma,
    accountStatus,
    events: { notify: vi.fn(async () => undefined) },
    env: { adminEmails: ["admin@rakazo.test"] },
    dataDir: "/tmp/rakazo-misc-test",
    jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
  } as unknown as RouterDeps;
  const userActor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "alice@rakazo.test",
    isDeploymentOwner: false,
  };
  const user = createRouterClient(createRouter(deps), { context: { actor: userActor } as never });
  return {
    user,
    seed: (next: unknown) => {
      row = { settings: next };
    },
  };
}

describe("miscSettings", () => {
  it("returns the built-in defaults when the space saved nothing", async () => {
    const { user } = miscDeps();
    await expect(user.miscSettings.get()).resolves.toEqual(DEFAULT_MISC_SETTINGS);
  });

  it("returns saved settings instead of the defaults", async () => {
    const { user, seed } = miscDeps();
    seed(saved);
    await expect(user.miscSettings.get()).resolves.toEqual(saved);
  });

  it("saves and normalizes the settings", async () => {
    const { user } = miscDeps();
    const written = await user.miscSettings.set({
      categories: { ...categories, image: ["PNG", ".Jpg"] },
      uploadExtensions: [".PY", "Md"],
    });
    expect(written).toEqual({
      categories: { ...categories, image: ["png", "jpg"] },
      uploadExtensions: ["py", "md"],
    });
    await expect(user.miscSettings.get()).resolves.toEqual(written);
  });

  it("refuses .env in the upload list", async () => {
    const { user } = miscDeps();
    await expect(
      user.miscSettings.set({ ...saved, uploadExtensions: ["png", "env"] }),
    ).rejects.toThrow();
    await expect(user.miscSettings.get()).resolves.toEqual(DEFAULT_MISC_SETTINGS);
  });

  it("refuses unknown categories", async () => {
    const { user } = miscDeps();
    await expect(
      user.miscSettings.set({
        categories: { ...categories, audio: ["mp3"] } as never,
        uploadExtensions: ["png"],
      }),
    ).rejects.toThrow();
  });
});
