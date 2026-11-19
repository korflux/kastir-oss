import {
  parseInternalUploadsPath,
  type InternalUploadsRef,
} from "@/lib/Modules/Media/publicUrl";

function originsMatch(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

/**
 * Collect unique internal /uploads/{id}/{file} references from free-form HTML.
 * Absolute URLs are only treated as internal when they match publicOrigin.
 * External hosts and non-uploads paths are ignored.
 */
export function extractInternalUploadsFromHtml(
  html: string,
  publicOrigin: string | null = null,
): InternalUploadsRef[] {
  const found = new Map<string, InternalUploadsRef>();

  const consider = (raw: string) => {
    const value = raw.trim();
    if (!value) return;

    if (/^https?:\/\//i.test(value)) {
      if (!publicOrigin || !originsMatch(value, publicOrigin)) return;
    } else if (!value.startsWith("/uploads/")) {
      return;
    }

    const parsed = parseInternalUploadsPath(value);
    if (!parsed) return;
    found.set(`${parsed.mediaId}/${parsed.fileName}`, parsed);
  };

  const attrPattern =
    /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(html)) !== null) {
    consider(match[1] ?? match[2] ?? match[3] ?? "");
  }

  const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]+))\s*\)/gi;
  while ((match = cssUrlPattern.exec(html)) !== null) {
    consider(match[1] ?? match[2] ?? match[3] ?? "");
  }

  return [...found.values()];
}
