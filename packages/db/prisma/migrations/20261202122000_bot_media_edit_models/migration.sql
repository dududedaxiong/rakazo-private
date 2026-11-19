-- Additive: per-bot media edit models. New columns are nullable, so the
-- previous release never reads or writes them.
ALTER TABLE "bots" ADD COLUMN "imageEditModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "videoEditModels" JSONB;
