import { normalizeSlug } from "@/lib/Modules/Pages/slug";

const RESERVED_CAMPAIGN_SLUGS = new Set([
  "admin",
  "api",
  "_next",
  "favicon.ico",
  "uploads",
  "s",
]);

/** Pure slug normalizer for campaign forms (client-safe). */
export { normalizeSlug };

export function assertCampaignSlug(value: string): string {
  const raw = value.trim().toLowerCase();

  if (!raw || raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
    throw new Error("Invalid campaign slug");
  }

  if (RESERVED_CAMPAIGN_SLUGS.has(raw)) {
    throw new Error("Campaign slug is reserved");
  }

  const slug = normalizeSlug(value);
  if (!slug || RESERVED_CAMPAIGN_SLUGS.has(slug) || slug.length > 200) {
    throw new Error("Invalid campaign slug");
  }

  return slug;
}
