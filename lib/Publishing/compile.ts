import { formatSiteTitle } from "@/lib/Modules/Settings/title";

export type CompilablePage = {
  id?: string;
  title?: string;
  content: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeyword?: string | null;
};

export type CompilableSiteSettings = {
  siteTitle: string;
  tagline?: string | null;
  seoDescription?: string | null;
  siteLanguage: string;
  faviconUrl?: string | null;
  indexable: boolean;
  isHome?: boolean;
};

export type CompilableSnippet = {
  id: string;
  location: "HEADER" | "BODY_START" | "BODY_END";
  content: string;
  priority: number | null;
  createdAt: Date;
  triggerType?: "SELECTOR_EVENT" | "PAGE_LOAD" | "SCROLL" | "REFERRER" | null;
  triggerConfig?: Record<string, unknown> | null;
  maxDisplays?: number | null;
  displayResetDays?: number | null;
};

function compareSnippets(
  left: CompilableSnippet,
  right: CompilableSnippet,
): number {
  if (
    left.priority !== null &&
    right.priority !== null &&
    left.priority !== right.priority
  ) {
    return left.priority - right.priority;
  }

  if (left.priority !== null && right.priority === null) return -1;
  if (left.priority === null && right.priority !== null) return 1;

  const createdDifference =
    left.createdAt.getTime() - right.createdAt.getTime();
  if (createdDifference !== 0) return createdDifference;
  return left.id.localeCompare(right.id);
}

function wrapTriggeredContent(snippet: CompilableSnippet): string {
  if (!snippet.triggerType) return snippet.content;
  return `<div data-kastir-trigger="${escapeHtml(snippet.id)}" style="display:none">${snippet.content}</div>`;
}

function contentForLocation(
  snippets: readonly CompilableSnippet[],
  location: CompilableSnippet["location"],
): string {
  return snippets
    .filter((snippet) => snippet.location === location)
    .slice()
    .sort(compareSnippets)
    .map(wrapTriggeredContent)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function removeExactContent(content: string, value: string): string {
  return value ? content.split(value).join("") : content;
}

const adminBarScriptPattern =
  /\r?\n?<script\b[^>]*\bdata-kastir-admin-bar\s*=\s*(?:"1"|'1'|1)[^>]*>[\s\S]*?<\/script\s*>/gi;

function removeExistingAdminBar(content: string): string {
  return content.replace(adminBarScriptPattern, "");
}

function adminBarScriptTag(pageId: string): string {
  return `<script defer src="/_kastir/admin-bar.js" data-kastir-admin-bar="1" data-page-id="${escapeHtml(pageId)}"></script>`;
}

function injectAdminBar(content: string, pageId: string | undefined): string {
  if (!pageId) return content;

  const script = adminBarScriptTag(pageId);
  const bodyClosing = /<\/body\s*>/i;
  if (bodyClosing.test(content)) {
    return content.replace(bodyClosing, `\n${script}$&`);
  }

  return `${content}\n${script}`;
}

const popupConfigScriptPattern =
  /\r?\n?<script\b[^>]*\bid\s*=\s*(?:"kastir-popup-config"|'kastir-popup-config')[^>]*>[\s\S]*?<\/script\s*>/gi;
const popupTriggersScriptPattern =
  /\r?\n?<script\b[^>]*\bdata-kastir-popup-triggers\s*=\s*(?:"1"|'1'|1)[^>]*>[\s\S]*?<\/script\s*>/gi;

function removeExistingPopupTriggers(content: string): string {
  return content
    .replace(popupConfigScriptPattern, "")
    .replace(popupTriggersScriptPattern, "");
}

/** `</script` inside a triggerConfig string (e.g. a referrer match) must not
 * be able to close this inline JSON script tag early and inject markup. */
function escapeScriptClose(json: string): string {
  return json.replace(/<\/script/gi, "<\\/script");
}

function popupConfigScriptTag(triggered: readonly CompilableSnippet[]): string {
  const config: Record<string, unknown> = {};
  for (const snippet of triggered) {
    config[snippet.id] = {
      triggerType: snippet.triggerType,
      triggerConfig: snippet.triggerConfig ?? null,
      maxDisplays: snippet.maxDisplays ?? null,
      displayResetDays: snippet.displayResetDays ?? null,
    };
  }
  const json = escapeScriptClose(JSON.stringify(config));
  return `<script type="application/json" id="kastir-popup-config">${json}</script>`;
}

function popupTriggersScriptTag(): string {
  return `<script defer src="/_kastir/popup-triggers.js" data-kastir-popup-triggers="1"></script>`;
}

function injectPopupTriggers(
  content: string,
  snippets: readonly CompilableSnippet[],
): string {
  const triggered = snippets.filter((snippet) => snippet.triggerType);
  const withoutExisting = removeExistingPopupTriggers(content);
  if (triggered.length === 0) return withoutExisting;

  const script = `${popupConfigScriptTag(triggered)}\n${popupTriggersScriptTag()}`;
  const bodyClosing = /<\/body\s*>/i;
  if (bodyClosing.test(withoutExisting)) {
    return withoutExisting.replace(bodyClosing, `\n${script}$&`);
  }

  return `${withoutExisting}\n${script}`;
}

const charsetMetaPattern =
  /<meta\b[^>]*\bcharset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi;
const legacyCharsetPattern =
  /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"content-type"|'content-type')[^>]*>/gi;

/** Normalizes charset to the first child of `<head>`, regardless of what
 * the user pasted (absent, late, or the legacy http-equiv form). */
