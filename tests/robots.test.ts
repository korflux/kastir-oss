import { describe, expect, it } from "vitest";

import { generateRobotsTxt } from "@/lib/Publishing/generateRobotsTxt";

describe("robots.txt generation", () => {
  it.each([
    [true, true, "Allow: /", true],
    [true, false, "Allow: /", true],
    [false, true, "Disallow: /", false],
    [false, false, "Disallow: /", false],
  ])(
    "generates state indexable=%s ai=%s",
    (indexable, allowAiCrawlers, rule, includesSitemap) => {
      const robots = generateRobotsTxt({
        indexable,
        allowAiCrawlers,
        sitemapUrl: "https://example.com/sitemap.xml",
      });

      expect(robots).toContain(rule);
      expect(robots.includes("Sitemap:")).toBe(includesSitemap);
      expect(robots.includes("User-agent: GPTBot")).toBe(!allowAiCrawlers);
    },
  );
});
