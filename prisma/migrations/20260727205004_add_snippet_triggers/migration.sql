-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('SELECTOR_EVENT', 'PAGE_LOAD', 'SCROLL', 'REFERRER');

-- AlterTable
ALTER TABLE "Snippet" ADD COLUMN     "displayResetDays" INTEGER,
ADD COLUMN     "maxDisplays" INTEGER,
ADD COLUMN     "triggerConfig" JSONB,
ADD COLUMN     "triggerType" "TriggerType";
