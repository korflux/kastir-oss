/**
 * Generates `/llms.txt` per https://llmstxt.org/ — Markdown with a required H1
 * and curated links so language models can understand the published site.
 */

export type LlmsTxtPage = {
  id: string;
  slug: string;
  title: string;
};

function absoluteUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, "");
  const normalized = path.replace(/^\/+/, "");
  return normalized ? `${base}/${normalized}` : `${base}/`;
}

/** Escape characters that would break a Markdown link label `[label](url)`. */
function markdownLinkLabel(value: string): string {
  return value.replace(/[\[\]]/g, "").trim() || "Untitled";
}

function summaryLine(input: {
  tagline?: string | null;
  seoDescription?: string | null;
}): string | null {
  const tagline = input.tagline?.trim();
  if (tagline) return tagline;
  const seo = input.seoDescription?.trim();
  if (seo) return seo;
  return null;
}

export function generateLlmsTxt({
  siteTitle,
  tagline,
  seoDescription,
  origin,
  homePageId,
  pages,
  sitemapEnabled,
}: {
  siteTitle: string;
  tagline?: string | null;
  seoDescription?: string | null;
  origin: string;
  homePageId?: string | null;
  pages: readonly LlmsTxtPage[];
  sitemapEnabled: boolean;
}): string {
  const title = siteTitle.trim() || "Site";
  const summary = summaryLine({ tagline, seoDescription });
  const home = homePageId
    ? pages.find((page) => page.id === homePageId)
    : undefined;

  const lines: string[] = [`# ${title}`, ""];

  if (summary) {
    lines.push(`> ${summary}`, "");
  }

  lines.push(
    "Curated map of this site's main public content for language models.",
    "Prefer these links over scraping the full HTML.",
    "",
    "## Pages",
    "",
  );

  // Always include at least one link so validators that require links pass
  // even when the site has no published pages yet.
  lines.push(
    `- [${markdownLinkLabel(title)}](${absoluteUrl(origin, "")}): Site home`,
  );

  if (home && home.slug) {
    lines.push(
      `- [${markdownLinkLabel(home.title)}](${absoluteUrl(origin, home.slug)}): Home page content`,
    );
  }

  const otherPages = [...pages]
    .filter((page) => page.id !== home?.id)
    .sort((left, right) => left.title.localeCompare(right.title));

  for (const page of otherPages) {
    lines.push(
      `- [${markdownLinkLabel(page.title)}](${absoluteUrl(origin, page.slug)})`,
    );
  }

  lines.push("", "## Resources", "");

  if (sitemapEnabled) {
    lines.push(
      `- [Sitemap](${absoluteUrl(origin, "sitemap.xml")}): Machine-readable list of public URLs`,
    );
  }

  lines.push(
    `- [Robots](${absoluteUrl(origin, "robots.txt")}): Crawler access rules for this site`,
  );

  return `${lines.join("\n")}\n`;
}
