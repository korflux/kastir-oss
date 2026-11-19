const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "_next",
  "favicon.ico",
  "uploads",
  "p",
]);

/** Pure slug normalizer — safe to import from client components. */
export function normalizeSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assertPublishableSlug(value: string): string {
  const raw = value.trim().toLowerCase();

  if (!raw || raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
    throw new Error("Invalid page slug");
  }

  if (RESERVED_SLUGS.has(raw)) {
    throw new Error("Page slug is reserved");
  }

  const slug = normalizeSlug(value);
  if (!slug || RESERVED_SLUGS.has(slug) || slug.length > 200) {
    throw new Error("Invalid page slug");
  }

  return slug;
}

export function nextAvailableSlug(
  requestedSlug: string,
  usedSlugs: ReadonlySet<string>,
): string {
  const base = assertPublishableSlug(requestedSlug);
  if (!usedSlugs.has(base)) {
    return base;
  }

  let suffix = 2;
  while (usedSlugs.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export function pageObjectLabel(page: { title: string; slug: string }): string {
  return `${page.title} (/${page.slug})`;
}
