"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { useMutationLock } from "@/components/Shared/mutationLock";
import { useDismissibleNotice } from "@/components/Shared/useDismissibleNotice";
import { useRowSelection } from "@/components/Shared/useRowSelection";
import { Button } from "@/components/ui/button";
import { MediaDetailsPanel } from "@/lib/Modules/Media/Components/MediaDetailsPanel";
import { MediaFolderPanel } from "@/lib/Modules/Media/Components/MediaFolderPanel";
import { isWebpConvertible } from "@/lib/Modules/Media/Components/MediaGrid";
import {
  MediaLibrary,
  MediaViewControls,
} from "@/lib/Modules/Media/Components/MediaLibrary";
import { MediaUploadDropzone } from "@/lib/Modules/Media/Components/MediaUploadDropzone";
import type {
  FolderCopy,
  FolderDto,
  MediaCopy,
  MediaDto,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import { mediaFolderPath } from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import { requestJson, type ApiError } from "@/lib/requestJson";
import type { BulkResult } from "@/lib/Modules/Shared/Bulk";
import type { PanelDictionary } from "@/lib/i18n/panel";

const MEDIA_PAGE_SIZE = 8;
type PendingConfirmation = { kind: "delete-media"; ids: string[] };

/** Calcula as páginas que a UI já mostrou e precisa revalidar após uma mutação. */
export function getMediaRefreshPages(loadedCount: number): number[] {
  const boundedCount = Math.max(MEDIA_PAGE_SIZE, loadedCount);
  return Array.from(
    { length: Math.ceil(boundedCount / MEDIA_PAGE_SIZE) },
    (_, index) => index + 1,
  );
}

/** Mantém todos os itens das páginas e remove apenas duplicatas de borda. */
export function mergeMediaPages<T extends { id: string }>(
  pages: readonly T[][],
): T[] {
  const seen = new Set<string>();
  return pages.flat().filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Substitui contagens nas mensagens da barra sem duplicar texto por idioma. */
function formatBulkCopy(
  template: string,
  values: Record<string, number>,
): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replace(`{${key}}`, String(value)),
    template,
  );
}

