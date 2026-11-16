-- Additive: one link-shared snapshot of a thread. The row stores the
-- redacted snapshot itself, so the public read needs no thread access; the
-- link token is sealed in the secret store and only its hash lives here.
-- The previous release never reads or writes the new table.
CREATE TABLE "conversation_shares" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "secretId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_shares_tokenHash_key" ON "conversation_shares"("tokenHash");

CREATE UNIQUE INDEX "conversation_shares_secretId_key" ON "conversation_shares"("secretId");

CREATE INDEX "conversation_shares_threadId_createdAt_idx" ON "conversation_shares"("threadId", "createdAt");

ALTER TABLE "conversation_shares" ADD CONSTRAINT "conversation_shares_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_shares" ADD CONSTRAINT "conversation_shares_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A share belongs to its thread's Space; the public share read is a named
-- system lookup by token hash.
ALTER TABLE "conversation_shares" ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_shares_tenant ON "conversation_shares"
  USING (EXISTS (
    SELECT 1 FROM "threads" t
    WHERE t."id" = "conversation_shares"."threadId"
      AND t."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  ));
CREATE POLICY conversation_shares_system ON "conversation_shares"
  USING ((SELECT app_rls_bypass()));
