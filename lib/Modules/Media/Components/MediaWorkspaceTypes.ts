import type { PanelDictionary } from "@/lib/i18n/panel";
import type { MediaGridItem } from "@/lib/Modules/Media/Components/MediaGrid";

/** Mídia completa consumida pela biblioteca e pelo painel de detalhes. */
export type MediaDto = MediaGridItem & {
  fileName: string;
  description: string | null;
  folderId: string;
  createdAt: string;
};

/** Pasta de mídia retornada pela API administrativa. */
export type FolderDto = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
};

export type MediaCopy = PanelDictionary["media"];
export type FolderCopy = PanelDictionary["folders"];
export type UploadState = "uploading" | "processing" | "ready" | "failed";

/** Formata bytes com a menor unidade legível usada nas duas visualizações. */
export function formatMediaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Traduz o estado de processamento sem duplicar a regra entre grid e detalhes. */
export function mediaStatusLabel(
  status: MediaDto["processingStatus"],
  copy: MediaCopy,
): string {
  if (status === "PROCESSING") return copy.processing;
  if (status === "FAILED") return copy.failed;
  return copy.ready;
}

/** Monta o caminho hierárquico e interrompe ciclos defensivamente. */
export function mediaFolderPath(
  folderId: string,
  folders: readonly FolderDto[],
): string {
  const parts: string[] = [];
  let current = folders.find((folder) => folder.id === folderId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId
      ? (folders.find((folder) => folder.id === current!.parentId) ?? null)
      : null;
  }
  return parts.join(" / ") || folderId;
}
