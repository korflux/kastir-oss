"use client";

import { useEffect, useRef } from "react";
import { Folder as FolderIcon, LayoutGrid, List, Trash2 } from "lucide-react";

import { BulkActionBar } from "@/components/Shared/BulkActionBar";
import {
  ListEmptyState,
  ListViewport,
} from "@/components/Shared/ResponsiveList";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { Button } from "@/components/ui/button";
import { MediaGrid } from "@/lib/Modules/Media/Components/MediaGrid";
import { MediaList } from "@/lib/Modules/Media/Components/MediaList";
import type {
  MediaCopy,
  MediaDto,
  FolderDto,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import {
  formatMediaBytes,
  mediaFolderPath,
  mediaStatusLabel,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { cn } from "@/lib/utils";

/** Alterna grid/lista sem acoplar o cabeçalho ao carregamento da biblioteca. */
export function MediaViewControls({
  dictionary,
  viewMode,
  onViewModeChange,
}: {
  dictionary: MediaCopy;
  viewMode: "grid" | "list";
  onViewModeChange: (viewMode: "grid" | "list") => void;
}) {
  return (
    <div className="border-border flex items-center gap-0.5 rounded-lg border p-0.5">
      <Button
        aria-label={dictionary.viewGrid}
        aria-pressed={viewMode === "grid"}
        className={cn(
          "size-8",
          viewMode === "grid" && "bg-muted text-foreground",
        )}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() => onViewModeChange("grid")}
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        aria-label={dictionary.viewList}
        aria-pressed={viewMode === "list"}
        className={cn(
          "size-8",
          viewMode === "list" && "bg-muted text-foreground",
        )}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() => onViewModeChange("list")}
      >
        <List className="size-4" />
      </Button>
    </div>
  );
}

