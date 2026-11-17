import { ORPCError } from "@orpc/server";
import type { SecretStore, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { configuredEmailProvider as providerFor } from "@rakazo/adapters";
import type {
  EmailProvider,
  EmailSettings,
  EmailSettingsSource,
  EmailSettingsUpdate,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { AppEnv } from "./env.js";

export function configuredEmailProvider(
  env: Pick<AppEnv, "emailProvider" | "emailApiKey" | "emailFrom" | "emailReplyTo" | "smtpUrl">,
): TransactionalEmailProvider | undefined {
  return providerFor({
    provider: env.emailProvider,
    apiKey: env.emailApiKey,
    from: env.emailFrom,
    replyTo: env.emailReplyTo,
    smtpUrl: env.smtpUrl,
  });
}

/** SecretStore record ids for the deployment-owned email credentials. */
export const DEPLOYMENT_EMAIL_API_KEY_RECORD = "deployment-email-api-key";
export const DEPLOYMENT_EMAIL_SMTP_PASSWORD_RECORD = "deployment-email-smtp-password";

/**
 * What the API reads the deployment's email configuration from: the database
 * row (written by the admin settings page), the server's environment, and the
 * SecretStore for the two credentials. The worker keeps its own environment
 * provider, so bot mail does not follow the page until that is moved to a
 * shared package.
 */
export type EmailConfigDeps = {
  prisma: PrismaClient;
  secrets: SecretStore;
  env: {
    emailProvider?: string;
    emailApiKey?: string;
    emailFrom?: string;
    emailReplyTo?: string;
    smtpUrl?: string;
  };
};

type EmailSettingsRow = {
  emailProvider: string | null;
  emailFrom: string | null;
  emailReplyTo: string | null;
  emailApiKeyCipher: string | null;
  emailSmtpHost: string | null;
  emailSmtpPort: number | null;
  emailSmtpUser: string | null;
  emailSmtpPasswordCipher: string | null;
};

async function readEmailSettingsRow(prisma: PrismaClient): Promise<EmailSettingsRow | null> {
  return runAsSystem("read the deployment email settings", () =>
    prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: {
        emailProvider: true,
        emailFrom: true,
        emailReplyTo: true,
        emailApiKeyCipher: true,
        emailSmtpHost: true,
        emailSmtpPort: true,
        emailSmtpUser: true,
        emailSmtpPasswordCipher: true,
      },
    }),
  );
}

async function openEmailSecret(
  secrets: SecretStore,
  ciphertext: string | null,
  recordId: string,
): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return await secrets.load(ciphertext, recordId);
  } catch {
    getLogger().warn("email.decrypt_failed", { record: recordId });
    return null;
  }
}

function parseSmtpUrlParts(url: string | undefined): {
  host: string;
  port: number | null;
  user: string;
  password: string;
} | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : null,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
  } catch {
    return null;
  }
}

function smtpUrlFromParts(
  fields: Pick<EmailConfigFields, "smtpHost" | "smtpPort" | "smtpUser">,
  password: string | null,
): string | undefined {
  if (!fields.smtpHost) return undefined;
  const scheme = fields.smtpPort === 465 ? "smtps" : "smtp";
  const auth = fields.smtpUser
    ? `${encodeURIComponent(fields.smtpUser)}:${encodeURIComponent(password ?? "")}@`
    : "";
  return `${scheme}://${auth}${fields.smtpHost}:${fields.smtpPort ?? 587}`;
}

function normalizeEmailProvider(value: string | null | undefined): EmailProvider | undefined {
  if (value === "resend" || value === "smtp" || value === "selfhost" || value === "none")
    return value;
  return undefined;
}

type EmailConfigFields = {
  provider: string | null;
  from: string | null;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
};

type EffectiveEmailConfig = {
  provider: EmailProvider;
  from: string;
  replyTo: string | null;
  apiKey: string | undefined;
  smtpUrl: string | undefined;
  smtpUser: string;
  smtpPassword: string | undefined;
};

