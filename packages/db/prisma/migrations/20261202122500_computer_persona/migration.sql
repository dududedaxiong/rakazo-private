-- Additive: computer persona setting (one prompt template per member, account
-- and Space copies). New tables only, so the previous release never reads or
-- writes them.
CREATE TABLE "user_computer_personas" (
    "userId" TEXT NOT NULL,
    "promptTemplateId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_computer_personas_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "space_computer_personas" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptTemplateId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_computer_personas_pkey" PRIMARY KEY ("spaceId", "userId")
);

-- AddForeignKey
ALTER TABLE "user_computer_personas" ADD CONSTRAINT "user_computer_personas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_computer_personas" ADD CONSTRAINT "user_computer_personas_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "space_computer_personas" ADD CONSTRAINT "space_computer_personas_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "space_computer_personas" ADD CONSTRAINT "space_computer_personas_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
