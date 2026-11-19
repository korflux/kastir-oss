"use client";

import Image from "next/image";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

export type MediaGridItem = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  category: "IMAGE_RASTER" | "IMAGE_SVG" | "DOCUMENT_PDF" | "VIDEO_MP4";
  sizeBytes: number;
  alt: string | null;
  processingStatus: "PROCESSING" | "READY" | "FAILED";
};

/** Mesmos critérios do convert individual e da rota bulk no servidor. */
export function isWebpConvertible(item: MediaGridItem): boolean {
  return (
    item.category === "IMAGE_RASTER" &&
    item.mimeType !== "image/webp" &&
    item.processingStatus === "READY"
  );
}

export function MediaGrid({
  items,
  selectedIds = [],
  onToggle,
  onOpenDetails,
  onConvert,
  selectionOnly = false,
  selectedLabel = "Select media",
  formatSize = (bytes) => bytes + " B",
  statusLabel = (status) => status,
  convertLabel = "Convert WebP",
  convertingLabel = "Converting…",
  convertingId = null,
  selectionAtLimit = false,
  selectionDisabled = false,
}: {
  items: readonly MediaGridItem[];
  selectedIds?: readonly string[];
  onToggle?: (id: string) => void;
  onOpenDetails?: (item: MediaGridItem) => void;
  /** Scope 5 — convert no hover do card (sem abrir Details). */
  onConvert?: (item: MediaGridItem) => void;
  selectionOnly?: boolean;
  selectedLabel?: string | ((item: MediaGridItem) => string);
  formatSize?: (bytes: number) => string;
  statusLabel?: (status: MediaGridItem["processingStatus"]) => string;
  convertLabel?: string;
  convertingLabel?: string;
  convertingId?: string | null;
  selectionAtLimit?: boolean;
  selectionDisabled?: boolean;
}) {
  return (
    // 2→6 colunas conforme largura (sm/md/lg/2xl).
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        const image =
          item.category === "IMAGE_RASTER" || item.category === "IMAGE_SVG";
        const canConvert =
          !selectionOnly && onConvert && isWebpConvertible(item);
        const converting = convertingId === item.id;
        const label =
          typeof selectedLabel === "function"
            ? selectedLabel(item)
            : item.name + " " + selectedLabel;

        return (
          // overflow-hidden só na miniatura — ring do card selecionado não corta.
          <article
            className={cn(
              "group border-border bg-card relative rounded-xl border transition-colors",
              selected && "border-primary ring-primary/20 ring-2",
              !selected && "hover:border-primary/40",
            )}
            data-testid="media-grid-card"
            key={item.id}
          >
            {/* Card inteiro clicável — checkbox e Convert param com stopPropagation. */}
            <button
              className="focus-visible:ring-ring/50 block w-full text-left outline-none focus-visible:ring-2"
              type="button"
              onClick={() => {
                if (selectionOnly && onToggle) onToggle(item.id);
                else onOpenDetails?.(item);
              }}
            >
              <div className="bg-muted/40 relative flex aspect-square items-center justify-center overflow-hidden rounded-t-xl">
                {image && item.processingStatus === "READY" ? (
                  <Image
                    alt={item.alt ?? item.name}
                    className="object-contain p-3"
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    src={item.url}
                    unoptimized
                  />
                ) : (
                  <span className="text-muted-foreground px-4 text-center text-xs">
                    {item.processingStatus === "PROCESSING"
                      ? statusLabel(item.processingStatus)
                      : item.mimeType}
                  </span>
                )}

                {/* Overlay rodapé: nome (+ tamanho fora do picker). */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 pt-8 pb-2">
                  <span className="min-w-0 truncate text-[11px] font-medium text-white/95">
                    {item.name}
                  </span>
                  {!selectionOnly ? (
                    <span className="shrink-0 text-[10px] text-white/75">
                      {formatSize(item.sizeBytes)}
                    </span>
                  ) : null}
                </div>

                {/* Ícone de edição no hover (affordance do mockup). */}
                {!selectionOnly ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-2 bottom-8 flex size-6 items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <Pencil className="size-3.5" />
                  </span>
                ) : null}
              </div>
            </button>

            {onToggle ? (
              <input
                aria-label={label}
                checked={selected}
                className="accent-primary absolute top-2.5 left-2.5 z-10 size-4"
                disabled={selectionDisabled || (selectionAtLimit && !selected)}
                type="checkbox"
                onChange={() => onToggle(item.id)}
                onClick={(event) => event.stopPropagation()}
              />
            ) : null}

            {/* Convert WebP — mockup: pill no topo, visível no hover/focus do card. */}
            {canConvert ? (
              <button
                className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/20 bg-black/75 px-2.5 py-1 text-[10px] font-medium whitespace-nowrap text-white opacity-0 shadow-md transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-black/90 focus-visible:opacity-100 disabled:opacity-60"
                disabled={converting || selectionDisabled}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onConvert(item);
                }}
              >
                {converting ? convertingLabel : convertLabel}
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
