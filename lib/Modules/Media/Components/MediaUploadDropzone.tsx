"use client";

import type { DragEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";

import { ListHeader } from "@/components/Shared/ListHeader";
import { Button } from "@/components/ui/button";
import type {
  MediaCopy,
  MediaDto,
  UploadState,
} from "@/lib/Modules/Media/Components/MediaWorkspaceTypes";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

/** Restringe o overlay e o drop a arrastes que realmente contêm arquivos. */
function hasFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** Mantém drop, input e feedback da fila no mesmo limite de responsabilidade. */
export function MediaUploadDropzone({
  children,
  dictionary,
  folderId,
  query,
  mutationBusy,
  uploadBusy,
  viewControls,
  onBeginMutation,
  onFinishMutation,
  onClearNotice,
  onError,
  onNotice,
  onQueryChange,
  onRefresh,
  onResolveFolderId,
}: {
  children: ReactNode;
  dictionary: MediaCopy;
  folderId: string;
  query: string;
  mutationBusy: boolean;
  uploadBusy: boolean;
  viewControls: ReactNode;
  onBeginMutation: (action: string) => boolean;
  onFinishMutation: () => void;
  onClearNotice: () => void;
  onError: (message: string | null) => void;
  onNotice: (message: string) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => Promise<void>;
  onResolveFolderId: () => Promise<string>;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [largeRasterNotice, setLargeRasterNotice] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<Record<string, UploadState>>(
    {},
  );
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Valida o folder atual, envia a fila e preserva o estado individual de falha. */
  const submitFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const targetFolderId = folderId || (await onResolveFolderId());
    if (!targetFolderId) return;
    if (!onBeginMutation("upload")) return;
    setLargeRasterNotice(
      Array.from(files).some(
        (file) =>
          file.size > 1024 * 1024 && /\.(jpe?g|png|webp|gif)$/i.test(file.name),
      ),
    );
    setUploadQueue(
      Object.fromEntries(Array.from(files, (file) => [file.name, "uploading"])),
    );
    onError(null);
    onClearNotice();
    try {
      const form = new FormData();
      form.set("folderId", targetFolderId);
      Array.from(files).forEach((file) => form.append("files", file));
      const result = await requestJson<{
        items: MediaDto[];
        errors: Array<{ fileName: string; message: string }>;
      }>("/api/admin/media", { method: "POST", body: form });
      const failedNames = new Set(result.errors.map((item) => item.fileName));
      setUploadQueue((current) =>
        Object.fromEntries(
          Object.keys(current).map((fileName) => [
            fileName,
            failedNames.has(fileName)
              ? "failed"
              : /\.(jpe?g|png|webp|gif)$/i.test(fileName)
                ? "processing"
                : "ready",
          ]),
        ),
      );
      if (result.errors.length) {
        onError(
          result.errors
            .map((item) => `${item.fileName}: ${item.message}`)
            .join(" "),
        );
      } else {
        onNotice(`${result.items.length} ${dictionary.upload.toLowerCase()}.`);
      }
      await onRefresh();
      setUploadQueue({});
    } catch (uploadError) {
      onError((uploadError as ApiError).message || dictionary.error);
      setUploadQueue((current) =>
        Object.fromEntries(
          Object.keys(current).map((fileName) => [fileName, "failed"]),
        ),
      );
    } finally {
      onFinishMutation();
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section
      className={cn(
        "relative flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden px-4 py-4 md:gap-4 md:px-8 md:py-5 xl:px-10",
        dragOver && "ring-primary/40 ring-2 ring-inset",
      )}
      onDragEnter={(event) => {
        if (!hasFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!hasFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragOver(false);
      }}
      onDragOver={(event) => {
        if (!hasFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!hasFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragOver(false);
        void submitFiles(event.dataTransfer.files);
      }}
    >
      {dragOver ? (
        <div
          aria-hidden
          className="border-primary/50 bg-primary/10 pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed"
        >
          <p className="bg-background/90 text-foreground rounded-full px-4 py-2 text-sm font-medium shadow-sm">
            {dictionary.upload}
          </p>
        </div>
      ) : null}

      <ListHeader
        className="border-border shrink-0 border-b pb-3"
        disabled={mutationBusy}
        searchAriaLabel={dictionary.searchPlaceholder}
        searchPlaceholder={dictionary.searchPlaceholder}
        searchValue={query}
        subtitle={dictionary.description}
        title={dictionary.title}
        onSearchChange={onQueryChange}
      >
        <input
          ref={fileInputRef}
          accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.pdf,.mp4"
          className="sr-only"
          disabled={!folderId || mutationBusy}
          multiple
          type="file"
          onChange={(event) => void submitFiles(event.target.files)}
        />
        {viewControls}
        <Button
          className="border-border rounded-full bg-transparent px-4 hover:bg-white/5"
          disabled={!folderId || mutationBusy}
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="text-brand size-4" />
          {uploadBusy ? dictionary.uploading : dictionary.upload}
        </Button>
      </ListHeader>

      {Object.keys(uploadQueue).length ? (
        <ul
          aria-label={dictionary.upload}
          className="grid shrink-0 gap-2 text-xs sm:grid-cols-2"
          role="status"
        >
          {Object.entries(uploadQueue).map(([fileName, state]) => (
            <li
              className="border-border flex items-center justify-between rounded-lg border px-3 py-2"
              key={fileName}
            >
              <span className="min-w-0 truncate">{fileName}</span>
              <span
                className={cn(
                  "ml-3 shrink-0",
                  state === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {state === "uploading"
                  ? dictionary.uploading
                  : state === "processing"
                    ? dictionary.processing
                    : state === "failed"
                      ? dictionary.failed
                      : dictionary.ready}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {largeRasterNotice ? (
        <div
          className="border-primary/30 bg-primary/10 text-primary shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          {dictionary.largeRaster}
        </div>
      ) : null}

      {children}
    </section>
  );
}
