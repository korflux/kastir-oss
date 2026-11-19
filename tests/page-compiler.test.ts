import { describe, expect, it, vi } from "vitest";

import { createPageCompiler } from "@/lib/Publishing/pageCompiler";
import { compilePage } from "@/lib/Publishing/compile";

function publishedSnippet(
  id: string,
  fields: {
    location: "HEADER" | "BODY_START" | "BODY_END";
    content: string;
    priority: number | null;
    createdAt: Date;
    scopeType: "ALL_PAGES" | "SPECIFIC_PAGES";
    pageIds: string[];
    triggerType?: "SELECTOR_EVENT" | "PAGE_LOAD" | "SCROLL" | "REFERRER" | null;
    triggerConfig?: Record<string, unknown> | null;
    maxDisplays?: number | null;
    displayResetDays?: number | null;
  },
) {
  return {
    id,
    status: "PUBLISHED" as const,
    deletedAt: null,
    publishedRevisionId: `${id}-rev`,
    publishedRevision: {
      id: `${id}-rev`,
      snippetId: id,
      name: id,
      ...fields,
      triggerType: fields.triggerType ?? null,
      triggerConfig: fields.triggerConfig ?? null,
      maxDisplays: fields.maxDisplays ?? null,
      displayResetDays: fields.displayResetDays ?? null,
    },
  };
}

