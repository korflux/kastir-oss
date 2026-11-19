/**
 * Ciclo de vida de um script (Custom Code): rascunho vs. revisão publicada e
 * as operações que movem um para o outro.
 *
 * Regra central: Save nunca recompila o site; só Publish, Ativar e Desativar
 * mudam o que está no ar, e o fazem pedindo o rebuild das páginas afetadas
 * depois do commit (com compensação do status se a fila falhar). Este módulo
 * reúne:
 *  1. o recorte rascunho/publicado e as guardas de concorrência
 *     (`toSnippetRevisionSnapshot`, `assertSnippet*`, `attachSnippetLifecycle`),
 *     consumidos também por rotas de diff, MCP e backfill;
 *  2. o contrato de banco do módulo (`SnippetDatabase`) e helpers de escopo e
 *     gatilho usados por criação e edição;
 *  3. `CustomCodeLifecycle`: Save (com trava de linha e versão por hash do
 *     conteúdo), patch de conteúdo, Restaurar versão, Publish, Ativar e
 *     Desativar, com as transações e a compensação de status.
 *
 * `CustomCodeService` valida a entrada, carrega o script (no patch e nas demais
 * operações; o Save lê a linha sozinho, já travada) e delega para cá; os erros
 * são exceções de domínio (`CustomCodeDomainError`), convertidas na borda. Este arquivo só importa tipos e helpers leves: backfill, rotas de
 * diff e ferramentas MCP o carregam só para `toSnippetRevisionSnapshot`, então
 * a fila (BullMQ, `server-only`) fica no Service, dono do rebuild, e chega por
 * injeção em `CustomCodeLifecycleHost`.
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/app/generated/prisma/client";
import { logEvent } from "@/lib/Logging/logEvent";
import type { LogEventContext } from "@/lib/Logging/logEvent";
import {
  MAX_SNIPPET_CONTENT_BYTES,
  validateSnippetContent,
  type CreateSnippetInput,
  type PatchSnippetContentInput,
  type UpdateSnippetInput,
} from "@/lib/Modules/CustomCode/Schema";
import {
  CustomCodeDomainError,
  type ScopeType,
  type SnippetRecord,
  type SnippetStatus,
  type SnippetWithLifecycle,
  type TriggerConfig,
  type TriggerType,
} from "@/lib/Modules/CustomCode/Types";
import {
  attachRevisionLifecycle,
  createRevisionLifecycleGuards,
  revisionServiceFor,
} from "@/lib/Modules/Revisions/lifecycle";
import type { RevisionService } from "@/lib/Modules/Revisions/Service";
import {
  snippetSnapshotFingerprint,
  snippetSnapshotsEqual,
} from "@/lib/Modules/Revisions/snapshot";
import type {
  SnippetRevisionRecord,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";
import {
  applyContentPatch,
  ContentPatchError,
} from "@/lib/Modules/Shared/ContentPatch";
import { lockRowForUpdate } from "@/lib/Modules/Shared/RowLock";

/* ----------------- recorte rascunho/publicado e guardas ----------------- */

export function toSnippetRevisionSnapshot(
  snippet: Pick<
    SnippetRecord,
    | "name"
    | "location"
    | "content"
    | "priority"
    | "scopeType"
    | "triggerType"
    | "triggerConfig"
    | "maxDisplays"
    | "displayResetDays"
  > & { scopedPages?: Array<{ pageId: string }>; pageIds?: string[] },
): SnippetSnapshot {
  return {
    name: snippet.name,
    location: snippet.location,
    content: snippet.content,
    priority: snippet.priority,
    scopeType: snippet.scopeType,
    pageIds:
      snippet.pageIds ??
      snippet.scopedPages?.map((scope) => scope.pageId) ??
      [],
    triggerType: snippet.triggerType,
    triggerConfig: snippet.triggerConfig,
    maxDisplays: snippet.maxDisplays,
    displayResetDays: snippet.displayResetDays,
  };
}

export function snippetNotFound(
  message = "Snippet was not found",
): CustomCodeDomainError {
  return new CustomCodeDomainError("NOT_FOUND", message);
}

const guards = createRevisionLifecycleGuards({
  resource: "Script",
  fail: (code, message) => new CustomCodeDomainError(code, message),
});

