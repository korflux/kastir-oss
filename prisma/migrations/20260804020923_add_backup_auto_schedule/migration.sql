-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "backupAutoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backupAutoHour" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backupAutoMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backupIntervalDays" INTEGER NOT NULL DEFAULT 1;
