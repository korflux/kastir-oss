-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WeekStart" ADD VALUE 'TUESDAY';
ALTER TYPE "WeekStart" ADD VALUE 'WEDNESDAY';
ALTER TYPE "WeekStart" ADD VALUE 'THURSDAY';
ALTER TYPE "WeekStart" ADD VALUE 'FRIDAY';
ALTER TYPE "WeekStart" ADD VALUE 'SATURDAY';

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "notFoundPageId" TEXT,
ADD COLUMN     "notFoundRedirectToHome" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sitemapEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tagline" TEXT;