export const assertSnippetExpectedUpdatedAt = guards.assertExpectedUpdatedAt;

/** Ativar só liga o ponteiro lido; Publish concorrente não reescreve outro live. */
export const assertSnippetActivatePointerUnchanged =
  guards.assertActivatePointerUnchanged;

/** Desativar rebuilda o escopo da revisão lida; ponteiro novo aborta. */
export const assertSnippetUnpublishPointerUnchanged =
  guards.assertUnpublishPointerUnchanged;

export function attachSnippetLifecycle(
  snippet: SnippetRecord,
  published: SnippetSnapshot | null,
  extra: { activatedDuringPublish?: boolean } = {},
): SnippetWithLifecycle {
  return attachRevisionLifecycle(
    snippet,
    toSnippetRevisionSnapshot(snippet),
    published,
    {
      fingerprint: snippetSnapshotFingerprint,
      equal: snippetSnapshotsEqual,
    },
    extra,
  );
}

/* ------------------------- contrato de banco ------------------------- */

type PageSummary = {
  id: string;
  title?: string;
  slug?: string;
  status: "DRAFT" | "PUBLISHED";
  deletedAt: Date | null;
};

/**
 * O que o módulo de Custom Code precisa do banco. Definido aqui (e usado por
 * `CustomCode/Service`) porque o ciclo de vida e o Service dependem do mesmo
 * contrato; as lojas opcionais permitem injetar bancos parciais em teste.
 */
export type SnippetDatabase = {
  snippet: {
    findUnique(args: {
      where: { id: string };
      include?: unknown;
    }): Promise<SnippetRecord | null>;
    findMany(args?: {
      where?: unknown;
      orderBy?: unknown;
      skip?: number;
      take?: number;
      include?: unknown;
      select?: unknown;
    }): Promise<SnippetRecord[]>;
    count(args?: { where?: unknown }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<SnippetRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SnippetRecord>;
    updateMany(args: {
      where: { id: string; status?: SnippetStatus };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    delete(args: { where: { id: string } }): Promise<SnippetRecord>;
  };
  snippetPageScope: {
    deleteMany(args: {
      where: { snippetId?: string; pageId?: string };
    }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<{ snippetId: string; pageId: string }>;
    }): Promise<{ count: number }>;
  };
  snippetRevision?: {
    findFirst(args: {
      where: { snippetId?: string; fingerprint?: string };
    }): Promise<SnippetRevisionRecord | null>;
    findUnique(args: {
      where: { id: string };
    }): Promise<SnippetRevisionRecord | null>;
    create(args: {
      data: SnippetSnapshot & {
        snippetId: string;
        authorId: string;
        fingerprint: string;
      };
    }): Promise<SnippetRevisionRecord>;
    count?(args: {
      where: { snippetId: string; pinned?: boolean };
    }): Promise<number>;
    update?(args: {
      where: { id: string };
      data: { pinned: boolean };
    }): Promise<SnippetRevisionRecord>;
  };
  page: {
    findUnique(args: { where: { id: string } }): Promise<PageSummary | null>;
    findMany(args?: {
      where?: unknown;
      select?: unknown;
      skip?: number;
      take?: number;
    }): Promise<PageSummary[]>;
    count(args?: { where?: unknown }): Promise<number>;
  };
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: "SCRIPT";
        objectLabel: string;
        objectId?: string;
      };
    }): Promise<unknown>;
    findMany?(args: {
      where: {
        action: string;
        objectType: "SCRIPT";
        objectId: { in: string[] };
      };
      orderBy: { createdAt: "desc" };
      select: { objectId: true; userId: true };
    }): Promise<Array<{ objectId: string | null; userId: string }>>;
  };
  user?: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
  /** Consulta crua da trava de linha do Save (`lockRowForUpdate`); só vale dentro da transação. */
  $queryRaw: PrismaClient["$queryRaw"];
  $transaction<T>(
    callback: (tx: SnippetDatabase) => Promise<T>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<T>;
};

export type CustomCodeMutationOptions = {
  /** Ativa a política extra usada pelo adaptador MCP, sem afetar o painel. */
  enforceConfirmation?: boolean;
  confirmationApproved?: boolean;
};

