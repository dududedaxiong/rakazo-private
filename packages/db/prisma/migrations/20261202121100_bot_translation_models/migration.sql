-- Additive: per-bot translation models as an ordered JSON list
-- [{provider, model}] (first is primary, rest are fallbacks). A bot's existing
-- single translation model moves into a one-element list; the old columns stay
-- and keep mirroring the list's first entry, so the previous release keeps
-- working.
ALTER TABLE "bots" ADD COLUMN "translationModels" JSONB;
UPDATE "bots"
SET "translationModels" = jsonb_build_array(
  jsonb_build_object('provider', "translationModelProvider", 'model', "translationModelId")
)
WHERE "translationModelProvider" IS NOT NULL AND "translationModelId" IS NOT NULL;
