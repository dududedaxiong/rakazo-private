-- Additive: per-bot video and image generation models as ordered JSON lists
-- [{provider, model}] (first is primary, rest are fallbacks), plus named
-- prompt presets per kind and the active preset's name. Older releases never
-- read or write the new columns; new columns are nullable, so the previous
-- release keeps working.
ALTER TABLE "bots" ADD COLUMN "videoModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "imageModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "videoPromptPresets" JSONB;
ALTER TABLE "bots" ADD COLUMN "activeVideoPromptPreset" TEXT;
ALTER TABLE "bots" ADD COLUMN "imagePromptPresets" JSONB;
ALTER TABLE "bots" ADD COLUMN "activeImagePromptPreset" TEXT;
