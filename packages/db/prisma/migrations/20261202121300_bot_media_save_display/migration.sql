-- Additive: per-bot save directories for generated images and videos, and
-- toggles for which actions show on generated media (favorite, share,
-- preview, download). A save directory is null when unset, meaning the
-- default location; the toggles default to true (shown). Older releases
-- never read or write the new columns, so the previous release keeps
-- working.
ALTER TABLE "bots" ADD COLUMN "imageSaveDirectory" TEXT;
ALTER TABLE "bots" ADD COLUMN "videoSaveDirectory" TEXT;
ALTER TABLE "bots" ADD COLUMN "showMediaFavorite" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "bots" ADD COLUMN "showMediaShare" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "bots" ADD COLUMN "showMediaPreview" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "bots" ADD COLUMN "showMediaDownload" BOOLEAN NOT NULL DEFAULT true;