/** Orquestra filtros, seleção e ações entre os componentes focados de Mídia. */
export function MediaWorkspace({
  bulkDictionary,
  canBulk,
  dictionary,
  folderDictionary,
}: {
  bulkDictionary: PanelDictionary["bulk"];
  canBulk: boolean;
  dictionary: MediaCopy;
  folderDictionary: FolderCopy;
}) {
  const [media, setMedia] = useState<MediaDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [mediaPage, setMediaPage] = useState(1);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const {
    busyAction,
    finish: finishMutation,
    isBusy: mutationBusy,
    start: beginMutation,
  } = useMutationLock();
  const [error, setError] = useState<string | null>(null);
  // Sucesso some sozinho; erro (abaixo) fica fixo.
  const {
    notice,
    show: showNotice,
    clear: clearNotice,
  } = useDismissibleNotice();
  // Grid padrão; lista é só apresentação (sem persistir).
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null,
  );
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const mediaLenRef = useRef(0);

  const activeMedia = media.find((item) => item.id === activeMediaId) ?? null;
  const baseFolder = folders.find((folder) => folder.isBase) ?? null;
  const uploadFolderId = selectedFolderId ?? baseFolder?.id ?? "";
  const hasMoreMedia = media.length < mediaTotal;
  const visibleIds = useMemo(() => media.map((item) => item.id), [media]);
  const selection = useRowSelection({
    resetKey: `${selectedFolderId ?? "all"}:${query}`,
    visibleIds,
  });
  const selectedIds = selection.selectedIds;

  const selectedFolderPath = useMemo(() => {
    if (!selectedFolderId) return dictionary.allMedia;
    return mediaFolderPath(selectedFolderId, folders);
  }, [dictionary.allMedia, folders, selectedFolderId]);

  useEffect(() => {
    mediaLenRef.current = media.length;
  }, [media]);

  /** Carrega mídia e folders numa única requisição, com modos de append e refresh. */
  const loadWorkspace = useCallback(
    async (options?: {
      append?: boolean;
      page?: number;
      /** Re-fetch páginas já visíveis (poll de PROCESSING / pós-upload). */
      refreshVisible?: boolean;
    }): Promise<{
      media: MediaDto[];
      folders: FolderDto[];
      total: number;
    } | null> => {
      const append = options?.append === true;
      const refreshVisible = options?.refreshVisible === true;
      const pageToLoad = append
        ? (options?.page ?? mediaPage + 1)
        : refreshVisible
          ? 1
          : (options?.page ?? 1);
      const pagesToLoad = refreshVisible
        ? getMediaRefreshPages(mediaLenRef.current)
        : [pageToLoad];

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const loadPage = async (page: number) => {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("pageSize", String(MEDIA_PAGE_SIZE));
          if (selectedFolderId) params.set("folderId", selectedFolderId);
          if (query.trim()) params.set("q", query.trim());
          return requestJson<{
            media: MediaDto[];
            folders: FolderDto[];
            total: number;
            page: number;
            pageSize: number;
          }>(`/api/admin/media?${params.toString()}`);
        };
        const payloads = await Promise.all(pagesToLoad.map(loadPage));
        const firstPayload = payloads[0]!;
        const refreshedMedia = refreshVisible
          ? mergeMediaPages(payloads.map((page) => page.media))
          : firstPayload.media;

        // O primeiro payload é a fonte única de folders e total da tela.
        setFolders(firstPayload.folders);
        setMediaTotal(firstPayload.total);
        if (append) {
          setMedia((current) => {
            const seen = new Set(current.map((item) => item.id));
            return [
              ...current,
              ...firstPayload.media.filter((item) => !seen.has(item.id)),
            ];
          });
          setMediaPage(firstPayload.page);
        } else {
          setMedia(refreshedMedia);
          setMediaPage(refreshVisible ? pagesToLoad.length : firstPayload.page);
          setActiveMediaId((current) =>
            current && refreshedMedia.some((item) => item.id === current)
              ? current
              : null,
          );
        }
        return {
          media: refreshedMedia,
          folders: firstPayload.folders,
          total: firstPayload.total,
        };
      } catch (loadError) {
        setError((loadError as ApiError).message || dictionary.error);
        return null;
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [dictionary.error, mediaPage, query, selectedFolderId],
  );

  // Busca/pasta: reseta para página 1.
  useEffect(() => {
    const timer = window.setTimeout(
      () => void loadWorkspace({ page: 1 }),
      query ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
    // loadWorkspace muda com query/folder — intencional.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage a filtros
  }, [query, selectedFolderId]);

  /** Troca o filtro de pasta e limpa seleções que pertenciam ao recorte anterior. */
  const selectFolder = (folderId: string | null) => {
    setSelectedFolderId(folderId);
    selection.clear();
    setBulkFolderId("");
    setActiveMediaId(null);
    setMediaPage(1);
  };

  /** Seleciona a mídia; o painel de detalhes hidrata o próprio formulário. */
  const openMediaDetails = (item: MediaDto) => setActiveMediaId(item.id);

  /** Alterna um ID na seleção múltipla sem duplicatas. */
  const toggleSelected = (mediaId: string) => {
    selection.toggle(mediaId);
  };

  /** Convert por id — usado no Details e no botão hover do grid. */
  const convertToWebp = async (mediaId?: string) => {
    const targetId = mediaId ?? activeMedia?.id;
    if (!targetId) return;
    const target = media.find((item) => item.id === targetId);
    if (!target || !isWebpConvertible(target)) return;
    if (!beginMutation(`convert:${targetId}`)) return;
    setError(null);
    try {
      await requestJson(`/api/admin/media/${targetId}/convert`, {
        method: "POST",
      });
      showNotice(dictionary.processing);
      await loadWorkspace({ refreshVisible: true });
    } catch (convertError) {
      setError((convertError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Converte os IDs carregados pelo endpoint canônico, preservando falhas. */
  const convertSelected = async () => {
    if (!selectedIds.length || !beginMutation("convert-bulk")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>("/api/admin/media/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "convert-webp", ids: selectedIds }),
      });
      selection.remove(result.ok);
      await loadWorkspace({ refreshVisible: true });
      if (result.failed.length) {
        setError(
          result.ok.length
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else if (result.ok.length) {
        showNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
    } catch (convertError) {
      setError((convertError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Move os IDs visíveis para a pasta validada pelo serviço de mídia. */
  const moveSelected = async () => {
    if (!bulkFolderId || !selectedIds.length) return;
    if (!beginMutation("move-bulk")) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>("/api/admin/media/bulk", {
        method: "POST",
        body: JSON.stringify({
          action: "move-folder",
          ids: selectedIds,
          folderId: bulkFolderId,
        }),
      });
      selection.remove(result.ok);
      await loadWorkspace({ refreshVisible: true });
      if (result.failed.length) {
        setError(
          result.ok.length
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else if (result.ok.length) {
        showNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
      setBulkFolderId("");
    } catch (moveError) {
      setError((moveError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Abre confirmação somente quando existe ao menos uma mídia para excluir. */
  const requestDeleteMedia = (ids: string[]) => {
    if (!ids.length || mutationBusy) return;
    setConfirmation({ kind: "delete-media", ids });
  };

  /** Executa o delete confirmado e recarrega exatamente o conjunto carregado. */
  const performDeleteMedia = async (ids: string[]) => {
    if (!beginMutation("delete")) return false;
    setError(null);
    try {
      const result = await requestJson<BulkResult>("/api/admin/media/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "delete", ids }),
      });
      selection.remove(result.ok);
      setActiveMediaId(null);
      await loadWorkspace({ refreshVisible: true });
      if (result.failed.length) {
        setError(
          result.ok.length
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else if (result.ok.length) {
        showNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
    } catch (deleteError) {
      setError((deleteError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
    return true;
  };

  /** Executa a exclusão em lote somente após a confirmação explícita. */
  const runConfirmation = async () => {
    if (!confirmation) return;
    setConfirmationBusy(true);
    try {
      if (await performDeleteMedia(confirmation.ids)) setConfirmation(null);
    } finally {
      setConfirmationBusy(false);
    }
  };

  const bulkDeleteNeedsPhrase = Boolean(
    confirmation && confirmation.ids.length > 1,
  );

  /** Atualiza todas as páginas visíveis sem criar uma segunda cadeia de polling. */
  const refreshVisible = useCallback(async () => {
    await loadWorkspace({ refreshVisible: true });
  }, [loadWorkspace]);

  /** Atualiza uma mídia sem invalidar seleção, paginação ou as demais áreas. */
  const updateMedia = useCallback((updated: MediaDto) => {
    setMedia((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  /** Carrega exatamente a próxima página quando o sentinel da biblioteca aparece. */
  const loadMore = useCallback(() => {
    if (mutationBusy || loading || loadingMore || !hasMoreMedia) return;
    void loadWorkspace({ append: true, page: mediaPage + 1 });
  }, [
    hasMoreMedia,
    loadWorkspace,
    loading,
    loadingMore,
    mediaPage,
    mutationBusy,
  ]);

  return (
    <MediaUploadDropzone
      dictionary={dictionary}
      folderId={uploadFolderId}
      query={query}
      mutationBusy={mutationBusy}
      uploadBusy={busyAction === "upload"}
      viewControls={
        <MediaViewControls
          dictionary={dictionary}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      }
      onBeginMutation={beginMutation}
      onFinishMutation={finishMutation}
      onClearNotice={clearNotice}
      onError={setError}
      onNotice={showNotice}
      onQueryChange={setQuery}
      onRefresh={() => loadWorkspace({ page: 1 }).then(() => undefined)}
      onResolveFolderId={async () => {
        const fresh = await loadWorkspace({ page: 1 });
        return (
          selectedFolderId ??
          fresh?.folders.find((folder) => folder.isBase)?.id ??
          ""
        );
      }}
    >
      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadWorkspace()}
          >
            {dictionary.retry}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <div
          className="border-primary/30 bg-primary/10 text-primary shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-rows-1 gap-3 overflow-hidden xl:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)_minmax(15rem,17rem)]">
        <MediaFolderPanel
          busyAction={busyAction}
          dictionary={dictionary}
          folderDictionary={folderDictionary}
          folders={folders}
          selectedFolderId={selectedFolderId}
          mediaFolderIds={media.map((item) => item.folderId)}
          onBeginMutation={beginMutation}
          onFinishMutation={finishMutation}
          onError={setError}
          onRefresh={() => loadWorkspace({ page: 1 }).then(() => undefined)}
          onSelect={selectFolder}
        />
        <MediaLibrary
          allSelected={selection.allSelected}
          bulkDictionary={bulkDictionary}
          busyAction={busyAction}
          canBulk={canBulk}
          dictionary={dictionary}
          bulkFolderId={bulkFolderId}
          folders={folders}
          hasMoreMedia={hasMoreMedia}
          loading={loading}
          loadingMore={loadingMore}
          media={media}
          selectedFolderPath={selectedFolderPath}
          selectedIds={selectedIds}
          selectionAtLimit={selection.atLimit}
          someSelected={selection.someSelected}
          viewMode={viewMode}
          onConvert={(mediaId) => void convertToWebp(mediaId)}
          onConvertSelected={() => void convertSelected()}
          onDeleteSelected={requestDeleteMedia}
          onBulkFolderChange={setBulkFolderId}
          onClearSelection={selection.clear}
          onMoveSelected={() => void moveSelected()}
          onLoadMore={loadMore}
          onOpenDetails={openMediaDetails}
          onRefresh={refreshVisible}
          onToggleAllSelection={() => selection.toggleAll(visibleIds)}
          onToggleSelected={toggleSelected}
        />
        <MediaDetailsPanel
          key={activeMedia?.id ?? "empty"}
          activeMedia={activeMedia}
          busyAction={busyAction}
          dictionary={dictionary}
          folders={folders}
          onBeginMutation={beginMutation}
          onFinishMutation={finishMutation}
          onConvert={() => void convertToWebp()}
          onDelete={requestDeleteMedia}
          onError={setError}
          onMediaChange={updateMedia}
          onNotice={showNotice}
          onRefresh={refreshVisible}
        />
      </div>

      <ConfirmDialog
        busy={confirmationBusy}
        busyLabel={dictionary.working}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.delete}
        destructive
        description={dictionary.confirmDeleteDescription}
        expectedText={
          bulkDeleteNeedsPhrase ? dictionary.confirmBulkDeletePhrase : undefined
        }
        expectedTextLabel={
          bulkDeleteNeedsPhrase
            ? dictionary.confirmBulkDeletePhraseLabel
            : undefined
        }
        open={Boolean(confirmation)}
        title={dictionary.confirmDeleteTitle}
        onConfirm={() => void runConfirmation()}
        onOpenChange={(open) => {
          if (!open && !confirmationBusy) setConfirmation(null);
        }}
      />
    </MediaUploadDropzone>
  );
}