describe("page compiler integration", () => {
  it("loads global and page-specific published snippets", async () => {
    const findMany = vi.fn(async () => [
      publishedSnippet("global", {
        location: "HEADER",
        content: '<meta name="global">',
        priority: 2,
        createdAt: new Date("2026-01-01"),
        scopeType: "ALL_PAGES",
        pageIds: [],
      }),
      publishedSnippet("specific", {
        location: "BODY_END",
        content: "<script>specific();</script>",
        priority: 1,
        createdAt: new Date("2026-01-02"),
        scopeType: "SPECIFIC_PAGES",
        pageIds: ["page-1"],
      }),
    ]);
    const compile = createPageCompiler({ snippet: { findMany } });

    const result = await compile({
      id: "page-1",
      content: "<html><head></head><body><main>Page</main></body></html>",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        publishedRevisionId: { not: null },
        publishedRevision: {
          is: {
            OR: [
              { scopeType: "ALL_PAGES" },
              {
                scopeType: "SPECIFIC_PAGES",
                pageIds: { has: "page-1" },
              },
            ],
          },
        },
      },
      include: { publishedRevision: true },
    });
    expect(result).toContain('<meta name="global">');
    expect(result).toContain("<script>specific();</script>");
  });

  it("asks only for ALL_PAGES snippets when the page has no id", async () => {
    const findMany = vi.fn(async () => []);
    const compile = createPageCompiler({ snippet: { findMany } });

    await compile({
      content: "<html><head></head><body><main>Page</main></body></html>",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        publishedRevisionId: { not: null },
        publishedRevision: {
          is: { scopeType: "ALL_PAGES" },
        },
      },
      include: { publishedRevision: true },
    });
  });

  it("carries a snippet's trigger fields through to the compiled HTML", async () => {
    const findMany = vi.fn(async () => [
      publishedSnippet("popup-1", {
        location: "BODY_END",
        content: "<div>Subscribe</div>",
        priority: null,
        createdAt: new Date("2026-01-01"),
        triggerType: "SCROLL",
        triggerConfig: { percentage: 50 },
        maxDisplays: 3,
        displayResetDays: 30,
        scopeType: "ALL_PAGES",
        pageIds: [],
      }),
    ]);
    const compile = createPageCompiler({ snippet: { findMany } });

    const result = await compile({
      id: "page-1",
      content: "<html><head></head><body><main>Page</main></body></html>",
    });

    expect(result).toContain(
      '<div data-kastir-trigger="popup-1" style="display:none">',
    );
    expect(result).toContain("popup-triggers.js");
    expect(result).toContain('"triggerType":"SCROLL"');
  });

  it("compiles complete documents with global fallbacks, language and noindex idempotently", () => {
    const page = {
      id: "page-1",
      title: "Landing",
      content:
        '<!doctype html><html><head><title>Old</title><meta name="robots" content="index"></head><body><main>Page</main></body></html>',
      seoTitle: null,
      seoDescription: null,
      seoKeyword: "kastir",
    };
    const settings = {
      siteTitle: "Kastir & Co",
      seoDescription: "A <strong>static</strong> site",
      siteLanguage: "pt-BR",
      faviconUrl: "/uploads/favicon.png",
      indexable: false,
    };

    const first = compilePage(page, [], settings);
    const second = compilePage(page, [], settings);

    expect(first).toBe(second);
    expect(first).toContain('<html lang="pt-BR">');
    expect(first).toContain("<title>Landing</title>");
    expect(first).toContain(
      'name="description" content="A &lt;strong&gt;static&lt;/strong&gt; site"',
    );
    expect(first).toContain('name="keywords" content="kastir"');
    expect(first).toContain('rel="icon" href="/uploads/favicon.png"');
    expect(first).toContain('name="robots" content="noindex,nofollow"');
    expect(first.match(/name="description"/g)).toHaveLength(1);
  });

  it("can compile a private preview without the admin bar script", () => {
    const html = compilePage(
      {
        id: "draft-1",
        title: "Draft",
        content: "<html><head></head><body><main>Draft</main></body></html>",
      },
      [],
      {
        siteTitle: "Kastir",
        seoDescription: null,
        siteLanguage: "en",
        indexable: true,
        faviconUrl: null,
      },
      { includeAdminBar: false },
    );

    expect(html).toContain("<main>Draft</main>");
    expect(html).not.toContain("admin-bar.js");
    expect(html).not.toContain("data-kastir-admin-bar");
  });

  it("uses site title and tagline only for the selected home fallback", () => {
    const home = compilePage(
      {
        id: "home",
        title: "Landing",
        content: "<html><head></head><body></body></html>",
      },
      [],
      {
        siteTitle: "Kastir",
        tagline: "Seu CMS Eficiente",
        siteLanguage: "pt-BR",
        indexable: true,
        isHome: true,
      },
    );
    const other = compilePage(
      {
        id: "other",
        title: "About",
        content: "<html><head></head><body></body></html>",
      },
      [],
      {
        siteTitle: "Kastir",
        tagline: "Seu CMS Eficiente",
        siteLanguage: "pt-BR",
        indexable: true,
        isHome: false,
      },
    );

    expect(home).toContain("<title>Kastir - Seu CMS Eficiente</title>");
    expect(other).toContain("<title>About</title>");
  });

  it("gives an explicit SEO title precedence over the page and site fallbacks", () => {
    const html = compilePage(
      {
        title: "Landing",
        seoTitle: "Search result title",
        content: "<html><head></head><body></body></html>",
      },
      [],
      {
        siteTitle: "Kastir",
        tagline: "Seu CMS Eficiente",
        siteLanguage: "pt-BR",
        indexable: true,
        isHome: true,
      },
    );

    expect(html).toContain("<title>Search result title</title>");
  });

  it("does not invent a document wrapper for fragments", () => {
    const fragment = compilePage(
      { title: "Landing", content: "<main>Fragment</main>" },
      [],
      {
        siteTitle: "Kastir",
        siteLanguage: "en",
        indexable: false,
        seoDescription: "Description",
      },
    );

    expect(fragment).toBe("<main>Fragment</main>");
    expect(fragment).not.toContain("<html");
  });

  it("appends one deferred admin bar after BODY_END with an escaped page id", () => {
    const html = compilePage(
      {
        id: 'page-"-1',
        content: "<html><head></head><body><main>Page</main></body></html>",
      },
      [
        {
          id: "body-end",
          location: "BODY_END",
          content: "<script>last()</script>",
          priority: null,
          createdAt: new Date("2026-01-01"),
        },
      ],
    );

    expect(html).toContain('data-kastir-admin-bar="1"');
    expect(html).toContain('data-page-id="page-&quot;-1"');
    expect(html.indexOf("last()")).toBeLessThan(
      html.indexOf('data-kastir-admin-bar="1"'),
    );
    expect(html.match(/data-kastir-admin-bar=/g)).toHaveLength(1);
    expect(html).toMatch(
      /<script defer src="\/_kastir\/admin-bar\.js"[^>]*><\/script><\/body><\/html>$/,
    );
  });

  it("appends the bar to fragments without creating a document wrapper", () => {
    const html = compilePage({
      id: "fragment-page",
      content: "<main>Page</main>",
    });

    expect(html).toMatch(
      /<main>Page<\/main>\n<script defer src="\/_kastir\/admin-bar\.js"/,
    );
    expect(html).not.toContain("<html");
    expect(html).not.toContain("<body");
  });

  it("adds a missing charset meta as the first child of head", () => {
    const html = compilePage({
      id: "page-1",
      content:
        "<html><head><title>No charset</title></head><body><main>Page</main></body></html>",
    });

    expect(html).toMatch(/<head><meta charset="UTF-8"><title>/);
  });

  it("moves a late charset meta to the start of head instead of duplicating it", () => {
    const html = compilePage({
      id: "page-1",
      content:
        '<html><head><title>Late</title><link rel="stylesheet" href="a.css"><meta charset=\'iso-8859-1\'></head><body></body></html>',
    });

    expect(html).toMatch(/<head><meta charset="UTF-8"><title>Late<\/title>/);
    expect(html.match(/charset/gi)).toHaveLength(1);
  });

  it("normalizes a legacy http-equiv content-type charset to the modern meta tag", () => {
    const html = compilePage({
      id: "page-1",
      content:
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>Legacy</title></head><body></body></html>',
    });

    expect(html).toMatch(/<head><meta charset="UTF-8"><title>Legacy<\/title>/);
    expect(html).not.toContain("http-equiv");
  });

  it("keeps charset as the first head child even with a published HEADER snippet", () => {
    const html = compilePage(
      {
        id: "page-1",
        content: "<html><head><title>GTM</title></head><body></body></html>",
      },
      [
        {
          id: "gtm",
          location: "HEADER",
          content: "<script>gtm();</script>",
          priority: null,
          createdAt: new Date("2026-01-01"),
        },
      ],
    );

    expect(html).toMatch(
      /<head><meta charset="UTF-8"><script>gtm\(\);<\/script>/,
    );
  });

  it("is idempotent and a no-op when charset is already correct and first", () => {
    const page = {
      id: "page-1",
      content:
        "<html><head><title>Already fine</title></head><body></body></html>",
    };
    const first = compilePage(page);
    const second = compilePage({ ...page, content: first });

    expect(second).toBe(first);
    expect(first.match(/<meta charset="UTF-8">/g)).toHaveLength(1);
  });

  it("adds charset even without site settings (preview without settings)", () => {
    const html = compilePage({
      id: "draft-1",
      content: "<html><head></head><body><main>Draft</main></body></html>",
    });

    expect(html).toContain('<meta charset="UTF-8">');
  });

  it("recompiling an already compiled artifact does not duplicate the bar", () => {
    const page = {
      id: "page-1",
      content: "<html><head></head><body><main>Page</main></body></html>",
    };
    const first = compilePage(page);
    const second = compilePage({ ...page, content: first });

    expect(second).toBe(first);
    expect(second.match(/data-kastir-admin-bar=/g)).toHaveLength(1);
  });
});
