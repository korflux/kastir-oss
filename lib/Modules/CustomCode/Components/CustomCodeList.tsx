"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { BulkActionBar } from "@/components/Shared/BulkActionBar";
import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { ListHeader } from "@/components/Shared/ListHeader";
import {
  NameSortHeader,
  nameSortAriaValue,
} from "@/components/Shared/NameSortHeader";
import {
  ListEmptyState,
  ListViewport,
} from "@/components/Shared/ResponsiveList";
import { StatusToggle } from "@/components/Shared/StatusToggle";
import { useMutationLock } from "@/components/Shared/mutationLock";
import { useRowSelection } from "@/components/Shared/useRowSelection";
import { Button } from "@/components/ui/button";
import {
  CustomCodeQuickEditPopover,
  type CustomCodeQuickEditInput,
} from "@/lib/Modules/CustomCode/Components/CustomCodeQuickEditPopover";
import type {
  CustomCodeCopy,
  SnippetDto,
} from "@/lib/Modules/CustomCode/Components/CustomCodeTypes";
import type { BulkResult } from "@/lib/Modules/Shared/Bulk";
import {
  statusSwitchLabelKey,
  turnOn,
  turnOnNoticeKey,
} from "@/lib/Modules/Revisions/Components/revisionEditorState";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";
import { compareByName, type NameSortDir } from "@/lib/utils/nameSort";

/** Formata timestamps da API sem quebrar a lista diante de valor inválido. */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Traduz o ponto de injeção usando a copy já fornecida pelo workspace. */
function locationLabel(
  location: SnippetDto["location"],
  copy: CustomCodeCopy,
): string {
  return location === "HEADER"
    ? copy.header
    : location === "BODY_START"
      ? copy.bodyStart
      : copy.bodyEnd;
}

/** Substitui contagens nas mensagens comuns sem misturar i18n com o chrome. */
function formatBulkCopy(
  template: string,
  values: Record<string, number>,
): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replace(`{${key}}`, String(value)),
    template,
  );
}

