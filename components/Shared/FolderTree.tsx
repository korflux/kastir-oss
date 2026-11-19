"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { MoreHorizontal, Plus } from "lucide-react";

import {
  FolderEditorDialog,
  type EditableFolder,
  type FolderEditorValue,
} from "@/components/Shared/FolderEditorDialog";
import { DEFAULT_FOLDER_COLOR } from "@/components/Shared/ColorPicker";
import { Button } from "@/components/ui/button";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { cn } from "@/lib/utils";

function collectSubtreeIds(
  rootId: string,
  folders: ReadonlyArray<Pick<EditableFolder, "id" | "parentId">>,
): Set<string> {
  const subtree = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (
        folder.parentId &&
        subtree.has(folder.parentId) &&
        !subtree.has(folder.id)
      ) {
        subtree.add(folder.id);
        changed = true;
      }
    }
  }
  return subtree;
}

export type FolderTreeHandle = {
  openCreate: () => void;
};

export const FolderTree = forwardRef<
  FolderTreeHandle,
  {
    folders: EditableFolder[];
    selectedFolderId: string | null;
    labels: PanelDictionary["folders"];
    onSelect: (id: string) => void;
    onCreate: (value: FolderEditorValue) => Promise<void>;
    onUpdate: (
      folder: EditableFolder,
      value: FolderEditorValue,
    ) => Promise<void>;
    onDelete: (folder: EditableFolder) => void;
    onMove?: (folderId: string, newParentId: string | null) => Promise<void>;
    busy?: boolean;
    /** Quando true, o chrome (título + +) fica no pai (Figma Pages). */
    hideChrome?: boolean;
    createMode?: "sub-or-root" | "root-only";
  }
>(function FolderTree(
  {
    folders,
    selectedFolderId,
    labels,
    onSelect,
    onCreate,
    onUpdate,
    onDelete,
    onMove,
    busy = false,
    hideChrome = false,
    createMode = "sub-or-root",
  },
  ref,
) {
  const baseFolder = useMemo(
    () => folders.find((folder) => folder.isBase) ?? null,
    [folders],
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Seed expand once — reloads não devem reabrir o que o usuário colapsou.
  const seededExpanded = useRef(false);
  useEffect(() => {
    if (seededExpanded.current || folders.length === 0) return;
    seededExpanded.current = true;
    setExpanded(new Set(folders.map((folder) => folder.id)));
  }, [folders]);
  const [editor, setEditor] = useState<{
    mode: "create" | "edit";
    folder: EditableFolder | null;
    parentId: string | null;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const childrenOf = (parentId: string | null) =>
    folders.filter((folder) => folder.parentId === parentId);

  /** Subpasta da selecionada (não-Base); senão raiz (parentId null). */
  const openCreate = () => {
    if (busy) return;
    if (createMode === "root-only") {
      setEditor({ mode: "create", folder: null, parentId: null });
      return;
    }
    const selected = folders.find((folder) => folder.id === selectedFolderId);
    const parentId = selected && !selected.isBase ? selected.id : null;
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
    }
    setEditor({ mode: "create", folder: null, parentId });
  };

  useImperativeHandle(ref, () => ({ openCreate }));

  const canDropOn = (target: EditableFolder): boolean => {
    if (!dragId || !onMove) return false;
    if (target.isBase) return false;
    if (target.id === dragId) return false;
    if (collectSubtreeIds(dragId, folders).has(target.id)) return false;
    return true;
  };

  const handleDrop = async (target: EditableFolder) => {
    if (busy || !dragId || !onMove || !canDropOn(target)) {
      setDragId(null);
      setDropTargetId(null);
      return;
    }
    try {
      await onMove(dragId, target.id);
    } finally {
      setDragId(null);
      setDropTargetId(null);
    }
  };

  const renderBranch = (
    parentId: string | null,
    depth: number,
  ): React.ReactNode => {
    const children = childrenOf(parentId);
    if (!children.length) return null;

    return (
      <ul className={cn("space-y-0.5", depth > 0 && "ml-4")}>
        {children.map((folder) => {
          const hasChildren = childrenOf(folder.id).length > 0;
          const isExpanded = expanded.has(folder.id);
          const isSelected = selectedFolderId === folder.id;
          const isDropTarget =
            dropTargetId === folder.id && dragId !== null && canDropOn(folder);

          // Auto-expand path when selecting — already seeded expanded for all.
          if (hasChildren && !isExpanded) {
            // still render children only when expanded
          }

          return (
            <li key={folder.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  isSelected
                    ? "text-foreground bg-white/10 font-medium"
                    : "text-foreground/90 hover:bg-white/5",
                  isDropTarget && "ring-brand/40 ring-2",
                  dragId === folder.id && "opacity-50",
                )}
                draggable={!busy && !folder.isBase && Boolean(onMove)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTargetId(null);
                }}
                onDragLeave={() => {
                  setDropTargetId((current) =>
                    current === folder.id ? null : current,
                  );
                }}
                onDragOver={(event) => {
                  if (busy || !onMove || folder.isBase) return;
                  if (dragId && canDropOn(folder)) {
                    event.preventDefault();
                    setDropTargetId(folder.id);
                  }
                }}
                onDragStart={(event) => {
                  if (busy || folder.isBase || !onMove) {
                    event.preventDefault();
                    return;
                  }
                  setDragId(folder.id);
                  event.dataTransfer.setData("text/plain", folder.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(folder);
                }}
              >
                <button
                  aria-current={isSelected ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    onSelect(folder.id);
                    if (hasChildren) {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (!next.has(folder.id)) next.add(folder.id);
                        return next;
                      });
                    }
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: folder.color ?? DEFAULT_FOLDER_COLOR,
                    }}
                  />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </button>
                {!folder.isBase ? (
                  <Button
                    aria-label={labels.rename}
                    className={cn(
                      "size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                      isSelected && "opacity-100",
                    )}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setEditor({
                        mode: "edit",
                        folder,
                        parentId: folder.parentId,
                      })
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                ) : null}
              </div>
              {hasChildren && isExpanded
                ? renderBranch(folder.id, depth + 1)
                : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      {!hideChrome ? (
        <div className="mb-2 flex items-center justify-between gap-1">
          <span className="text-foreground text-sm font-medium">
            {labels.name}
          </span>
          <Button
            aria-label={labels.create}
            disabled={busy || !baseFolder}
            size="icon-sm"
            title={labels.create}
            type="button"
            variant="ghost"
            onClick={openCreate}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      ) : null}
      {/* hideChrome: o + do pai chama via data attribute / imperative — expõe botão sr-only se createFromParent */}
      {renderBranch(null, 0)}

      <FolderEditorDialog
        busy={busy}
        folder={editor?.folder}
        key={
          editor
            ? editor.mode +
              ":" +
              (editor.folder?.id ?? "create") +
              ":" +
              String(editor.parentId)
            : "closed"
        }
        labels={labels}
        mode={editor?.mode ?? "create"}
        open={Boolean(editor)}
        parentId={editor?.parentId}
        onDelete={onDelete}
        onMoveToRoot={
          onMove
            ? async (folder) => {
                await onMove(folder.id, null);
              }
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onSubmit={async (value) => {
          if (!editor) return;
          if (editor.mode === "create") {
            await onCreate({ ...value, parentId: editor.parentId });
          } else if (editor.folder) {
            await onUpdate(editor.folder, value);
          }
          setEditor(null);
        }}
      />
    </>
  );
});

/** Expõe helper de subtree pra workspaces (listagem agregada no client). */
export { collectSubtreeIds as collectFolderSubtreeIds };
