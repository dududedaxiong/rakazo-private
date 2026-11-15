-- Additive: per-message model-switch timeline. NULL when the first model
-- answered with no switch, so old rows and old releases are unaffected.
-- The previous release never reads or writes the new column.
ALTER TABLE "messages" ADD COLUMN "modelSwitches" JSONB;