/** Renderiza a biblioteca e encerra corretamente polling e observer ao desmontar. */
export function MediaLibrary({
  bulkDictionary,
  busyAction,
  canBulk,
  dictionary,
  bulkFolderId,
  folders,
  hasMoreMedia,
  loading,
  loadingMore,
  media,
  selectedFolderPath,
  selectedIds,
  selectionAtLimit,
  allSelected,
  someSelected,
  viewMode,
  onConvert: convertToWebp,
  onConvertSelected: convertSelected,
  onDeleteSelected: requestDeleteMedia,
  onBulkFolderChange,
  onClearSelection,
  onToggleAllSelection,
  onMoveSelected,
  onLoadMore,
  onOpenDetails: openMediaDetails,
  onRefresh,
  onToggleSelected: toggleSelected,
}: {
  bulkDictionary: PanelDictionary["bulk"];
  busyAction: string | null;
  canBulk: boolean;
  dictionary: MediaCopy;
  bulkFolderId: string;
  folders: FolderDto[];
  allSelected: boolean;
  hasMoreMedia: boolean;
  loading: boolean;
  loadingMore: boolean;
  media: MediaDto[];
  selectedFolderPath: string;
  selectedIds: string[];
  selectionAtLimit: boolean;
  someSelected: boolean;
  viewMode: "grid" | "list";
  onConvert: (mediaId: string) => void;
  onConvertSelected: () => void;
  onDeleteSelected: (ids: string[]) => void;
  onBulkFolderChange: (folderId: string) => void;
  onClearSelection: () => void;
  onToggleAllSelection: () => void;
  onMoveSelected: () => void;
  onLoadMore: () => void;
  onOpenDetails: (media: MediaDto) => void;
  onRefresh: () => void;
  onToggleSelected: (mediaId: string) => void;
}) {
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      busyAction ||
      !media.some((item) => item.processingStatus === "PROCESSING")
    )
      return;
    const timer = window.setInterval(onRefresh, 2000);
    return () => window.clearInterval(timer);
  }, [busyAction, media, onRefresh]);

  useEffect(() => {
    const root = gridScrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || !hasMoreMedia) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loading || loadingMore || busyAction)
          return;
        onLoadMore();
      },
      { root, rootMargin: "120px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [busyAction, hasMoreMedia, loading, loadingMore, onLoadMore]);

  return (
    <div className="bg-card/80 border-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border p-3 md:p-4">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FolderIcon
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
          <h2 className="text-foreground truncate text-base font-medium tracking-tight md:text-lg">
            {selectedFolderPath}
          </h2>
        </div>
      </div>

      {!canBulk ? (
        <p className="text-muted-foreground mb-3 text-xs" role="status">
          {bulkDictionary.noPermission}
        </p>
      ) : null}

      {canBulk ? (
        <BulkActionBar
          allSelected={allSelected}
          busy={Boolean(busyAction)}
          clearLabel={bulkDictionary.clear}
          onClear={onClearSelection}
          onToggleAll={onToggleAllSelection}
          selectedCount={selectedIds.length}
          selectedLabel={bulkDictionary.selected}
          selectAllLabel={bulkDictionary.selectAll}
          selectionLimitLabel={bulkDictionary.selectionLimit}
          someSelected={someSelected}
          visibleCount={media.length}
          actions={
            <>
              <label className="sr-only" htmlFor="media-bulk-folder">
                {bulkDictionary.moveFolder}
              </label>
              <div className="relative">
                <select
                  className="border-input bg-background text-foreground h-8 max-w-44 appearance-none rounded-lg border py-1 pr-7 pl-2 text-xs"
                  disabled={Boolean(busyAction)}
                  id="media-bulk-folder"
                  value={bulkFolderId}
                  onChange={(event) => onBulkFolderChange(event.target.value)}
                >
                  <option value="">{bulkDictionary.moveFolder}</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {mediaFolderPath(folder.id, folders)}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
              <Button
                disabled={!bulkFolderId || Boolean(busyAction)}
                onClick={onMoveSelected}
                size="sm"
                type="button"
                variant="outline"
              >
                {bulkDictionary.moveFolder}
              </Button>
              <Button
                disabled={Boolean(busyAction)}
                onClick={() => void convertSelected()}
                size="sm"
                type="button"
                variant="outline"
              >
                {busyAction === "convert-bulk"
                  ? dictionary.converting
                  : bulkDictionary.convertWebp}
              </Button>
            </>
          }
          destructiveActions={
            <Button
              disabled={Boolean(busyAction)}
              onClick={() => requestDeleteMedia(selectedIds)}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Trash2 className="size-3.5" />
              {bulkDictionary.delete}
            </Button>
          }
        />
      ) : null}

      <ListViewport ref={gridScrollRef}>
        {loading && !media.length ? (
          <div
            className="text-muted-foreground py-12 text-center text-sm"
            role="status"
          >
            {dictionary.loading}
          </div>
        ) : media.length ? (
          <>
            {viewMode === "grid" ? (
              <MediaGrid
                convertLabel={dictionary.convertToWebp}
                convertingId={
                  busyAction?.startsWith("convert:")
                    ? busyAction.slice("convert:".length)
                    : null
                }
                convertingLabel={dictionary.converting}
                formatSize={formatMediaBytes}
                items={media}
                selectedIds={selectedIds}
                selectionAtLimit={selectionAtLimit}
                selectionDisabled={Boolean(busyAction)}
                selectedLabel={(item) => item.name + " " + dictionary.selected}
                statusLabel={(status) => mediaStatusLabel(status, dictionary)}
                onConvert={(item) => void convertToWebp(item.id)}
                onOpenDetails={(item) => {
                  const fullItem = media.find(
                    (candidate) => candidate.id === item.id,
                  );
                  if (fullItem) openMediaDetails(fullItem);
                }}
                onToggle={canBulk ? toggleSelected : undefined}
              />
            ) : (
              <MediaList
                convertLabel={dictionary.convertToWebp}
                convertingId={
                  busyAction?.startsWith("convert:")
                    ? busyAction.slice("convert:".length)
                    : null
                }
                convertingLabel={dictionary.converting}
                dateLabel={dictionary.date}
                formatSize={formatMediaBytes}
                items={media}
                nameLabel={dictionary.name}
                selectedIds={selectedIds}
                selectionAtLimit={selectionAtLimit}
                selectionDisabled={Boolean(busyAction)}
                selectedLabel={(item) => item.name + " " + dictionary.selected}
                sizeLabel={dictionary.size}
                statusLabel={(status) => mediaStatusLabel(status, dictionary)}
                onConvert={(item) => void convertToWebp(item.id)}
                onOpenDetails={(item) => {
                  const fullItem = media.find(
                    (candidate) => candidate.id === item.id,
                  );
                  if (fullItem) openMediaDetails(fullItem);
                }}
                onToggle={canBulk ? toggleSelected : undefined}
              />
            )}
            {/* Sentinel — carrega mais 8 ao rolar. */}
            <div
              aria-hidden
              className="flex h-8 items-center justify-center"
              ref={loadMoreSentinelRef}
            >
              {loadingMore ? (
                <span className="text-muted-foreground text-xs">
                  {dictionary.loading}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <ListEmptyState>{dictionary.empty}</ListEmptyState>
        )}
      </ListViewport>
    </div>
  );
}
