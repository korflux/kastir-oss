/**
 * CSP do preview: scripts inline rodam por design (HTML/snippet do rascunho).
 * sandbox sem allow-same-origin deixa a origin opaca (sem cookie/storage/fetch).
 * img-src https: cobre imagens remotas do draft e também um canal de beacon —
 * default-src 'none' já corta XHR; o EDITOR que injeta o script já lê o DOM
 * no painel. font/media ficam em self+data (externos raros em rascunho).
 */
export const PREVIEW_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Content-Security-Policy":
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
} as const;
