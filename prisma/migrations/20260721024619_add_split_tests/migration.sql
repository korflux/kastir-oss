-- CreateEnum
CREATE TYPE "SplitCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "SplitDestinationStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- AlterEnum
ALTER TYPE "LogObjectType" ADD VALUE 'SPLIT_TEST';

-- CreateTable
CREATE TABLE "SplitCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "SplitCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitDestination" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "status" "SplitDestinationStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitRedirectEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SplitRedirectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SplitCampaign_slug_key" ON "SplitCampaign"("slug");

-- CreateIndex
CREATE INDEX "SplitCampaign_status_idx" ON "SplitCampaign"("status");

-- CreateIndex
CREATE INDEX "SplitDestination_campaignId_status_idx" ON "SplitDestination"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SplitDestination_campaignId_sortOrder_idx" ON "SplitDestination"("campaignId", "sortOrder");

-- CreateIndex
CREATE INDEX "SplitRedirectEvent_campaignId_createdAt_idx" ON "SplitRedirectEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "SplitRedirectEvent_destinationId_createdAt_idx" ON "SplitRedirectEvent"("destinationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SplitCampaign" ADD CONSTRAINT "SplitCampaign_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitDestination" ADD CONSTRAINT "SplitDestination_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SplitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitRedirectEvent" ADD CONSTRAINT "SplitRedirectEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SplitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitRedirectEvent" ADD CONSTRAINT "SplitRedirectEvent_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "SplitDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;