/** Lista e lixeira de scripts; concentra fetch e ações sem conhecer a rota do editor. */
export function CustomCodeList({
  bulkDictionary,
  canBulk,
  dictionary,
}: {
  bulkDictionary: PanelDictionary["bulk"];
  canBulk: boolean;
  dictionary: CustomCodeCopy;
}) {
  const router = useRouter();
  const [items, setItems] = useState<SnippetDto[]>([]);
  const [search, setSearch] = useState("");
  // Sort de apresentação só na UI — API continua createdAt desc.
  const [sortDir, setSortDir] = useState<NameSortDir>("asc");
  const [trashMode, setTrashMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    busyAction: busyId,
    finish: finishMutation,
    isBusy: mutationBusy,
    start: beginMutation,
  } = useMutationLock();
  const [confirmTrashId, setConfirmTrashId] = useState<string | null>(null);
  // Desligar o switch pede confirmação (F4): o script deixa de ser injetado no site.
  const [confirmUnpublishId, setConfirmUnpublishId] = useState<string | null>(
    null,
  );
  const [confirmTrashIds, setConfirmTrashIds] = useState<string[] | null>(null);
  const [confirmPermanentId, setConfirmPermanentId] = useState<string | null>(
    null,
  );
  const [confirmPermanentIds, setConfirmPermanentIds] = useState<
    string[] | null
  >(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => compareByName(a.name, b.name, sortDir)),
    [items, sortDir],
  );
  const visibleIds = useMemo(
    () => sortedItems.map((item) => item.id),
    [sortedItems],
  );
  const selection = useRowSelection({
    resetKey: `${search}:${trashMode}`,
    visibleIds,
  });

  /** Recarrega a lista ou lixeira aplicando a busca atual na API. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (trashMode) params.set("trash", "1");
      const query = params.size ? `?${params.toString()}` : "";
      const result = await requestJson<{ items: SnippetDto[] }>(
        `/api/admin/custom-code${query}`,
      );
      setItems(result.items);
    } catch (loadError) {
      setError((loadError as ApiError).message || dictionary.error);
    } finally {
      setLoading(false);
    }
  }, [dictionary.error, search, trashMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Cria o rascunho mínimo e encaminha imediatamente para o editor. */
  const createSnippet = async () => {
    if (!beginMutation("create")) return;
    setError(null);
    try {
      const result = await requestJson<{ snippet: SnippetDto }>(
        "/api/admin/custom-code",
        {
          method: "POST",
          body: JSON.stringify({
            name: dictionary.newSnippet,
            location: "HEADER",
            content: dictionary.newScriptTemplate,
            scopeType: "ALL_PAGES",
            pageIds: [],
          }),
        },
      );
      router.push(`/admin/custom-code/${result.snippet.id}`);
    } catch (createError) {
      setError((createError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Chamada crua à ação de ciclo de vida do script; lança o `ApiError` do servidor. */
  const callLifecycleAction = (
    id: string,
    action: "publish" | "activate" | "unpublish",
  ) =>
    requestJson(`/api/admin/custom-code/${id}/${action}`, {
      method: "POST",
    });

  /**
   * Liga o switch da linha (F9, A12): publica o rascunho salvo e, só quando o servidor
   * recusa por "sem alteração não publicada", volta ao ar a versão publicada (`turnOn`,
   * T1). A listagem não salva nem compara conteúdo: o servidor decide, então nunca vai ao
   * ar uma versão diferente do rascunho salvo. Falha mostra a mensagem do servidor na faixa
   * de erro e o switch continua como estava.
   */
  const turnOnSnippet = async (id: string) => {
    if (!beginMutation(`turn-on:${id}`)) return;
    setError(null);
    try {
      const result = await turnOn({
        publish: () => callLifecycleAction(id, "publish"),
        activate: () => callLifecycleAction(id, "activate"),
      });
      await load();
      // `load` limpa o aviso ao começar; o resultado entra depois do recarregamento.
      if (result) setNotice(dictionary.publishing[turnOnNoticeKey(result)]);
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Tira o script confirmado do ar; rascunho e versões ficam. */
  const unpublishSnippet = async (id: string) => {
    if (!beginMutation(`unpublish:${id}`)) return;
    setError(null);
    try {
      await callLifecycleAction(id, "unpublish");
      await load();
      setNotice(dictionary.publishing.noticeTakenOffline);
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
      setConfirmUnpublishId(null);
    }
  };

  /** Ligar publica na hora; desligar deixa de injetar o script, então pede confirmação (F4). */
  const toggleLive = (item: SnippetDto) => {
    if (item.status === "PUBLISHED") {
      setConfirmUnpublishId(item.id);
      return;
    }
    void turnOnSnippet(item.id);
  };

  /** Duplica um script como rascunho e abre a nova cópia. */
  const duplicateSnippet = async (id: string) => {
    if (!beginMutation(id)) return;
    setError(null);
    try {
      const result = await requestJson<{ snippet: SnippetDto }>(
        `/api/admin/custom-code/${id}/duplicate`,
        { method: "POST" },
      );
      router.push(`/admin/custom-code/${result.snippet.id}`);
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Move o script confirmado para a lixeira reversível. */
  const trashSnippet = async (id: string) => {
    if (!beginMutation(id)) return;
    setError(null);
    try {
      await requestJson(`/api/admin/custom-code/${id}`, { method: "DELETE" });
      setConfirmTrashId(null);
      // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
      selection.remove([id]);
      await load();
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Envia a lixeira em lote pelo endpoint canônico e preserva falhas para retry. */
  const trashSnippetsBulk = async (ids: string[]) => {
    if (!beginMutation("bulk:trash")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>(
        "/api/admin/custom-code/bulk",
        {
          method: "POST",
          body: JSON.stringify({ action: "trash", ids }),
        },
      );
      selection.remove(result.ok);
      await load();
      if (result.failed.length) {
        setError(
          result.ok.length
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else {
        setNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
    } catch (bulkError) {
      setError((bulkError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
      setConfirmTrashIds(null);
    }
  };

  /** Reusa o PUT de Script e recarrega o DTO normalizado pelo domínio. */
  const saveQuickEdit = async (
    id: string,
    input: CustomCodeQuickEditInput,
  ): Promise<void> => {
    if (!beginMutation(`quick-edit:${id}`)) {
      throw new Error(dictionary.working);
    }
    try {
      await requestJson<{ snippet: SnippetDto }>(
        `/api/admin/custom-code/${id}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
      await load();
    } finally {
      finishMutation();
    }
  };

  /** Restaura um script da lixeira e mantém o usuário na listagem atual. */
  const restoreSnippet = async (id: string) => {
    if (!beginMutation(id)) return;
    setError(null);
    try {
      await requestJson(`/api/admin/custom-code/${id}/restore`, {
        method: "POST",
      });
      // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
      selection.remove([id]);
      await load();
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Exclui definitivamente apenas o script já confirmado na lixeira. */
  const permanentlyDeleteSnippet = async (id: string) => {
    if (!beginMutation(id)) return;
    setError(null);
    try {
      await requestJson(`/api/admin/custom-code/${id}/permanently-delete`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true }),
      });
      setConfirmPermanentId(null);
      // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
      selection.remove([id]);
      await load();
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Exclui a seleção da lixeira pelo mesmo contrato da exclusão individual. */
  const permanentlyDeleteSnippetsBulk = async (ids: string[]) => {
    if (!beginMutation("bulk:permanently-delete")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>(
        "/api/admin/custom-code/bulk",
        {
          method: "POST",
          body: JSON.stringify({
            action: "permanently-delete",
            ids,
            confirmed: true,
          }),
        },
      );
      selection.remove(result.ok);
      await load();
      if (result.failed.length) {
        setError(
          result.ok.length
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else {
        setNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
    } catch (bulkError) {
      setError((bulkError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
      setConfirmPermanentIds(null);
    }
  };

  /** Restaura a seleção da lixeira em lote e mantém falhas disponíveis para retry. */
  const restoreSnippetsBulk = async (ids: string[]) => {
    if (!beginMutation("bulk:restore")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>(
        "/api/admin/custom-code/bulk",
        {
          method: "POST",
          body: JSON.stringify({ action: "restore", ids }),
        },
      );
      selection.remove(result.ok);
      await load();
      if (result.failed.length) {
        setError(
          result.ok.length
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else {
        setNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
    } catch (bulkError) {
      setError((bulkError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  // Ícones de linha (mesmo chrome da lista de Pages).
  const iconBtn =
    "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40";

  return (
    // Shell Figma Scripts: ListHeader + tabela switch/edit/copy/…
    <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-4 md:gap-4 md:px-8 md:py-5 xl:px-10">
      <ListHeader
        className="border-border shrink-0 border-b pb-3"
        disabled={mutationBusy}
        searchAriaLabel={dictionary.searchSnippets}
        searchValue={search}
        subtitle={dictionary.description}
        title={dictionary.title}
        onSearchChange={setSearch}
      >
        <Button
          className="border-border rounded-full bg-transparent px-4 hover:bg-white/5"
          disabled={mutationBusy}
          type="button"
          variant="outline"
          onClick={() => void createSnippet()}
        >
          <Plus className="text-brand size-4" />
          {dictionary.newSnippet}
        </Button>
      </ListHeader>

      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {dictionary.retry}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <div
          className="border-border bg-primary/10 text-foreground shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <div className="bg-card/80 border-border flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border p-3 md:p-4">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-foreground truncate text-base font-medium tracking-tight md:text-lg">
            {trashMode ? dictionary.deletedScripts : dictionary.title}
          </h2>
          <button
            aria-pressed={trashMode}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              trashMode
                ? "bg-destructive/15 text-destructive font-medium"
                : "text-destructive/90 hover:bg-destructive/10",
            )}
            disabled={mutationBusy}
            type="button"
            onClick={() => {
              setTrashMode((on) => !on);
              selection.clear();
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            {dictionary.deletedScripts}
          </button>
        </div>
        {!canBulk ? (
          <p className="text-muted-foreground mb-3 text-xs" role="status">
            {bulkDictionary.noPermission}
          </p>
        ) : null}
        {canBulk ? (
          <BulkActionBar
            allSelected={selection.allSelected}
            busy={mutationBusy}
            clearLabel={bulkDictionary.clear}
            onClear={selection.clear}
            onToggleAll={() => selection.toggleAll(visibleIds)}
            selectedCount={selection.selectedIds.length}
            selectedLabel={bulkDictionary.selected}
            selectAllLabel={bulkDictionary.selectAll}
            selectionLimitLabel={bulkDictionary.selectionLimit}
            someSelected={selection.someSelected}
            visibleCount={visibleIds.length}
            actions={
              trashMode ? (
                <Button
                  disabled={mutationBusy}
                  onClick={() =>
                    void restoreSnippetsBulk([...selection.selectedIds])
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {dictionary.restore}
                </Button>
              ) : undefined
            }
            destructiveActions={
              trashMode ? (
                <Button
                  disabled={mutationBusy}
                  onClick={() =>
                    setConfirmPermanentIds([...selection.selectedIds])
                  }
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {dictionary.permanentlyDelete}
                </Button>
              ) : (
                <Button
                  disabled={mutationBusy}
                  onClick={() => setConfirmTrashIds([...selection.selectedIds])}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {bulkDictionary.moveToTrash}
                </Button>
              )
            }
          />
        ) : null}
        <ListViewport>
          {loading ? (
            <div
              className="text-muted-foreground py-12 text-center text-sm"
              role="status"
            >
              {dictionary.loading}
            </div>
          ) : items.length === 0 ? (
            <ListEmptyState>{dictionary.empty}</ListEmptyState>
          ) : trashMode ? (
            <div className="overflow-x-auto" role="table">
              <div
                className="text-muted-foreground mb-2 grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] gap-2 px-1 text-sm lg:min-w-[1000px] lg:grid-cols-[2.5rem_7.5rem_minmax(12rem,1fr)_9rem_9rem_8rem_11rem]"
                role="row"
              >
                <div role="columnheader" />
                <div role="columnheader" />
                <div aria-sort={nameSortAriaValue(sortDir)} role="columnheader">
                  <NameSortHeader
                    label={dictionary.scriptColumn}
                    sortDir={sortDir}
                    onToggle={() =>
                      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
                    }
                  />
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.author}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.deletedBy}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.deleted}
                </div>
                <div role="columnheader" />
              </div>
              <div
                className="divide-border divide-y lg:min-w-[1000px]"
                role="rowgroup"
              >
                {sortedItems.map((item) => (
                  <div
                    className={cn(
                      "grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-2 py-4 lg:grid-cols-[2.5rem_7.5rem_minmax(12rem,1fr)_9rem_9rem_8rem_11rem] lg:gap-3",
                      selection.selectedIds.includes(item.id) && "bg-primary/5",
                    )}
                    key={item.id}
                    role="row"
                  >
                    <div className="flex justify-center" role="cell">
                      {canBulk ? (
                        <input
                          aria-label={`${bulkDictionary.selectItem}: ${item.name}`}
                          checked={selection.selectedIds.includes(item.id)}
                          className="accent-primary size-4"
                          disabled={
                            mutationBusy ||
                            (selection.atLimit &&
                              !selection.selectedIds.includes(item.id))
                          }
                          onChange={() => selection.toggle(item.id)}
                          type="checkbox"
                        />
                      ) : null}
                    </div>
                    <div role="cell">
                      <Button
                        disabled={mutationBusy || busyId === item.id}
                        size="sm"
                        variant="outline"
                        onClick={() => void restoreSnippet(item.id)}
                      >
                        {dictionary.restore}
                      </Button>
                    </div>
                    <div className="min-w-0" role="cell">
                      <span className="block truncate font-medium">
                        {item.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {locationLabel(item.location, dictionary)}
                      </span>
                    </div>
                    <div
                      className="text-muted-foreground hidden truncate text-sm lg:block"
                      role="cell"
                    >
                      —
                    </div>
                    <div
                      className="text-muted-foreground hidden truncate text-sm lg:block"
                      role="cell"
                    >
                      {item.deletedBy?.name ?? "—"}
                    </div>
                    <div className="text-muted-foreground text-sm" role="cell">
                      {formatDate(item.deletedAt ?? "")}
                    </div>
                    <div className="flex justify-end" role="cell">
                      {canBulk ? (
                        <Button
                          disabled={mutationBusy || busyId === item.id}
                          size="sm"
                          variant="destructive"
                          onClick={() => setConfirmPermanentId(item.id)}
                        >
                          {dictionary.permanentlyDelete}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto" role="table">
              <div
                className="text-muted-foreground mb-1 grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] gap-2 px-1 text-sm lg:min-w-[1080px] lg:grid-cols-[2.5rem_minmax(20rem,22rem)_minmax(10rem,1.4fr)_8rem_5rem_9rem_7rem_5rem]"
                role="row"
              >
                <div role="columnheader" />
                <div role="columnheader" />
                <div aria-sort={nameSortAriaValue(sortDir)} role="columnheader">
                  <NameSortHeader
                    label={dictionary.scriptColumn}
                    sortDir={sortDir}
                    onToggle={() =>
                      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
                    }
                  />
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.location}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.priority}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.author}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.created}
                </div>
                <div role="columnheader" />
              </div>
              <div
                className="divide-border divide-y lg:min-w-[970px]"
                role="rowgroup"
              >
                {sortedItems.map((item) => {
                  const published = item.status === "PUBLISHED";
                  const busy = busyId === item.id;
                  const switchLabelKey = statusSwitchLabelKey({
                    live: published,
                    hasPublishedRevision: Boolean(item.publishedRevisionId),
                  });
                  const rowToggling =
                    busyId === `turn-on:${item.id}` ||
                    busyId === `unpublish:${item.id}`;
                  return (
                    <div
                      className={cn(
                        "grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-2 py-3.5 lg:grid-cols-[2.5rem_minmax(20rem,22rem)_minmax(10rem,1.4fr)_8rem_5rem_9rem_7rem_5rem] lg:gap-3",
                        selection.selectedIds.includes(item.id) &&
                          "bg-primary/5",
                      )}
                      key={item.id}
                      role="row"
                    >
                      <div
                        className="flex items-center justify-center"
                        role="cell"
                      >
                        {canBulk ? (
                          <input
                            aria-label={`${bulkDictionary.selectItem}: ${item.name}`}
                            checked={selection.selectedIds.includes(item.id)}
                            className="accent-primary size-4"
                            disabled={
                              mutationBusy ||
                              (selection.atLimit &&
                                !selection.selectedIds.includes(item.id))
                            }
                            type="checkbox"
                            onChange={() => selection.toggle(item.id)}
                          />
                        ) : null}
                      </div>
                      {/* Cluster esquerdo: status + duplicar → lápis → raio; lixeira só à direita. */}
                      <div
                        className="flex min-w-0 flex-nowrap items-center gap-1"
                        data-testid="script-row-actions"
                        role="cell"
                      >
                        {/*
                          Switch No ar / Fora do ar. Habilitado também para script nunca
                          publicado (ligar publica o rascunho). Ocupado só na própria
                          linha; as demais ficam inertes enquanto outra mutação roda.
                        */}
                        <StatusToggle
                          appearance="switch"
                          busy={rowToggling}
                          busyLabel={
                            busyId === `turn-on:${item.id}`
                              ? dictionary.publishing.buttonPublishing
                              : dictionary.working
                          }
                          disabled={mutationBusy && !rowToggling}
                          draftLabel={dictionary.publishing[switchLabelKey]}
                          draftShortLabel={dictionary.publishing.switchOffShort}
                          published={published}
                          publishedLabel={dictionary.publishing.switchLive}
                          publishLabel={dictionary.publishing.switchTurnOn}
                          unpublishLabel={dictionary.publishing.switchTurnOff}
                          onToggle={() => toggleLive(item)}
                        />
                        <button
                          aria-label={dictionary.duplicate}
                          className={iconBtn}
                          disabled={mutationBusy || busy}
                          type="button"
                          onClick={() => void duplicateSnippet(item.id)}
                        >
                          <Copy className="size-4" />
                        </button>
                        <Link
                          aria-label={`${dictionary.edit}: ${item.name}`}
                          className={iconBtn}
                          href={`/admin/custom-code/${item.id}`}
                        >
                          <Pencil aria-hidden className="size-[18px]" />
                        </Link>
                        <CustomCodeQuickEditPopover
                          disabled={mutationBusy}
                          dictionary={dictionary}
                          page={item}
                          onSave={(input) => saveQuickEdit(item.id, input)}
                        />
                      </div>
                      <div className="min-w-0" role="cell">
                        <span className="block min-w-0 truncate font-medium">
                          {item.name}
                        </span>
                      </div>
                      <div
                        className="text-muted-foreground hidden truncate text-sm lg:block"
                        role="cell"
                      >
                        {locationLabel(item.location, dictionary)}
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm tabular-nums lg:block"
                        role="cell"
                      >
                        {item.priority ?? "—"}
                      </div>
                      <div
                        className="text-muted-foreground hidden truncate text-sm lg:block"
                        role="cell"
                      >
                        —
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm lg:block"
                        role="cell"
                      >
                        {formatDate(item.createdAt)}
                      </div>
                      <div className="flex justify-end gap-1" role="cell">
                        <button
                          aria-label={dictionary.moveToTrash}
                          className={cn(
                            iconBtn,
                            "text-destructive hover:text-destructive",
                          )}
                          disabled={mutationBusy || busy}
                          type="button"
                          onClick={() => setConfirmTrashId(item.id)}
                        >
                          <Trash2 className="size-[18px]" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ListViewport>
      </div>

      <ConfirmDialog
        busy={mutationBusy}
        busyLabel={dictionary.working}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.publishing.unpublishConfirm}
        destructive
        description={dictionary.publishing.unpublishDescription}
        open={confirmUnpublishId != null}
        title={dictionary.publishing.unpublishTitle}
        onConfirm={() => {
          if (confirmUnpublishId) void unpublishSnippet(confirmUnpublishId);
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setConfirmUnpublishId(null);
        }}
      />
      <ConfirmDialog
        busy={mutationBusy}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.moveToTrash}
        destructive
        description={dictionary.confirmTrashDescription}
        open={confirmTrashId != null}
        title={dictionary.confirmTrashTitle}
        onConfirm={() => {
          if (confirmTrashId) void trashSnippet(confirmTrashId);
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setConfirmTrashId(null);
        }}
      />
      <ConfirmDialog
        busy={mutationBusy}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={bulkDictionary.moveToTrash}
        destructive
        description={
          confirmTrashIds
            ? formatBulkCopy(dictionary.confirmBulkTrashDescription, {
                count: confirmTrashIds.length,
              })
            : dictionary.confirmBulkTrashDescription
        }
        open={confirmTrashIds != null}
        title={dictionary.confirmBulkTrashTitle}
        onConfirm={() => {
          if (confirmTrashIds) void trashSnippetsBulk(confirmTrashIds);
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setConfirmTrashIds(null);
        }}
      />
      <ConfirmDialog
        busy={mutationBusy}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.permanentlyDelete}
        destructive
        description={dictionary.confirmPermanentDescription}
        open={confirmPermanentId != null}
        title={dictionary.confirmPermanentTitle}
        onConfirm={() => {
          if (confirmPermanentId)
            void permanentlyDeleteSnippet(confirmPermanentId);
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setConfirmPermanentId(null);
        }}
      />
      <ConfirmDialog
        busy={mutationBusy}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.permanentlyDelete}
        destructive
        description={dictionary.confirmBulkPermanentDescription}
        open={confirmPermanentIds != null}
        title={dictionary.confirmBulkPermanentTitle}
        onConfirm={() => {
          if (confirmPermanentIds)
            void permanentlyDeleteSnippetsBulk(confirmPermanentIds);
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setConfirmPermanentIds(null);
        }}
      />
    </section>
  );
}
