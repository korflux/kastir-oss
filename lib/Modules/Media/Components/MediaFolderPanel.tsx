"use client";

import { useRef, useState } from "react";
import { Folder as FolderIcon, Plus } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import {
  collectFolderSubtreeIds,
  FolderTree,
  type FolderTreeHandle,
} from "@/components/Shared/FolderTree";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { useFolderCrud } from "@/components/Shared/useFolderCrud";
import { Button } from "@/components/ui/button";
import type {
  FolderCopy,
  FolderDto,
  MediaCopy,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import { mediaFolderPath } from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import { cn } from "@/lib/utils";

/** Exibe e opera a árvore de pastas reutilizando o CRUD e os diálogos compartilhados. */
export function MediaFolderPanel({
  busyAction,
  dictionary,
  folderDictionary,
  folders,
  mediaFolderIds,
  selectedFolderId,
  onBeginMutation,
  onFinishMutation,
  onError,
  onRefresh,
  onSelect: selectFolder,
}: {
  busyAction: string | null;
  dictionary: MediaCopy;
  folderDictionary: FolderCopy;
  folders: FolderDto[];
  mediaFolderIds: string[];
  selectedFolderId: string | null;
  onBeginMutation: (action: string) => boolean;
  onFinishMutation: () => void;
  onError: (message: string | null) => void;
  onRefresh: () => Promise<void>;
  onSelect: (folderId: string | null) => void;
}) {
  const folderTreeRef = useRef<FolderTreeHandle>(null);
  const [deleteDraft, setDeleteDraft] = useState<{
    id: string;
    reassignToFolderId: string;
    needsReassignment: boolean;
  } | null>(null);

  const { createFolder, updateFolder, moveFolder, deleteFolder } =
    useFolderCrud({
      basePath: "/api/admin/media/folders",
      beginMutation: onBeginMutation,
      finishMutation: onFinishMutation,
      onSuccess: onRefresh,
      setError: onError,
      errorFallback: dictionary.error,
    });

  /** Prepara o destino de realocação e nunca permite apagar a pasta Base. */
  const requestDeleteFolder = (folder: FolderDto) => {
    if (folder.isBase) return;
    const subtree = collectFolderSubtreeIds(folder.id, folders);
    const hasContent = mediaFolderIds.some((folderId) => subtree.has(folderId));
    const baseId = folders.find((item) => item.isBase)?.id ?? "";
    const defaultTarget =
      folders.find((item) => item.id !== folder.id && !subtree.has(item.id))
        ?.id ?? baseId;
    if (!defaultTarget) return;
    setDeleteDraft({
      id: folder.id,
      reassignToFolderId: hasContent ? defaultTarget : baseId,
      needsReassignment: hasContent,
    });
  };

  /** Confirma o soft delete e limpa a seleção se a pasta ativa foi removida. */
  const confirmDeleteFolder = async () => {
    if (!deleteDraft?.reassignToFolderId) return;
    try {
      await deleteFolder(deleteDraft.id, deleteDraft.reassignToFolderId);
      selectFolder(null);
    } finally {
      setDeleteDraft(null);
    }
  };

  return (
    <>
      <aside className="bg-card/80 border-border flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border p-3">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="text-foreground flex items-center gap-2">
            <FolderIcon aria-hidden className="size-4 opacity-80" />
            <span className="text-sm font-medium">{dictionary.folders}</span>
          </div>
          <Button
            aria-label={folderDictionary.create}
            className="size-8"
            disabled={Boolean(busyAction)}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={() => folderTreeRef.current?.openCreate()}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <button
          className={cn(
            "mb-2 w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
            !selectedFolderId
              ? "text-foreground bg-white/10 font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5",
          )}
          disabled={Boolean(busyAction)}
          type="button"
          onClick={() => selectFolder(null)}
        >
          {dictionary.allMedia}
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <FolderTree
            ref={folderTreeRef}
            busy={Boolean(busyAction)}
            createMode="sub-or-root"
            folders={folders}
            hideChrome
            labels={folderDictionary}
            selectedFolderId={selectedFolderId}
            onCreate={createFolder}
            onDelete={requestDeleteFolder}
            onMove={moveFolder}
            onSelect={selectFolder}
            onUpdate={updateFolder}
          />
        </div>
      </aside>

      <ConfirmDialog
        busy={Boolean(busyAction)}
        busyLabel={dictionary.working}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={folderDictionary.delete}
        destructive
        description={
          deleteDraft?.needsReassignment
            ? folderDictionary.reassignHint
            : dictionary.confirmFolderDeleteDescription
        }
        open={Boolean(deleteDraft)}
        title={dictionary.confirmFolderDeleteTitle}
        onConfirm={() => void confirmDeleteFolder()}
        onOpenChange={(open) => {
          if (!open && !busyAction) setDeleteDraft(null);
        }}
      >
        {deleteDraft?.needsReassignment ? (
          <label className="block space-y-1 text-sm">
            <span>{folderDictionary.reassignTo}</span>
            <div className="relative">
              <select
                className="border-input bg-background w-full appearance-none rounded-lg border py-2 pr-8 pl-3 text-sm"
                value={deleteDraft.reassignToFolderId}
                onChange={(event) =>
                  setDeleteDraft((current) =>
                    current
                      ? { ...current, reassignToFolderId: event.target.value }
                      : current,
                  )
                }
              >
                {folders
                  .filter(
                    (folder) =>
                      !collectFolderSubtreeIds(deleteDraft.id, folders).has(
                        folder.id,
                      ),
                  )
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {mediaFolderPath(folder.id, folders)}
                    </option>
                  ))}
              </select>
              <SelectChevron />
            </div>
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
