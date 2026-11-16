-- Additive: a kept translation for one bot message, so it survives a reload.
-- Older releases never read or write the new table, so the previous release
-- keeps working.
CREATE TABLE "message_translations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "attempts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_translations_pkey" PRIMARY KEY ("id")
);

-- One kept translation per message and target language; re-translating
-- replaces it.
CREATE UNIQUE INDEX "message_translations_userId_spaceId_messageId_targetLanguage_key" ON "message_translations"("userId", "spaceId", "messageId", "targetLanguage");
CREATE INDEX "message_translations_userId_spaceId_messageId_idx" ON "message_translations"("userId", "spaceId", "messageId");

ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_translations" ADD CONSTRAINT "message_translations_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
