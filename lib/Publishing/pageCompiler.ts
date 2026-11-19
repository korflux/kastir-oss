import {
  resolvePublishedSnippet,
  snippetAppliesToPage,
  type PublishedSnippetSource,
} from "@/lib/Modules/Revisions/publishedState";
import {
  compilePage,
  type CompilablePage,
  type CompilableSiteSettings,
  type CompilePageOptions,
} from "@/lib/Publishing/compile";

export type PageCompilationDatabase = {
  snippet?: {
    findMany(args: {
      where: unknown;
      include?: { publishedRevision: true };
    }): Promise<PublishedSnippetSource[]>;
  };
  siteSettings?: {
    findUnique(args: { where: { id: string } }): Promise<{
      siteTitle: string;
      tagline?: string | null;
      seoDescription: string | null;
      siteLanguage: string;
      indexable: boolean;
      faviconMediaId: string | null;
      homePageId?: string | null;
      updatedAt?: Date;
    } | null>;
  };
  mediaFile?: {
    findUnique(args: { where: { id: string } }): Promise<{
      url: string;
      processingStatus: string;
    } | null>;
  };
};

export type PageCompiler = (page: CompilablePage) => Promise<string>;

export function createPageCompiler(
  database: PageCompilationDatabase,
  compileOptions: CompilePageOptions = {},
): PageCompiler {
  return async (page) => {
    // Escopo vem da revisão publicada. Sem page.id só ALL_PAGES — has:undefined
    // no Prisma não é “nenhuma página”, é filtro inválido.
    const publishedScope = page.id
      ? {
          is: {
            OR: [
              { scopeType: "ALL_PAGES" as const },
              {
                scopeType: "SPECIFIC_PAGES" as const,
                pageIds: { has: page.id },
              },
            ],
          },
        }
      : { is: { scopeType: "ALL_PAGES" as const } };
    const snippetRows = database.snippet
      ? await database.snippet.findMany({
          where: {
            status: "PUBLISHED",
            deletedAt: null,
            publishedRevisionId: { not: null },
            publishedRevision: publishedScope,
          },
          include: { publishedRevision: true },
        })
      : [];
    const snippets = snippetRows
      .map(resolvePublishedSnippet)
      .filter((snippet) => snippet !== null)
      .filter((snippet) => snippetAppliesToPage(snippet, page.id));

    let settings: CompilableSiteSettings | undefined;
    if (database.siteSettings) {
      const stored = await database.siteSettings.findUnique({
        where: { id: "singleton" },
      });
      if (stored) {
        let faviconUrl: string | null = null;
        if (stored.faviconMediaId && database.mediaFile) {
          const favicon = await database.mediaFile.findUnique({
            where: { id: stored.faviconMediaId },
          });
          if (favicon?.processingStatus === "READY") {
            // Cache-bust so browsers pick up a changed site icon without hard refresh.
            const version =
              "updatedAt" in stored && stored.updatedAt instanceof Date
                ? stored.updatedAt.getTime()
                : Date.now();
            faviconUrl = `${favicon.url}${favicon.url.includes("?") ? "&" : "?"}v=${version}`;
          }
        }
        settings = {
          siteTitle: stored.siteTitle,
          tagline: stored.tagline ?? null,
          seoDescription: stored.seoDescription,
          siteLanguage: stored.siteLanguage,
          // Private preview must never be indexed even if the site is indexable.
          indexable:
            compileOptions.includeAdminBar === false ? false : stored.indexable,
          isHome: stored.homePageId === page.id,
          faviconUrl,
        };
      }
    }

    return compilePage(page, snippets, settings, compileOptions);
  };
}
