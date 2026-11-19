/**
 * Ciclo de vida de revisões compartilhado por Pages e Custom Code.
 *
 * Reúne só o que os dois módulos fazem do mesmo jeito em Save, Publish,
 * Ativar, Desativar e Restaurar versão:
 *  - guardas de concorrência (versão esperada por data ou por hash do
 *    conteúdo, e ponteiro publicado);
 *  - o recorte rascunho vs. publicado devolvido junto do registro;
 *  - o RevisionService restrito ao tipo de revisão que o módulo usa.
 *
 * O que muda o site público (arquivos e CDN em Pages; fila de rebuild e
 * compensação em Custom Code) é diferente por natureza e fica no `lifecycle.ts`
 * de cada módulo, que consome estas peças. Este arquivo só importa tipos, o
 * `RevisionService` e o hash puro de `Shared/ContentPatch` (sem Prisma):
 * `Pages/lifecycle` e `CustomCode/lifecycle` são carregados até pelo backfill,
 * então nada daqui pode puxar Prisma, fila ou `server-only`.
 */
import {
  RevisionService,
  type RevisionDatabase,
} from "@/lib/Modules/Revisions/Service";
import type {
  RevisionLifecycleFailure,
  RevisionLifecycleFields,
} from "@/lib/Modules/Revisions/Types";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

/** Qual loja de revisões o módulo usa: `pageRevision` (Pages) ou `snippetRevision` (Custom Code). */
export type RevisionKind = "pageRevision" | "snippetRevision";

/* ------------------------------ guardas ------------------------------ */

export type RevisionLifecycleGuards = {
  /** Save/Restore/Publish com versão esperada recusam quando outro request já gravou. */
  assertExpectedUpdatedAt(
    expectedUpdatedAt: Date | undefined,
    actualUpdatedAt: Date,
  ): void;
  /**
   * Guarda de versão do Save, fonte única para páginas e scripts. Com
   * `expected.contentSha256` confere só o hash do conteúdo atual (comparado em
   * minúsculas) e ignora `expected.updatedAt`: publicar, ativar ou desativar
   * muda o `updatedAt` sem mudar o conteúdo, e isso não deve gerar conflito.
   * Sem hash vale `expected.updatedAt`, como em `assertExpectedUpdatedAt`.
   * `actual` é a linha lida depois da trava; o hash só é calculado quando
   * pedido. O CONFLICT por hash mantém a frase "was updated by another
   * request", que o painel reconhece, e traz o hash atual.
   */
  assertExpectedVersion(
    expected: { updatedAt?: Date; contentSha256?: string },
    actual: { updatedAt: Date; content: string },
  ): void;
  /** Ativar só liga o ponteiro lido; Publish concorrente não pode trocar o ponto de ligação. */
  assertActivatePointerUnchanged(
    currentPointer: string | null,
    compiledRevisionId: string,
  ): void;
  /** Desativar desfaz a revisão lida; ponteiro novo aborta. */
  assertUnpublishPointerUnchanged(
    currentPointer: string | null,
    expectedPointer: string,
  ): void;
};

/**
 * Monta as guardas para um recurso. `resource` entra nas mensagens
 * ("Page"/"Script") e `fail` cria o erro de domínio do módulo chamador.
 */
export function createRevisionLifecycleGuards(options: {
  resource: string;
  fail: RevisionLifecycleFailure;
}): RevisionLifecycleGuards {
  const { resource, fail } = options;

  const assertExpectedUpdatedAt: RevisionLifecycleGuards["assertExpectedUpdatedAt"] =
    (expectedUpdatedAt, actualUpdatedAt) => {
      if (
        expectedUpdatedAt &&
        expectedUpdatedAt.getTime() !== actualUpdatedAt.getTime()
      ) {
        throw fail("CONFLICT", `${resource} was updated by another request`);
      }
    };

  return {
    assertExpectedUpdatedAt,
    assertExpectedVersion(expected, actual) {
      // `!== undefined`, não truthiness: hash vazio é hash esperado inválido e
      // deve recusar, nunca cair para a conferência mais fraca por data.
      if (expected.contentSha256 !== undefined) {
        const currentSha256 = contentSha256(actual.content);
        if (expected.contentSha256.toLowerCase() !== currentSha256) {
          throw fail(
            "CONFLICT",
            `${resource} was updated by another request (current contentSha256: ${currentSha256})`,
          );
        }
        return;
      }
      assertExpectedUpdatedAt(expected.updatedAt, actual.updatedAt);
    },
    assertActivatePointerUnchanged(currentPointer, compiledRevisionId) {
      if (!currentPointer) {
        throw fail("INVALID_STATE", `${resource} has no published revision`);
      }
      if (currentPointer !== compiledRevisionId) {
        throw fail("CONFLICT", "Published revision changed during activate");
      }
    },
    assertUnpublishPointerUnchanged(currentPointer, expectedPointer) {
      if (!currentPointer) {
        throw fail("INVALID_STATE", `${resource} has no published revision`);
      }
      if (currentPointer !== expectedPointer) {
        throw fail("CONFLICT", "Published revision changed during deactivate");
      }
    },
  };
}