function ensureCharsetDeclaration(content: string): string {
  const headOpening = /<head\b[^>]*>/i;
  if (!headOpening.test(content)) return content;

  const stripped = content
    .replace(charsetMetaPattern, "")
    .replace(legacyCharsetPattern, "");

  return stripped.replace(
    headOpening,
    (match) => `${match}<meta charset="UTF-8">`,
  );
}

function replaceOrInsertHeadTag(
  content: string,
  pattern: RegExp,
  tag: string,
): string {
  const withoutExisting = content.replace(pattern, "");
  const closingHead = /<\/head\s*>/i;
  if (!closingHead.test(withoutExisting)) return withoutExisting;
  return withoutExisting.replace(closingHead, `${tag}\n$&`);
}

function compileDocumentMetadata(
  content: string,
  page: CompilablePage,
  settings: CompilableSiteSettings,
): string {
  const isDocument =
    /<html\b[^>]*>/i.test(content) &&
    /<head\b[^>]*>/i.test(content) &&
    /<body\b[^>]*>/i.test(content);
  if (!isDocument) return content;

  let compiled = content.replace(
    /(<html\b[^>]*?)\s+lang=(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
    "$1",
  );
  compiled = compiled.replace(
    /<html\b([^>]*)>/i,
    (_match, attributes: string) =>
      `<html${attributes} lang="${escapeHtml(settings.siteLanguage)}">`,
  );

  const pageTitle = page.seoTitle?.trim();
  const homeTitle = settings.isHome
    ? formatSiteTitle(settings.siteTitle, settings.tagline)
    : null;
  const fallbackTitle =
    homeTitle || page.title?.trim() || settings.siteTitle.trim();
  const effectiveTitle =
    pageTitle || fallbackTitle || settings.siteTitle.trim();
  const effectiveDescription =
    page.seoDescription?.trim() || settings.seoDescription?.trim();

  if (effectiveTitle) {
    compiled = replaceOrInsertHeadTag(
      compiled,
      /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,
      `<title>${escapeHtml(effectiveTitle)}</title>`,
    );
  }

  if (effectiveDescription) {
    compiled = replaceOrInsertHeadTag(
      compiled,
      /<meta\b[^>]*\bname\s*=\s*(?:"description"|'description'|description)[^>]*>/gi,
      `<meta name="description" content="${escapeHtml(effectiveDescription)}">`,
    );
  }

  compiled = compiled.replace(
    /<meta\b[^>]*\bname\s*=\s*(?:"keywords"|'keywords'|keywords)[^>]*>/gi,
    "",
  );
  if (page.seoKeyword?.trim()) {
    compiled = replaceOrInsertHeadTag(
      compiled,
      /$a^/, // force insertion through the head closing tag
      `<meta name="keywords" content="${escapeHtml(page.seoKeyword.trim())}">`,
    );
  }

  compiled = compiled.replace(
    /<link\b[^>]*\brel\s*=\s*(?:"(?:icon|shortcut icon)"|'(?:icon|shortcut icon)'|(?:icon|shortcut icon))[^>]*>/gi,
    "",
  );
  if (settings.faviconUrl) {
    compiled = replaceOrInsertHeadTag(
      compiled,
      /$a^/,
      `<link rel="icon" href="${escapeHtml(settings.faviconUrl)}">`,
    );
  }

  compiled = compiled.replace(
    /<meta\b[^>]*\bname\s*=\s*(?:"robots"|'robots'|robots)[^>]*>/gi,
    "",
  );
  if (!settings.indexable) {
    compiled = replaceOrInsertHeadTag(
      compiled,
      /$a^/,
      `<meta name="robots" content="noindex,nofollow">`,
    );
  }

  return compiled;
}

export type CompilePageOptions = {
  /** Published pages inject the admin bar; private preview must omit it. Default true. */
  includeAdminBar?: boolean;
};

export function compilePage(
  page: CompilablePage,
  snippets: readonly CompilableSnippet[] = [],
  settings?: CompilableSiteSettings,
  options: CompilePageOptions = {},
): string {
  const includeAdminBar = options.includeAdminBar !== false;
  let compiled = settings
    ? compileDocumentMetadata(page.content, page, settings)
    : page.content;
  compiled = removeExistingAdminBar(compiled);

  const header = contentForLocation(snippets, "HEADER");
  const bodyStart = contentForLocation(snippets, "BODY_START");
  const bodyEnd = contentForLocation(snippets, "BODY_END");
  let prefix = "";
  let suffix = "";

  if (header) {
    compiled = removeExactContent(compiled, header);
    const headOpening = /<head\b[^>]*>/i;
    if (headOpening.test(compiled)) {
      compiled = compiled.replace(
        headOpening,
        (match) => `${match}${header}\n`,
      );
    } else {
      prefix += `${header}\n`;
    }
  }

  compiled = ensureCharsetDeclaration(compiled);

  if (bodyStart) {
    compiled = removeExactContent(compiled, bodyStart);
    const bodyOpening = /<body\b[^>]*>/i;
    if (bodyOpening.test(compiled)) {
      compiled = compiled.replace(
        bodyOpening,
        (match) => `${match}${bodyStart}\n`,
      );
    } else {
      prefix += `${bodyStart}\n`;
    }
  }

  if (bodyEnd) {
    compiled = removeExactContent(compiled, bodyEnd);
    const bodyClosing = /<\/body\s*>/i;
    if (bodyClosing.test(compiled)) {
      compiled = compiled.replace(
        bodyClosing,
        (match) => `\n${bodyEnd}${match}`,
      );
    } else {
      suffix = `\n${bodyEnd}`;
    }
  }

  const body = injectPopupTriggers(`${prefix}${compiled}${suffix}`, snippets);
  if (!includeAdminBar) return body;

  return injectAdminBar(
    body,
    page.id && page.id.length > 0 ? page.id : undefined,
  );
}
