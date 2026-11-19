import { describe, expect, it } from "vitest";

import { generateLlmsTxt } from "@/lib/Publishing/generateLlmsTxt";

describe("llms.txt generation", () => {
  it("emits a required H1, a summary, and markdown links", () => {
    const body = generateLlmsTxt({
      siteTitle: "Acme Docs",
      tagline: "Product documentation",
      origin: "https://docs.example.com/",
      homePageId: "home",
      pages: [
        { id: "home", slug: "welcome", title: "Welcome" },
        { id: "other", slug: "pricing", title: "Pricing" },
      ],
      sitemapEnabled: true,
    });

    expect(body.startsWith("# Acme Docs\n")).toBe(true);
    expect(body).toContain("> Product documentation");
    expect(body).toContain("[Acme Docs](https://docs.example.com/)");
    expect(body).toContain("[Welcome](https://docs.example.com/welcome)");
    expect(body).toContain("[Pricing](https://docs.example.com/pricing)");
    expect(body).toContain("[Sitemap](https://docs.example.com/sitemap.xml)");
    expect(body).toContain("[Robots](https://docs.example.com/robots.txt)");
    // At least one markdown link with a URL (validator requirement).
    expect(body).toMatch(/\[[^\]]+\]\(https?:\/\/[^)]+\)/);
  });

  it("falls back to seoDescription and still links when there are no pages", () => {
    const body = generateLlmsTxt({
      siteTitle: "Empty Site",
      seoDescription: "A brand new site",
      origin: "https://empty.example",
      pages: [],
      sitemapEnabled: false,
    });

    expect(body).toContain("# Empty Site");
    expect(body).toContain("> A brand new site");
    expect(body).toContain("[Empty Site](https://empty.example/)");
    expect(body).not.toContain("Sitemap");
    expect(body).toContain("robots.txt");
  });

  it("strips brackets from link labels so markdown stays valid", () => {
    const body = generateLlmsTxt({
      siteTitle: "Site",
      origin: "https://example.com",
      pages: [{ id: "1", slug: "a", title: "See [docs]" }],
      sitemapEnabled: false,
    });

    expect(body).toContain("[See docs](https://example.com/a)");
    expect(body).not.toContain("[See [docs]]");
  });
});