/** Centraliza a barreira server-side das transições MCP de custom code. */
export function requireMutationConfirmation(
  options: CustomCodeMutationOptions,
  message: string,
): void {
  if (options.enforceConfirmation && options.confirmationApproved !== true) {
    throw new CustomCodeDomainError("CONFIRMATION_REQUIRED", message);
  }
}

/* --------------------- helpers de escopo, rótulo e gatilho --------------------- */

/** Relação de escopo carregada junto do script em todo `findUnique`/`findMany`. */
export const snippetInclude = { scopedPages: { select: { pageId: true } } };

export function snippetObjectLabel(
  snippet: Pick<SnippetRecord, "name">,
): string {
  return snippet.name;
}

export function snippetPageIds(snippet: SnippetRecord): string[] {
  return snippet.scopedPages?.map((scope) => scope.pageId) ?? [];
}

export function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

type TriggerFieldsState = {
  triggerType: TriggerType | null;
  triggerConfig: TriggerConfig | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
};

export const NULL_TRIGGER_FIELDS: TriggerFieldsState = {
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
};

/**
 * maxDisplays/displayResetDays are only meaningful alongside a trigger, but
 * updateSnippetSchema is partial (a request can touch just one of the three
 * fields) — so the cross-field invariant can't be checked from the payload
 * alone and is resolved here against the existing DB state instead. Clearing
 * a field cascades to the ones that depend on it (no trigger => no cap, no
 * cap => no reset window) instead of erroring on a merge artifact; it only
 * rejects a value the caller explicitly set in this same request that
 * contradicts the resolved state.
 */
export function resolveTriggerFields(
  existing: TriggerFieldsState,
  parsed: Pick<
    CreateSnippetInput,
    "trigger" | "maxDisplays" | "displayResetDays"
  >,
): TriggerFieldsState {
  const triggerType =
    parsed.trigger !== undefined
      ? (parsed.trigger?.triggerType ?? null)
      : existing.triggerType;
  const triggerConfig = (
    parsed.trigger !== undefined
      ? (parsed.trigger?.triggerConfig ?? null)
      : existing.triggerConfig
  ) as TriggerConfig | null;

  if (triggerType == null) {
    if (parsed.maxDisplays != null) {
      throw new CustomCodeDomainError(
        "VALIDATION_ERROR",
        "maxDisplays requires a trigger to be configured",
      );
    }
    return {
      triggerType: null,
      triggerConfig: null,
      maxDisplays: null,
      displayResetDays: null,
    };
  }

  const maxDisplays =
    parsed.maxDisplays !== undefined
      ? parsed.maxDisplays
      : existing.maxDisplays;
  if (maxDisplays == null) {
    if (parsed.displayResetDays != null) {
      throw new CustomCodeDomainError(
        "VALIDATION_ERROR",
        "displayResetDays requires maxDisplays to be configured",
      );
    }
    return {
      triggerType,
      triggerConfig,
      maxDisplays: null,
      displayResetDays: null,
    };
  }

  const displayResetDays =
    parsed.displayResetDays !== undefined
      ? parsed.displayResetDays
      : (existing.displayResetDays ?? 30);

  return { triggerType, triggerConfig, maxDisplays, displayResetDays };
}

/** Campos do snapshot que moram na linha do script; `pageIds` vive na tabela de escopo. */
function snapshotRowData(snapshot: SnippetSnapshot) {
  return {
    name: snapshot.name,
    location: snapshot.location,
    content: snapshot.content,
    priority: snapshot.priority,
    scopeType: snapshot.scopeType,
    triggerType: snapshot.triggerType,
    triggerConfig: snapshot.triggerConfig,
    maxDisplays: snapshot.maxDisplays,
    displayResetDays: snapshot.displayResetDays,
  };
}

/** Troca as linhas de escopo do script; só SPECIFIC_PAGES grava linhas novas. */
async function replaceScopeRows(
  tx: SnippetDatabase,
  snippetId: string,
  scopeType: ScopeType,
  pageIds: string[],
): Promise<void> {
  await tx.snippetPageScope.deleteMany({ where: { snippetId } });
  if (scopeType === "SPECIFIC_PAGES" && pageIds.length) {
    await tx.snippetPageScope.createMany({
      data: pageIds.map((pageId) => ({ snippetId, pageId })),
    });
  }
}

