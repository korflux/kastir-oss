export type SitemapPage = {
  slug: string;
  publishedAt: Date | null;
  updatedAt: Date;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function generateSitemap({
  origin,
  pages,
  homePageId,
}: {
  origin: string;
  pages: readonly (SitemapPage & { id?: string })[];
  homePageId?: string | null;
}): string {
  const entries = new Map<string, string>();
  for (const page of pages) {
    const timestamp = (page.publishedAt ?? page.updatedAt).toISOString();
    entries.set(absoluteUrl(origin, page.slug), timestamp);
    if (page.id && page.id === homePageId) {
      entries.set(absoluteUrl(origin, ""), timestamp);
    }
  }

  const urls = [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([loc, lastmod]) =>
        `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