/** Database first, environment second, field by field. */
function effectiveEmailConfig(
  fields: EmailConfigFields,
  credentials: { apiKey?: string | null; smtpPassword?: string | null },
  env: EmailConfigDeps["env"],
): EffectiveEmailConfig {
  const envSmtp = parseSmtpUrlParts(env.smtpUrl);
  const dbSmtpUrl = smtpUrlFromParts(fields, credentials.smtpPassword ?? null);
  const smtpUrl = dbSmtpUrl ?? env.smtpUrl;
  const provider =
    normalizeEmailProvider(fields.provider) ??
    normalizeEmailProvider(env.emailProvider) ??
    (smtpUrl ? "smtp" : "none");
  const apiKey = credentials.apiKey ?? env.emailApiKey ?? undefined;
  const smtpPassword = credentials.smtpPassword ?? envSmtp?.password ?? undefined;
  return {
    provider,
    from: fields.from ?? env.emailFrom ?? "",
    replyTo: fields.replyTo ?? env.emailReplyTo ?? null,
    apiKey: apiKey || undefined,
    smtpUrl,
    smtpUser: fields.smtpUser ?? envSmtp?.user ?? "",
    smtpPassword: smtpPassword || undefined,
  };
}

type ResolvedEmailConfig = EffectiveEmailConfig & {
  source: EmailSettingsSource;
  row: EmailSettingsRow | null;
  dbApiKey: string | null;
  dbSmtpPassword: string | null;
};

async function resolveEmailConfig(deps: EmailConfigDeps): Promise<ResolvedEmailConfig> {
  const row = await readEmailSettingsRow(deps.prisma);
  const [dbApiKey, dbSmtpPassword] = await Promise.all([
    openEmailSecret(deps.secrets, row?.emailApiKeyCipher ?? null, DEPLOYMENT_EMAIL_API_KEY_RECORD),
    openEmailSecret(
      deps.secrets,
      row?.emailSmtpPasswordCipher ?? null,
      DEPLOYMENT_EMAIL_SMTP_PASSWORD_RECORD,
    ),
  ]);
  const effective = effectiveEmailConfig(
    {
      provider: row?.emailProvider ?? null,
      from: row?.emailFrom ?? null,
      replyTo: row?.emailReplyTo ?? null,
      smtpHost: row?.emailSmtpHost ?? null,
      smtpPort: row?.emailSmtpPort ?? null,
      smtpUser: row?.emailSmtpUser ?? null,
    },
    { apiKey: dbApiKey, smtpPassword: dbSmtpPassword },
    deps.env,
  );
  const hasDatabaseValue = Boolean(
    row &&
      (row.emailProvider !== null ||
        row.emailFrom !== null ||
        row.emailReplyTo !== null ||
        row.emailApiKeyCipher !== null ||
        row.emailSmtpHost !== null ||
        row.emailSmtpPort !== null ||
        row.emailSmtpUser !== null ||
        row.emailSmtpPasswordCipher !== null),
  );
  const source: EmailSettingsSource = hasDatabaseValue
    ? "database"
    : effective.provider === "none"
      ? "none"
      : "environment";
  return { ...effective, source, row, dbApiKey, dbSmtpPassword };
}

/** The settings page view. Secrets are never returned, only whether one is set. */
export async function readEmailSettings(deps: EmailConfigDeps): Promise<EmailSettings> {
  const config = await resolveEmailConfig(deps);
  const envSmtp = parseSmtpUrlParts(deps.env.smtpUrl);
  return {
    provider: config.provider,
    from: config.from,
    replyTo: config.replyTo,
    apiKeyConfigured: Boolean(config.apiKey),
    smtpHost: config.row?.emailSmtpHost ?? envSmtp?.host ?? null,
    smtpPort: config.row?.emailSmtpPort ?? envSmtp?.port ?? null,
    smtpUser: config.row?.emailSmtpUser ?? envSmtp?.user ?? null,
    smtpPasswordConfigured: Boolean(config.smtpPassword),
    source: config.source,
  };
}

function validateEmailConfig(effective: EffectiveEmailConfig): void {
  if (effective.provider === "resend" && !effective.apiKey) {
    throw new ORPCError("BAD_REQUEST", { message: "Resend API key is required" });
  }
  if (effective.provider === "smtp" || effective.provider === "selfhost") {
    if (!effective.smtpUrl) {
      throw new ORPCError("BAD_REQUEST", { message: "SMTP host is required" });
    }
  }
  if (effective.provider !== "none" && !effective.from) {
    throw new ORPCError("BAD_REQUEST", { message: "From address is required" });
  }
}