/** Conteúdo recusado pelo validador vira VALIDATION_ERROR antes de ir ao ar. */
function validateForPublish(content: string): void {
  try {
    validateSnippetContent(content);
  } catch (error) {
    throw new CustomCodeDomainError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Snippet content is invalid",
    );
  }
}

/* ------------------------------ operações ------------------------------ */

/**
 * Dependências do ciclo de vida, injetadas pelo `CustomCodeService`. O banco é
 * função porque o Service o resolve de forma preguiçosa (Prisma reaproveitado
 * em hot reload). O efeito pós-commit (fila de rebuild) fica no Service, dono
 * da fila, e chega como `completeMutation`.
 */
export type CustomCodeLifecycleHost = {
  database(): SnippetDatabase;
  /**
   * Enfileira o rebuild das páginas afetadas depois do commit. Se a fila
   * falhar, roda `compensate` e lança QUEUE_FAILED, para nunca deixar
   * "publicado no banco, HTML estático sem rebuild".
   */
  completeMutation(
    mutation: { affectedPageIds: string[]; operationId: string },
    compensate?: () => Promise<void>,
  ): Promise<void>;
};

/**
 * Operações que movem o script entre rascunho e no ar. Publish/Ativar/
 * Desativar seguem a ordem: transação com guarda de ponteiro, depois rebuild
 * enfileirado das páginas afetadas; se a fila falhar, o status é compensado
 * quando o registro ainda é o da própria operação.
 */
export class CustomCodeLifecycle {
  constructor(private readonly host: CustomCodeLifecycleHost) {}

  private get database(): SnippetDatabase {
    return this.host.database();
  }

  private transaction<T>(
    callback: (tx: SnippetDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback);
  }

  /* ---- revisões e estado rascunho/publicado ---- */

  /** RevisionService restrito às revisões de script (Pages não entra). */
  revisionsOf(database: SnippetDatabase): RevisionService {
    return revisionServiceFor("snippetRevision", database, {
      fail: (code, message) => new CustomCodeDomainError(code, message),
      unavailable: "Snippet revision store is unavailable",
      unused: "Page revisions are not used by Custom Code",
    });
  }

  /** Revisão no ar do script; sem ponteiro ou com ponteiro quebrado, null. */
  async loadPublished(
    database: SnippetDatabase,
    snippet: SnippetRecord,
  ): Promise<SnippetRevisionRecord | null> {
    if (!snippet.publishedRevisionId || !database.snippetRevision) return null;
    try {
      return await this.revisionsOf(database).getSnippetRevisionForSnippet(
        snippet.publishedRevisionId,
        snippet.id,
      );
    } catch {
      return null;
    }
  }

  async withLifecycle(
    database: SnippetDatabase,
    snippet: SnippetRecord,
    extra: { activatedDuringPublish?: boolean } = {},
  ): Promise<SnippetWithLifecycle> {
    const published = await this.loadPublished(database, snippet);
    return attachSnippetLifecycle(
      snippet,
      published ? toSnippetRevisionSnapshot(published) : null,
      extra,
    );
  }

  /* ---- escopo e páginas afetadas ---- */

  async publishedScopePageIds(
    snapshot: Pick<SnippetSnapshot, "scopeType" | "pageIds"> | null,
  ): Promise<string[]> {
    if (!snapshot) return [];
    return this.publishedPageIds(snapshot.scopeType, snapshot.pageIds);
  }

  /**
   * Recusa escopo com página inexistente ou na lixeira; devolve os ids únicos.
   * `database` é o banco da consulta: o Save passa a própria transação para não
   * tomar uma segunda conexão do pool enquanto segura a trava da linha.
   */
  async validateScope(
    scopeType: ScopeType,
    pageIds: string[],
    database: SnippetDatabase = this.database,
  ): Promise<string[]> {
    const normalizedIds = uniqueIds(pageIds);
    if (scopeType === "ALL_PAGES" || normalizedIds.length === 0) return [];

    const pages = await database.page.findMany({
      where: { id: { in: normalizedIds } },
    });
    const valid = new Set(
      pages.filter((page) => page.deletedAt === null).map((page) => page.id),
    );
    if (valid.size !== normalizedIds.length) {
      throw new CustomCodeDomainError(
        "VALIDATION_ERROR",
        "The snippet scope contains an invalid or deleted page",
      );
    }
    return normalizedIds;
  }

