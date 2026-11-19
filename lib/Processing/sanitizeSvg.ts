import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitiza SVG de upload. O perfil svg do DOMPurify remove script/handlers,
 * mas deixa texto envolvente, `@import` e `data:text/html` — recusados aqui.
 */
export function sanitizeSvg(source: string): string {
  if (!source.trim()) {
    throw new Error("Content is not a valid SVG");
  }

  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_TRUSTED_TYPE: false,
  }).trim();

  if (!/^<svg(?:\s|>)/i.test(sanitized) || !/<\/svg>$/i.test(sanitized)) {
    throw new Error("Content is not a valid SVG");
  }

  if (/@import/i.test(sanitized) || /data:\s*text\/html/i.test(sanitized)) {
    throw new Error("Content is not a valid SVG");
  }

  return sanitized;
}
