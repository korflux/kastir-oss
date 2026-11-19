-- CreateTable
CREATE TABLE "SplitRedirectDailyStat" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitRedirectDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SplitRedirectDailyStat_campaignId_day_idx" ON "SplitRedirectDailyStat"("campaignId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SplitRedirectDailyStat_destinationId_day_key" ON "SplitRedirectDailyStat"("destinationId", "day");

-- CreateIndex
CREATE INDEX "LogEntry_objectType_createdAt_idx" ON "LogEntry"("objectType", "createdAt");

-- CreateIndex
CREATE INDEX "MediaFile_createdAt_idx" ON "MediaFile"("createdAt");

-- CreateIndex
CREATE INDEX "Page_status_deletedAt_idx" ON "Page"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "SplitCampaign_authorId_idx" ON "SplitCampaign"("authorId");