  /** Páginas publicadas que o escopo alcança; só elas precisam de rebuild. */
  async publishedPageIds(
    scopeType: ScopeType,
    pageIds: string[],
  ): Promise<string[]> {
    const where =
      scopeType === "ALL_PAGES"
        ? { status: "PUBLISHED", deletedAt: null }
        : {
            id: { in: uniqueIds(pageIds) },
            status: "PUBLISHED",
            deletedAt: null,
          };
    const pages = await this.database.page.findMany({ where });
    return pages.map((page) => page.id);
  }

  /* ---- compensação do status quando o rebuild falha ---- */

  /** Desfaz o status só se o registro ainda é o da operação (`updatedAt` igual). */
  private async compensateStatus(
    snippetId: string,
    expectedUpdatedAt: Date,
    status: SnippetStatus,
    publishedRevisionId?: string | null,
  ): Promise<void> {
    const current = await this.database.snippet.findUnique({
      where: { id: snippetId },
    });
    if (!current || !sameInstant(current.updatedAt, expectedUpdatedAt)) return;
    await this.database.snippet.update({
      where: { id: snippetId },
      data: {
        status,
        ...(publishedRevisionId !== undefined ? { publishedRevisionId } : {}),
      },
    });
  }

  /* ---- Save ---- */

  /**
   * Save: grava o rascunho e nunca fotografa, publica nem enfileira rebuild.
   *
   * Tudo roda numa transação, sobre a linha travada, nesta ordem:
   *  1. trava o script (`SELECT ... FOR UPDATE`) antes de qualquer leitura da
   *     linha: duas gravações simultâneas se enfileiram e a segunda lê o que a
   *     primeira confirmou (ler, decidir e gravar é atômico no banco);
   *  2. lê a linha, agora a confirmada pela última gravação concorrente;
   *  3. confere a versão esperada pela guarda comum (hash do conteúdo, que
   *     prevalece, ou `updatedAt`);
   *  4. monta o snapshot a partir DESSA linha, não de um script carregado antes
   *     da trava: com a conferência só pelo hash, nome, escopo ou gatilho
   *     alterados por outra gravação entre o pedido e a trava seriam regravados
   *     com o valor antigo;
   *  5. sem mudança real no snapshot não escreve nem audita (o no-op também
   *     decide sobre a linha travada);
   *  6. grava e audita.
   * Linha ausente ou na lixeira é NOT_FOUND, como no restante do módulo.
   */
  async save(
    userId: string,
    parsed: UpdateSnippetInput,
    audit?: LogEventContext,
  ): Promise<SnippetWithLifecycle> {
    return this.transaction(async (tx) => {
      await lockRowForUpdate(tx, "Snippet", parsed.id);
      const row = await tx.snippet.findUnique({
        where: { id: parsed.id },
        include: snippetInclude,
      });
      if (!row || row.deletedAt) throw snippetNotFound();
      const current: SnippetRecord = {
        ...row,
        scopedPages: row.scopedPages ?? [],
      };
      guards.assertExpectedVersion(
        {
          updatedAt: parsed.expectedUpdatedAt,
          contentSha256: parsed.expectedContentSha256,
        },
        current,
      );

      const nextScopeType = parsed.scopeType ?? current.scopeType;
      const nextPageIds = await this.validateScope(
        nextScopeType,
        parsed.pageIds ?? snippetPageIds(current),
        tx,
      );
      const triggerTouched =
        parsed.trigger !== undefined ||
        parsed.maxDisplays !== undefined ||
        parsed.displayResetDays !== undefined;
      const resolvedTrigger = resolveTriggerFields(
        {
          triggerType: current.triggerType,
          triggerConfig: current.triggerConfig,
          maxDisplays: current.maxDisplays,
          displayResetDays: current.displayResetDays,
        },
        parsed,
      );

      const nextSnapshot: SnippetSnapshot = {
        name: parsed.name ?? current.name,
        location: parsed.location ?? current.location,
        content: parsed.content ?? current.content,
        priority:
          parsed.priority !== undefined ? parsed.priority : current.priority,
        scopeType: nextScopeType,
        pageIds: nextPageIds,
        triggerType: triggerTouched
          ? resolvedTrigger.triggerType
          : current.triggerType,
        triggerConfig: triggerTouched
          ? resolvedTrigger.triggerConfig
          : current.triggerConfig,
        maxDisplays: triggerTouched
          ? resolvedTrigger.maxDisplays
          : current.maxDisplays,
        displayResetDays: triggerTouched
          ? resolvedTrigger.displayResetDays
          : current.displayResetDays,
      };

      if (
        snippetSnapshotsEqual(toSnippetRevisionSnapshot(current), nextSnapshot)
      ) {
        return this.withLifecycle(tx, current);
      }

      // Versão só no Publish — Save grava o rascunho e não fotografa.
      const result = await tx.snippet.update({
        where: { id: current.id },
        data: snapshotRowData(nextSnapshot),
      });
      if (parsed.scopeType !== undefined || parsed.pageIds !== undefined) {
        await replaceScopeRows(tx, current.id, nextScopeType, nextPageIds);
      }
      await logEvent(tx, {
        userId,
        action: "SCRIPT_UPDATED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(result),
        ...audit,
        objectId: result.id,
      });
      return this.withLifecycle(tx, {
        ...result,
        scopedPages: nextPageIds.map((pageId) => ({ pageId })),
      });
    });
  }

