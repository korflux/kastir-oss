/**
 * Pure detection of clickable media references in raw page HTML/CSS —
 * `<img src="...">` and `url(...)` inside a `style="..."` attribute or an
 * embedded `<style>` block. Isolated from PageEditor/CodeMirror so it stays
 * unit-testable without a browser.
 */
export type MediaReferenceRange = { from: number; to: number };

// Each pattern matches only up to (and including) the opening delimiter, so
// `match.index + match[0].length` is the exact start of the value — no need
// for the ES2022 regex `d` (match indices) flag, which this project's ES2017
// build target doesn't support.
const IMG_SRC_PREFIX = /<img\b[^>]*?\bsrc\s*=\s*(["'])/gi;
const STYLE_BLOCK_OPEN = /<style\b[^>]*>/gi;
const STYLE_CLOSE = /<\/style\s*>/i;
const STYLE_ATTR_PREFIX = /\sstyle\s*=\s*(["'])/gi;
const URL_FUNCTION_PREFIX = /url\(\s*(["']?)/gi;

function findUrlFunctionRanges(
  css: string,
  offset: number,
): MediaReferenceRange[] {
  const ranges: MediaReferenceRange[] = [];
  for (const match of css.matchAll(URL_FUNCTION_PREFIX)) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = quote
      ? css.indexOf(quote, valueStart)
      : css.indexOf(")", valueStart);
    if (valueEnd === -1) continue;
    ranges.push({ from: offset + valueStart, to: offset + valueEnd });
  }
  return ranges;
}

export function findMediaReferenceRanges(doc: string): MediaReferenceRange[] {
  const ranges: MediaReferenceRange[] = [];

  for (const match of doc.matchAll(IMG_SRC_PREFIX)) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = doc.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;
    ranges.push({ from: valueStart, to: valueEnd });
  }

  for (const match of doc.matchAll(STYLE_BLOCK_OPEN)) {
    const contentStart = match.index + match[0].length;
    const remainder = doc.slice(contentStart);
    const closing = remainder.match(STYLE_CLOSE);
    const contentEnd =
      closing?.index != null ? contentStart + closing.index : doc.length;
    ranges.push(
      ...findUrlFunctionRanges(
        doc.slice(contentStart, contentEnd),
        contentStart,
      ),
    );
  }

  for (const match of doc.matchAll(STYLE_ATTR_PREFIX)) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = doc.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;
    ranges.push(
      ...findUrlFunctionRanges(doc.slice(valueStart, valueEnd), valueStart),
    );
  }

  return ranges.sort((a, b) => a.from - b.from);
}
