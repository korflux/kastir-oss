import type { PublicSiteSettings } from "@/lib/Modules/Settings/Types";

/** Non-sensitive settings fields exposed over MCP (no Cloudflare material). */
export const MCP_PUBLIC_SETTINGS_KEYS = [
  "siteTitle",
  "tagline",
  "seoDescription",
  "faviconMediaId",
  "siteUrl",
  "siteLanguage",
  "timezone",
  "dateFormat",
  "timeFormat",
  "weekStartsOn",
  "homePageId",
  "indexable",
  "allowAiCrawlers",
  "sitemapEnabled",
  "notFoundPageId",
  "notFoundRedirectToHome",
  "webpConversionEnabled",
  "revisionRetentionLimit",
] as const satisfies ReadonlyArray<keyof PublicSiteSettings>;

/** Project settings for MCP responses — never includes token, zone, or configured flag. */
export function toMcpPublicSettings(
  settings: PublicSiteSettings,
): Record<string, unknown> {
  return Object.fromEntries(
    MCP_PUBLIC_SETTINGS_KEYS.map((key) => [key, settings[key]]),
  );
}