  /**
   * Patch de conteúdo por busca e troca exata: o agente envia só os trechos,
   * com o hash do rascunho que leu. `existing` é o script já carregado por
   * `CustomCodeService`; `parsed` já passou pelo schema (1 a 50 operações,
   * `old` não vazio, hash de 64 hexadecimais).
   *
   * Ordem: (1) a versão é conferida ANTES das operações, para que o hash velho
   * resulte em CONFLICT com o hash atual e não em "old text occurs 0 times"
   * sobre conteúdo que o agente nunca viu; (2) `applyContentPatch` aplica as
   * operações em sequência, tudo ou nada; recusa vira VALIDATION_ERROR com o
   * índice e a contagem, sem transação, escrita nem audit; (3) o resultado
   * grava pelo mesmo `save`, que confere o hash outra vez sobre a linha
   * travada. Essa segunda conferência é a que garante a atomicidade: hash igual
   * na linha travada significa conteúdo igual ao que foi corrigido em (2), e uma
   * gravação concorrente entre (1) e a trava resulta em CONFLICT. Resultado
   * idêntico ao conteúdo termina como no-op do `save`. O patch altera só
   * `content`; nome, escopo e gatilho seguem pelo update.
   */
  async patchContent(
    userId: string,
    existing: SnippetRecord,
    parsed: PatchSnippetContentInput,
    audit?: LogEventContext,
  ): Promise<SnippetWithLifecycle> {
    guards.assertExpectedVersion(
      { contentSha256: parsed.expectedContentSha256 },
      existing,
    );

    let content: string;
    try {
      content = applyContentPatch(existing.content, parsed.operations, {
        maxBytes: MAX_SNIPPET_CONTENT_BYTES,
      });
    } catch (error) {
      if (error instanceof ContentPatchError) {
        throw new CustomCodeDomainError("VALIDATION_ERROR", error.message);
      }
      throw error;
    }

    return this.save(
      userId,
      {
        id: existing.id,
        content,
        expectedContentSha256: parsed.expectedContentSha256,
      },
      audit,
    );
  }

  /* ---- Restaurar versão ---- */

