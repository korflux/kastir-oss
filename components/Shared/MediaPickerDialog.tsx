"use client";

import { useEffect, useState } from "react";

import {
  MediaGrid,
  type MediaGridItem,
} from "@/lib/Modules/Media/Components/MediaGrid";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PickerFolder = { id: string; name: string; isBase: boolean };

/**
 * Seletor de imagem da biblioteca de mídia (busca, pasta e grade de seleção única), compartilhado
 * pelo editor de código (Pages e Scripts) e pelo favicon em Settings.
 *
 * Rótulos de fechar: `cancelLabel` nomeia o botão do rodapé e `closeLabel` nomeia o X do canto
 * (texto só para leitor de tela). São separados e obrigatórios, como no `ConfirmDialog`: o X
 * anuncia "Fechar"/"Close" do dicionário e o rodapé "Cancelar"/"Cancel" (fase 4, A3, design ›
 * Diálogos e decisão humana de estender o "Fechar" a este seletor). Quem usa o componente passa
 * os dois do dicionário do módulo, pois ele é client e não conhece o idioma do painel.
 */
export function MediaPickerDialog({
  open,
  title,
  cancelLabel,
  closeLabel,
  selectLabel,
  onOpenChange,
  selectedId,
  onSelect,
}: {
  open: boolean;
  title: string;
  /** Texto do botão de cancelar do rodapé. */
  cancelLabel: string;
  /** Nome acessível do X do canto, vindo da chave `close` do dicionário do módulo. */
  closeLabel: string;
  selectLabel: string;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  onSelect: (item: MediaGridItem) => void;
}) {
  const [items, setItems] = useState<MediaGridItem[]>([]);
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selected = selectedOverride ?? selectedId;
  const selectedItem = items.find((item) => item.id === selected);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Debounce keystrokes like MediaWorkspace's own search (250ms) — folder
    // switches fire immediately since they aren't typed character-by-character.
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        const params = new URLSearchParams({ status: "READY" });
        if (folderId) params.set("folderId", folderId);
        if (query.trim()) params.set("q", query.trim());
        fetch("/api/admin/media?" + params.toString(), {
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("Unable to load media");
            return (await response.json()) as {
              media: MediaGridItem[];
              folders: PickerFolder[];
            };
          })
          .then((payload) => {
            setItems(
              payload.media.filter(
                (item) =>
                  item.processingStatus === "READY" &&
                  (item.category === "IMAGE_RASTER" ||
                    item.category === "IMAGE_SVG"),
              ),
            );
            setFolders(payload.folders);
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setItems([]);
              setFolders([]);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [folderId, open, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSelectedOverride(null);
        onOpenChange(nextOpen);
      }}
    >
      {/* X do canto = `closeLabel` ("Fechar"); botão do rodapé = `cancelLabel` ("Cancelar"). */}
      <DialogContent className="max-w-3xl" closeLabel={closeLabel}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <select
            aria-label="Folder"
            className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">All media</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <Input
            aria-label="Search media"
            placeholder="Search media"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Loading…
            </p>
          ) : items.length ? (
            <MediaGrid
              items={items}
              selectedIds={selected ? [selected] : []}
              selectionOnly
              onToggle={setSelectedOverride}
            />
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No media found.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            disabled={!selectedItem}
            onClick={() => {
              if (!selectedItem) return;
              onSelect(selectedItem);
              onOpenChange(false);
            }}
          >
            {selectLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
