-- Additive: per-space misc settings (artifact category mapping and chat
-- upload formats). A new table, so the previous release never reads or
-- writes it.
CREATE TABLE "space_misc_configs" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_misc_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_misc_configs_spaceId_key" ON "space_misc_configs"("spaceId");

-- AddForeignKey
ALTER TABLE "space_misc_configs" ADD CONSTRAINT "space_misc_configs_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