  /**
   * Copia a revisão para o rascunho. Confere versão, não fotografa o
   * draft substituído e nunca enfileira rebuild.
   */
  async restoreRevision(
    userId: string,
    existing: SnippetRecord,
    revisionId: string,
    expectedUpdatedAt: Date,
    audit?: LogEventContext,
  ): Promise<SnippetWithLifecycle> {
    assertSnippetExpectedUpdatedAt(expectedUpdatedAt, existing.updatedAt);

    return this.transaction(async (tx) => {
      const current = await tx.snippet.findUnique({
        where: { id: existing.id },
        include: snippetInclude,
      });
      if (!current) throw snippetNotFound();
      assertSnippetExpectedUpdatedAt(expectedUpdatedAt, current.updatedAt);

      const target = await this.revisionsOf(tx).getSnippetRevisionForSnippet(
        revisionId,
        current.id,
      );
      const currentSnapshot = toSnippetRevisionSnapshot({
        ...current,
        scopedPages: current.scopedPages ?? [],
      });
      const nextSnapshot: SnippetSnapshot = {
        name: target.name,
        location: target.location,
        content: target.content,
        priority: target.priority,
        scopeType: target.scopeType,
        pageIds: target.pageIds,
        triggerType: target.triggerType,
        triggerConfig: target.triggerConfig,
        maxDisplays: target.maxDisplays,
        displayResetDays: target.displayResetDays,
      };

      if (!snippetSnapshotsEqual(currentSnapshot, nextSnapshot)) {
        const nextPageIds = await this.validateScope(
          nextSnapshot.scopeType,
          nextSnapshot.pageIds,
        );
        const result = await tx.snippet.update({
          where: { id: current.id },
          data: snapshotRowData(nextSnapshot),
        });
        await replaceScopeRows(
          tx,
          current.id,
          nextSnapshot.scopeType,
          nextPageIds,
        );
        await logEvent(tx, {
          userId,
          action: "SCRIPT_REVISION_RESTORED",
          objectType: "SCRIPT",
          objectLabel: snippetObjectLabel(result),
          objectId: result.id,
          ...audit,
        });
        return this.withLifecycle(tx, {
          ...result,
          scopedPages: nextPageIds.map((pageId) => ({ pageId })),
        });
      }

      await logEvent(tx, {
        userId,
        action: "SCRIPT_REVISION_RESTORED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(current),
        objectId: current.id,
        ...audit,
      });
      return this.withLifecycle(tx, current);
    });
  }

  /* ---- Publish / Ativar / Desativar ---- */

  /**
   * Publish: fotografa o rascunho como revisão, liga o ponteiro e enfileira o
   * rebuild do escopo anterior e do novo. `existing` é o script já carregado.
   */
  async publish(
    userId: string,
    existing: SnippetRecord,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    requireMutationConfirmation(
      options,
      "Explicit confirmation is required to publish a script",
    );
    const previousPublished = await this.loadPublished(this.database, existing);
    const draft = toSnippetRevisionSnapshot(existing);
    if (
      previousPublished &&
      snippetSnapshotsEqual(draft, toSnippetRevisionSnapshot(previousPublished))
    ) {
      throw new CustomCodeDomainError(
        "INVALID_STATE",
        "Script has no unpublished changes",
      );
    }
    validateForPublish(existing.content);

    const affectedPageIds = uniqueIds([
      ...(await this.publishedScopePageIds(previousPublished)),
      ...(await this.publishedPageIds(
        existing.scopeType,
        snippetPageIds(existing),
      )),
    ]);
    const operationId = randomUUID();
    const previousPointer = existing.publishedRevisionId ?? null;
    const wasDeactivated =
      Boolean(existing.publishedRevisionId) && existing.status !== "PUBLISHED";

    const published = await this.transaction(async (tx) => {
      const current = await tx.snippet.findUnique({
        where: { id: existing.id },
        include: snippetInclude,
      });
      if (!current) throw snippetNotFound();
      requireMutationConfirmation(
        options,
        "Explicit confirmation is required to publish a script",
      );
      const currentDraft = toSnippetRevisionSnapshot({
        ...current,
        scopedPages: current.scopedPages ?? [],
      });
      if (!snippetSnapshotsEqual(currentDraft, draft)) {
        throw new CustomCodeDomainError(
          "CONFLICT",
          "Script was updated by another request",
        );
      }
      validateForPublish(current.content);
      const persisted = await this.revisionsOf(tx).persistSnippetSnapshot({
        snippetId: current.id,
        authorId: userId,
        snapshot: currentDraft,
      });
      const result = await tx.snippet.update({
        where: { id: existing.id },
        data: {
          status: "PUBLISHED",
          publishedRevisionId: persisted.revision.id,
        },
      });
      await logEvent(tx, {
        userId,
        action: "SCRIPT_PUBLISHED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(result),
        ...audit,
        objectId: result.id,
      });
      return {
        ...result,
        scopedPages: current.scopedPages ?? [],
      };
    });

    await this.host.completeMutation({ affectedPageIds, operationId }, () =>
      this.compensateStatus(
        published.id,
        published.updatedAt,
        existing.status,
        previousPointer,
      ),
    );
    return this.withLifecycle(this.database, published, {
      activatedDuringPublish: wasDeactivated,
    });
  }

