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
  })
  .refine(
    (input) =>
      input.emailSignupEnabled !== undefined ||
      input.inviteCodeEnabled !== undefined ||
      input.signupAllowlist !== undefined ||
      input.ipRegistrationLimit !== undefined ||
      input.ipRegistrationHourlyThreshold !== undefined ||
      input.ipCollectiveBanEnabled !== undefined,
    { message: "Nothing to update" },
  );
export type RegistrationSettingsUpdate = z.infer<typeof RegistrationSettingsUpdateSchema>;

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
  status: InviteCodeStatusSchema,
});
export type InviteCode = z.infer<typeof InviteCodeSchema>;

export const InviteCodeCreateInputSchema = z.object({
  count: z.number().int().min(1).max(100),
  /** Days until expiry; null means the codes never expire. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  maxUses: z.number().int().min(1).max(100).default(1),
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
