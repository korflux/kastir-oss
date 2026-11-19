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
import { campaignPublicPath } from "@/lib/Modules/SplitTests/constants";
import {
  SplitTestQuickEditPopover,
  type SplitTestQuickEditInput,
} from "@/lib/Modules/SplitTests/Components/SplitTestQuickEditPopover";
import type {
  CampaignDetail,
  CampaignListItem,
  SplitTestsCopy,
} from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import type { BulkResult } from "@/lib/Modules/Shared/Bulk";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";
import { compareByName, type NameSortDir } from "@/lib/utils/nameSort";

/** Formata datas vindas da API e evita exibir uma data inválida na listagem. */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Substitui contagens nas mensagens comuns sem expor detalhes do backend. */
function formatBulkCopy(
  template: string,
  values: Record<string, number>,
): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replace(`{${key}}`, String(value)),
    template,
  );
}

/** Chrome compartilhado pelas ações compactas de uma linha. */
const iconBtn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40";

/** Mantém busca, ordenação e lixeira da listagem de Split Tests no mesmo fluxo. */
export function SplitTestsList({
  bulkDictionary,
  canBulk,
  dictionary,
  publicOrigin,
}: {
  bulkDictionary: PanelDictionary["bulk"];
  canBulk: boolean;
  dictionary: SplitTestsCopy;
  publicOrigin: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<CampaignListItem[]>([]);
  const [search, setSearch] = useState("");
  // Sort de apresentação só na UI — destinos do editor não usam isso.
  const [sortDir, setSortDir] = useState<NameSortDir>("asc");
  const [trashMode, setTrashMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trashId, setTrashId] = useState<string | null>(null);
  const [bulkTrashIds, setBulkTrashIds] = useState<string[] | null>(null);
  const [permanentId, setPermanentId] = useState<string | null>(null);
  const [bulkPermanentIds, setBulkPermanentIds] = useState<string[] | null>(
    null,
  );
  const {
    busyAction: busyId,
    finish: finishMutation,
    isBusy: mutationBusy,
    start: beginMutation,
  } = useMutationLock();

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

  /** Recarrega campanhas ou lixeira com a busca atual. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (trashMode) params.set("trash", "1");
      const query = params.size ? `?${params.toString()}` : "";
      const result = await requestJson<{ items: CampaignListItem[] }>(
        `/api/admin/split-tests${query}`,
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

  /** Cria uma campanha pausada com destino inicial e abre o editor. */
  const createCampaign = async () => {
    if (!beginMutation("create")) return;
    setError(null);
    try {
      const stamp = Date.now();
      const result = await requestJson<{ campaign: CampaignDetail }>(
        "/api/admin/split-tests",
        {
          method: "POST",
          body: JSON.stringify({
            name: `${dictionary.newCampaign} ${stamp}`,
            // Draft (PAUSED): /s/slug fica 404 até publicar. Destino seed com name+url.
            destinations: [
              {
                url: "https://example.com",
                label: dictionary.defaultDestinationName,
              },
            ],
          }),
        },
      );
      router.push(`/admin/split-tests/${result.campaign.id}?created=1`);
    } catch (createError) {
      setError((createError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Alterna ACTIVE/PAUSED e atualiza a linha com o estado persistido. */
  const toggleStatus = async (item: CampaignListItem) => {
    if (!beginMutation(item.id)) return;
    setError(null);
    try {
      await requestJson(`/api/admin/split-tests/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: item.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
        }),
      });
      await load();
    } catch (toggleError) {
      setError((toggleError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Envia campanhas em ordem ao endpoint canônico e mantém falhas selecionadas. */
  const trashCampaignsBulk = async (ids: string[]) => {
    if (!beginMutation("bulk:trash")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>(
        "/api/admin/split-tests/bulk",
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
      setBulkTrashIds(null);
    }
  };

  /** Restaura a seleção da lixeira pelo endpoint bulk canônico. */
  const restoreCampaignsBulk = async (ids: string[]) => {
    if (!beginMutation("bulk:restore")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>(
        "/api/admin/split-tests/bulk",
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

  /** Exclui definitivamente uma seleção já confirmada na lixeira. */
  const permanentlyDeleteCampaignsBulk = async (ids: string[]) => {
    if (!beginMutation("bulk:permanently-delete")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>(
        "/api/admin/split-tests/bulk",
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
      setBulkPermanentIds(null);
    }
  };

  /** Reusa o PATCH de campanha para a edição rápida sem aceitar status/destinos. */
  const saveQuickEdit = async (
    id: string,
    input: SplitTestQuickEditInput,
  ): Promise<void> => {
    if (!beginMutation(`quick-edit:${id}`)) {
      throw new Error(dictionary.working);
    }
    try {
      await requestJson(`/api/admin/split-tests/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      await load();
    } finally {
      finishMutation();
    }
  };

  /** Copia a URL pública canônica construída com a origem fornecida pela página. */
  const copyPublicUrl = async (slug: string) => {
    const url = `${publicOrigin.replace(/\/$/, "")}${campaignPublicPath(slug)}`;
    await navigator.clipboard.writeText(url);
  };

  // Shell Figma SplitTests: ListHeader + tabela switch/edit/slug/…
  return (
    <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-4 md:gap-4 md:px-8 md:py-5 xl:px-10">
      <ListHeader
        className="border-border shrink-0 border-b pb-3"
        disabled={mutationBusy}
        searchAriaLabel={dictionary.search}
        searchPlaceholder={dictionary.searchBy}
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
          onClick={() => void createCampaign()}
        >
          <Plus className="text-brand size-4" />
          {busyId === "create" ? dictionary.working : dictionary.newCampaign}
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
            {trashMode ? dictionary.deletedCampaigns : dictionary.title}
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
            {dictionary.deletedCampaigns}
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
                    void restoreCampaignsBulk([...selection.selectedIds])
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
                    setBulkPermanentIds([...selection.selectedIds])
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
                  onClick={() => setBulkTrashIds([...selection.selectedIds])}
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
                    label={dictionary.testsColumn}
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
                        onClick={async () => {
                          if (!beginMutation(item.id)) return;
                          try {
                            await requestJson(
                              `/api/admin/split-tests/${item.id}/restore`,
                              { method: "POST" },
                            );
                            // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
                            selection.remove([item.id]);
                            await load();
                          } catch (restoreError) {
                            setError(
                              (restoreError as ApiError).message ||
                                dictionary.error,
                            );
                          } finally {
                            finishMutation();
                          }
                        }}
                      >
                        {dictionary.restore}
                      </Button>
                    </div>
                    <div className="min-w-0" role="cell">
                      <span className="block truncate font-medium">
                        {item.name}
                      </span>
                      <span className="text-muted-foreground block truncate font-mono text-xs">
                        {campaignPublicPath(item.slug)}
                      </span>
                    </div>
                    <div
                      className="text-muted-foreground hidden truncate text-sm lg:block"
                      role="cell"
                    >
                      {item.author?.name ?? "—"}
                    </div>
                    <div
                      className="text-muted-foreground hidden truncate text-sm lg:block"
                      role="cell"
                    >
                      {item.deletedBy?.name ?? "—"}
                    </div>
                    <div
                      className="text-muted-foreground hidden text-sm lg:block"
                      role="cell"
                    >
                      {formatDate(item.deletedAt ?? "")}
                    </div>
                    <div className="flex justify-end" role="cell">
                      {canBulk ? (
                        <Button
                          disabled={mutationBusy || busyId === item.id}
                          size="sm"
                          variant="destructive"
                          onClick={() => setPermanentId(item.id)}
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
                className="text-muted-foreground mb-1 grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] gap-2 px-1 text-sm lg:min-w-[1030px] lg:grid-cols-[2.5rem_minmax(11rem,13rem)_minmax(10rem,1.3fr)_minmax(10rem,1.1fr)_7rem_5rem_9rem_7rem_5rem]"
                role="row"
              >
                <div role="columnheader" />
                <div role="columnheader" />
                <div aria-sort={nameSortAriaValue(sortDir)} role="columnheader">
                  <NameSortHeader
                    label={dictionary.testsColumn}
                    sortDir={sortDir}
                    onToggle={() =>
                      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
                    }
                  />
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.slug}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.destinations}
                </div>
                <div className="hidden lg:block" role="columnheader">
                  {dictionary.hits}
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
                className="divide-border divide-y lg:min-w-[1030px]"
                role="rowgroup"
              >
                {sortedItems.map((item) => {
                  const published = item.status === "ACTIVE";
                  const busy = busyId === item.id;
                  const publicPath = campaignPublicPath(item.slug);
                  return (
                    <div
                      className={cn(
                        "grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-2 py-3.5 lg:grid-cols-[2.5rem_minmax(11rem,13rem)_minmax(10rem,1.3fr)_minmax(10rem,1.1fr)_7rem_5rem_9rem_7rem_5rem] lg:gap-3",
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
                      {/* Cluster esquerdo: status + lápis + raio; copiar URL no slug; lixeira só à direita. */}
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-1"
                        role="cell"
                      >
                        <StatusToggle
                          appearance="switch"
                          busy={mutationBusy || busy}
                          draftLabel={dictionary.draft}
                          published={published}
                          publishedLabel={dictionary.published}
                          publishLabel={dictionary.publish}
                          unpublishLabel={dictionary.unpublish}
                          onToggle={() => void toggleStatus(item)}
                        />
                        <Link
                          aria-label={`${dictionary.edit}: ${item.name}`}
                          className={iconBtn}
                          href={`/admin/split-tests/${item.id}`}
                        >
                          <Pencil aria-hidden className="size-[18px]" />
                        </Link>
                        <SplitTestQuickEditPopover
                          campaign={item}
                          dictionary={dictionary}
                          onSave={(input) => saveQuickEdit(item.id, input)}
                        />
                      </div>
                      <div className="min-w-0" role="cell">
                        <div className="min-w-0">
                          <span className="block min-w-0 truncate font-medium">
                            {item.name}
                          </span>
                          <span className="text-muted-foreground block truncate font-mono text-xs lg:hidden">
                            {publicPath}
                          </span>
                        </div>
                      </div>
                      <div
                        className="hidden min-w-0 items-center gap-1 lg:flex"
                        role="cell"
                      >
                        <button
                          aria-label={dictionary.copyUrl}
                          className={iconBtn}
                          type="button"
                          onClick={() => void copyPublicUrl(item.slug)}
                        >
                          <Copy className="size-4" />
                        </button>
                        <span className="text-muted-foreground truncate font-mono text-xs">
                          {publicPath}
                        </span>
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm lg:block"
                        role="cell"
                      >
                        {dictionary.destinationsCount.replace(
                          "{count}",
                          String(item.activeDestinationCount),
                        )}
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm tabular-nums lg:block"
                        role="cell"
                      >
                        {item.totalHits.toLocaleString()}
                      </div>
                      <div
                        className="text-muted-foreground hidden truncate text-sm lg:block"
                        role="cell"
                      >
                        {item.author?.name ?? "—"}
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
                          onClick={() => setTrashId(item.id)}
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
        open={trashId !== null}
        title={dictionary.confirmTrashTitle}
        description={dictionary.confirmTrashDescription}
        confirmLabel={dictionary.moveToTrash}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        destructive
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setTrashId(null);
        }}
        onConfirm={async () => {
          if (!trashId) return;
          if (!beginMutation(trashId)) return;
          try {
            await requestJson(`/api/admin/split-tests/${trashId}`, {
              method: "DELETE",
            });
            setTrashId(null);
            // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
            selection.remove([trashId]);
            await load();
          } catch (deleteError) {
            setError((deleteError as ApiError).message || dictionary.error);
          } finally {
            finishMutation();
          }
        }}
      />
      <ConfirmDialog
        open={bulkTrashIds !== null}
        title={dictionary.confirmBulkTrashTitle}
        description={
          bulkTrashIds
            ? formatBulkCopy(dictionary.confirmBulkTrashDescription, {
                count: bulkTrashIds.length,
              })
            : dictionary.confirmBulkTrashDescription
        }
        confirmLabel={bulkDictionary.moveToTrash}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        destructive
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setBulkTrashIds(null);
        }}
        onConfirm={() => {
          if (bulkTrashIds) void trashCampaignsBulk(bulkTrashIds);
        }}
      />
      <ConfirmDialog
        open={permanentId !== null}
        title={dictionary.confirmPermanentTitle}
        description={dictionary.confirmPermanentDescription}
        confirmLabel={dictionary.permanentlyDelete}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        destructive
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setPermanentId(null);
        }}
        onConfirm={async () => {
          if (!permanentId) return;
          if (!beginMutation(permanentId)) return;
          try {
            await requestJson(
              `/api/admin/split-tests/${permanentId}/permanently-delete`,
              {
                method: "POST",
                body: JSON.stringify({ confirmed: true }),
              },
            );
            setPermanentId(null);
            // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
            selection.remove([permanentId]);
            await load();
          } catch (deleteError) {
            setError((deleteError as ApiError).message || dictionary.error);
          } finally {
            finishMutation();
          }
        }}
      />
      <ConfirmDialog
        open={bulkPermanentIds !== null}
        title={dictionary.confirmBulkPermanentTitle}
        description={dictionary.confirmBulkPermanentDescription}
        confirmLabel={dictionary.permanentlyDelete}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        destructive
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setBulkPermanentIds(null);
        }}
        onConfirm={() => {
          if (bulkPermanentIds)
            void permanentlyDeleteCampaignsBulk(bulkPermanentIds);
        }}
      />
    </section>
  );
}
