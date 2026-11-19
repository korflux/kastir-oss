import { prisma } from "@/lib/prisma";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import {
  resolvePublishedPage,
  type PublishedPageSource,
} from "@/lib/Modules/Revisions/publishedState";
import { generateLlmsTxt } from "@/lib/Publishing/generateLlmsTxt";
import { generateRobotsTxt } from "@/lib/Publishing/generateRobotsTxt";
import {
  generateSitemap,
  type SitemapPage,
} from "@/lib/Publishing/generateSitemap";
import { createPageFileStore } from "@/lib/Publishing/fileStore";
import {
  removePublicArtifact,
  writePublicArtifact,
} from "@/lib/Publishing/publicArtifacts";

export type PublicSiteArtifactsDatabase = {
  siteSettings: {
    findUnique(args: { where: { id: string } }): Promise<{
      siteTitle: string;
      tagline: string | null;
      seoDescription: string | null;
      siteUrl: string | null;
      homePageId: string | null;
      indexable: boolean;
      allowAiCrawlers: boolean;
      sitemapEnabled: boolean;
      notFoundPageId: string | null;
      notFoundRedirectToHome: boolean;
    } | null>;
  };
  page: {
    findMany(args: {
      where: { status: "PUBLISHED"; deletedAt: null };
      include?: { publishedRevision: true };
    }): Promise<
      Array<
        PublishedPageSource & {
          publishedAt: Date | null;
          updatedAt: Date;
        }
      >
    >;
  };
};

export async function regeneratePublicArtifacts(
  database: PublicSiteArtifactsDatabase = prisma as unknown as PublicSiteArtifactsDatabase,
  publicDir?: string,
): Promise<void> {
  const [settings, rows] = await Promise.all([
    database.siteSettings.findUnique({ where: { id: "singleton" } }),
    database.page.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      include: { publishedRevision: true },
    }),
  ]);
  if (!settings) return;

  const pages = rows.flatMap((row) => {
    const published = resolvePublishedPage(row);
    if (!published) return [];
    return [
      {
        ...published,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      },
    ];
  });

  const origin = getPublicOrigin({ siteUrl: settings.siteUrl });
  const sitemapPages: SitemapPage[] = pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
  }));
  if (settings.sitemapEnabled !== false) {
    await writePublicArtifact(
      "sitemap.xml",
      generateSitemap({
        origin,
        pages: sitemapPages,
        homePageId: settings.homePageId,
      }),
      publicDir,
    );
  } else {
    await removePublicArtifact("sitemap.xml", publicDir);
  }
  await writePublicArtifact(
    "robots.txt",
    generateRobotsTxt({
      indexable: settings.indexable,
      allowAiCrawlers: settings.allowAiCrawlers,
      sitemapUrl:
        settings.sitemapEnabled !== false ? origin + "/sitemap.xml" : null,
    }),
    publicDir,
  );
  await writePublicArtifact(
    "llms.txt",
    generateLlmsTxt({
      siteTitle: settings.siteTitle,
      tagline: settings.tagline,
      seoDescription: settings.seoDescription,
      origin,
      homePageId: settings.homePageId,
      pages: pages.map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
      })),
      sitemapEnabled: settings.sitemapEnabled !== false,
    }),
    publicDir,
  );

  const home = settings.homePageId
    ? pages.find((page) => page.id === settings.homePageId)
    : undefined;
  if (!home) {
    await removePublicArtifact("index.html", publicDir);
  } else {
    const homeContent = await createPageFileStore(publicDir).read(home.slug);
    if (homeContent === null) {
      await removePublicArtifact("index.html", publicDir);
    } else {
      await writePublicArtifact("index.html", homeContent, publicDir);
    }
  }

  if (settings.notFoundRedirectToHome) {
    await writePublicArtifact(".notfound-redirect", "", publicDir);
    await removePublicArtifact("404.html", publicDir);
  } else {
    await removePublicArtifact(".notfound-redirect", publicDir);
    const notFoundPage = settings.notFoundPageId
      ? pages.find((page) => page.id === settings.notFoundPageId)
      : undefined;
    const notFoundContent = notFoundPage
      ? await createPageFileStore(publicDir).read(notFoundPage.slug)
      : null;
    if (notFoundContent === null) {
      await removePublicArtifact("404.html", publicDir);
    } else {
      await writePublicArtifact("404.html", notFoundContent, publicDir);
    }
  }
}
