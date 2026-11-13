-- Additive: a user's saved messages and message translations, shared by web
-- and mobile. Older releases never read or write the new table, so the
-- previous release keeps working.
CREATE TABLE "message_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_favorites_pkey" PRIMARY KEY ("id")
);

-- One favorite per message per bot; a translation favorite keeps the same
-- message id with a `:translation` suffix.
CREATE UNIQUE INDEX "message_favorites_userId_spaceId_botId_messageId_key" ON "message_favorites"("userId", "spaceId", "botId", "messageId");
CREATE INDEX "message_favorites_userId_spaceId_botId_createdAt_idx" ON "message_favorites"("userId", "spaceId", "botId", "createdAt");

ALTER TABLE "message_favorites" ADD CONSTRAINT "message_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_favorites" ADD CONSTRAINT "message_favorites_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_favorites" ADD CONSTRAINT "message_favorites_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