async function sealEmailSecret(
  deps: EmailConfigDeps,
  actor: { userId: string; spaceId: string },
  value: string,
  recordId: string,
): Promise<string> {
  const stored = await deps.secrets.put(
    value,
    {
      operationId: "admin-email-settings",
      traceId: "admin-email-settings",
      spaceId: actor.spaceId,
      userId: actor.userId,
      signal: new AbortController().signal,
    },
    { recordId },
  );
  return stored.ciphertext;
}

/**
 * Saves the page's email configuration. Plain fields: undefined keeps, null
 * clears. Secrets: empty string keeps, null clears, a value replaces. The
 * merged effective config is validated before anything is written, and saving
 * takes effect on the next send with no restart.
 */
export async function updateEmailSettings(
  deps: EmailConfigDeps,
  actor: { userId: string; spaceId: string },
  input: EmailSettingsUpdate,
): Promise<EmailSettings> {
  const current = await resolveEmailConfig(deps);
  // The credentials in effect after this update. New values are only used to
  // validate here, never stored or logged in clear.
  const nextApiKey =
    input.apiKey === undefined || input.apiKey === "" ? current.dbApiKey : input.apiKey;
  const nextSmtpPassword =
    input.smtpPassword === undefined || input.smtpPassword === ""
      ? current.dbSmtpPassword
      : input.smtpPassword;
  const nextFields: EmailConfigFields = {
    provider: input.provider ?? current.row?.emailProvider ?? null,
    from: input.from ?? current.row?.emailFrom ?? null,
    replyTo: input.replyTo ?? current.row?.emailReplyTo ?? null,
    smtpHost:
      input.smtpHost === undefined ? (current.row?.emailSmtpHost ?? null) : input.smtpHost || null,
    smtpPort: input.smtpPort ?? current.row?.emailSmtpPort ?? null,
    smtpUser:
      input.smtpUser === undefined ? (current.row?.emailSmtpUser ?? null) : input.smtpUser || null,
  };
  const effective = effectiveEmailConfig(
    nextFields,
    { apiKey: nextApiKey, smtpPassword: nextSmtpPassword },
    deps.env,
  );
  validateEmailConfig(effective);
  const apiKeyCipher =
    input.apiKey === undefined || input.apiKey === "" || input.apiKey === null
      ? undefined
      : await sealEmailSecret(deps, actor, input.apiKey, DEPLOYMENT_EMAIL_API_KEY_RECORD);
  const smtpPasswordCipher =
    input.smtpPassword === undefined || input.smtpPassword === "" || input.smtpPassword === null
      ? undefined
      : await sealEmailSecret(
          deps,
          actor,
          input.smtpPassword,
          DEPLOYMENT_EMAIL_SMTP_PASSWORD_RECORD,
        );
  const data: {
    emailProvider?: string | null;
    emailFrom?: string | null;
    emailReplyTo?: string | null;
    emailApiKeyCipher?: string | null;
    emailSmtpHost?: string | null;
    emailSmtpPort?: number | null;
    emailSmtpUser?: string | null;
    emailSmtpPasswordCipher?: string | null;
  } = {};
  if (input.provider !== undefined) data.emailProvider = input.provider;
  if (input.from !== undefined) data.emailFrom = input.from;
  if (input.replyTo !== undefined) data.emailReplyTo = input.replyTo;
  if (input.smtpHost !== undefined) data.emailSmtpHost = input.smtpHost || null;
  if (input.smtpPort !== undefined) data.emailSmtpPort = input.smtpPort;
  if (input.smtpUser !== undefined) data.emailSmtpUser = input.smtpUser || null;
  if (input.apiKey !== undefined)
    data.emailApiKeyCipher = input.apiKey === null ? null : apiKeyCipher;
  if (input.smtpPassword !== undefined)
    data.emailSmtpPasswordCipher = input.smtpPassword === null ? null : smtpPasswordCipher;
  if (Object.values(data).every((value) => value === undefined)) {
    return readEmailSettings(deps);
  }
  await runAsSystem("save the deployment email settings", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    }),
  );
  // The replaced ciphers are no longer referenced; drop them best-effort.
  if (input.apiKey !== undefined && current.row?.emailApiKeyCipher) {
    await deps.secrets
      .delete(current.row.emailApiKeyCipher, DEPLOYMENT_EMAIL_API_KEY_RECORD)
      .catch(() => undefined);
  }
  if (input.smtpPassword !== undefined && current.row?.emailSmtpPasswordCipher) {
    await deps.secrets
      .delete(current.row.emailSmtpPasswordCipher, DEPLOYMENT_EMAIL_SMTP_PASSWORD_RECORD)
      .catch(() => undefined);
  }
  return readEmailSettings(deps);
}

