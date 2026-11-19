/**
 * Public URL for a published static page. The file remains at
 * `public/<slug>/index.html`, but the clean `/slug` path is canonical.
 */
export function getPublishedPagePath(slug: string): string {
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  return `/${normalized}`;
}

/** Path shown/copied in the Pages list: home is always `/`. */
export function getListedPagePath(slug: string, isHome: boolean): string {
  return isHome ? "/" : getPublishedPagePath(slug);
}

/** Absolute public URL for the list copy action (origin without trailing slash). */
export function getListedPageAbsoluteUrl(
  origin: string,
  slug: string,
  isHome: boolean,
): string {
  return `${origin.replace(/\/$/, "")}${getListedPagePath(slug, isHome)}`;
}
