"use client";

/**
 * Estado do histórico de versões de um recurso (Pages e Scripts compartilham).
 *
 * Seções deste arquivo:
 *   1. Tipos das respostas da API.
 *   2. `useRevisionHistory`: lista, comparação (versão + diff), fixar e restaurar.
 *
 * Fluxo de comparação: `select(id, conteúdoDoEditor)` busca a versão (a resposta já traz o
 * snapshot completo) e guarda o snapshot em `version` e o diff em `diffLines`. A direção do
 * diff é editor → versão: `−` é o que sai do rascunho ao restaurar, `+` é o que volta com a
 * versão. O editor deriva daí os campos fora do código (`revisionFieldChanges`).
 *
 * Desfazer (spec F7) NÃO mora aqui: o editor só sabe restaurar com o formulário limpo, então
 * o rascunho que vai ser substituído é o DTO salvo que ele já tem em mãos. O editor guarda
 * esse DTO antes de chamar `restore` e, para desfazer, grava-o de volta pelo salvar normal
 * com o `updatedAt` do recurso devolvido por `restore` (sem publicar).
 */

import { useCallback, useEffect, useState } from "react";

import type { RevisionHistoryItem } from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import {
  compareRevisionText,
  type RevisionDiffLine,
} from "@/lib/Modules/Revisions/diff";
import { requestJson, type ApiError } from "@/lib/requestJson";

/* -------------------------------------------------------------------------- */
/* 1. Tipos das respostas                                                      */
/* -------------------------------------------------------------------------- */

type ListResponse = {
  items: Array<{
    id: string;
    fingerprint: string;
    title?: string;
    name?: string;
    authorId: string;
    authorName?: string;
    author?: { name?: string } | null;
    createdAt: string;
    pinned: boolean;
    published: boolean;
  }>;
};

/** Teto de itens por página do servidor (`MAX_REVISION_PAGE_SIZE`). */
// ponytail: um pedido só com o teto cobre a retenção máxima (30) + fixadas + publicada, então
// não há paginação na UI; paginar se o teto de retenção ou de fixadas crescer.
const LIST_PAGE_SIZE = 50;

/** O GET de uma versão devolve o registro inteiro: snapshot completo + metadados. */
type RevisionResponse<TSnapshot> = { revision: TSnapshot };

/** Mínimo que todo snapshot tem; Pages e Scripts acrescentam os próprios campos. */
export type RevisionSnapshotBase = { content: string };

type Compare<TSnapshot> = {
  id: string;
  version: TSnapshot;
  lines: RevisionDiffLine[];
};

/** Referência estável para "sem comparação": o painel do diff depende da identidade de `lines`. */
const NO_DIFF_LINES: RevisionDiffLine[] = [];

/* -------------------------------------------------------------------------- */
/* 2. Hook                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Consultas de histórico para um recurso. Restore devolve o payload cru
 * para o adaptador (page/snippet) atualizar o rascunho sem publicar.
 *
 * Retorno:
 *   - lista: `items`, `status`, `errorMessage`, `conflict`, `retryable`, `busy`, `reload`;
 *   - comparação: `selectedId` (null = editando), `selected` (item da lista), `version`
 *     (snapshot completo), `diffLines`, `expandAllSignal`;
 *   - ações: `select(id, conteúdoDoEditor)`, `closeView()`, `restore(id)`, `pin(id, fixar)`,
 *     `retry(conteúdoDoEditor)` (tenta de novo o que falhou) e `expandAll()`.
 */
export function useRevisionHistory<
  TSnapshot extends RevisionSnapshotBase = RevisionSnapshotBase,
