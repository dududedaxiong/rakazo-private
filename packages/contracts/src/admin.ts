import * as z from "zod";
import { SecurityEventSchema } from "./security-events.js";

/**
 * Super-admin backend contracts: registration controls, invite codes, user management,
 * and per-IP registration stats. Admin-only routes; see `admin` in rpc.ts.
 */

/** Registration controls as the admin page shows them. */
export const RegistrationSettingsSchema = z.object({
  /** Effective registration state: the environment master switch and the email switch. */
  signupsEnabled: z.boolean(),
  /** The environment master switch; read-only in the admin page. */
  masterSwitchEnabled: z.boolean(),
  emailSignupEnabled: z.boolean(),
  inviteCodeEnabled: z.boolean(),
  signupAllowlist: z.array(z.string()),
  ipRegistrationLimit: z.number().int(),
  ipRegistrationHourlyThreshold: z.number().int(),
  ipCollectiveBanEnabled: z.boolean(),
  referralCodeEnabled: z.boolean(),
  referralCodeMaxUses: z.number().int(),
});
export type RegistrationSettings = z.infer<typeof RegistrationSettingsSchema>;

export const RegistrationSettingsUpdateSchema = z
  .object({
    emailSignupEnabled: z.boolean().optional(),
    inviteCodeEnabled: z.boolean().optional(),
    signupAllowlist: z.array(z.string().max(320)).max(200).optional(),
    ipRegistrationLimit: z.number().int().min(0).max(10000).optional(),
    ipRegistrationHourlyThreshold: z.number().int().min(0).max(10000).optional(),
    ipCollectiveBanEnabled: z.boolean().optional(),
    referralCodeEnabled: z.boolean().optional(),
    referralCodeMaxUses: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (input) =>
      input.emailSignupEnabled !== undefined ||
      input.inviteCodeEnabled !== undefined ||
      input.signupAllowlist !== undefined ||
      input.ipRegistrationLimit !== undefined ||
      input.ipRegistrationHourlyThreshold !== undefined ||
      input.ipCollectiveBanEnabled !== undefined ||
      input.referralCodeEnabled !== undefined ||
      input.referralCodeMaxUses !== undefined,
    { message: "Nothing to update" },
  );
export type RegistrationSettingsUpdate = z.infer<typeof RegistrationSettingsUpdateSchema>;

/** Admin-set custom app download addresses, one per platform; null means unset. */
export const AppDownloadLinksSchema = z.object({
  androidUrl: z.string().nullable(),
  iosUrl: z.string().nullable(),
});
export type AppDownloadLinks = z.infer<typeof AppDownloadLinksSchema>;

export const AppDownloadLinksUpdateSchema = z
  .object({
    androidUrl: z.string().url().max(2048).nullable().optional(),
    iosUrl: z.string().url().max(2048).nullable().optional(),
  })
  .refine((input) => input.androidUrl !== undefined || input.iosUrl !== undefined, {
    message: "Nothing to update",
  });
export type AppDownloadLinksUpdate = z.infer<typeof AppDownloadLinksUpdateSchema>;

export const InviteCodeStatusSchema = z.enum(["active", "expired", "revoked", "exhausted"]);
export type InviteCodeStatus = z.infer<typeof InviteCodeStatusSchema>;

export const InviteCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  createdById: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  maxUses: z.number().int(),
  usedCount: z.number().int(),
  revokedAt: z.string().nullable(),
  isReferral: z.boolean(),
  status: InviteCodeStatusSchema,
});
export type InviteCode = z.infer<typeof InviteCodeSchema>;

export const InviteCodeCreateInputSchema = z.object({
  count: z.number().int().min(1).max(100),
  /** Days until expiry; null means the codes never expire. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  maxUses: z.number().int().min(1).max(100).default(1),
  /**
   * Custom codes to create, one per entry; when non-empty, count is ignored and
   * exactly these codes are created. Blank entries are skipped.
   */
  codes: z.array(z.string().max(64)).max(100).optional(),
});
export type InviteCodeCreateInput = z.infer<typeof InviteCodeCreateInputSchema>;

