"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Image as ImageIcon, Trash2 } from "lucide-react";

import { RequiredMark } from "@/components/Shared/RequiredMark";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isWebpConvertible } from "@/lib/Modules/Media/Components/MediaGrid";
import type {
  FolderDto,
  MediaCopy,
  MediaDto,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import {
  formatMediaBytes,
  mediaFolderPath,
  mediaStatusLabel,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import { SeoDot } from "@/lib/Modules/Pages/Components/SeoFields";
import { requestJson, type ApiError } from "@/lib/requestJson";

const AUTOSAVE_MS = 450;

/** Mantém metadados, replace, conversão e cópia no painel da mídia ativa. */
export function MediaDetailsPanel({
  activeMedia,
  busyAction,
  dictionary,
  folders,
  onBeginMutation,
  onFinishMutation,
  onConvert: convertToWebp,
  onDelete: requestDeleteMedia,
  onError,
  onMediaChange,
  onNotice,
  onRefresh,
}: {
  activeMedia: MediaDto | null;
  busyAction: string | null;
  dictionary: MediaCopy;
  folders: FolderDto[];
  onBeginMutation: (action: string) => boolean;
  onFinishMutation: () => void;
  onConvert: () => void;
  onDelete: (ids: string[]) => void;
  onError: (message: string | null) => void;
  onMediaChange: (media: MediaDto) => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [editName, setEditName] = useState(activeMedia?.name ?? "");
  const [editAlt, setEditAlt] = useState(activeMedia?.alt ?? "");
  const [editDescription, setEditDescription] = useState(
    activeMedia?.description ?? "",
  );
  const [editFolderId, setEditFolderId] = useState(activeMedia?.folderId ?? "");
  const activeIsImage =
    activeMedia &&
    (activeMedia.category === "IMAGE_RASTER" ||
      activeMedia.category === "IMAGE_SVG");
  const mutationBusy = busyAction !== null;

  /** Persiste somente campos alterados e devolve o registro atualizado ao workspace. */
  const persistDetails = useCallback(async () => {
    if (!activeMedia) return;
    const name = editName.trim();
    if (!name) return;
    if (
      activeMedia.name === name &&
      (activeMedia.alt ?? "") === editAlt &&
      (activeMedia.description ?? "") === editDescription &&
      activeMedia.folderId === editFolderId
    ) {
      return;
    }
    if (!onBeginMutation(`save:${activeMedia.id}`)) return;
    onError(null);
    try {
      const payload = await requestJson<{ media: MediaDto }>(
        `/api/admin/media/${activeMedia.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name,
            alt: editAlt,
            description: editDescription,
            folderId: editFolderId,
          }),
        },
      );
      onMediaChange(payload.media);
    } catch (saveError) {
      onError((saveError as ApiError).message || dictionary.error);
    } finally {
      onFinishMutation();
    }
  }, [
    activeMedia,
    dictionary.error,
    editAlt,
    editDescription,
    editFolderId,
    editName,
    onBeginMutation,
    onFinishMutation,
    onError,
    onMediaChange,
  ]);

  useEffect(() => {
    if (!activeMedia || mutationBusy) return;
    const timer = window.setTimeout(() => void persistDetails(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [activeMedia, mutationBusy, persistDetails]);

  /** Copia somente URLs prontas e as resolve contra a origem atual. */
  const copyLink = async () => {
    if (!activeMedia || activeMedia.processingStatus !== "READY") return;
    await navigator.clipboard.writeText(
      new URL(activeMedia.url, window.location.origin).toString(),
    );
    onNotice(dictionary.copyLink);
  };

  /** Substitui o arquivo ativo, atualiza a biblioteca e libera nova seleção do mesmo arquivo. */
  const submitReplacement = async (file: File | undefined) => {
    if (!file || !activeMedia) return;
    if (!onBeginMutation(`replace:${activeMedia.id}`)) return;
    onError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      await requestJson(`/api/admin/media/${activeMedia.id}/replace`, {
        method: "POST",
        body: form,
      });
      onNotice(dictionary.uploadHint);
      await onRefresh();
    } catch (replaceError) {
      onError((replaceError as ApiError).message || dictionary.error);
    } finally {
      onFinishMutation();
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  };

  return (
    <aside className="bg-card/80 border-border flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border p-3">
      <h2 className="text-foreground mb-2 flex shrink-0 items-center gap-2 text-sm font-medium">
        <ImageIcon aria-hidden className="size-3.5 opacity-80" />
        {dictionary.details}
      </h2>

      {activeMedia ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            <div className="bg-muted/40 relative mx-auto h-24 w-full max-w-[10rem] shrink-0 overflow-hidden rounded-lg">
              {activeIsImage && activeMedia.processingStatus === "READY" ? (
                <Image
                  alt={activeMedia.alt ?? activeMedia.name}
                  className="object-contain p-1.5"
                  fill
                  sizes="10rem"
                  src={activeMedia.url}
                  unoptimized
                />
              ) : (
                <span className="text-muted-foreground flex h-full items-center justify-center px-2 text-center text-[11px]">
                  {mediaStatusLabel(activeMedia.processingStatus, dictionary)}
                </span>
              )}
            </div>

            <label className="block space-y-0.5 text-sm" htmlFor="media-name">
              <span className="text-muted-foreground text-xs">
                {dictionary.name}
                <RequiredMark />
              </span>
              <Input
                className="h-8"
                disabled={mutationBusy}
                id="media-name"
                required
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {activeMedia.fileName}
              </span>
              <button
                aria-label={dictionary.copyLink}
                className="text-muted-foreground hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10 disabled:opacity-40"
                disabled={activeMedia.processingStatus !== "READY"}
                type="button"
                onClick={() => void copyLink()}
              >
                <Copy className="size-3.5" />
              </button>
            </div>

            <label className="block space-y-0.5 text-sm" htmlFor="media-folder">
              <span className="sr-only">{dictionary.folders}</span>
              <div className="relative">
                <select
                  className="border-input bg-background h-8 w-full appearance-none rounded-lg border py-1 pr-8 pl-2 text-sm"
                  disabled={mutationBusy}
                  id="media-folder"
                  value={editFolderId}
                  onChange={(event) => setEditFolderId(event.target.value)}
                >
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {mediaFolderPath(folder.id, folders)}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </label>

            <label className="block space-y-0.5 text-sm" htmlFor="media-alt">
              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                {dictionary.alt}
                <SeoDot />
              </span>
              <Input
                className="h-8"
                disabled={mutationBusy}
                id="media-alt"
                value={editAlt}
                onChange={(event) => setEditAlt(event.target.value)}
              />
            </label>

            <label
              className="block space-y-0.5 text-sm"
              htmlFor="media-description"
            >
              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                {dictionary.descriptionLabel}
                <SeoDot />
              </span>
              <textarea
                className="border-input bg-background focus-visible:ring-ring/50 min-h-12 w-full resize-none rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
                disabled={mutationBusy}
                id="media-description"
                rows={2}
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </label>

            <p className="text-muted-foreground shrink-0 text-[10px] leading-tight">
              {dictionary.type}: {activeMedia.mimeType.split("/").pop()} ·{" "}
              {dictionary.size}: {formatMediaBytes(activeMedia.sizeBytes)} ·{" "}
              {dictionary.status}:{" "}
              {mediaStatusLabel(activeMedia.processingStatus, dictionary)}
              {busyAction === `save:${activeMedia.id}`
                ? ` · ${dictionary.saving}`
                : null}
            </p>
          </div>

          <div className="border-border mt-2 flex shrink-0 flex-wrap gap-1.5 border-t pt-2">
            <input
              ref={replaceInputRef}
              accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.pdf,.mp4"
              className="sr-only"
              disabled={mutationBusy}
              type="file"
              onChange={(event) =>
                void submitReplacement(event.target.files?.[0])
              }
            />
            <Button
              disabled={mutationBusy}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => replaceInputRef.current?.click()}
            >
              {dictionary.replace}
            </Button>
            {isWebpConvertible(activeMedia) ? (
              <Button
                disabled={mutationBusy}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void convertToWebp()}
              >
                {busyAction === `convert:${activeMedia.id}`
                  ? dictionary.converting
                  : dictionary.convertToWebp}
              </Button>
            ) : null}
            <Button
              disabled={mutationBusy}
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => requestDeleteMedia([activeMedia.id])}
            >
              <Trash2 className="size-3.5" />
              {dictionary.delete}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{dictionary.empty}</p>
      )}
    </aside>
  );
}
