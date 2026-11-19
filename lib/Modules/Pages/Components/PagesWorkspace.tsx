"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  Folder as FolderIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { BulkActionBar } from "@/components/Shared/BulkActionBar";
import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import {
  collectFolderSubtreeIds,
  FolderTree,
  type FolderTreeHandle,
} from "@/components/Shared/FolderTree";

import { ListHeader } from "@/components/Shared/ListHeader";
import {
  ListEmptyState,
  ListViewport,
} from "@/components/Shared/ResponsiveList";
import {
  NameSortHeader,
  NameSortIcon,
  nameSortAriaValue,
} from "@/components/Shared/NameSortHeader";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { useFolderCrud } from "@/components/Shared/useFolderCrud";
import { useMutationLock } from "@/components/Shared/mutationLock";
import { useRowSelection } from "@/components/Shared/useRowSelection";
import { StatusToggle } from "@/components/Shared/StatusToggle";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  PageQuickEditPopover,
  type PageQuickEditInput,
} from "@/lib/Modules/Pages/Components/PageQuickEditPopover";
import type { PanelDictionary } from "@/lib/i18n/panel";
import {
  getListedPageAbsoluteUrl,
  getListedPagePath,
  getPublishedPagePath,
} from "@/lib/Modules/Pages/publicUrl";
import {
  formatPanelDate,
  type PanelFormatSettings,
} from "@/lib/Modules/Settings/format";
import type { BulkResult } from "@/lib/Modules/Shared/Bulk";
import {
  statusSwitchLabelKey,
  turnOn,
  turnOnNoticeKey,
} from "@/lib/Modules/Revisions/Components/revisionEditorState";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";
import { compareByName, type NameSortDir } from "@/lib/utils/nameSort";

type PageDto = {
  id: string;
  title: string;
  slug: string;
  status: "DRAFT" | "PUBLISHED";
  activeSnippetCount?: number;
  folderId: string;
  authorId: string;
  author?: { id: string; name: string } | null;
  deletedBy?: { id: string; name: string } | null;
  publishedRevisionId?: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

type FolderDto = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
};

type WorkspaceCopy = PanelDictionary["pages"];
type FolderCopy = PanelDictionary["folders"];
type BulkCopy = PanelDictionary["bulk"];

/** Ações de ciclo de vida de uma página, uma por endpoint `/api/admin/pages/:id/...`. */
type PageAction =
  | "publish"
  | "activate"
  | "unpublish"
  | "duplicate"
  | "restore"
  | "trash"
  | "permanently-delete";

type PendingConfirmation =
  | { kind: "trash-page"; id: string }
  | { kind: "trash-pages"; ids: string[] }
  | { kind: "permanent-page"; id: string }
  | { kind: "permanent-pages"; ids: string[] }
  | { kind: "delete-folder"; id: string; reassignToFolderId: string }
  // Desligar o switch pede confirmação (F4): a URL pública passa a dar 404.
  | { kind: "unpublish-page"; id: string }
  | null;

/** Chamada crua ao endpoint da ação; lança o `ApiError` (código e mensagem do servidor). */
function callPageAction(pageId: string, action: PageAction) {
  const method = action === "trash" ? "DELETE" : "POST";
  return requestJson(
    `/api/admin/pages/${pageId}${action === "trash" ? "" : `/${action}`}`,
    action === "permanently-delete"
      ? { method, body: JSON.stringify({ confirmed: true }) }
      : { method },
  );
}

/**
 * Título, frase e botão do diálogo de confirmação conforme a ação pendente. Sem ação
 * pendente o diálogo está fechado e devolve o texto da lixeira (campos são obrigatórios).
 */
function confirmationCopy(
  pending: PendingConfirmation,
  dictionary: PanelDictionary["pages"],
  bulkDictionary: PanelDictionary["bulk"],
  folderDictionary: PanelDictionary["folders"],
): { title: string; description: string; confirmLabel: string } {
  switch (pending?.kind) {
    case "permanent-page":
      return {
        title: dictionary.confirmPermanentTitle,
        description: dictionary.confirmPermanentDescription,
        confirmLabel: dictionary.permanentlyDelete,
      };
    case "permanent-pages":
      return {
        title: dictionary.confirmBulkPermanentTitle,
        description: formatBulkCopy(
          dictionary.confirmBulkPermanentDescription,
          {
            count: pending.ids.length,
          },
        ),
        confirmLabel: dictionary.permanentlyDelete,
      };
    case "trash-pages":
      return {
        title: dictionary.confirmBulkTrashTitle,
        description: formatBulkCopy(dictionary.confirmBulkTrashDescription, {
          count: pending.ids.length,
        }),
        confirmLabel: bulkDictionary.moveToTrash,
      };
    case "delete-folder":
      return {
        title: dictionary.confirmFolderDeleteTitle,
        description: dictionary.confirmFolderDeleteDescription,
        confirmLabel: folderDictionary.delete,
      };
    case "unpublish-page":
      return {
        title: dictionary.publishing.unpublishTitle,
        description: dictionary.publishing.unpublishDescription,
        confirmLabel: dictionary.publishing.unpublishConfirm,
      };
    default:
      return {
        title: dictionary.confirmTrashTitle,
        description: dictionary.confirmTrashDescription,
        confirmLabel: dictionary.moveToTrash,
      };
  }
}

function folderPath(folderId: string, folders: FolderDto[]): string {
  const parts: string[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId
      ? folders.find((folder) => folder.id === current!.parentId)
      : undefined;
  }
  return parts.join(" / ");
}

/** Formata mensagens de lote sem acoplar a barra compartilhada ao i18n do módulo. */
function formatBulkCopy(
  template: string,
  values: Record<string, number>,
): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replace(`{${key}}`, String(value)),
    template,
  );
}

