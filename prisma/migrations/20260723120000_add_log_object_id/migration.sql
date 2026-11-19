ALTER TABLE "LogEntry" ADD COLUMN "objectId" TEXT;

CREATE INDEX "LogEntry_objectId_idx" ON "LogEntry"("objectId");
