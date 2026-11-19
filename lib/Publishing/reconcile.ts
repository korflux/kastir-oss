import "server-only";

import { prisma } from "@/lib/prisma";
import {
  resolvePublishedPage,
  type PublishedPageSource,
} from "@/lib/Modules/Revisions/publishedState";
import {
  createPageFileStore,
  type PageFileStore,
} from "@/lib/Publishing/fileStore";
import { rebuildSettings } from "@/lib/Publishing/settingsRebuild";
import { backfillPublishedRevisions } from "@/lib/Modules/Revisions/backfill";

export type PublishedSiteReconcileDatabase = {
  page: {
    findMany(args: {
      where: { status: "PUBLISHED"; deletedAt: null };
      include?: { publishedRevision: true };
    }): Promise<PublishedPageSource[]>;
  };
};

export type PublishedSiteReconcileDependencies = {
  database: PublishedSiteReconcileDatabase;
  fileStore: PageFileStore;
  rebuildGlobal: () => Promise<void>;
  backfill?: () => Promise<unknown>;
};

const defaultDependencies: PublishedSiteReconcileDependencies = {
  database: prisma as unknown as PublishedSiteReconcileDatabase,
  fileStore: createPageFileStore(),
  rebuildGlobal: () => rebuildSettings("GLOBAL"),
  backfill: () =>
    backfillPublishedRevisions(
      prisma as unknown as Parameters<typeof backfillPublishedRevisions>[0],
    ),
};

export type PublishedSiteReconcileResult = {
  checked: number;
  missing: number;
  rebuilt: boolean;
};

/**
 * Published pages are served as static files under public/ (see nginx.conf);
 * nothing re-renders them on request. Some hosts (e.g. a PaaS app configured
 * without a persistent volume mount) recreate that directory from the image
 * on every deploy, silently dropping every previously published page even
 * though the database still says PUBLISHED. Detect that by checking whether
 * each published page's static output still exists on disk, and rebuild the
 * whole site if any are missing so links recover without manual action.
 */
export async function reconcilePublishedSite(
  dependencies: PublishedSiteReconcileDependencies = defaultDependencies,
): Promise<PublishedSiteReconcileResult> {
  if (dependencies.backfill) await dependencies.backfill();
  const pages = await dependencies.database.page.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    include: { publishedRevision: true },
  });
  const publishedPages = pages
    .map(resolvePublishedPage)
    .filter((page) => page !== null);
  if (publishedPages.length === 0)
    return { checked: 0, missing: 0, rebuilt: false };

  let missing = 0;
  for (const page of publishedPages) {
    const content = await dependencies.fileStore.read(page.slug);
    if (content === null) missing += 1;
  }

  if (missing === 0)
    return { checked: publishedPages.length, missing: 0, rebuilt: false };

  await dependencies.rebuildGlobal();
  return { checked: publishedPages.length, missing, rebuilt: true };
}
