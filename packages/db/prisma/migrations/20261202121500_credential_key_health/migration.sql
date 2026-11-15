-- Additive: last key-health probe outcome per connection. NULL until the
-- first check, so old rows and old releases are unaffected. Only the status
-- and check time are stored, never the key. The previous release never reads
-- or writes the new columns.
ALTER TABLE "user_model_credentials" ADD COLUMN "keyHealthStatus" TEXT;
ALTER TABLE "user_model_credentials" ADD COLUMN "keyHealthCheckedAt" TIMESTAMP(3);
