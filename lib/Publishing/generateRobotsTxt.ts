export const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "CCBot",
  "PerplexityBot",
  "Bytespider",
  "Applebot-Extended",
  "Meta-ExternalAgent",
] as const;

export function generateRobotsTxt({
  indexable,
  allowAiCrawlers,
  sitemapUrl,
}: {
  indexable: boolean;
  allowAiCrawlers: boolean;
  sitemapUrl?: string | null;
}): string {
  const lines = ["User-agent: *", indexable ? "Allow: /" : "Disallow: /"];

  if (!allowAiCrawlers) {
    for (const userAgent of AI_CRAWLER_USER_AGENTS) {
      lines.push("", `User-agent: ${userAgent}`, "Disallow: /");
    }
  }

  if (indexable && sitemapUrl) {
    lines.push("", `Sitemap: ${sitemapUrl}`);
  }

  return `${lines.join("\n")}\n`;
}