/** Drops the page's email configuration; the environment values take over again. */
export async function clearEmailSettings(deps: EmailConfigDeps): Promise<EmailSettings> {
  const current = await resolveEmailConfig(deps);
  await runAsSystem("clear the deployment email settings", () =>
    deps.prisma.deploymentSettings.updateMany({
      where: { id: "default" },
      data: {
        emailProvider: null,
        emailFrom: null,
        emailReplyTo: null,
        emailApiKeyCipher: null,
        emailSmtpHost: null,
        emailSmtpPort: null,
        emailSmtpUser: null,
        emailSmtpPasswordCipher: null,
      },
    }),
  );
  if (current.row?.emailApiKeyCipher) {
    await deps.secrets
      .delete(current.row.emailApiKeyCipher, DEPLOYMENT_EMAIL_API_KEY_RECORD)
      .catch(() => undefined);
  }
  if (current.row?.emailSmtpPasswordCipher) {
    await deps.secrets
      .delete(current.row.emailSmtpPasswordCipher, DEPLOYMENT_EMAIL_SMTP_PASSWORD_RECORD)
      .catch(() => undefined);
  }
  return readEmailSettings(deps);
}

function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message
    .replace(/:\/\/[^/\s]*@/g, "://***@")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** Sends a test message to the admin's own address through the effective provider. */
export async function testEmailSettings(
  deps: EmailConfigDeps,
  actor: { userId: string },
): Promise<{ ok: true }> {
  const provider = await resolveEmailProvider(deps);
  if (!provider) {
    throw new ORPCError("BAD_REQUEST", { message: "No email provider is configured" });
  }
  const user = await deps.prisma.user.findUnique({
    where: { id: actor.userId },
    select: { email: true },
  });
  if (!user) throw new ORPCError("NOT_FOUND");
  try {
    await provider.send({
      to: [user.email],
      subject: "Rakazo 测试邮件",
      text: "这是一封来自 Rakazo 管理设置的测试邮件。如果能看到它，说明出站邮件可以正常发送。",
    });
  } catch (error) {
    getLogger().warn("email.test_failed", {
      "error.name": error instanceof Error ? error.name : typeof error,
    });
    throw new ORPCError("INTERNAL_ERROR", {
      message: `Test email failed: ${sanitizeProviderError(error)}`,
    });
  }
  return { ok: true as const };
}

/** The provider for one send, resolved from the page config first, then the environment. */
export async function resolveEmailProvider(
  deps: EmailConfigDeps,
): Promise<TransactionalEmailProvider | undefined> {
  const config = await resolveEmailConfig(deps);
  if (config.provider === "none") return undefined;
  if (config.provider === "resend" && !config.apiKey) return undefined;
  if ((config.provider === "smtp" || config.provider === "selfhost") && !config.smtpUrl)
    return undefined;
  return providerFor({
    provider: config.provider === "selfhost" ? "smtp" : config.provider,
    apiKey: config.apiKey,
    from: config.from,
    replyTo: config.replyTo ?? undefined,
    smtpUrl: config.smtpUrl,
  });
}

/**
 * A provider that resolves the effective configuration on every send, so a
 * saved page change applies without a restart. Falls back to the given
 * provider (the local emulator in development) when nothing is configured.
 * In-flight deliveries are tracked so shutdown can wait for them.
 */
export function createResolvingEmailProvider(
  deps: EmailConfigDeps,
  fallback?: TransactionalEmailProvider,
): TransactionalEmailProvider {
  const inFlight = new Set<Promise<void>>();
  return {
    describe: () => ({
      id: "dynamic-email",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { transactional: true },
    }),
    send: async (message) => {
      const provider = (await resolveEmailProvider(deps)) ?? fallback;
      if (!provider) {
        // No provider anywhere: behave as before the resolving provider, when
        // the email slot was empty and verification mail simply was not sent.
        getLogger().warn("email.not_configured", { "email.subject": message.subject });
        return;
      }
      const delivery = provider.send(message);
      inFlight.add(delivery);
      try {
        await delivery;
      } finally {
        inFlight.delete(delivery);
      }
    },
    drain: async () => {
      await Promise.allSettled([...inFlight]);
    },
  };
}
