"use client";

import { useCallback } from "react";

import type { FolderEditorValue } from "@/components/Shared/FolderEditorDialog";
import { requestJson, type ApiError } from "@/lib/requestJson";

/**
 * Shared create/update/move/delete wiring for Pages and Media folder trees.
 * Delete requires reassignToFolderId (Scope 3 multi-raiz).
 */
export function useFolderCrud(options: {
  basePath: string;
  beginMutation: (action: string) => boolean;
  finishMutation: () => void;
  onSuccess: () => Promise<unknown>;
  setError: (message: string | null) => void;
  errorFallback: string;
}) {
  const {
    basePath,
    beginMutation,
    finishMutation,
    onSuccess,
    setError,
    errorFallback,
  } = options;

  const createFolder = useCallback(
    async (value: FolderEditorValue) => {
      if (!beginMutation("create-folder")) return;
      setError(null);
      try {
        await requestJson(basePath, {
          method: "POST",
          body: JSON.stringify({
            name: value.name,
            color: value.color,
            parentId: value.parentId ?? null,
          }),
        });
        await onSuccess();
      } catch (folderError) {
        setError((folderError as ApiError).message || errorFallback);
      } finally {
        finishMutation();
      }
    },
    [
      basePath,
      beginMutation,
      finishMutation,
      onSuccess,
      setError,
      errorFallback,
    ],
  );

  const updateFolder = useCallback(
    async (folder: { id: string }, value: FolderEditorValue) => {
      if (!beginMutation("update-folder")) return;
      setError(null);
      try {
        await requestJson(`${basePath}/${folder.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: value.name, color: value.color }),
        });
        await onSuccess();
      } catch (folderError) {
        setError((folderError as ApiError).message || errorFallback);
      } finally {
        finishMutation();
      }
    },
    [
      basePath,
      beginMutation,
      finishMutation,
      onSuccess,
      setError,
      errorFallback,
    ],
  );

  const moveFolder = useCallback(
    async (folderId: string, newParentId: string | null) => {
      if (!beginMutation("move-folder")) return;
      setError(null);
      try {
        await requestJson(`${basePath}/${folderId}`, {
          method: "PUT",
          body: JSON.stringify({ newParentId }),
        });
        await onSuccess();
      } catch (folderError) {
        setError((folderError as ApiError).message || errorFallback);
        throw folderError;
      } finally {
        finishMutation();
      }
    },
    [
      basePath,
      beginMutation,
      finishMutation,
      onSuccess,
      setError,
      errorFallback,
    ],
  );

  const deleteFolder = useCallback(
    async (folderId: string, reassignToFolderId: string) => {
      if (!beginMutation(`delete-folder:${folderId}`)) return;
      setError(null);
      try {
        await requestJson(`${basePath}/${folderId}`, {
          method: "DELETE",
          body: JSON.stringify({ reassignToFolderId }),
        });
        await onSuccess();
      } catch (folderError) {
        setError((folderError as ApiError).message || errorFallback);
        throw folderError;
      } finally {
        finishMutation();
      }
    },
    [
      basePath,
      beginMutation,
      finishMutation,
      onSuccess,
      setError,
      errorFallback,
    ],
  );

  return { createFolder, updateFolder, moveFolder, deleteFolder };
}
