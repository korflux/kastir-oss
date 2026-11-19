import { normalizePublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import type { UrlRewriteStats } from "@/lib/Modules/Backup/Types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build candidate source origins to replace (exact origin + optional http/https twin for same host).
 */
export function sourceOriginCandidates(sourceOrigin: string): string[] {
  const origin = normalizePublicOrigin(sourceOrigin);
  const url = new URL(origin);
  const candidates = new Set<string>([origin]);

  if (url.protocol === "https:") {
    candidates.add(`http://${url.host}`);
  } else if (url.protocol === "http:") {
    candidates.add(`https://${url.host}`);
  }

  return [...candidates];
}

/**
 * Replace absolute URLs of the source site origin with the target origin.
 * Third-party hosts are left untouched. Uses origin-boundary matching, not raw host substrings.
 */
export function rewriteOriginInString(
  input: string,
  sourceOrigin: string,
  targetOrigin: string,
): { value: string; replacements: number } {
  if (!input) {
    return { value: input, replacements: 0 };
  }

  const fromList = sourceOriginCandidates(sourceOrigin);
  const to = normalizePublicOrigin(targetOrigin);
  let value = input;
  let replacements = 0;

  for (const from of fromList) {
    if (from === to) continue;
    // Match origin as a URL prefix: origin, origin/, or origin followed by path char
    const pattern = new RegExp(
      `${escapeRegExp(from)}(?=$|[/?#]|[^a-zA-Z0-9._~-])`,
      "g",
    );
    value = value.replace(pattern, () => {
      replacements += 1;
      return to;
    });
  }

  return { value, replacements };
}

export function rewriteOriginsInValue(
  value: unknown,
  sourceOrigin: string,
  targetOrigin: string,
): { value: unknown; stats: UrlRewriteStats } {
  let replacements = 0;

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const result = rewriteOriginInString(node, sourceOrigin, targetOrigin);
      replacements += result.replacements;
      return result.value;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        out[key] = walk(child);
      }
      return out;
    }
    return node;
  };

  return {
    value: walk(value),
    stats: { replacements },
  };
}