  /**
   * Liga só a revisão já publicada. Recusa sem ponteiro; não lê o rascunho.
   */
  async activate(
    userId: string,
    existing: SnippetRecord,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    requireMutationConfirmation(
      options,
      "Explicit confirmation is required to publish a script",
    );
    if (!existing.publishedRevisionId) {
      throw new CustomCodeDomainError(
        "INVALID_STATE",
        "Script has no published revision",
      );
    }
    if (existing.status === "PUBLISHED") {
      return this.withLifecycle(this.database, existing);
    }

    const published = await this.revisionsOf(
      this.database,
    ).getSnippetRevisionForSnippet(existing.publishedRevisionId, existing.id);
    validateForPublish(published.content);
    const affectedPageIds = await this.publishedScopePageIds(published);
    const operationId = randomUUID();

    const activated = await this.transaction(async (tx) => {
      const current = await tx.snippet.findUnique({
        where: { id: existing.id },
        include: snippetInclude,
      });
      if (!current) throw snippetNotFound();
      assertSnippetActivatePointerUnchanged(
        current.publishedRevisionId ?? null,
        published.id,
      );
      const result = await tx.snippet.update({
        where: { id: existing.id },
        data: { status: "PUBLISHED" },
      });
      await logEvent(tx, {
        userId,
        action: "SCRIPT_PUBLISHED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(result),
        ...audit,
        objectId: result.id,
      });
      return { ...result, scopedPages: current.scopedPages ?? [] };
    });

    await this.host.completeMutation({ affectedPageIds, operationId }, () =>
      this.compensateStatus(activated.id, activated.updatedAt, "DRAFT"),
    );
    return this.withLifecycle(this.database, activated);
  }

  /**
   * Desativa: tira o script do ar mantendo a revisão publicada e o ponteiro,
   * para que Ativar religue exatamente a mesma versão.
   */
  async unpublish(
    userId: string,
    existing: SnippetRecord,
    audit?: LogEventContext,
    options: CustomCodeMutationOptions = {},
  ): Promise<SnippetWithLifecycle> {
    requireMutationConfirmation(
      options,
      "Explicit confirmation is required to unpublish a script",
    );
    const publishedRevisionId = existing.publishedRevisionId;
    if (!publishedRevisionId) {
      throw new CustomCodeDomainError(
        "INVALID_STATE",
        "Script has no published revision",
      );
    }
    if (existing.status === "DRAFT") {
      return this.withLifecycle(this.database, existing);
    }

    const published = await this.loadPublished(this.database, existing);
    const affectedPageIds = await this.publishedScopePageIds(published);
    const operationId = randomUUID();
    const unpublished = await this.transaction(async (tx) => {
      const current = await tx.snippet.findUnique({
        where: { id: existing.id },
        include: snippetInclude,
      });
      if (!current) throw snippetNotFound();
      requireMutationConfirmation(
        options,
        "Explicit confirmation is required to unpublish a script",
      );
      assertSnippetUnpublishPointerUnchanged(
        current.publishedRevisionId ?? null,
        publishedRevisionId,
      );
      if (current.status === "DRAFT") {
        return { ...current, scopedPages: current.scopedPages ?? [] };
      }
      const result = await tx.snippet.update({
        where: { id: existing.id },
        data: { status: "DRAFT" },
      });
      await logEvent(tx, {
        userId,
        action: "SCRIPT_UNPUBLISHED",
        objectType: "SCRIPT",
        objectLabel: snippetObjectLabel(result),
        ...audit,
        objectId: result.id,
      });
      return { ...result, scopedPages: current.scopedPages ?? [] };
    });

    await this.host.completeMutation({ affectedPageIds, operationId }, () =>
      this.compensateStatus(unpublished.id, unpublished.updatedAt, "PUBLISHED"),
    );
    return this.withLifecycle(this.database, unpublished);
  }
}
