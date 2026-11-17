import type { TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { EncryptedSecretStore } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import {
  clearEmailSettings,
  createResolvingEmailProvider,
  DEPLOYMENT_EMAIL_API_KEY_RECORD,
  readEmailSettings,
  resolveEmailProvider,
  testEmailSettings,
  updateEmailSettings,
} from "./email.js";

type Row = Record<string, unknown>;

const defined = (data: Row): Row =>
  Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));

function fixture(env: Record<string, string | undefined> = {}) {
  let settingsRow: Row | null = null;
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) =>
        where.id === "admin-1" ? { id: "admin-1", email: "admin@example.com" } : null,
    },
    deploymentSettings: {
      findUnique: async () => (settingsRow ? { ...settingsRow } : null),
      upsert: async ({ create, update }: { create: Row; update: Row }) => {
        settingsRow = settingsRow
          ? { ...settingsRow, ...defined(update) }
          : { ...defined(create), ...defined(update) };
        return { ...settingsRow };
      },
      updateMany: async ({ data }: { data: Row }) => {
        if (settingsRow) Object.assign(settingsRow, defined(data));
        return { count: settingsRow ? 1 : 0 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  const secrets = new EncryptedSecretStore("test-only-encryption-key");
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    secrets,
    env: {
      emailProvider: env.emailProvider,
      emailApiKey: env.emailApiKey,
      emailFrom: env.emailFrom,
      emailReplyTo: env.emailReplyTo,
      smtpUrl: env.smtpUrl,
    },
  };
  const actor = { userId: "admin-1", spaceId: "space-1" };
  return {
    deps,
    actor,
    secrets,
    settingsRow: () => settingsRow,
  };
}

describe("admin email settings", () => {
  it("reads the environment configuration when the page has none", async () => {
    const { deps } = fixture({
      emailProvider: "resend",
      emailApiKey: "env-key",
      emailFrom: "env@example.com",
      smtpUrl: "smtp://user:pass@smtp.example.test:587",
    });
    await expect(readEmailSettings(deps)).resolves.toEqual({
      provider: "resend",
      from: "env@example.com",
      replyTo: null,
      apiKeyConfigured: true,
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpUser: "user",
      smtpPasswordConfigured: true,
      source: "environment",
    });
  });

  it("reads nothing configured as none", async () => {
    const { deps } = fixture();
    await expect(readEmailSettings(deps)).resolves.toEqual(
      expect.objectContaining({ provider: "none", source: "none", apiKeyConfigured: false }),
    );
  });

  it("saves a Resend key encrypted, and the page takes over", async () => {
    const { deps, actor, secrets, settingsRow } = fixture({
      emailProvider: "resend",
      emailApiKey: "env-key",
      emailFrom: "env@example.com",
    });
    const saved = await updateEmailSettings(deps, actor, {
      provider: "resend",
      from: "page@example.com",
      apiKey: "page-key",
    });
    expect(saved).toEqual(
      expect.objectContaining({
        provider: "resend",
        from: "page@example.com",
        apiKeyConfigured: true,
        source: "database",
      }),
    );
    const row = settingsRow();
    expect(JSON.stringify(row)).not.toContain("page-key");
    expect(row?.emailApiKeyCipher).toBeTruthy();
    await expect(
      secrets.load(row?.emailApiKeyCipher as string, DEPLOYMENT_EMAIL_API_KEY_RECORD),
    ).resolves.toBe("page-key");
  });

  it("refuses Resend without a key from anywhere", async () => {
    const { deps, actor } = fixture({ emailFrom: "env@example.com" });
    await expect(
      updateEmailSettings(deps, actor, { provider: "resend", from: "page@example.com" }),
    ).rejects.toThrow("Resend API key is required");
  });

  it("refuses SMTP without a host", async () => {
    const { deps, actor } = fixture({ emailFrom: "env@example.com" });
    await expect(
      updateEmailSettings(deps, actor, { provider: "smtp", from: "page@example.com" }),
    ).rejects.toThrow("SMTP host is required");
  });

  it("lets a username stand without a password; the server refuses it at send time", async () => {
    const { deps, actor } = fixture({ emailFrom: "env@example.com" });
    const saved = await updateEmailSettings(deps, actor, {
      provider: "smtp",
      from: "page@example.com",
      smtpHost: "smtp.example.test",
      smtpUser: "user",
    });
    expect(saved.smtpPasswordConfigured).toBe(false);
  });

  it("keeps a saved secret when the field is left blank, and clears it on null", async () => {
    const { deps, actor } = fixture({ emailFrom: "env@example.com" });
    await updateEmailSettings(deps, actor, {
      provider: "smtp",
      from: "page@example.com",
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpUser: "user",
      smtpPassword: "page-password",
    });
    const kept = await updateEmailSettings(deps, actor, {
      smtpHost: "smtp.example.test",
      smtpPassword: "",
    });
    expect(kept.smtpPasswordConfigured).toBe(true);
    const cleared = await updateEmailSettings(deps, actor, { smtpPassword: null });
    expect(cleared.smtpPasswordConfigured).toBe(false);
  });

  it("resolves the page config first, mapping self-hosted SMTP", async () => {
    const { deps, actor } = fixture({
      emailProvider: "resend",
      emailApiKey: "env-key",
      emailFrom: "env@example.com",
    });
    await updateEmailSettings(deps, actor, {
      provider: "selfhost",
      from: "page@example.com",
      smtpHost: "smtp.example.test",
      smtpPort: 465,
    });
    const provider = await resolveEmailProvider(deps);
    expect(provider?.describe().id).toBe("smtp");
    await expect(readEmailSettings(deps)).resolves.toEqual(
      expect.objectContaining({ provider: "selfhost", source: "database" }),
    );
  });

  it("clears the page config and falls back to the environment", async () => {
    const { deps, actor } = fixture({
      emailProvider: "resend",
      emailApiKey: "env-key",
      emailFrom: "env@example.com",
    });
    await updateEmailSettings(deps, actor, {
      provider: "resend",
      from: "page@example.com",
      apiKey: "page-key",
    });
    const cleared = await clearEmailSettings(deps);
    expect(cleared).toEqual(
      expect.objectContaining({
        provider: "resend",
        from: "env@example.com",
        source: "environment",
      }),
    );
  });

  it("sends the test mail through the fallback when nothing is configured", async () => {
    const { deps } = fixture();
    await expect(testEmailSettings(deps, { userId: "admin-1" })).rejects.toThrow(
      "No email provider is configured",
    );
    const sent: unknown[] = [];
    const fallback = {
      describe: () => ({
        id: "fake",
        contractVersion: "1",
        adapterVersion: "0.1.0",
        capabilities: { transactional: true },
      }),
      send: async (message: unknown) => {
        sent.push(message);
      },
    } as unknown as TransactionalEmailProvider;
    const resolving = createResolvingEmailProvider(deps, fallback);
    await resolving.send({
      to: ["admin@example.com"],
      subject: "hello",
      text: "body",
    });
    expect(sent).toHaveLength(1);
    expect(resolving.describe().id).toBe("dynamic-email");
  });

  it("stays quiet without a provider or a fallback", async () => {
    const { deps } = fixture();
    const resolving = createResolvingEmailProvider(deps);
    await expect(
      resolving.send({ to: ["admin@example.com"], subject: "hello", text: "body" }),
    ).resolves.toBeUndefined();
    await expect(resolving.drain?.()).resolves.toBeUndefined();
  });

  it("rejects an unknown provider value instead of throwing at send time", async () => {
    const { deps } = fixture({ emailProvider: "typo", emailFrom: "env@example.com" });
    await expect(resolveEmailProvider(deps)).resolves.toBeUndefined();
  });
});
