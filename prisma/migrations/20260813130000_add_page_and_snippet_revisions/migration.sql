-- CreateTable
CREATE TABLE "PageRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoKeyword" TEXT,
    "folderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnippetRevision" (
    "id" TEXT NOT NULL,
    "snippetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" "InjectionPoint" NOT NULL,
    "content" TEXT NOT NULL,
    "priority" INTEGER,
    "scopeType" "ScopeType" NOT NULL,
    "pageIds" TEXT[],
    "triggerType" "TriggerType",
    "triggerConfig" JSONB,
    "maxDisplays" INTEGER,
    "displayResetDays" INTEGER,
    "authorId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnippetRevision_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "publishedRevisionId" TEXT;

-- AlterTable
ALTER TABLE "Snippet" ADD COLUMN "publishedRevisionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PageRevision_pageId_fingerprint_key" ON "PageRevision"("pageId", "fingerprint");

-- CreateIndex
CREATE INDEX "PageRevision_pageId_createdAt_idx" ON "PageRevision"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "PageRevision_pageId_pinned_idx" ON "PageRevision"("pageId", "pinned");

-- CreateIndex
CREATE UNIQUE INDEX "SnippetRevision_snippetId_fingerprint_key" ON "SnippetRevision"("snippetId", "fingerprint");

-- CreateIndex
CREATE INDEX "SnippetRevision_snippetId_createdAt_idx" ON "SnippetRevision"("snippetId", "createdAt");

-- CreateIndex
CREATE INDEX "SnippetRevision_snippetId_pinned_idx" ON "SnippetRevision"("snippetId", "pinned");

-- CreateIndex
CREATE UNIQUE INDEX "Page_publishedRevisionId_key" ON "Page"("publishedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Snippet_publishedRevisionId_key" ON "Snippet"("publishedRevisionId");

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnippetRevision" ADD CONSTRAINT "SnippetRevision_snippetId_fkey" FOREIGN KEY ("snippetId") REFERENCES "Snippet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnippetRevision" ADD CONSTRAINT "SnippetRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "PageRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snippet" ADD CONSTRAINT "Snippet_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "SnippetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
