/**
 * Build the final redirect Location.
 * Incoming request query params override same keys on the destination.
 * Internal paths (`/…`) are resolved against `siteOrigin`.
 */
export function mergeDestinationUrl(
  destinationUrl: string,
  requestSearch: URLSearchParams,
  siteOrigin: string,
): string {
  const trimmed = destinationUrl.trim();
  const base = trimmed.startsWith("/")
    ? new URL(trimmed, siteOrigin)
    : new URL(trimmed);

  for (const [key, value] of requestSearch.entries()) {
    base.searchParams.set(key, value);
  }

  return base.toString();
}
