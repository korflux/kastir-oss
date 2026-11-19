import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({
  cloudflarePurge: vi.fn().mockResolvedValue({ status: "SKIPPED" }),
}));

import { rebuildSettings } from "@/lib/Publishing/settingsRebuild";
import { createPageFileStore } from "@/lib/Publishing/fileStore";
import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import type { PageRecord } from "@/lib/Modules/Pages/Types";
import type { SiteSettingsRecord } from "@/lib/Modules/Settings/Types";

function page(
  id: string,
  slug: string,
  title: string,
): PageRecord & {
  publishedRevision: {
    id: string;
    pageId: string;
    title: string;
    slug: string;
    content: string;
    seoTitle: string | null;
    seoDescription: string | null;
    seoKeyword: string | null;
  };
} {
  const now = new Date("2026-01-02T00:00:00.000Z");
  const content = `<!doctype html><html><head></head><body><h1>${title}</h1></body></html>`;
  return {
    id,
    slug,
    title,
    content,
    seoTitle: null,
    seoDescription: null,
    seoKeyword: null,
    status: "PUBLISHED",
    folderId: "base",
    authorId: "admin",
    publishedRevisionId: `${id}-rev`,
    publishedRevision: {
      id: `${id}-rev`,
      pageId: id,
      title,
      slug,
      content,
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
    },
    publishedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function settings(
  homePageId: string | null,
  overrides: Partial<SiteSettingsRecord> = {},
): SiteSettingsRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "singleton",
    siteTitle: "Kastir",
    tagline: null,
    seoDescription: "Site description",
    faviconMediaId: null,
    siteUrl: "https://example.com",
    siteLanguage: "en",
    timezone: "UTC",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24H",
    weekStartsOn: "SUNDAY",
    homePageId,
    indexable: true,
    allowAiCrawlers: false,
    sitemapEnabled: true,
    notFoundPageId: null,
    notFoundRedirectToHome: false,
    cloudflareApiTokenEncrypted: null,
    cloudflareZoneId: null,
    webpConversionEnabled: true,
    revisionRetentionLimit: 5,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("settings rebuild worker", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  beforeEach(() => {
    vi.mocked(cloudflarePurge).mockClear();
  });

  it("rebuilds HTML, the selected root alias and public artifacts", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-settings-rebuild-"));
    roots.push(publicDir);
    const pages = [
      page("home", "landing", "Landing"),
      page("other", "other", "Other"),
    ];
    const database = {
      siteSettings: { findUnique: vi.fn(async () => settings("home")) },
      page: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            pages.find((candidate) => candidate.id === where.id) ?? null,
        ),
        findMany: vi.fn(async () => pages),
      },
      snippet: { findMany: vi.fn(async () => []) },
    };

    await rebuildSettings("GLOBAL", [], {
      database: database as never,
      fileStore: createPageFileStore(publicDir),
      publicDir,
    });

    const landing = await readFile(
      join(publicDir, "landing", "index.html"),
      "utf8",
    );
    expect(landing).toContain('<html lang="en">');
    expect(landing).toContain("<title>Kastir</title>");
    expect(landing).not.toContain('name="robots" content="noindex');
    expect(landing).toContain('data-kastir-admin-bar="1"');
    expect(landing).toContain('data-page-id="home"');
    await expect(readFile(join(publicDir, "index.html"), "utf8")).resolves.toBe(
      landing,
    );
    await expect(
      readFile(join(publicDir, "robots.txt"), "utf8"),
    ).resolves.toContain("GPTBot");
    await expect(
      readFile(join(publicDir, "robots.txt"), "utf8"),
    ).resolves.toContain("Sitemap: https://example.com/sitemap.xml");
    await expect(
      readFile(join(publicDir, "sitemap.xml"), "utf8"),
    ).resolves.toContain("https://example.com/");
    const llms = await readFile(join(publicDir, "llms.txt"), "utf8");
    expect(llms.startsWith("# Kastir\n")).toBe(true);
    expect(llms).toContain("[Landing](https://example.com/landing)");
    expect(llms).toMatch(/\[[^\]]+\]\(https?:\/\/[^)]+\)/);
  });

  it("ARTIFACTS does not rewrite page files", async () => {
    const publicDir = await mkdtemp(
      join(tmpdir(), "kastir-settings-artifacts-"),
    );
    roots.push(publicDir);
    const pages = [page("home", "landing", "Landing")];
    const database = {
      siteSettings: { findUnique: vi.fn(async () => settings(null)) },
      page: { findUnique: vi.fn(), findMany: vi.fn(async () => pages) },
      snippet: { findMany: vi.fn(async () => []) },
    };
    const store = createPageFileStore(publicDir);
    await store.write("landing", "original");

    await rebuildSettings("ARTIFACTS", [], {
      database: database as never,
      fileStore: store,
      publicDir,
    });

    await expect(store.read("landing")).resolves.toBe("original");
    await expect(
      readFile(join(publicDir, "robots.txt"), "utf8"),
    ).resolves.toContain("Disallow: /");
  });

  it("purges the published HTML and selected favicon after a global rebuild", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-settings-favicon-"));
    roots.push(publicDir);
    const pages = [
      page("home", "landing", "Landing"),
      page("other", "other", "Other"),
    ];
    const current = settings("home", {
      faviconMediaId: "favicon",
      cloudflareApiTokenEncrypted: "encrypted-token",
      cloudflareZoneId: "zone-id",
    });
    const database = {
      siteSettings: { findUnique: vi.fn(async () => current) },
      page: { findUnique: vi.fn(), findMany: vi.fn(async () => pages) },
      mediaFile: {
        findUnique: vi.fn(async () => ({
          url: "/uploads/favicon.webp",
          processingStatus: "READY",
        })),
      },
      snippet: { findMany: vi.fn(async () => []) },
    };

    await rebuildSettings("GLOBAL", [], {
      database: database as never,
      fileStore: createPageFileStore(publicDir),
      publicDir,
    });

    expect(cloudflarePurge).toHaveBeenCalledWith(
      [
        "https://example.com/",
        "https://example.com/index.html",
        "https://example.com/landing",
        "https://example.com/other",
        "https://example.com/landing/index.html",
        "https://example.com/other/index.html",
        "https://example.com/robots.txt",
        "https://example.com/sitemap.xml",
        "https://example.com/llms.txt",
        "https://example.com/uploads/favicon.webp",
      ],
      {
        credentials: {
          cloudflareApiTokenEncrypted: current.cloudflareApiTokenEncrypted,
          cloudflareZoneId: current.cloudflareZoneId,
        },
      },
    );
  });

  it("logs a failed Cloudflare purge instead of hiding the cache invalidation failure", async () => {
    const publicDir = await mkdtemp(
      join(tmpdir(), "kastir-settings-purge-failure-"),
    );
    roots.push(publicDir);
    const pages = [page("home", "landing", "Landing")];
    const current = settings("home", {
      cloudflareApiTokenEncrypted: "encrypted-token",
      cloudflareZoneId: "zone-id",
    });
    const database = {
      siteSettings: { findUnique: vi.fn(async () => current) },
      page: { findUnique: vi.fn(), findMany: vi.fn(async () => pages) },
      snippet: { findMany: vi.fn(async () => []) },
    };
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(cloudflarePurge).mockResolvedValueOnce({
      status: "FAILED",
      message: "Cloudflare returned HTTP 403",
    });

    await rebuildSettings("GLOBAL", [], {
      database: database as never,
      fileStore: createPageFileStore(publicDir),
      publicDir,
    });

    expect(cloudflarePurge).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[Kastir] Cloudflare purge failed",
      "Cloudflare returned HTTP 403",
    );
    errorSpy.mockRestore();
  });

  it("writes and removes custom 404, redirect marker and sitemap artifacts", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-settings-404-"));
    roots.push(publicDir);
    const pages = [
      page("home", "landing", "Landing"),
      page("error", "error", "Error"),
    ];
    let current = settings("home", { notFoundPageId: "error" });
    const database = {
      siteSettings: { findUnique: vi.fn(async () => current) },
      page: { findUnique: vi.fn(), findMany: vi.fn(async () => pages) },
      snippet: { findMany: vi.fn(async () => []) },
    };
    const store = createPageFileStore(publicDir);
    await store.write("error", "<html><body><h1>Custom 404</h1></body></html>");

    await rebuildSettings("ARTIFACTS", [], {
      database: database as never,
      fileStore: store,
      publicDir,
    });
    await expect(
      readFile(join(publicDir, "404.html"), "utf8"),
    ).resolves.toContain("Custom 404");
    await expect(
      readFile(join(publicDir, ".notfound-redirect"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    current = {
      ...current,
      notFoundPageId: null,
      notFoundRedirectToHome: true,
    };
    await rebuildSettings("ARTIFACTS", [], {
      database: database as never,
      fileStore: store,
      publicDir,
    });
    await expect(
      readFile(join(publicDir, ".notfound-redirect"), "utf8"),
    ).resolves.toBe("");
    await expect(
      readFile(join(publicDir, "404.html"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    current = {
      ...current,
      notFoundRedirectToHome: false,
      sitemapEnabled: false,
    };
    await rebuildSettings("ARTIFACTS", [], {
      database: database as never,
      fileStore: store,
      publicDir,
    });
    await expect(
      readFile(join(publicDir, ".notfound-redirect"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(publicDir, "404.html"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(publicDir, "sitemap.xml"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(publicDir, "robots.txt"), "utf8"),
    ).resolves.not.toContain("Sitemap:");
  });
});
