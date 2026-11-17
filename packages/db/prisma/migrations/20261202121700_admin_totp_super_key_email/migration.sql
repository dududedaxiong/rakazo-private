-- Additive: admin login TOTP, super-key grants, and editable outbound email settings.
-- New tables are only ever read or written as system; new columns are nullable, so
-- the previous release never reads or writes them.
ALTER TABLE "deployment_settings" ADD COLUMN "emailProvider" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "emailFrom" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "emailReplyTo" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "emailApiKeyCipher" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "emailSmtpHost" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "emailSmtpPort" INTEGER;
ALTER TABLE "deployment_settings" ADD COLUMN "emailSmtpUser" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "emailSmtpPasswordCipher" TEXT;

ALTER TABLE "session" ADD COLUMN "totpVerifiedAt" TIMESTAMP(3);

CREATE TABLE "admin_super_key_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_super_key_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_super_key_grants_sessionId_key" ON "admin_super_key_grants"("sessionId");

CREATE INDEX "admin_super_key_grants_userId_createdAt_idx" ON "admin_super_key_grants"("userId", "createdAt");

ALTER TABLE "admin_super_key_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_super_key_grants_system ON "admin_super_key_grants"
  USING ((SELECT app_rls_bypass()));

CREATE TABLE "admin_totp_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_totp_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_totp_recovery_codes_userId_createdAt_idx" ON "admin_totp_recovery_codes"("userId", "createdAt");

ALTER TABLE "admin_totp_recovery_codes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_totp_recovery_codes_system ON "admin_totp_recovery_codes"
  USING ((SELECT app_rls_bypass()));