/*
 * Trilhas das listagens. Cabeçalho e linhas usam a MESMA string: cada grid é independente, então
 * só trilhas de tamanho fixo ou `minmax` com mínimo fixo (nunca `auto`/`fr` sem mínimo) mantêm as
 * colunas alinhadas entre os dois.
 *
 * Lista ativa de `lg` em diante, sem `min-w` e sem rolagem horizontal. Orçamento por cálculo sobre a
 * casca (BrandRail 93px, `px-8`/`xl:px-10`, card `p-4`, Folders 17rem ao lado a partir de `xl`) e
 * ~15px de barra de rolagem do ListViewport: a lista tem ~818px em 1024, ~774px em 1280, ~934px em
 * 1440 e ~1030px em 1536.
 * - Ações: o cluster (switch + 4 ícones) é dimensionado pelo rótulo mais longo do switch, "Fora do ar
 *   · nunca publicada" (~175px a 14px), mais pista (40px), gap (8px), 3 botões de 32px, 1 de 28px e
 *   4 gaps de 4px: ~363px, ou seja 23rem (os 15rem do design só cabem o switch "No ar"/"Offline").
 *   De `lg` a `2xl` o piso é 15rem e a trilha cresce até 23rem com a folga; em ~1280px (lista de
 *   ~774px) sobram ~334px e o rótulo longo quebra em duas linhas, sem perder informação. De `2xl`
 *   em diante a trilha é fixa em 23rem e quem cede é Autor/Pasta (`minmax(5rem,9rem)`, ~99px em 1536).
 * - Título: piso de 12rem em todas as larguras; recebe o que sobra.
 * - Criado 7rem (data sem hora) e lixeira 3rem (um botão de 32px).
 *
 * Lixeira ("Deleted Pages"), mesmo orçamento e mesma regra da lista ativa: de `lg` em diante sem
 * `min-w`, e Autor/Excluída por só de `2xl`. Antes eram 7 trilhas já em `lg` (mínimos de ~790px mais
 * 6 gaps, ~872px) contra ~774px de lista em 1280 e ~818px em 1024. Agora:
 * - `lg`: checkbox 2.5rem · Restaurar 6rem ("Restaurar" ~55px + padding do botão) · título `minmax(12rem,1fr)`
 *   · Excluída em 7rem · Excluir 11rem: ~672px de mínimos com 4 gaps e recuo, cabe nos ~774px de 1280;
 * - `2xl`: + Autor e Excluída por (9rem cada): ~984px de mínimos, cabe nos ~1030px de 1536.
 * - Excluir é 11rem (176px) e não os 10rem de antes: "Excluir permanentemente" (pt-BR, ~149px a
 *   12.8px) + padding e borda do botão `sm` pede ~171px e passava dos 160px da trilha antiga.
 */
const ROW_TRACKS_SM = "sm:grid-cols-[2rem_auto_minmax(0,1fr)_auto]";
const ACTIVE_TRACKS_LG =
  "lg:grid-cols-[2.5rem_minmax(15rem,23rem)_minmax(12rem,1fr)_7rem_3rem]";
const ACTIVE_TRACKS_2XL =
  "2xl:grid-cols-[2.5rem_23rem_minmax(12rem,1fr)_minmax(5rem,9rem)_minmax(5rem,9rem)_7rem_3rem]";
const TRASH_TRACKS_LG =
  "lg:grid-cols-[2.5rem_6rem_minmax(12rem,1fr)_7rem_11rem]";
const TRASH_TRACKS_2XL =
  "2xl:grid-cols-[2.5rem_6rem_minmax(12rem,1fr)_9rem_9rem_7rem_11rem]";

/**
 * Workspace da listagem de Pages: painel Folders, barra de seleção em massa e linhas (ou a
 * lixeira). Lei E/D: não-destrutivo à esquerda (cluster da linha, `actions` da barra), só
 * destrutivo à direita (lixeira da linha, `destructiveActions` da barra).
 *
 * Contrato responsivo (breakpoints `sm` = 640px, `lg` = 1024px, `2xl` = 1536px):
 * - abaixo de `sm`: rolagem única (só a seção do workspace rola, com tudo junto), Folders limitado a
 *   ~12rem com rolagem própria e linhas de dois níveis, ativa e lixeira (título em cima; ações e
 *   lixeira embaixo). Sem cabeçalho de colunas, a ordenação por nome vive num botão na barra da
 *   lista, alimentado pelo mesmo estado do cabeçalho de `sm` em diante e válido para as duas listas;
 * - de `sm` em diante: altura travada na viewport, lista rolando por dentro, linha em faixa única e
 *   cabeçalho de colunas (com `aria-sort` na coluna Nome);
 * - de `lg` em diante: colunas sem rolagem horizontal; Autor e Pasta da lista ativa só em `2xl`
 *   (ver o orçamento de largura nas constantes de trilhas).
 */
