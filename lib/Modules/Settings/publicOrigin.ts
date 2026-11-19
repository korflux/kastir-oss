function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    url.pathname = "/";
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizePublicOrigin(value: string): string {
  const origin = parseOrigin(value);
  if (!origin) throw new Error("Public origin must be an HTTP(S) origin");
  return origin;
}

export function getPublicOrigin({
  siteUrl,
  requestOrigin,
  fallbackOrigin,
}: {
  siteUrl?: string | null;
  requestOrigin?: string | null;
  fallbackOrigin?: string;
} = {}): string {
  for (const candidate of [
    siteUrl,
    requestOrigin,
    fallbackOrigin ?? process.env.BETTER_AUTH_URL,
  ]) {
    if (!candidate) continue;
    const origin = parseOrigin(candidate);
    if (origin) return origin;
  }

  throw new Error("No valid public origin is configured");
}
