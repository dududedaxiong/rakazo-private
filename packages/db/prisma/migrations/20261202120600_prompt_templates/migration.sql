-- Additive: prompt templates. Older releases never read or write the new table and columns;
-- new columns are nullable or defaulted, so the previous release keeps working.
ALTER TABLE "user" ADD COLUMN "promptTemplatesSeededAt" TIMESTAMP(3);
ALTER TABLE "bots" ADD COLUMN "promptTemplateId" TEXT;

CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prompt_templates_userId_name_key" ON "prompt_templates"("userId", "name");
CREATE INDEX "prompt_templates_userId_updatedAt_idx" ON "prompt_templates"("userId", "updatedAt");

ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
