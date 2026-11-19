"use client";

import Image from "next/image";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  isWebpConvertible,
  type MediaGridItem,
} from "@/lib/Modules/Media/Components/MediaGrid";

/** Item de lista — inclui createdAt que o grid não precisa. */
export type MediaListItem = MediaGridItem & {
  createdAt?: string;
};

/** Lista densa com as mesmas ações do MediaGrid (seleção/convert/details). */
export function MediaList({
  items,
  selectedIds = [],
  onToggle,
  onOpenDetails,
  onConvert,
  selectionOnly = false,
  selectedLabel = "Select media",
  formatSize = (bytes) => bytes + " B",
  formatDate = (item) => {
    if (!item.createdAt) return "—";
    const date = new Date(item.createdAt);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
  },
  statusLabel = (status) => status,
  convertLabel = "Convert WebP",
  convertingLabel = "Converting…",
  convertingId = null,
  nameLabel = "Name",
  sizeLabel = "Size",
  dateLabel = "Date",
  selectionAtLimit = false,
  selectionDisabled = false,
}: {
  items: readonly MediaListItem[];
  selectedIds?: readonly string[];
  onToggle?: (id: string) => void;
  onOpenDetails?: (item: MediaListItem) => void;
  onConvert?: (item: MediaListItem) => void;
  selectionOnly?: boolean;
  selectedLabel?: string | ((item: MediaListItem) => string);
  formatSize?: (bytes: number) => string;
  formatDate?: (item: MediaListItem) => string;
  statusLabel?: (status: MediaListItem["processingStatus"]) => string;
  convertLabel?: string;
  convertingLabel?: string;
  convertingId?: string | null;
  nameLabel?: string;
  sizeLabel?: string;
  dateLabel?: string;
  selectionAtLimit?: boolean;
  selectionDisabled?: boolean;
}) {
  return (
    <div className="overflow-x-auto" role="table">
      {/* Sem coluna dimensões — schema ainda não guarda width/height. */}
      <div
        className="text-muted-foreground mb-1 grid min-w-[648px] grid-cols-[2.5rem_3rem_minmax(10rem,1.4fr)_5.5rem_7rem_auto] gap-3 px-1 text-sm"
        role="row"
      >
        <div role="columnheader" />
        <div role="columnheader" />
        <div role="columnheader">{nameLabel}</div>
        <div role="columnheader">{sizeLabel}</div>
        <div role="columnheader">{dateLabel}</div>
        <div role="columnheader" />
      </div>
      <div className="divide-border min-w-[640px] divide-y" role="rowgroup">
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
            <div
              className={cn(
                "grid grid-cols-[2.5rem_3rem_minmax(10rem,1.4fr)_5.5rem_7rem_auto] items-center gap-3 py-2.5",
                selected && "bg-primary/5",
              )}
              data-testid="media-list-row"
              key={item.id}
              role="row"
            >
              <div className="flex justify-center" role="cell">
                {onToggle ? (
                  <input
                    aria-label={label}
                    checked={selected}
                    className="accent-primary size-4"
                    disabled={
                      selectionDisabled || (selectionAtLimit && !selected)
                    }
                    type="checkbox"
                    onChange={() => onToggle(item.id)}
                  />
                ) : null}
              </div>

              <div role="cell">
                <button
                  className="bg-muted/40 relative flex size-10 items-center justify-center overflow-hidden rounded-md"
                  type="button"
                  onClick={() => {
                    if (selectionOnly && onToggle) onToggle(item.id);
                    else onOpenDetails?.(item);
                  }}
                >
                  {image && item.processingStatus === "READY" ? (
                    <Image
                      alt={item.alt ?? item.name}
                      className="object-contain p-0.5"
                      fill
                      sizes="40px"
                      src={item.url}
                      unoptimized
                    />
                  ) : (
                    <span className="text-muted-foreground px-0.5 text-[9px] leading-tight">
                      {item.processingStatus === "PROCESSING"
                        ? statusLabel(item.processingStatus)
                        : item.mimeType.split("/").pop()}
                    </span>
                  )}
                </button>
              </div>

              <div className="min-w-0" role="cell">
                <button
                  className="hover:text-foreground flex w-full min-w-0 items-center gap-1.5 text-left"
                  type="button"
                  onClick={() => {
                    if (selectionOnly && onToggle) onToggle(item.id);
                    else onOpenDetails?.(item);
                  }}
                >
                  <span className="truncate font-medium">{item.name}</span>
                  {!selectionOnly ? (
                    <Pencil
                      aria-hidden
                      className="text-muted-foreground size-3.5 shrink-0 opacity-60"
                    />
                  ) : null}
                </button>
              </div>

              <div
                className="text-muted-foreground text-sm tabular-nums"
                role="cell"
              >
                {formatSize(item.sizeBytes)}
              </div>
              <div className="text-muted-foreground text-sm" role="cell">
                {formatDate(item)}
              </div>

              <div className="flex justify-end" role="cell">
                {canConvert ? (
                  <button
                    className="text-muted-foreground hover:text-foreground border-border rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap disabled:opacity-60"
                    disabled={converting || selectionDisabled}
                    type="button"
                    onClick={() => onConvert(item)}
                  >
                    {converting ? convertingLabel : convertLabel}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
