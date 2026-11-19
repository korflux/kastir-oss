import { describe, expect, it } from "vitest";

import { generateSitemap } from "@/lib/Publishing/generateSitemap";

describe("sitemap generation", () => {
  it("lists published slugs and one root alias for the selected home", () => {
    const sitemap = generateSitemap({
      origin: "https://example.com/",
      homePageId: "home",
      pages: [
        {
          id: "home",
          slug: "landing",
          publishedAt: new Date("2026-01-02"),
          updatedAt: new Date("2026-01-03"),
        },
        {
          id: "other",
          slug: "other",
          publishedAt: null,
          updatedAt: new Date("2026-01-04"),
        },
      ],
    });

    expect(sitemap).toContain("https://example.com/landing");
    expect(sitemap).toContain("https://example.com/other");
    expect(sitemap).toContain("<loc>https://example.com/</loc>");
    expect(sitemap).toContain("<lastmod>2026-01-02T00:00:00.000Z</lastmod>");
    expect(sitemap.match(/<loc>/g)).toHaveLength(3);
  });
});
