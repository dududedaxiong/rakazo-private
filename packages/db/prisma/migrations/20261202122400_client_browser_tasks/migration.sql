-- Additive: client browser task channel (server to phone fetch tasks). New tables only,
-- so the previous release never reads or writes them.
CREATE TABLE "client_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fetch',
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "client_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_task_preferences" (
    "userId" TEXT NOT NULL,
    "localTrafficEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_task_preferences_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "client_presences" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_presences_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "client_tasks_userId_status_createdAt_idx" ON "client_tasks"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_task_preferences" ADD CONSTRAINT "client_task_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_presences" ADD CONSTRAINT "client_presences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
