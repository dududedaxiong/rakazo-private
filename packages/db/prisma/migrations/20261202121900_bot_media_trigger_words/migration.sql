-- Additive: per-bot media trigger words. New columns are nullable, so the
-- previous release never reads or writes them.
ALTER TABLE "bots" ADD COLUMN "videoTriggerWords" TEXT;
ALTER TABLE "bots" ADD COLUMN "imageTriggerWords" TEXT;
