export function formatSiteTitle(
  siteTitle: string,
  tagline?: string | null,
): string {
  return [siteTitle.trim(), tagline?.trim()]
    .filter((value): value is string => Boolean(value))
    .join(" - ");
}