export function PagesWorkspace({
  bulkDictionary,
  canBulk,
  dictionary,
  folderDictionary,
  formatSettings,
  homePageId,
  locale = "en",
  publicOrigin,
}: {
  bulkDictionary: BulkCopy;
  canBulk: boolean;
  dictionary: WorkspaceCopy;
  folderDictionary: FolderCopy;
  formatSettings?: PanelFormatSettings;
  homePageId?: string | null;
  locale?: string;
  publicOrigin: string;
}) {
  const [pages, setPages] = useState<PageDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [trashMode, setTrashMode] = useState(false);
  const [search, setSearch] = useState("");
  // Sort de apresentação só na UI — API continua createdAt desc. Estado único: o cabeçalho de
  // colunas (de `sm` em diante) e o botão da barra (abaixo de `sm`) alternam o mesmo valor, nas
  // duas listas (ativa e lixeira).
  const [sortDir, setSortDir] = useState<NameSortDir>("asc");
  const toggleSortDir = () =>
    setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    busyAction,
    finish: finishMutation,
    isBusy: mutationBusy,
    start: beginMutation,
  } = useMutationLock();
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>(null);
  const [folderDeleteDraft, setFolderDeleteDraft] = useState<{
    id: string;
    reassignToFolderId: string;
    needsReassign: boolean;
  } | null>(null);
  const selectedFolderIdRef = useRef<string | null>(null);
  const folderTreeRef = useRef<FolderTreeHandle>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (trashMode) params.set("trash", "1");
      if (search.trim()) params.set("search", search.trim());
      const query = params.size ? `?${params.toString()}` : "";
      const payload = await requestJson<{
        pages: PageDto[];
        folders: FolderDto[];
      }>(`/api/admin/pages${query}`);
      setPages(payload.pages);
      setFolders(payload.folders);
      const nextSelectedFolderId = (() => {
        const current = selectedFolderIdRef.current;
        if (
          current &&
          payload.folders.some((folder) => folder.id === current)
        ) {
          return current;
        }
        if (current === null) return null;
        return payload.folders.find((folder) => folder.isBase)?.id ?? null;
      })();
      setSelectedFolderId(nextSelectedFolderId);
      selectedFolderIdRef.current = nextSelectedFolderId;
    } catch {
      setError(dictionary.error);
    } finally {
      setLoading(false);
    }
  }, [dictionary.error, trashMode, search]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void loadWorkspace(),
      search ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [loadWorkspace, search]);

  const selectedFolderPath = useMemo(() => {
    if (!selectedFolderId) return dictionary.allPages;
    return folderPath(selectedFolderId, folders) || dictionary.allPages;
  }, [dictionary.allPages, folders, selectedFolderId]);

  const selectFolder = (id: string) => {
    setTrashMode(false);
    setSelectedFolderId(id);
    selectedFolderIdRef.current = id;
    setBulkFolderId("");
  };

  const visiblePages = useMemo(() => {
    const subtree = selectedFolderId
      ? collectFolderSubtreeIds(selectedFolderId, folders)
      : null;
    return pages
      .filter((page) => {
        const inTrash = page.deletedAt != null;
        if (trashMode ? !inTrash : inTrash) return false;
        if (trashMode) return true;
        return !subtree || subtree.has(page.folderId);
      })
      .sort((a, b) => compareByName(a.title, b.title, sortDir));
  }, [pages, selectedFolderId, trashMode, folders, sortDir]);

  const visiblePageIds = useMemo(
    () => visiblePages.map((page) => page.id),
    [visiblePages],
  );
  const selection = useRowSelection({
    resetKey: `${selectedFolderId ?? "all"}:${search}:${trashMode}`,
    visibleIds: visiblePageIds,
  });

  /** Ações da linha que passam pelo gate de mutação (ligar tem fluxo próprio: `turnOnPage`). */
  const performPageAction = async (
    pageId: string,
    action: Exclude<PageAction, "publish" | "activate">,
  ) => {
    const key = `${action}:${pageId}`;
    if (!beginMutation(key)) return;
    setNotice(null);
    try {
      await callPageAction(pageId, action);
      if (
        action === "trash" ||
        action === "restore" ||
        action === "permanently-delete"
      ) {
        // A ação individual muda o dataset atual; não deixe o ID órfão na barra.
        selection.remove([pageId]);
      }
      await loadWorkspace();
      // `loadWorkspace` limpa o aviso ao começar; o resultado entra depois do recarregamento.
      if (action === "unpublish") {
        setNotice(dictionary.publishing.noticeTakenOffline);
      }
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
      setPendingConfirmation(null);
    }
  };

  /**
   * Liga o switch da linha (F9, A12): publica o rascunho salvo e, só quando o servidor recusa
   * por "sem alteração não publicada", volta ao ar a versão publicada (`turnOn`, T1). A
   * listagem não salva nem compara conteúdo: o servidor decide, então nunca vai ao ar uma
   * versão diferente do rascunho salvo. Falha (inclusive mídia não pronta, `VALIDATION_ERROR`)
   * mostra a mensagem do servidor na faixa de erro e o switch continua como estava.
   */
  const turnOnPage = async (pageId: string) => {
    if (!beginMutation(`turn-on:${pageId}`)) return;
    setError(null);
    setNotice(null);
    try {
      const result = await turnOn({
        publish: () => callPageAction(pageId, "publish"),
        activate: () => callPageAction(pageId, "activate"),
      });
      await loadWorkspace();
      if (result) setNotice(dictionary.publishing[turnOnNoticeKey(result)]);
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
    }
  };

  /** Ligar publica na hora; desligar tira a URL do ar, então pede confirmação antes (F4). */
  const toggleLive = (page: PageDto) => {
    if (page.status === "PUBLISHED") {
      setPendingConfirmation({ kind: "unpublish-page", id: page.id });
      return;
    }
    void turnOnPage(page.id);
  };

  const saveQuickEdit = async (
    pageId: string,
    input: PageQuickEditInput,
  ): Promise<void> => {
    if (!beginMutation(`quick-edit:${pageId}`)) {
      throw new Error(dictionary.working);
    }
    try {
      await requestJson<{ page: PageDto }>(`/api/admin/pages/${pageId}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
      // O servidor normaliza slug/pasta e devolve o DTO; a lista deve relê-lo.
      await loadWorkspace();
    } finally {
      finishMutation();
    }
  };

  const performPagesBulk = async (
    payload:
      | { action: "move-folder"; ids: string[]; folderId: string }
      | { action: "trash"; ids: string[] }
      | { action: "restore"; ids: string[] }
      | { action: "permanently-delete"; ids: string[]; confirmed: true },
  ) => {
    if (!beginMutation(`bulk:${payload.action}`)) return;
    setError(null);
    try {
      const result = await requestJson<BulkResult>("/api/admin/pages/bulk", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Falhas permanecem selecionadas para retry; somente sucessos saem.
      selection.remove(result.ok);
      await loadWorkspace();

      if (result.failed.length > 0) {
        setError(
          result.ok.length > 0
            ? formatBulkCopy(bulkDictionary.partial, {
                ok: result.ok.length,
                failed: result.failed.length,
              })
            : bulkDictionary.failed,
        );
      } else {
        setNotice(
          formatBulkCopy(bulkDictionary.success, { count: result.ok.length }),
        );
      }
    } catch (bulkError) {
      setError((bulkError as ApiError).message || dictionary.error);
    } finally {
      finishMutation();
      setPendingConfirmation(null);
    }
  };

  const moveSelectedPages = () => {
    if (!bulkFolderId || selection.selectedIds.length === 0) return;
    void performPagesBulk({
      action: "move-folder",
      ids: [...selection.selectedIds],
      folderId: bulkFolderId,
    });
  };

  const { createFolder, updateFolder, moveFolder, deleteFolder } =
    useFolderCrud({
      basePath: "/api/admin/pages/folders",
      beginMutation,
      finishMutation,
      onSuccess: loadWorkspace,
      setError,
      errorFallback: dictionary.error,
    });

  const iconBtn =
    "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40";

  const confirmCopy = confirmationCopy(
    pendingConfirmation,
    dictionary,
    bulkDictionary,
    folderDictionary,
  );

  return (
    // Full width + altura da seção travada na área do `main` (o wrapper da rota é
    // `overflow-hidden`). A seção é o contêiner de rolagem vertical em todas as larguras; o que
    // muda em `sm` (640px) é o que rola DENTRO dela:
    // - de `sm` em diante: grade e card ocupam a altura que sobra e a lista rola no `ListViewport`
    //   (colunas não ultrapassam a 1ª dobra).
    // - abaixo de `sm`: rolagem única. Grade, card e lista crescem com o conteúdo e só a seção
    //   rola, com Header, Folders e linhas juntos. A altura travada deixava a lista com ~99px
    //   úteis em 375x812 (Header + Folders consumiam a viewport).
    // A tabela reserva o scroll horizontal para o próprio bloco em telas que exibem todas as colunas.
    <section
      className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-4 md:gap-4 md:px-8 md:py-5 xl:px-10"
      data-testid="pages-workspace"
    >
      {/* Header: título + Search by + New page. */}
      <ListHeader
        className="border-border shrink-0 border-b pb-3"
        disabled={mutationBusy}
        searchAriaLabel={dictionary.searchBy}
        searchPlaceholder={dictionary.searchBy}
        searchValue={search}
        subtitle={dictionary.description}
        title={dictionary.title}
        onSearchChange={setSearch}
      >
        <Link
          className={cn(
            buttonVariants({ size: "default", variant: "outline" }),
            "border-border rounded-full bg-transparent px-4 hover:bg-white/5",
          )}
          href={`/admin/pages/new${selectedFolderId ? `?folderId=${selectedFolderId}` : ""}`}
        >
          <Plus className="text-brand size-4" />
          {dictionary.newPage}
        </Link>
      </ListHeader>

      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadWorkspace()}
          >
            {dictionary.retry}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <div
          className="border-primary/30 bg-primary/10 text-primary flex shrink-0 items-center rounded-lg border px-3 py-2 text-sm"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {/*
        Grade Folders + lista. Abaixo de `sm` a grade tem a altura do conteúdo (`flex-none`, linhas
        automáticas: Folders limitado a ~12rem com rolagem própria, lista com a altura das linhas);
        de `sm` a `xl` Folders ocupa até 14rem e a lista o resto da altura travada; de `xl` em
        diante, duas colunas de uma linha.
      */}
      <div
        className="grid flex-none grid-cols-1 gap-3 sm:min-h-0 sm:flex-1 sm:grid-rows-[minmax(0,14rem)_minmax(0,1fr)] sm:overflow-hidden xl:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)] xl:grid-rows-1"
        data-testid="pages-workspace-grid"
      >
        {/* Painel Folders — só árvore (Deleted Pages vai pro header da lista). */}
        <aside
          className="bg-card/80 border-border flex h-auto max-h-48 min-h-0 flex-col overflow-hidden rounded-2xl border p-3 sm:max-h-none xl:h-full"
          data-testid="pages-folders-panel"
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <div className="text-foreground flex items-center gap-2">
              <FolderIcon aria-hidden className="size-4 opacity-80" />
              <span className="text-sm font-medium">{dictionary.folders}</span>
            </div>
            <Button
              aria-label={folderDictionary.create}
              className="size-8"
              disabled={mutationBusy}
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
              !trashMode && !selectedFolderId
                ? "text-foreground bg-white/10 font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
            disabled={mutationBusy}
            type="button"
            onClick={() => {
              setTrashMode(false);
              setSelectedFolderId(null);
              selectedFolderIdRef.current = null;
              setBulkFolderId("");
            }}
          >
            {dictionary.allPages}
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <FolderTree
              ref={folderTreeRef}
              busy={mutationBusy}
              createMode="sub-or-root"
              folders={folders}
              hideChrome
              labels={folderDictionary}
              selectedFolderId={trashMode ? null : selectedFolderId}
              onCreate={createFolder}
              onDelete={(folder) => {
                const subtree = collectFolderSubtreeIds(folder.id, folders);
                const hasContent = pages.some(
                  (page) =>
                    page.deletedAt == null && subtree.has(page.folderId),
                );
                const baseId = folders.find((item) => item.isBase)?.id ?? "";
                const defaultTarget =
                  folders.find(
                    (item) => item.id !== folder.id && !subtree.has(item.id),
                  )?.id ?? baseId;
                if (!hasContent && baseId) {
                  setPendingConfirmation({
                    kind: "delete-folder",
                    id: folder.id,
                    reassignToFolderId: baseId,
                  });
                  return;
                }
                setFolderDeleteDraft({
                  id: folder.id,
                  reassignToFolderId: defaultTarget,
                  needsReassign: true,
                });
              }}
              onMove={moveFolder}
              onSelect={selectFolder}
              onUpdate={updateFolder}
            />
          </div>
        </aside>

        {/*
          Lista full-width: path à esquerda, Deleted Pages à direita. Abaixo de `sm` o card cresce
          com as linhas (sem `h-full` nem corte); de `sm` em diante ocupa a linha da grade e rola
          por dentro do `ListViewport`.
        */}
        <div
          className="bg-card/80 border-border flex min-h-0 min-w-0 flex-col rounded-2xl border p-3 sm:h-full sm:overflow-hidden md:p-4"
          data-testid="pages-list-card"
        >
          {/*
            Barra da lista: caminho à esquerda; Deleted Pages e, abaixo de `sm`, o botão de ordenação
            por nome à direita. `flex-wrap`: em ~375px os dois botões (~210px) não cabem ao lado do
            caminho sem espremê-lo, então descem para uma segunda linha alinhada à direita; de `sm`
            em diante (sem o botão de ordenação) tudo cabe numa linha, como antes.
          */}
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
              <FolderIcon
                aria-hidden
                className="text-muted-foreground size-4 shrink-0"
              />
              <h2 className="text-foreground truncate text-base font-medium tracking-tight md:text-lg">
                {trashMode ? dictionary.deletedPages : selectedFolderPath}
              </h2>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                aria-pressed={trashMode}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  trashMode
                    ? "bg-destructive/15 text-destructive font-medium"
                    : "text-destructive/90 hover:bg-destructive/10",
                )}
                disabled={mutationBusy}
                type="button"
                onClick={() => {
                  setTrashMode((on) => !on);
                  setBulkFolderId("");
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                {dictionary.deletedPages}
              </button>
              {/*
                Ordenação por nome abaixo de `sm`, onde o cabeçalho de colunas não existe. Texto +
                seta da direção atual (não só ícone); o nome acessível traz a direção ("A a Z") e o
                clique a alterna. 32px de altura: alvo de toque do baseline mobile (o `sm` do
                Button tem 28px). Sem linhas (vazio ou carregando a primeira vez) não há o que ordenar.
              */}
              {visiblePages.length > 0 ? (
                <Button
                  aria-label={
                    sortDir === "asc"
                      ? dictionary.sortNameAsc
                      : dictionary.sortNameDesc
                  }
                  className="h-8 sm:hidden"
                  data-testid="pages-sort-toggle"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={toggleSortDir}
                >
                  {dictionary.nameLabel}
                  <NameSortIcon sortDir={sortDir} />
                </Button>
              ) : null}
            </div>
          </div>

          {!canBulk ? (
            <p className="text-muted-foreground mb-3 text-xs" role="status">
              {bulkDictionary.noPermission}
            </p>
          ) : null}

          {canBulk ? (
            <BulkActionBar
              allSelected={selection.allSelected}
              busy={mutationBusy}
              clearLabel={bulkDictionary.clear}
              onClear={selection.clear}
              onToggleAll={() => selection.toggleAll(visiblePageIds)}
              selectedCount={selection.selectedIds.length}
              selectedLabel={bulkDictionary.selected}
              selectAllLabel={bulkDictionary.selectAll}
              selectionLimitLabel={bulkDictionary.selectionLimit}
              someSelected={selection.someSelected}
              visibleCount={visiblePageIds.length}
              actions={
                trashMode ? (
                  <Button
                    disabled={mutationBusy}
                    onClick={() =>
                      void performPagesBulk({
                        action: "restore",
                        ids: [...selection.selectedIds],
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {dictionary.restore}
                  </Button>
                ) : (
                  <>
                    <label className="sr-only" htmlFor="pages-bulk-folder">
                      {bulkDictionary.moveFolder}
                    </label>
                    <div className="relative">
                      <select
                        className="border-input bg-background text-foreground h-8 max-w-44 appearance-none rounded-lg border py-1 pr-7 pl-2 text-xs"
                        disabled={mutationBusy}
                        id="pages-bulk-folder"
                        value={bulkFolderId}
                        onChange={(event) =>
                          setBulkFolderId(event.target.value)
                        }
                      >
                        <option value="">{dictionary.selectFolder}</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folderPath(folder.id, folders) || folder.name}
                          </option>
                        ))}
                      </select>
                      <SelectChevron />
                    </div>
                    <Button
                      disabled={!bulkFolderId || mutationBusy}
                      onClick={moveSelectedPages}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {bulkDictionary.moveFolder}
                    </Button>
                  </>
                )
              }
              destructiveActions={
                trashMode ? (
                  <Button
                    disabled={mutationBusy}
                    onClick={() =>
                      setPendingConfirmation({
                        kind: "permanent-pages",
                        ids: [...selection.selectedIds],
                      })
                    }
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    {dictionary.permanentlyDelete}
                  </Button>
                ) : (
                  <Button
                    disabled={mutationBusy}
                    onClick={() =>
                      setPendingConfirmation({
                        kind: "trash-pages",
                        ids: [...selection.selectedIds],
                      })
                    }
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    {bulkDictionary.moveToTrash}
                  </Button>
                )
              }
            />
          ) : null}

          {/*
            `ListViewport` é compartilhado (outros módulos mantêm a rolagem interna): só Pages
            sobrescreve abaixo de `sm`, onde a lista flui com as linhas e a seção rola. De `sm`
            em diante devolve o comportamento da base (`flex-1`, `overflow-y-auto`,
            `overscroll-contain`); abaixo de `sm` o `overscroll-auto` evita reter o gesto de rolagem
            num contêiner que não rola.
          */}
          <ListViewport
            className="flex-none overflow-y-visible overscroll-auto sm:flex-1 sm:overflow-y-auto sm:overscroll-contain"
            data-testid="pages-list-viewport"
          >
            {loading ? (
              <div
                className="text-muted-foreground py-12 text-center text-sm"
                role="status"
              >
                {dictionary.loading}
              </div>
            ) : visiblePages.length === 0 ? (
              <ListEmptyState>{dictionary.empty}</ListEmptyState>
            ) : trashMode ? (
              <div className="overflow-x-auto" role="table">
                {/*
                  Cabeçalho e linhas com as mesmas trilhas, gaps e recuo (`px-1`): cada grid é
                  independente, e trilha `auto` no botão fazia "Deleted" cair em cima do
                  permanently-delete. Oculto abaixo de `sm`: lá a linha tem dois níveis e não
                  existem colunas a rotular; a ordenação por nome fica no botão da barra da lista.
                */}
                <div
                  className={cn(
                    "text-muted-foreground mb-2 hidden gap-2 px-1 text-sm sm:grid lg:gap-3",
                    ROW_TRACKS_SM,
                    TRASH_TRACKS_LG,
                    TRASH_TRACKS_2XL,
                  )}
                  role="row"
                >
                  <div role="columnheader" />
                  <div role="columnheader" />
                  <div
                    aria-sort={nameSortAriaValue(sortDir)}
                    role="columnheader"
                  >
                    <NameSortHeader
                      label={dictionary.pageColumn}
                      sortDir={sortDir}
                      onToggle={toggleSortDir}
                    />
                  </div>
                  <div className="hidden 2xl:block" role="columnheader">
                    {dictionary.author}
                  </div>
                  <div className="hidden 2xl:block" role="columnheader">
                    {dictionary.deletedBy}
                  </div>
                  <div className="hidden lg:block" role="columnheader">
                    {dictionary.deleted}
                  </div>
                  <div role="columnheader" />
                </div>
                <div className="divide-border divide-y" role="rowgroup">
                  {visiblePages.map((page) => (
                    /*
                      Linha da lixeira. Ordem do DOM = ordem de leitura e de foco, em todas as
                      larguras: checkbox → título → Restaurar → colunas extras → Excluir
                      permanentemente. A posição visual vem de colunas/linhas explícitas, nunca de
                      `order`:
                      - abaixo de `sm` (3 trilhas, dois níveis): nível 1 = checkbox (col 1) + título
                        (col 2-3); nível 2 = Restaurar à esquerda (col 2, sob o título) + Excluir
                        permanentemente sozinho à direita (col 3), a lei E/D da lista ativa;
                      - `sm` a `lg` (4 trilhas, uma faixa): checkbox | Restaurar | título | Excluir;
                      - `lg` a `2xl` (5 trilhas): checkbox | Restaurar | título | Excluída em | Excluir;
                      - `2xl` em diante (7 trilhas): + Autor e Excluída por entre o título e Excluída em.
                      De `sm` em diante todas as células fixam `row-1`, senão o auto-posicionamento
                      empurra Restaurar (col 2, depois do título no DOM) para outra linha.
                      ponytail: abaixo de ~340px de viewport o Restaurar encosta no Excluir
                      permanentemente (pt-BR); tratar se 320px virar alvo.
                    */
                    <div
                      className={cn(
                        "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-4 lg:gap-3",
                        ROW_TRACKS_SM,
                        TRASH_TRACKS_LG,
                        TRASH_TRACKS_2XL,
                      )}
                      key={page.id}
                      role="row"
                    >
                      <div
                        className="col-1 row-1 flex items-center justify-center"
                        role="cell"
                      >
                        {canBulk ? (
                          <input
                            aria-label={`${bulkDictionary.selectItem}: ${page.title}`}
                            checked={selection.selectedIds.includes(page.id)}
                            className="accent-primary size-4"
                            disabled={
                              mutationBusy ||
                              (selection.atLimit &&
                                !selection.selectedIds.includes(page.id))
                            }
                            onChange={() => selection.toggle(page.id)}
                            type="checkbox"
                          />
                        ) : null}
                      </div>
                      <div
                        className="col-[2/span_2] row-1 min-w-0 sm:col-3"
                        data-testid="trash-row-title"
                        role="cell"
                      >
                        <span className="block truncate font-medium">
                          {page.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          /{page.slug}
                        </span>
                      </div>
                      {/* 32px de altura abaixo de `sm` (alvo de toque); de `sm` em diante o `sm` do Button. */}
                      <div
                        className="col-2 row-2 sm:row-1"
                        data-testid="trash-row-restore"
                        role="cell"
                      >
                        <Button
                          className="h-8 sm:h-7"
                          disabled={
                            mutationBusy || busyAction === `restore:${page.id}`
                          }
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void performPageAction(page.id, "restore")
                          }
                        >
                          {dictionary.restore}
                        </Button>
                      </div>
                      <div
                        className="text-muted-foreground hidden truncate text-sm 2xl:col-4 2xl:row-1 2xl:block"
                        role="cell"
                      >
                        {page.author?.name ?? "—"}
                      </div>
                      <div
                        className="text-muted-foreground hidden truncate text-sm 2xl:col-5 2xl:row-1 2xl:block"
                        role="cell"
                      >
                        {page.deletedBy?.name ?? "—"}
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm lg:col-4 lg:row-1 lg:block 2xl:col-6"
                        role="cell"
                      >
                        {formatPanelDate(
                          page.deletedAt ?? "",
                          formatSettings,
                          locale,
                        )}
                      </div>
                      {/* Destrutivo: sempre a última célula no DOM e à direita (lei E/D). */}
                      <div
                        className="col-3 row-2 flex justify-end sm:col-4 sm:row-1 lg:col-5 2xl:col-7"
                        data-testid="trash-row-delete"
                        role="cell"
                      >
                        {canBulk ? (
                          <Button
                            className="h-8 sm:h-7"
                            disabled={
                              mutationBusy ||
                              busyAction === `permanently-delete:${page.id}`
                            }
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              setPendingConfirmation({
                                kind: "permanent-page",
                                id: page.id,
                              })
                            }
                          >
                            {dictionary.permanentlyDelete}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto" role="table">
                {/*
                  Cabeçalhos alinhados ao Figma (sem “Status”/“Actions” textuais), com as mesmas
                  trilhas, gaps e recuo (`px-1`) das linhas. Oculto abaixo de `sm`: lá a linha tem
                  dois níveis e não existem colunas a rotular; a ordenação por nome fica no botão da
                  barra da lista. Autor e Pasta só de `2xl` em diante (orçamento de largura nas
                  constantes de trilhas); `role="table"` no contêiner dá ao `aria-sort` da coluna
                  Nome o pai exigido pelo ARIA.
                */}
                <div
                  className={cn(
                    "text-muted-foreground mb-1 hidden gap-2 px-1 text-sm sm:grid lg:gap-3",
                    ROW_TRACKS_SM,
                    ACTIVE_TRACKS_LG,
                    ACTIVE_TRACKS_2XL,
                  )}
                  role="row"
                >
                  <div role="columnheader" />
                  <div role="columnheader" />
                  <div
                    aria-sort={nameSortAriaValue(sortDir)}
                    role="columnheader"
                  >
                    <NameSortHeader
                      label={dictionary.pageColumn}
                      sortDir={sortDir}
                      onToggle={toggleSortDir}
                    />
                  </div>
                  <div className="hidden 2xl:block" role="columnheader">
                    {dictionary.author}
                  </div>
                  <div className="hidden 2xl:block" role="columnheader">
                    {dictionary.folderLabel}
                  </div>
                  <div className="hidden lg:block" role="columnheader">
                    {dictionary.created}
                  </div>
                  <div role="columnheader" />
                </div>
                <div className="divide-border divide-y" role="rowgroup">
                  {visiblePages.map((page) => {
                    const published = page.status === "PUBLISHED";
                    const switchLabelKey = statusSwitchLabelKey({
                      live: published,
                      hasPublishedRevision: Boolean(page.publishedRevisionId),
                    });
                    const rowToggling =
                      busyAction === `turn-on:${page.id}` ||
                      busyAction === `unpublish:${page.id}`;
                    /*
                      Linha da listagem. A ordem do DOM é a ordem de leitura e de foco, em todas as
                      larguras: checkbox → título (com copiar URL) → cluster de ações → colunas
                      extras → lixeira. A posição visual vem de colunas/linhas explícitas
                      (`col-N`/`row-N`), nunca de `order`, para o Tab acompanhar o que se lê:
                      - abaixo de `sm` (3 trilhas, dois níveis): nível 1 = checkbox (col 1) +
                        título (col 2-3); nível 2 = cluster não-destrutivo (col 2) + lixeira
                        sozinha à direita (col 3);
                      - `sm` a `lg` (4 trilhas, uma faixa): checkbox | cluster | título | lixeira;
                      - `lg` a `2xl` (5 trilhas): checkbox | cluster | título | Criado | lixeira;
                      - `2xl` em diante (7 trilhas): + Autor e Pasta entre o título e Criado.
                      Todas as células de `sm` em diante fixam `row-1` para o auto-posicionamento
                      não empurrar o cluster (col 2, depois do título no DOM) para outra linha.
                    */
                    return (
                      <div
                        className={cn(
                          "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-3.5 lg:gap-3",
                          ROW_TRACKS_SM,
                          ACTIVE_TRACKS_LG,
                          ACTIVE_TRACKS_2XL,
                          selection.selectedIds.includes(page.id) &&
                            "bg-primary/5",
                        )}
                        key={page.id}
                        role="row"
                      >
                        <div
                          className="col-1 row-1 flex items-center justify-center"
                          role="cell"
                        >
                          {canBulk ? (
                            <input
                              aria-label={`${bulkDictionary.selectItem}: ${page.title}`}
                              checked={selection.selectedIds.includes(page.id)}
                              className="accent-primary size-4"
                              disabled={
                                mutationBusy ||
                                (selection.atLimit &&
                                  !selection.selectedIds.includes(page.id))
                              }
                              onChange={() => selection.toggle(page.id)}
                              type="checkbox"
                            />
                          ) : null}
                        </div>
                        {/*
                          Título + copiar URL + caminho. Abaixo de `sm` o miolo é uma grade de duas
                          trilhas (título 1fr + botão auto) e o caminho cai numa linha própria,
                          ambos com reticências; de `sm` em diante volta à faixa única em flex.
                        */}
                        <div
                          className="col-[2/span_2] row-1 min-w-0 sm:col-3"
                          data-testid="page-row-title"
                          role="cell"
                        >
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 sm:flex">
                            <span className="min-w-0 truncate font-medium">
                              {page.title}
                            </span>
                            <button
                              aria-label={dictionary.copyUrl}
                              className="text-muted-foreground hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                              data-testid="page-copy-url"
                              type="button"
                              onClick={() =>
                                void navigator.clipboard.writeText(
                                  getListedPageAbsoluteUrl(
                                    publicOrigin,
                                    page.slug,
                                    page.id === homePageId,
                                  ),
                                )
                              }
                            >
                              <Copy className="size-3" />
                            </button>
                            <span className="text-muted-foreground col-span-2 min-w-0 truncate text-xs sm:col-auto">
                              {getListedPagePath(
                                page.slug,
                                page.id === homePageId,
                              )}
                            </span>
                          </div>
                        </div>

                        {/*
                          Cluster esquerdo (não-destrutivo): status, abrir,
                          duplicar → lápis → raio. Lixeira só na célula direita.
                          Depois do título no DOM (ordem de foco = ordem de leitura); fica na col 2
                          de `sm` em diante por posição explícita, no nível 2 abaixo de `sm`.
                          ponytail: o cluster não quebra (~208px); abaixo de ~340px de viewport ele
                          encosta na lixeira, tratar se 320px virar alvo.
                        */}
                        <div
                          className="col-2 row-2 flex min-w-0 flex-nowrap items-center gap-1 sm:row-1"
                          data-testid="page-row-actions"
                          role="cell"
                        >
                          {/*
                            Switch No ar / Fora do ar. Habilitado também para página nunca
                            publicada (ligar publica o rascunho). Ocupado só na própria
                            linha; as demais ficam inertes enquanto outra mutação roda.
                          */}
                          <StatusToggle
                            appearance="switch"
                            busy={rowToggling}
                            busyLabel={
                              busyAction === `turn-on:${page.id}`
                                ? dictionary.publishing.buttonPublishing
                                : dictionary.working
                            }
                            disabled={mutationBusy && !rowToggling}
                            draftLabel={dictionary.publishing[switchLabelKey]}
                            draftShortLabel={
                              dictionary.publishing.switchOffShort
                            }
                            published={published}
                            publishedLabel={dictionary.publishing.switchLive}
                            publishLabel={dictionary.publishing.switchTurnOn}
                            unpublishLabel={dictionary.publishing.switchTurnOff}
                            onToggle={() => toggleLive(page)}
                          />
                          {published ? (
                            <a
                              aria-label={dictionary.viewPublished}
                              className={iconBtn}
                              href={getPublishedPagePath(page.slug)}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          ) : (
                            <a
                              aria-label={dictionary.preview}
                              className={iconBtn}
                              href={`/p/${page.slug}`}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          )}
                          <button
                            aria-label={dictionary.duplicate}
                            className={iconBtn}
                            disabled={mutationBusy}
                            type="button"
                            onClick={() =>
                              void performPageAction(page.id, "duplicate")
                            }
                          >
                            <Copy className="size-4" />
                          </button>
                          <Link
                            aria-label={`${dictionary.edit}: ${page.title}`}
                            className={iconBtn}
                            href={`/admin/pages/${page.id}`}
                          >
                            <Pencil aria-hidden className="size-[18px]" />
                          </Link>
                          <PageQuickEditPopover
                            disabled={mutationBusy}
                            dictionary={dictionary}
                            folders={folders}
                            page={page}
                            onSave={(input) => saveQuickEdit(page.id, input)}
                          />
                        </div>
                        <div
                          className="text-muted-foreground hidden truncate text-sm 2xl:col-4 2xl:row-1 2xl:block"
                          role="cell"
                        >
                          {page.author?.name ?? "—"}
                        </div>
                        <div
                          className="text-muted-foreground hidden truncate text-sm 2xl:col-5 2xl:row-1 2xl:block"
                          role="cell"
                        >
                          {folderPath(page.folderId, folders) || "—"}
                        </div>
                        <div
                          className="text-muted-foreground hidden text-sm lg:col-4 lg:row-1 lg:block 2xl:col-6"
                          role="cell"
                        >
                          {formatPanelDate(
                            page.createdAt,
                            formatSettings,
                            locale,
                          )}
                        </div>
                        {/* Lixeira (única ação destrutiva da linha): sempre a última no DOM e à direita. */}
                        <div
                          className="col-3 row-2 flex justify-end gap-1 sm:col-4 sm:row-1 lg:col-5 2xl:col-7"
                          data-testid="page-row-trash"
                          role="cell"
                        >
                          <button
                            aria-label={dictionary.moveToTrash}
                            className={cn(
                              iconBtn,
                              "text-destructive hover:text-destructive",
                            )}
                            disabled={
                              mutationBusy || busyAction === `trash:${page.id}`
                            }
                            type="button"
                            onClick={() =>
                              setPendingConfirmation({
                                kind: "trash-page",
                                id: page.id,
                              })
                            }
                          >
                            <Trash2 className="size-[18px]" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </ListViewport>
        </div>
      </div>

      <ConfirmDialog
        busy={mutationBusy}
        busyLabel={dictionary.working}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={confirmCopy.confirmLabel}
        destructive
        description={confirmCopy.description}
        open={Boolean(pendingConfirmation)}
        title={confirmCopy.title}
        onConfirm={() => {
          if (!pendingConfirmation) return;
          if (pendingConfirmation.kind === "unpublish-page") {
            void performPageAction(pendingConfirmation.id, "unpublish");
            return;
          }
          if (pendingConfirmation.kind === "delete-folder") {
            void deleteFolder(
              pendingConfirmation.id,
              pendingConfirmation.reassignToFolderId,
            )
              .then(() => {
                setSelectedFolderId(null);
                setPendingConfirmation(null);
              })
              .catch(() => {
                setPendingConfirmation(null);
              });
            return;
          }
          if (pendingConfirmation.kind === "trash-pages") {
            void performPagesBulk({
              action: "trash",
              ids: pendingConfirmation.ids,
            });
            return;
          }
          if (pendingConfirmation.kind === "permanent-pages") {
            void performPagesBulk({
              action: "permanently-delete",
              ids: pendingConfirmation.ids,
              confirmed: true,
            });
            return;
          }
          void performPageAction(
            pendingConfirmation.id,
            pendingConfirmation.kind === "permanent-page"
              ? "permanently-delete"
              : "trash",
          );
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setPendingConfirmation(null);
        }}
      />

      <ConfirmDialog
        busy={mutationBusy}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={folderDictionary.delete}
        destructive
        description={folderDictionary.reassignHint}
        open={Boolean(folderDeleteDraft)}
        title={dictionary.confirmFolderDeleteTitle}
        onConfirm={() => {
          if (!folderDeleteDraft?.reassignToFolderId) return;
          void deleteFolder(
            folderDeleteDraft.id,
            folderDeleteDraft.reassignToFolderId,
          )
            .then(() => {
              setSelectedFolderId(null);
              setFolderDeleteDraft(null);
            })
            .catch(() => {
              setFolderDeleteDraft(null);
            });
        }}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) setFolderDeleteDraft(null);
        }}
      >
        {folderDeleteDraft ? (
          <label className="block space-y-1 text-sm">
            <span>{folderDictionary.reassignTo}</span>
            <div className="relative">
              <select
                className="border-input bg-background w-full appearance-none rounded-lg border py-2 pr-8 pl-3 text-sm"
                value={folderDeleteDraft.reassignToFolderId}
                onChange={(event) =>
                  setFolderDeleteDraft((current) =>
                    current
                      ? { ...current, reassignToFolderId: event.target.value }
                      : current,
                  )
                }
              >
                {folders
                  .filter((folder) => {
                    const subtree = collectFolderSubtreeIds(
                      folderDeleteDraft.id,
                      folders,
                    );
                    return !subtree.has(folder.id);
                  })
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
              </select>
              <SelectChevron />
            </div>
          </label>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
