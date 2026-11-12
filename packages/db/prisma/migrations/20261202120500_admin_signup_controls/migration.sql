-- Additive: admin signup controls. Older releases never read or write the new columns and
-- tables; new columns are nullable or defaulted, so the previous release keeps working.
ALTER TABLE "user" ADD COLUMN "blacklistedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "deployment_settings" ADD COLUMN "inviteCodeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deployment_settings" ADD COLUMN "ipRegistrationLimit" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "deployment_settings" ADD COLUMN "ipRegistrationHourlyThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "deployment_settings" ADD COLUMN "ipCollectiveBanEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "invite_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invite_code_redemptions" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_code_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "signup_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");
CREATE UNIQUE INDEX "invite_code_redemptions_codeId_email_key" ON "invite_code_redemptions"("codeId", "email");
CREATE INDEX "invite_code_redemptions_codeId_idx" ON "invite_code_redemptions"("codeId");
CREATE INDEX "invite_code_redemptions_userId_idx" ON "invite_code_redemptions"("userId");
CREATE UNIQUE INDEX "signup_records_userId_key" ON "signup_records"("userId");
CREATE INDEX "signup_records_ip_createdAt_idx" ON "signup_records"("ip", "createdAt");

ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invite_code_redemptions" ADD CONSTRAINT "invite_code_redemptions_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "invite_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invite_code_redemptions" ADD CONSTRAINT "invite_code_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "signup_records" ADD CONSTRAINT "signup_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
