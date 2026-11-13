-- Additive: per-bot translation settings. Older releases never read or write
-- the new columns; new columns are nullable or defaulted, so the previous
-- release keeps working.
ALTER TABLE "bots" ADD COLUMN "translationModelProvider" TEXT;
ALTER TABLE "bots" ADD COLUMN "translationModelId" TEXT;
ALTER TABLE "bots" ADD COLUMN "translationSourceLanguage" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "bots" ADD COLUMN "translationTargetLanguage" TEXT;
ALTER TABLE "bots" ADD COLUMN "autoTranslate" BOOLEAN NOT NULL DEFAULT false;
