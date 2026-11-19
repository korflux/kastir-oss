/**
 * Backfill de revisões publicadas, executado no boot por
 * `lib/Publishing/reconcile.ts`.
 *
 * Após a migração de schema, Pages/Snippets publicados ainda não têm
 * ponteiro. Cria o snapshot inicial com o mesmo fingerprint do app e
 * aponta publishedRevisionId sem apagar o rascunho atual.
 *
 * Page guarda `authorId`; o model `Snippet` não guarda autor nem lista de
 * páginas no registro. Por isso o autor da revisão de script legado é o
 * usuário Master (`isMaster`) e o escopo vem das linhas `SnippetPageScope`
 * (`scopedPages`). As formas de leitura abaixo espelham o que o Prisma devolve.
 *
 * Este módulo só recebe o banco por injeção: não importa Prisma, fila nem
 * `server-only`, para que testes e o boot o carreguem sem efeito colateral.
 */
import { toSnippetRevisionSnapshot } from "@/lib/Modules/CustomCode/lifecycle";
import { toPageSnapshot } from "@/lib/Modules/Pages/lifecycle";
import {
  pageSnapshotFingerprint,
  snippetSnapshotFingerprint,
} from "@/lib/Modules/Revisions/snapshot";
import type {
  PageSnapshot,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";

type BackfillPage = PageSnapshot & {
  id: string;
  authorId: string;
  status: "DRAFT" | "PUBLISHED";
  publishedRevisionId: string | null;
};

/**
 * Linha de `Snippet` lida com `include: { scopedPages }`. O `pageIds` do
 * snapshot não existe no model: é derivado de `scopedPages` em
 * `toSnippetRevisionSnapshot`.
 */
type BackfillSnippet = Omit<SnippetSnapshot, "pageIds"> & {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  publishedRevisionId: string | null;
  scopedPages: Array<{ pageId: string }>;
};

export type RevisionBackfillDatabase = {
  page: {
    findMany(): Promise<BackfillPage[]>;
    update(args: {
      where: { id: string };
      data: { publishedRevisionId: string };
    }): Promise<unknown>;
  };
  /** Só para resolver o autor das revisões de script (usuário Master). */
  user: {
    findFirst(args: {
      where: { isMaster: true };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  snippet: {
    findMany(args: {
      include: { scopedPages: { select: { pageId: true } } };
    }): Promise<BackfillSnippet[]>;
    update(args: {
      where: { id: string };
      data: { publishedRevisionId: string };
    }): Promise<unknown>;
  };
  pageRevision: {
    /** Revisão já existente do mesmo conteúdo (`@@unique([pageId, fingerprint])`). */
    findFirst(args: {
      where: { pageId: string; fingerprint: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: PageSnapshot & {
        pageId: string;
        authorId: string;
        fingerprint: string;
      };
    }): Promise<{ id: string }>;
  };
  snippetRevision: {
    /** Revisão já existente do mesmo conteúdo (`@@unique([snippetId, fingerprint])`). */
    findFirst(args: {
      where: { snippetId: string; fingerprint: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: SnippetSnapshot & {
        snippetId: string;
        authorId: string;
        fingerprint: string;
      };
    }): Promise<{ id: string }>;
  };
};

/**
 * Cria a revisão publicada inicial de cada Page e Snippet `PUBLISHED` ainda
 * sem ponteiro e devolve quantos recursos passaram a ter ponteiro. Se já
 * existir revisão com o mesmo fingerprint (unique por recurso), ela é
 * reaproveitada em vez de criada. Recursos que já têm versão publicada
 * ficam intocados. Páginas usam o `authorId` da própria linha; scripts usam o
 * Master (ver cabeçalho) e, sem Master, são pulados com aviso no log técnico.
 */
export async function backfillPublishedRevisions(
  database: RevisionBackfillDatabase,
): Promise<{ pages: number; snippets: number }> {
  let pages = 0;
  let snippets = 0;

  for (const page of await database.page.findMany()) {
    if (page.status !== "PUBLISHED" || page.publishedRevisionId) continue;
    const snapshot = toPageSnapshot(page);
    const fingerprint = pageSnapshotFingerprint(snapshot);
    // Reaproveita a revisão do mesmo conteúdo (create e update não são atômicos:
    // um boot interrompido entre os dois deixa a revisão sem ponteiro, e criar
    // de novo violaria a unique [pageId, fingerprint] em todo boot seguinte).
    const revision =
      (await database.pageRevision.findFirst({
        where: { pageId: page.id, fingerprint },
        select: { id: true },
      })) ??
      (await database.pageRevision.create({
        data: {
          pageId: page.id,
          authorId: page.authorId,
          fingerprint,
          ...snapshot,
        },
      }));
    await database.page.update({
      where: { id: page.id },
      data: { publishedRevisionId: revision.id },
    });
    pages += 1;
  }

  const legacySnippets = (
    await database.snippet.findMany({
      include: { scopedPages: { select: { pageId: true } } },
    })
  ).filter(
    (snippet) => snippet.status === "PUBLISHED" && !snippet.publishedRevisionId,
  );

  if (legacySnippets.length > 0) {
    // ponytail: autor fixo = Master porque o Snippet não guarda autor, trocar se o model ganhar authorId
    const master = await database.user.findFirst({
      where: { isMaster: true },
      select: { id: true },
    });

    if (!master) {
      // Estado inválido da instalação: sem autor válido a FK de SnippetRevision
      // recusaria a revisão. Não cria nada, registra o motivo (sem dados do
      // script) e deixa o boot seguir; o próximo boot tenta de novo.
      console.warn(
        "[Kastir] Script revision backfill skipped: no Master user found",
        `${legacySnippets.length} published script(s) left without a published revision`,
      );
    } else {
      for (const snippet of legacySnippets) {
        // Falha de um script não impede os demais nem o resto do reconcile.
        try {
          const snapshot = toSnippetRevisionSnapshot(snippet);
          const fingerprint = snippetSnapshotFingerprint(snapshot);
          // Mesmo reaproveitamento das páginas: revisão idêntica já existente
          // só recebe o ponteiro, em vez de falhar na unique a cada boot.
          const revision =
            (await database.snippetRevision.findFirst({
              where: { snippetId: snippet.id, fingerprint },
              select: { id: true },
            })) ??
            (await database.snippetRevision.create({
              data: {
                snippetId: snippet.id,
                authorId: master.id,
                fingerprint,
                ...snapshot,
              },
            }));
          await database.snippet.update({
            where: { id: snippet.id },
            data: { publishedRevisionId: revision.id },
          });
          snippets += 1;
        } catch (error) {
          console.error(
            "[Kastir] Script revision backfill failed",
            snippet.id,
            error instanceof Error ? error.name : "unknown error",
          );
        }
      }
    }
  }

  return { pages, snippets };
}
