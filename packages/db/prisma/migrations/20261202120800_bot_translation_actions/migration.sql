-- Additive: per-bot toggle for the read-aloud, share, and favorite actions
-- on a translation. Older releases never read or write the new column; it is
-- defaulted, so the previous release keeps working.
ALTER TABLE "bots" ADD COLUMN "showTranslationActions" BOOLEAN NOT NULL DEFAULT true;
