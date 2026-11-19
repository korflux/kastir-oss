import "dotenv/config";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@/app/generated/prisma/client";
import { pageSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import { SettingsService } from "@/lib/Modules/Settings/Service";
import { createPageFileStore } from "@/lib/Publishing/fileStore";
import { rebuildSettings } from "@/lib/Publishing/settingsRebuild";

async function seedPublishedRevision(
  database: PrismaClient,
  page: {
    id: string;
    title: string;
    slug: string;
    content: string;
    seoTitle: string | null;
    seoDescription: string | null;
    seoKeyword: string | null;
    folderId: string;
  },
  authorId: string,
) {
  const snapshot = {
    title: page.title,
    slug: page.slug,
    content: page.content,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    seoKeyword: page.seoKeyword,
    folderId: page.folderId,
  };
  const revision = await database.pageRevision.create({
    data: {
      pageId: page.id,
      authorId,
      fingerprint: pageSnapshotFingerprint(snapshot),
      ...snapshot,
    },
  });
  await database.page.update({
    where: { id: page.id },
    data: { publishedRevisionId: revision.id },
  });
}

const integrationEnabled = process.env.SETTINGS_TEST === "1";
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = describe.skipIf(
  !integrationEnabled || !databaseUrl,
);

describeIntegration("Settings against the development Postgres", () => {
  let database: PrismaClient;
  let service: SettingsService;
  let actorId: string;
  let publicDir: string;
  let pageIds: string[] = [];
  let baseFolderId: string;
  let originalSettings: Awaited<ReturnType<SettingsService["getSettings"]>>;

  beforeAll(async () => {
    publicDir = await mkdtemp(join(tmpdir(), "kastir-settings-integration-"));
    process.env.PUBLIC_DIR = publicDir;
    process.env.NEXTAUTH_SECRET ??=
      "a-stable-test-secret-with-at-least-32-bytes";

    database = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl! }),
    });
    const actor = await database.user.findFirst({
      where: { isMaster: true },
      select: { id: true },
    });
    if (!actor) throw new Error("DATABASE_URL has no master user");
    actorId = actor.id;

    const baseFolder = await database.pageFolder.findFirst({
      where: { isBase: true },
      select: { id: true },
    });
    if (!baseFolder) throw new Error("Base page folder missing");
    baseFolderId = baseFolder.id;

    service = new SettingsService(database as never, {
      add: vi.fn(async () => {
        throw new Error("force inline rebuild in integration");
      }),
    });
    originalSettings = await service.getSettings();
  });

  afterAll(async () => {
    try {
      if (originalSettings) {
        await service.updateSettings(actorId, {
          siteTitle: originalSettings.siteTitle,
          seoDescription: originalSettings.seoDescription,
          faviconMediaId: originalSettings.faviconMediaId,
          siteUrl: originalSettings.siteUrl,
          confirmSiteUrl: true,
          siteLanguage: originalSettings.siteLanguage,
          timezone: originalSettings.timezone,
          dateFormat: originalSettings.dateFormat,
          timeFormat: originalSettings.timeFormat,
          weekStartsOn: originalSettings.weekStartsOn,
          homePageId: originalSettings.homePageId,
          indexable: originalSettings.indexable,
          allowAiCrawlers: originalSettings.allowAiCrawlers,
          cloudflareZoneId: originalSettings.cloudflareZoneId,
          webpConversionEnabled: originalSettings.webpConversionEnabled,
          revisionRetentionLimit: originalSettings.revisionRetentionLimit,
        });
      }
      if (pageIds.length) {
        await database.page.deleteMany({ where: { id: { in: pageIds } } });
      }
    } finally {
      await database?.$disconnect();
      if (publicDir) await rm(publicDir, { recursive: true, force: true });
    }
  });

  it("persists SEO fallbacks, artifacts, home alias and asymmetric rebuild scopes", async () => {
    const stamp = Date.now();
    const home = await database.page.create({
      data: {
        title: `Settings Home ${stamp}`,
        slug: `settings-home-${stamp}`,
        content:
          "<!doctype html><html><head></head><body><main>Home</main></body></html>",
        status: "PUBLISHED",
        folderId: baseFolderId,
        authorId: actorId,
        publishedAt: new Date(),
      },
    });
    const other = await database.page.create({
      data: {
        title: `Settings Other ${stamp}`,
        slug: `settings-other-${stamp}`,
        content:
          "<!doctype html><html><head></head><body><main>Other</main></body></html>",
        status: "PUBLISHED",
        folderId: baseFolderId,
        authorId: actorId,
        publishedAt: new Date(),
      },
    });
    pageIds = [home.id, other.id];
    await seedPublishedRevision(database, home, actorId);
    await seedPublishedRevision(database, other, actorId);

    const fileStore = createPageFileStore(publicDir);
    await fileStore.write(home.slug, home.content);
    await fileStore.write(other.slug, other.content);

    const globalResult = await service.updateSettings(actorId, {
      siteTitle: `Kastir Integration ${stamp}`,
      seoDescription: "Integration SEO description",
      faviconMediaId: null,
      siteUrl: "https://integration.example.com",
      confirmSiteUrl: true,
      siteLanguage: "pt-BR",
      timezone: originalSettings.timezone,
      dateFormat: originalSettings.dateFormat,
      timeFormat: originalSettings.timeFormat,
      weekStartsOn: originalSettings.weekStartsOn,
      homePageId: home.id,
      indexable: false,
      allowAiCrawlers: true,
      cloudflareZoneId: null,
      webpConversionEnabled: originalSettings.webpConversionEnabled,
      revisionRetentionLimit: originalSettings.revisionRetentionLimit,
    });

    expect(globalResult.scope).toBe("GLOBAL");
    expect(globalResult.queueStatus).toBe("ENQUEUED");
    expect(globalResult.settings).not.toHaveProperty(
      "cloudflareApiTokenEncrypted",
    );

    // Force PUBLIC_DIR-aware rebuild against the temp tree.
    await rebuildSettings("GLOBAL", [], {
      database: database as never,
      fileStore,
      publicDir,
    });

    const homeHtml = await readFile(
      join(publicDir, home.slug, "index.html"),
      "utf8",
    );
    expect(homeHtml).toContain('lang="pt-BR"');
    expect(homeHtml).toContain(
      `Settings Home ${stamp} · Kastir Integration ${stamp}`,
    );
    expect(homeHtml).toContain("Integration SEO description");
    expect(homeHtml).toContain('name="robots" content="noindex,nofollow"');
    expect(homeHtml).toContain('data-kastir-admin-bar="1"');
    expect(homeHtml).toContain(`data-page-id="${home.id}"`);
    await expect(readFile(join(publicDir, "index.html"), "utf8")).resolves.toBe(
      homeHtml,
    );
    await expect(
      readFile(join(publicDir, "robots.txt"), "utf8"),
    ).resolves.toContain("Disallow: /");
    await expect(
      readFile(join(publicDir, "sitemap.xml"), "utf8"),
    ).resolves.toContain(home.slug);

    const artifactsOnly = await service.updateSettings(actorId, {
      siteTitle: `Kastir Integration ${stamp}`,
      seoDescription: "Integration SEO description",
      faviconMediaId: null,
      siteUrl: "https://integration.example.com",
      siteLanguage: "pt-BR",
      timezone: originalSettings.timezone,
      dateFormat: originalSettings.dateFormat,
      timeFormat: originalSettings.timeFormat,
      weekStartsOn: originalSettings.weekStartsOn,
      homePageId: home.id,
      indexable: true,
      allowAiCrawlers: false,
      cloudflareZoneId: null,
      webpConversionEnabled: originalSettings.webpConversionEnabled,
      revisionRetentionLimit: originalSettings.revisionRetentionLimit,
    });
    expect(artifactsOnly.scope).toBe("GLOBAL"); // indexable change is GLOBAL

    await rebuildSettings("ARTIFACTS", [], {
      database: database as never,
      fileStore,
      publicDir,
    });
    const robotsAi = await readFile(join(publicDir, "robots.txt"), "utf8");
    expect(robotsAi).toContain("GPTBot");
    expect(robotsAi).toContain("Sitemap:");

    // Only homePageId change → HOME scope (previous already home, switch to other)
    const homeOnly = await service.updateSettings(actorId, {
      siteTitle: `Kastir Integration ${stamp}`,
      seoDescription: "Integration SEO description",
      faviconMediaId: null,
      siteUrl: "https://integration.example.com",
      siteLanguage: "pt-BR",
      timezone: originalSettings.timezone,
      dateFormat: originalSettings.dateFormat,
      timeFormat: originalSettings.timeFormat,
      weekStartsOn: originalSettings.weekStartsOn,
      homePageId: other.id,
      indexable: true,
      allowAiCrawlers: false,
      cloudflareZoneId: null,
      webpConversionEnabled: originalSettings.webpConversionEnabled,
      revisionRetentionLimit: originalSettings.revisionRetentionLimit,
    });
    expect(homeOnly.scope).toBe("HOME");
    expect(homeOnly.affectedPageIds.sort()).toEqual([home.id, other.id].sort());

    await rebuildSettings("HOME", [home.id, other.id], {
      database: database as never,
      fileStore,
      publicDir,
    });
    const alias = await readFile(join(publicDir, "index.html"), "utf8");
    const otherHtml = await readFile(
      join(publicDir, other.slug, "index.html"),
      "utf8",
    );
    expect(alias).toBe(otherHtml);

    const logs = await database.logEntry.count({
      where: {
        userId: actorId,
        action: "SETTINGS_UPDATED",
        createdAt: { gte: new Date(stamp - 60_000) },
      },
    });
    expect(logs).toBeGreaterThanOrEqual(3);
  });
});
