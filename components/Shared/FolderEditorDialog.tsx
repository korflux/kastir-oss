"use client";

import { useState } from "react";
import { ArrowUpToLine, Trash2 } from "lucide-react";

import {
  ColorPicker,
  DEFAULT_FOLDER_COLOR,
} from "@/components/Shared/ColorPicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PanelDictionary } from "@/lib/i18n/panel";

export type FolderEditorValue = {
  name: string;
  color: string;
  parentId?: string | null;
};

export type EditableFolder = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
};

export function FolderEditorDialog({
  open,
  mode,
  folder,
  parentId,
  labels,
  busy = false,
  onOpenChange,
  onSubmit,
  onDelete,
  onMoveToRoot,
}: {
  open: boolean;
  mode: "create" | "edit";
  folder?: EditableFolder | null;
  parentId?: string | null;
  labels: PanelDictionary["folders"];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: FolderEditorValue) => Promise<void>;
  onDelete?: (folder: EditableFolder) => void;
  onMoveToRoot?: (folder: EditableFolder) => Promise<void>;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(folder?.color ?? DEFAULT_FOLDER_COLOR);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onSubmit({ name: name.trim(), color, parentId });
  };

  const title = mode === "create" ? labels.create : labels.rename;

  /** Promove a pasta e só fecha o editor depois da persistência confirmada. */
  const moveToRoot = async () => {
    if (!folder || !onMoveToRoot) return;
    try {
      await onMoveToRoot(folder);
      onOpenChange(false);
    } catch {
      // O workspace exibe o erro compartilhado; manter o diálogo preserva o contexto.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={labels.close}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{labels.name}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label
            className="block space-y-1 text-sm"
            htmlFor="folder-editor-name"
          >
            <span>{labels.name}</span>
            <Input
              autoFocus
              id="folder-editor-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <ColorPicker label={labels.color} value={color} onChange={setColor} />
          <DialogFooter>
            {mode === "edit" && folder && !folder.isBase && onDelete ? (
              <Button
                className="mr-auto"
                disabled={busy}
                type="button"
                variant="destructive"
                onClick={() => {
                  onDelete(folder);
                  onOpenChange(false);
                }}
              >
                <Trash2 />
                {labels.delete}
              </Button>
            ) : null}
            {mode === "edit" &&
            folder &&
            folder.parentId !== null &&
            !folder.isBase &&
            onMoveToRoot ? (
              <Button
                disabled={busy}
                type="button"
                variant="outline"
                onClick={() => void moveToRoot()}
              >
                <ArrowUpToLine />
                {labels.moveToRoot}
              </Button>
            ) : null}
            <Button
              disabled={!name.trim() || busy || Boolean(folder?.isBase)}
              type="submit"
            >
              {mode === "create" ? labels.create : labels.rename}
            </Button>
          </DialogFooter>
        </form>
        {folder?.isBase ? (
          <p className="text-muted-foreground text-xs">
            {labels.baseProtected}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