/* -------------------- rascunho vs. publicado no registro -------------------- */

/**
 * Anexa ao registro o estado observável de rascunho vs. revisão publicada.
 * `draft` é o snapshot do rascunho atual e `published` o da revisão no ar
 * (null sem ponteiro); `snapshot` injeta fingerprint e igualdade do tipo.
 */
export function attachRevisionLifecycle<
  R extends { status: "DRAFT" | "PUBLISHED" },
  S,
>(
  record: R,
  draft: S,
  published: S | null,
  snapshot: {
    fingerprint(value: S): string;
    equal(left: S, right: S): boolean;
  },
  extra: { activatedDuringPublish?: boolean } = {},
): R & RevisionLifecycleFields<S> {
  return {
    ...record,
    published,
    draftFingerprint: snapshot.fingerprint(draft),
    hasUnpublishedChanges: published ? !snapshot.equal(draft, published) : true,
    activated: record.status === "PUBLISHED",
    ...(extra.activatedDuringPublish !== undefined
      ? { activatedDuringPublish: extra.activatedDuringPublish }
      : {}),
  };
}

/* ------------------- RevisionService restrito a um tipo ------------------- */

type OwnStores<K extends RevisionKind> = {
  [P in K]?: RevisionDatabase[P];
};

/** Banco do módulo: só a loja de revisões que ele usa mais `$transaction`. */
export type ScopedRevisionHost<K extends RevisionKind> = OwnStores<K> & {
  $transaction(
    callback: (tx: OwnStores<K>) => Promise<unknown>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<unknown>;
};

/**
 * RevisionService restrito à loja do módulo. O RevisionService exige as duas
 * lojas (Page e Snippet), mas cada módulo usa uma: a outra vira uma loja
 * "fantasma" que lê vazio e recusa escrita, para que um uso indevido falhe
 * como INVALID_STATE em vez de gravar no tipo errado. Também dentro da
 * `$transaction`, onde a loja é relida do `tx`.
 */
export function revisionServiceFor<K extends RevisionKind>(
  kind: K,
  host: ScopedRevisionHost<K>,
  messages: {
    fail: RevisionLifecycleFailure;
    /** Erro quando o banco do módulo não expõe a própria loja. */
    unavailable: string;
    /** Erro quando alguém tenta gravar na loja que o módulo não usa. */
    unused: string;
  },
): RevisionService {
  const own = host[kind];
  if (!own) throw messages.fail("INVALID_STATE", messages.unavailable);

  const unusedKind: RevisionKind =
    kind === "pageRevision" ? "snippetRevision" : "pageRevision";
  const unusedStore = {
    findFirst: async () => null,
    findUnique: async () => null,
    create: async () => {
      throw messages.fail("INVALID_STATE", messages.unused);
    },
  };
  const withStores = (store: unknown): RevisionDatabase =>
    ({
      [kind]: store,
      [unusedKind]: unusedStore,
    }) as unknown as RevisionDatabase;

  return new RevisionService({
    ...withStores(own),
    $transaction: (callback, options) =>
      host.$transaction(async (tx) => {
        const txStore = tx[kind];
        if (!txStore)
          throw messages.fail("INVALID_STATE", messages.unavailable);
        return callback(withStores(txStore));
      }, options) as ReturnType<typeof callback>,
  });
}