>({
  listUrl,
  expectedUpdatedAt,
  enabled,
  fallbackError,
}: {
  listUrl: string | null;
  expectedUpdatedAt: string | null;
  enabled: boolean;
  fallbackError: string;
}) {
  const [items, setItems] = useState<RevisionHistoryItem[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "empty" | "ready">(
    "empty",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [compare, setCompare] = useState<Compare<TSnapshot> | null>(null);
  // Versão que falhou ao carregar: "Tentar de novo" a reabre sem trocar o modo do editor.
  const [failedSelectId, setFailedSelectId] = useState<string | null>(null);
  const [expandAllSignal, setExpandAllSignal] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!listUrl || !enabled) {
      setItems([]);
      setStatus("empty");
      return;
    }
    setStatus("loading");
    setErrorMessage(undefined);
    try {
      const result = await requestJson<ListResponse>(
        `${listUrl}?pageSize=${LIST_PAGE_SIZE}`,
      );
      const next = result.items.map((item) => ({
        id: item.id,
        fingerprint: item.fingerprint,
        authorName: item.authorName ?? item.author?.name ?? item.authorId,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : new Date(item.createdAt).toISOString(),
        pinned: item.pinned,
        published: item.published,
      }));
      setItems(next);
      setStatus(next.length === 0 ? "empty" : "ready");
    } catch (error) {
      setStatus("error");
      setErrorMessage((error as ApiError).message || fallbackError);
    }
  }, [enabled, fallbackError, listUrl]);

  useEffect(() => {
    let active = true;
    // Microtask: o lint recusa setState síncrono no body do effect.
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  /**
   * Inspeção: GET da versão (snapshot completo) e diff contra o conteúdo em memória do
   * editor (não o rascunho persistido). Falha não troca o modo do editor: guarda o id para
   * `retry`.
   */
  const select = async (id: string, draftContent: string) => {
    if (!listUrl) return;
    setBusy(true);
    setConflict(false);
    setErrorMessage(undefined);
    setFailedSelectId(null);
    try {
      const result = await requestJson<RevisionResponse<TSnapshot>>(
        `${listUrl}/${id}`,
      );
      setCompare({
        id,
        version: result.revision,
        // Editor → versão: `−` sai do rascunho, `+` volta com a versão.
        lines: compareRevisionText(draftContent, result.revision.content),
      });
    } catch (error) {
      setFailedSelectId(id);
      setErrorMessage((error as ApiError).message || fallbackError);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Restaura a versão no rascunho (sem publicar) com o `updatedAt` carregado no editor.
   * Devolve o recurso resultante (o editor atualiza o formulário e guarda o `updatedAt` novo
   * para o desfazer) ou null quando falhou; um 409 liga `conflict`.
   */
  const restore = async (
    id: string,
  ): Promise<Record<string, unknown> | null> => {
    if (!listUrl || !expectedUpdatedAt) return null;
    setBusy(true);
    setConflict(false);
    setErrorMessage(undefined);
    try {
      const result = await requestJson<Record<string, unknown>>(
        `${listUrl}/${id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ expectedUpdatedAt }),
        },
      );
      setCompare(null);
      await load();
      return result;
    } catch (error) {
      const typed = error as ApiError;
      if (typed.code === "CONFLICT") setConflict(true);
      else setErrorMessage(typed.message || fallbackError);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Fixa ou desafixa uma versão e recarrega a lista (o limite de 3 é conferido no servidor). */
  const pin = async (id: string, pinned: boolean) => {
    if (!listUrl) return;
    setBusy(true);
    setErrorMessage(undefined);
    try {
      await requestJson(`${listUrl}/${id}/pin`, {
        method: "POST",
        body: JSON.stringify({ pinned }),
      });
      await load();
    } catch (error) {
      setErrorMessage((error as ApiError).message || fallbackError);
    } finally {
      setBusy(false);
    }
  };

  /** Sai da comparação (Voltar a editar / linha Rascunho): o editor retoma o conteúdo. */
  const closeView = () => {
    setCompare(null);
    setFailedSelectId(null);
    setErrorMessage(undefined);
  };

  /**
   * "Tentar de novo": recarrega a lista quando ela falhou, ou reabre a versão que falhou ao
   * carregar. Recebe o conteúdo ATUAL do editor porque o diff é contra ele.
   */
  const retry = async (draftContent: string) => {
    if (failedSelectId) await select(failedSelectId, draftContent);
    else await load();
  };

  /** Pede ao painel do diff para abrir todos os trechos iguais recolhidos. */
  const expandAll = () => setExpandAllSignal((value) => value + 1);

  return {
    items,
    status,
    errorMessage,
    conflict,
    /** Há o que tentar de novo: lista com erro, ou versão que falhou ao carregar. */
    retryable: status === "error" || failedSelectId !== null,
    selectedId: compare?.id ?? null,
    selected: items.find((item) => item.id === compare?.id) ?? null,
    version: compare?.version ?? null,
    diffLines: compare?.lines ?? NO_DIFF_LINES,
    expandAllSignal,
    busy,
    reload: load,
    select,
    restore,
    pin,
    closeView,
    retry,
    expandAll,
  };
}
