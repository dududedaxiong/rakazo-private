-- Additive: personal referral codes and their admin settings. New columns have
-- defaults, so the previous release never reads or writes them.
ALTER TABLE "invite_codes" ADD COLUMN "isReferral" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deployment_settings" ADD COLUMN "referralCodeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "deployment_settings" ADD COLUMN "referralCodeMaxUses" INTEGER NOT NULL DEFAULT 10;
