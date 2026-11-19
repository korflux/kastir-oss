/**
 * Allow only private page preview paths as post-login redirects.
 * Rejects protocol-relative and open redirects.
 */
export function sanitizeLoginNext(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed, "http://kastir.local");
  } catch {
    return null;
  }

  if (
    parsed.origin === "http://kastir.local" &&
    parsed.pathname === "/admin/mcp/consent" &&
    parsed.searchParams.has("client_id") &&
    parsed.searchParams.has("redirect_uri") &&
    parsed.searchParams.has("exp") &&
    parsed.searchParams.has("sig")
  ) {
    return parsed.pathname + parsed.search;
  }

  if (!trimmed.startsWith("/p/")) return null;
  if (
    trimmed.includes("//") ||
    trimmed.includes("\\") ||
    trimmed.includes("..")
  ) {
    return null;
  }
  // /p/{slug} — single segment, publishable slug characters
  if (!/^\/p\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) return null;
  return trimmed;
}
