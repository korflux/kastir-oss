-- AlterTable
ALTER TABLE "Snippet" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SplitCampaign" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Snippet_deletedAt_idx" ON "Snippet"("deletedAt");

-- CreateIndex
CREATE INDEX "Snippet_status_deletedAt_idx" ON "Snippet"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "SplitCampaign_deletedAt_idx" ON "SplitCampaign"("deletedAt");

-- CreateIndex
CREATE INDEX "SplitCampaign_status_deletedAt_idx" ON "SplitCampaign"("status", "deletedAt");
