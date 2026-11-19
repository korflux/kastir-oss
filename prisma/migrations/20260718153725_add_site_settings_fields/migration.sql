-- CreateEnum
CREATE TYPE "WeekStart" AS ENUM ('SUNDAY', 'MONDAY');

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "allowAiCrawlers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cloudflareApiTokenEncrypted" TEXT,
ADD COLUMN     "cloudflareZoneId" TEXT,
ADD COLUMN     "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
ADD COLUMN     "faviconMediaId" TEXT,
ADD COLUMN     "homePageId" TEXT,
ADD COLUMN     "indexable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "siteLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "siteUrl" TEXT,
ADD COLUMN     "timeFormat" TEXT NOT NULL DEFAULT '24H',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "webpConversionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weekStartsOn" "WeekStart" NOT NULL DEFAULT 'SUNDAY';
