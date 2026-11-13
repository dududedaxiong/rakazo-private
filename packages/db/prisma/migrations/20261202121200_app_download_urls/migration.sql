-- Additive: admin-set custom app download addresses, one per platform.
-- Null means unset; the menu hides that platform and shows a not-configured
-- note when both are unset. The previous release ignores the new columns.
ALTER TABLE "deployment_settings" ADD COLUMN "androidAppDownloadUrl" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "iosAppDownloadUrl" TEXT;
