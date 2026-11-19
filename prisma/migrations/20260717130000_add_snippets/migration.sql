-- CreateEnum
CREATE TYPE "InjectionPoint" AS ENUM ('HEADER', 'BODY_START', 'BODY_END');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ALL_PAGES', 'SPECIFIC_PAGES');

-- CreateTable
CREATE TABLE "Snippet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" "InjectionPoint" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'ALL_PAGES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Snippet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnippetPageScope" (
    "snippetId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,

    CONSTRAINT "SnippetPageScope_pkey" PRIMARY KEY ("snippetId", "pageId")
);

-- CreateIndex
CREATE INDEX "Snippet_status_location_idx" ON "Snippet"("status", "location");

-- CreateIndex
CREATE INDEX "Snippet_scopeType_idx" ON "Snippet"("scopeType");

-- CreateIndex
CREATE INDEX "Snippet_createdAt_idx" ON "Snippet"("createdAt");

-- CreateIndex
CREATE INDEX "SnippetPageScope_pageId_idx" ON "SnippetPageScope"("pageId");

-- AddForeignKey
ALTER TABLE "SnippetPageScope" ADD CONSTRAINT "SnippetPageScope_snippetId_fkey" FOREIGN KEY ("snippetId") REFERENCES "Snippet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnippetPageScope" ADD CONSTRAINT "SnippetPageScope_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
