import "server-only";

import { prisma } from "@/lib/prisma";
import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import {
  logUnresolvedPublishedRevision,
  resolvePublishedPage,
  type PublishedPageSource,
  type PublishedSnippetSource,
} from "@/lib/Modules/Revisions/publishedState";
import { createPageCompiler } from "@/lib/Publishing/pageCompiler";
import {
  createPageFileStore,
  type PageFileStore,
} from "@/lib/Publishing/fileStore";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";

export type PageRebuildDatabase = {
  page: {
    findUnique(args: {
      where: { id: string };
      include?: { publishedRevision: true };
    }): Promise<PublishedPageSource | null>;
  };
  snippet: {
    findMany(args: { where: unknown }): Promise<PublishedSnippetSource[]>;
  };
  siteSettings?: {
    findUnique(args: { where: { id: string } }): Promise<{
      siteTitle: string;
      tagline?: string | null;
      seoDescription: string | null;
      siteLanguage: string;
      indexable: boolean;
      faviconMediaId: string | null;
      siteUrl: string | null;
      homePageId?: string | null;
    } | null>;
  };
  mediaFile?: {
    findUnique(args: { where: { id: string } }): Promise<{
      url: string;
      processingStatus: string;
    } | null>;
  };
};

export type PageRebuildDependencies = {
  database: PageRebuildDatabase;
  fileStore: PageFileStore;
};

const defaultDependencies: PageRebuildDependencies = {
  database: prisma as unknown as PageRebuildDatabase,
  fileStore: createPageFileStore(),
};

export async function rebuildPublishedPage(
  pageId: string,
  dependencies: PageRebuildDependencies = defaultDependencies,
): Promise<void> {
  const page = await dependencies.database.page.findUnique({
    where: { id: pageId },
    include: { publishedRevision: true },
  });
  if (!page || page.deletedAt) return;
  const published = resolvePublishedPage(page);
  if (!published) {
    if (page.status === "PUBLISHED" && page.publishedRevisionId) {
      logUnresolvedPublishedRevision(page.id);
    }
    return;
  }

  const compiler = createPageCompiler(dependencies.database);
  await dependencies.fileStore.write(published.slug, await compiler(published));
  const siteSettings = dependencies.database.siteSettings
    ? await dependencies.database.siteSettings.findUnique({
        where: { id: "singleton" },
      })
    : null;
  const publicUrl = siteSettings
    ? `${getPublicOrigin({ siteUrl: siteSettings.siteUrl })}/${published.slug}`
    : published.slug;
  await cloudflarePurge(publicUrl);
}

export async function processPageRebuildJob(pageId: string): Promise<void> {
  await rebuildPublishedPage(pageId);
}
