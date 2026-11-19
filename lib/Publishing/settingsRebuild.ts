import "server-only";

import { prisma } from "@/lib/prisma";
import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import { getPublishedPagePath } from "@/lib/Modules/Pages/publicUrl";
import {
  createPageCompiler,
  type PageCompilationDatabase,
} from "@/lib/Publishing/pageCompiler";
import {
  createPageFileStore,
  type PageFileStore,
} from "@/lib/Publishing/fileStore";
import { regeneratePublicArtifacts } from "@/lib/Publishing/publicSiteArtifacts";
import {
  logUnresolvedPublishedRevision,
  resolvePublishedPage,
  type PublishedPageSource,
  type PublishedPageState,
} from "@/lib/Modules/Revisions/publishedState";
import type {
  SettingsRebuildScope,
  SiteSettingsRecord,
} from "@/lib/Modules/Settings/Types";

export type SettingsRebuildDatabase = Omit<
  PageCompilationDatabase,
  "siteSettings"
> & {
  siteSettings: {
    findUnique(args: {
      where: { id: string };
    }): Promise<SiteSettingsRecord | null>;
  };
  page: {
    findUnique(args: {
      where: { id: string };
      include?: { publishedRevision: true };
    }): Promise<PublishedPageSource | null>;
    findMany(args: {
      where: { status: "PUBLISHED"; deletedAt: null };
      include?: { publishedRevision: true };
    }): Promise<
      Array<PublishedPageSource & { publishedAt: Date | null; updatedAt: Date }>
    >;
  };
};

export type SettingsRebuildDependencies = {
  database: SettingsRebuildDatabase;
  fileStore: PageFileStore;
  publicDir?: string;
};

const defaultDependencies: SettingsRebuildDependencies = {
  database: prisma as unknown as SettingsRebuildDatabase,
  fileStore: createPageFileStore(),
};

function pagesForScope(
  scope: SettingsRebuildScope,
  pageIds: readonly string[],
  allPages: readonly PublishedPageState[],
): PublishedPageState[] {
  if (scope === "GLOBAL") return [...allPages];
  if (scope !== "HOME") return [];
  const wanted = new Set(pageIds);
  return allPages.filter((page) => wanted.has(page.id));
}

function purgeUrlsForGlobalSettings(
  settings: SiteSettingsRecord,
  pages: readonly PublishedPageState[],
  faviconUrl: string | null,
): string[] {
  let origin: string;
  try {
    origin = getPublicOrigin({ siteUrl: settings.siteUrl });
  } catch {
    return [];
  }

  const urls = [
    new URL("/", origin).toString(),
    new URL("/index.html", origin).toString(),
    ...pages.map((page) =>
      new URL(getPublishedPagePath(page.slug), origin).toString(),
    ),
    ...pages.map((page) =>
      new URL(`/${page.slug}/index.html`, origin).toString(),
    ),
    new URL("/robots.txt", origin).toString(),
    new URL("/sitemap.xml", origin).toString(),
    new URL("/llms.txt", origin).toString(),
  ];
  if (faviconUrl) urls.push(new URL(faviconUrl, origin).toString());
  return [...new Set(urls)];
}

export async function rebuildSettings(
  scope: SettingsRebuildScope,
  pageIds: readonly string[] = [],
  dependencies: SettingsRebuildDependencies = defaultDependencies,
): Promise<void> {
  const settings = await dependencies.database.siteSettings.findUnique({
    where: { id: "singleton" },
  });
  if (!settings) return;

  const allRows = await dependencies.database.page.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    include: { publishedRevision: true },
  });
  const allPages: PublishedPageState[] = [];
  for (const row of allRows) {
    const published = resolvePublishedPage(row);
    if (published) {
      allPages.push(published);
      continue;
    }
    if (row.publishedRevisionId) logUnresolvedPublishedRevision(row.id);
  }
  const affectedPages = pagesForScope(scope, pageIds, allPages);
  const compiler = createPageCompiler(dependencies.database);

  for (const page of affectedPages) {
    await dependencies.fileStore.write(page.slug, await compiler(page));
  }

  if (scope !== "NONE") {
    await regeneratePublicArtifacts(
      dependencies.database,
      dependencies.publicDir,
    );
  }

  if (scope === "GLOBAL") {
    let faviconUrl: string | null = null;
    if (settings.faviconMediaId && dependencies.database.mediaFile) {
      const favicon = await dependencies.database.mediaFile.findUnique({
        where: { id: settings.faviconMediaId },
      });
      if (favicon?.processingStatus === "READY") faviconUrl = favicon.url;
    }
    const purgeUrls = purgeUrlsForGlobalSettings(
      settings,
      allPages,
      faviconUrl,
    );
    if (purgeUrls.length > 0) {
      try {
        const purgeResult = await cloudflarePurge(purgeUrls, {
          credentials: {
            cloudflareApiTokenEncrypted: settings.cloudflareApiTokenEncrypted,
            cloudflareZoneId: settings.cloudflareZoneId,
          },
        });
        if (purgeResult.status === "FAILED") {
          console.error(
            "[Kastir] Cloudflare purge failed",
            purgeResult.message,
          );
        }
      } catch (error) {
        console.error(
          "[Kastir] Cloudflare purge failed",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
}

export async function processSettingsRebuildJob(data: {
  scope: "HOME" | "ARTIFACTS" | "GLOBAL";
  pageIds: string[];
}): Promise<void> {
  await rebuildSettings(data.scope, data.pageIds);
}
