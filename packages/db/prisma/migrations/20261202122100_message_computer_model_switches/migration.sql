-- Additive: the computer-mode switch timeline on a message. The column is
-- nullable, so the previous release never reads or writes it.
ALTER TABLE "messages" ADD COLUMN "computerModelSwitches" JSONB;
