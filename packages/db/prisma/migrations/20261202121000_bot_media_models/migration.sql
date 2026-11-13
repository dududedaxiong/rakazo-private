-- Additive: per-bot video and image generation models. Older releases never read or write
-- the new columns; new columns are nullable, so the previous release keeps working.
ALTER TABLE "bots" ADD COLUMN "videoModelProvider" TEXT;
ALTER TABLE "bots" ADD COLUMN "videoModelId" TEXT;
ALTER TABLE "bots" ADD COLUMN "imageModelProvider" TEXT;
ALTER TABLE "bots" ADD COLUMN "imageModelId" TEXT;