export const InviteCodeListInputSchema = z.object({
  status: InviteCodeStatusSchema.optional(),
  /** The id of the last code on the previous page; the next page starts just after it. */
  cursor: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type InviteCodeListInput = z.infer<typeof InviteCodeListInputSchema>;

export const AdminUserStatusSchema = z.enum(["active", "disabled", "blacklisted", "deleted"]);
export type AdminUserStatus = z.infer<typeof AdminUserStatusSchema>;

export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
  registrationIp: z.string().nullable(),
  status: AdminUserStatusSchema,
  deactivatedAt: z.string().nullable(),
  blacklistedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListInputSchema = z.object({
  query: z.string().max(128).optional(),
  status: AdminUserStatusSchema.optional(),
  /** The id of the last user on the previous page; the next page starts just after it. */
  cursor: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type AdminUserListInput = z.infer<typeof AdminUserListInputSchema>;

export const IpRegistrationStatSchema = z.object({
  ip: z.string(),
  todayCount: z.number().int(),
  totalCount: z.number().int(),
  lastRegisteredAt: z.string().nullable(),
  status: z.enum(["normal", "limited"]),
});
export type IpRegistrationStat = z.infer<typeof IpRegistrationStatSchema>;

export const IpRegistrationStatListInputSchema = z.object({
  /** The IP of the last row on the previous page; the next page starts just after it. */
  cursor: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type IpRegistrationStatListInput = z.infer<typeof IpRegistrationStatListInputSchema>;

/** One day of the overview's seven-day registration trend, oldest first. */
export const AdminOverviewDaySchema = z.object({
  date: z.string(),
  count: z.number().int().min(0),
});
export type AdminOverviewDay = z.infer<typeof AdminOverviewDaySchema>;

/** Registration and account-safety totals for the admin overview page. */
export const AdminOverviewSchema = z.object({
  totalUsers: z.number().int().min(0),
  todayNew: z.number().int().min(0),
  weekNew: z.number().int().min(0),
  disabledCount: z.number().int().min(0),
  blacklistedCount: z.number().int().min(0),
  collectiveBanCount: z.number().int().min(0),
  collectiveBanAccounts: z.number().int().min(0),
  dailyNew: z.array(AdminOverviewDaySchema),
  recentEvents: z.array(SecurityEventSchema),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

/** Outbound email provider the admin picks in the email settings page. */
export const EmailProviderSchema = z.enum(["resend", "smtp", "selfhost", "none"]);
export type EmailProvider = z.infer<typeof EmailProviderSchema>;

/** Where the effective email configuration comes from. */
export const EmailSettingsSourceSchema = z.enum(["database", "environment", "none"]);
export type EmailSettingsSource = z.infer<typeof EmailSettingsSourceSchema>;

/** Email settings as the admin page shows them. Secrets are never returned. */
export const EmailSettingsSchema = z.object({
  provider: EmailProviderSchema,
  from: z.string(),
  replyTo: z.string().nullable(),
  apiKeyConfigured: z.boolean(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().nullable(),
  smtpUser: z.string().nullable(),
  smtpPasswordConfigured: z.boolean(),
  source: EmailSettingsSourceSchema,
});
export type EmailSettings = z.infer<typeof EmailSettingsSchema>;

export const EmailSettingsUpdateSchema = z
  .object({
    provider: EmailProviderSchema.optional(),
    from: z.email().max(320).optional(),
    replyTo: z.email().max(320).nullable().optional(),
    /** Empty string keeps the saved key; null clears it. */
    apiKey: z.string().max(512).nullable().optional(),
    smtpHost: z.string().max(253).nullable().optional(),
    smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
    smtpUser: z.string().max(320).nullable().optional(),
    /** Empty string keeps the saved password; null clears it. */
    smtpPassword: z.string().max(512).nullable().optional(),
  })
  .refine(
    (input) =>
      input.provider !== undefined ||
      input.from !== undefined ||
      input.replyTo !== undefined ||
      input.apiKey !== undefined ||
      input.smtpHost !== undefined ||
      input.smtpPort !== undefined ||
      input.smtpUser !== undefined ||
      input.smtpPassword !== undefined,
    { message: "Nothing to update" },
  );
export type EmailSettingsUpdate = z.infer<typeof EmailSettingsUpdateSchema>;

/** Admin TOTP state for the current session. */
export const AdminTwoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  /** This session already proved a code (or recovery code). */
  verified: z.boolean(),
  recoveryCodesRemaining: z.number().int().min(0),
});
export type AdminTwoFactorStatus = z.infer<typeof AdminTwoFactorStatusSchema>;

/** Enrollment material: the otpauth URI for the QR code, plus the secret for manual entry. */
export const AdminTwoFactorEnrollSchema = z.object({
  otpauthUri: z.string(),
  secret: z.string(),
});
export type AdminTwoFactorEnroll = z.infer<typeof AdminTwoFactorEnrollSchema>;

/** Recovery codes are shown once, at enrollment. */
export const AdminTwoFactorConfirmSchema = z.object({
  recoveryCodes: z.array(z.string()),
});
export type AdminTwoFactorConfirm = z.infer<typeof AdminTwoFactorConfirmSchema>;

/** Super-key gate state for the current session. */
export const AdminSuperKeyStatusSchema = z.object({
  /** A grant is live for this session. */
  granted: z.boolean(),
  /** When the live grant expires; null when none. */
  expiresAt: z.string().nullable(),
  /** Any key exists at all (database or environment); without one the gate cannot open. */
  configured: z.boolean(),
});
export type AdminSuperKeyStatus = z.infer<typeof AdminSuperKeyStatusSchema>;
