-- CreateEnum
CREATE TYPE "MediaCategory" AS ENUM ('IMAGE_RASTER', 'IMAGE_SVG', 'DOCUMENT_PDF', 'VIDEO_MP4');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "parentId" TEXT,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "category" "MediaCategory" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "alt" TEXT,
    "description" TEXT,
    "folderId" TEXT NOT NULL,
    "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'READY',
    "processingToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaFolder_parentId_idx" ON "MediaFolder"("parentId");

-- CreateIndex
CREATE INDEX "MediaFolder_isBase_idx" ON "MediaFolder"("isBase");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_url_key" ON "MediaFile"("url");

-- CreateIndex
CREATE INDEX "MediaFile_folderId_idx" ON "MediaFile"("folderId");

-- CreateIndex
CREATE INDEX "MediaFile_category_idx" ON "MediaFile"("category");

-- CreateIndex
CREATE INDEX "MediaFile_processingStatus_idx" ON "MediaFile"("processingStatus");

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
