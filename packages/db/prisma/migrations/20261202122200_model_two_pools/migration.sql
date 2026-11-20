-- Additive: two model pools (main pool, then backup pool). New columns are
-- nullable, so the previous release never reads or writes them; readers split
-- the old single list (first entry -> main pool, rest -> backup pool) while
-- the backup column is null, and rows with a null pool split by position
-- (position 0 -> main pool, rest -> backup pool).
ALTER TABLE "bots" ADD COLUMN "translationBackupModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "videoBackupModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "imageBackupModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "imageEditBackupModels" JSONB;
ALTER TABLE "bots" ADD COLUMN "videoEditBackupModels" JSONB;
ALTER TABLE "user_model_role_choices" ADD COLUMN "pool" TEXT;
ALTER TABLE "space_model_role_choices" ADD COLUMN "pool" TEXT;
