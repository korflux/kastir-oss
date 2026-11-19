"use client";

/**
 * Editor de página (`/admin/pages/<id>` e `/admin/pages/new`), no modelo do switch da fase 2:
 * o switch No ar / Fora do ar é o publicar; o botão principal diz se mexe no ar; o menu ⋯
 * guarda as ações raras; o bloco Versões compara na direção rascunho → versão.
 *
 * Seções deste arquivo:
 *   1. Tipos e helpers puros (`EditorPage`, pasta por caminho, mescla do DTO).
 *   2. Estado do formulário, carga da página e "sujo" (`isDirty`).
 *   3. Salvar: `persistDraft` (núcleo) e `savePage` (formulário → servidor, com erros e avisos).
 *   4. Ciclo de vida: ligar (`turnOnPage`), Salvar e publicar (`saveAndPublish`), tirar do ar
 *      (`takeOffline`), Pré-visualizar (`openPreview`) e excluir (`trashPage`).
 *   5. Versões: restaurar com Desfazer (`restoreVersion`, `undoRestore`) e campos da comparação.
 *   6. Render: Details (formulário + bloco Versões), cabeçalho, área de código ou comparação.
 *
 * Regra que atravessa tudo (spec C1): nada vai ao ar além do que está no editor. Por isso ligar
 * o switch com edição não salva SEMPRE salva antes de publicar, e a escolha entre publicar e
 * reativar a versão publicada é do servidor (recusa "sem alteração não publicada"), nunca de
 * uma comparação feita no navegador. Em comparação de versão, formulário, switch, botão e menu
 * ficam pausados (o hook de histórico só vira `selectedId` quando a versão carregou).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder as FolderIcon, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { DetailsPanel } from "@/components/Shared/DetailsPanel";
import { RequiredMark } from "@/components/Shared/RequiredMark";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { SlugField } from "@/components/Shared/SlugField";
import { useDismissibleNotice } from "@/components/Shared/useDismissibleNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SeoDot,
  SeoFields,
  type SeoValues,
} from "@/lib/Modules/Pages/Components/SeoFields";
import { PageEditor } from "@/lib/Modules/Pages/Components/PageEditor";
import { normalizeSlug } from "@/lib/Modules/Pages/slug";
import {
  EditorFeedback,
  EditorHeader,
  type EditorHeaderBusy,
} from "@/lib/Modules/Revisions/Components/EditorHeader";
import { RevisionCompareBar } from "@/lib/Modules/Revisions/Components/RevisionCompareBar";
import { RevisionDiffPane } from "@/lib/Modules/Revisions/Components/RevisionDiffPane";
import {
  fillRevisionCopy,
  RevisionHistoryPanel,
  revisionShortId,
  type RevisionHistoryItem,
} from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import {
  attachExpectedUpdatedAt,
  draftRowState,
  getEditorHeaderState,
  isNothingToPublishRefusal,
  isOptimisticSaveConflict,
  turnOn,
  turnOnNoticeKey,
  type HeaderMenuItem,
} from "@/lib/Modules/Revisions/Components/revisionEditorState";
import { pageFieldChanges } from "@/lib/Modules/Revisions/Components/revisionFieldChanges";
import { useRevisionHistory } from "@/lib/Modules/Revisions/Components/useRevisionHistory";
import type { PageSnapshot } from "@/lib/Modules/Revisions/Types";
import { REVISION_RETENTION_DEFAULT } from "@/lib/Modules/Settings/revisionRetention";
import {
  formatPanelDateTime,
  type PanelFormatSettings,
} from "@/lib/Modules/Settings/format";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { requestJson, type ApiError } from "@/lib/requestJson";

/* -------------------------------------------------------------------------- */
/* 1. Tipos e helpers puros                                                    */
/* -------------------------------------------------------------------------- */

/** Página como o editor a usa: rascunho salvo + estado de publicação calculado pelo servidor. */
type EditorPage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
  status: "DRAFT" | "PUBLISHED";
  folderId: string;
  publishedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  publishedRevisionId?: string | null;
  hasUnpublishedChanges?: boolean;
  draftFingerprint?: string;
  author?: { id: string; name: string } | null;
};

/** Pasta como a API de páginas a devolve; alimenta o seletor de pasta e o caminho legível. */
type FolderDto = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  isBase: boolean;
};

/** Campos que o salvar grava (o corpo do POST/PUT, sem o `expectedUpdatedAt`). */
type DraftValues = {
  title: string;
  slug: string;
  content: string;
  folderId: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
};

/** Operação em andamento. O cabeçalho só distingue as que mudam rótulo (ver `EditorHeaderBusy`). */
type Busy =
  | "saving"
  | "publishing"
  | "turningOn"
  | "turningOff"
  | "previewing"
  | "undoing";

/** Texto vazio vira `null`: o servidor guarda SEO opcional assim. */
function emptyToNull(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

/** Caminho legível da pasta ("Base / Campanhas / 2026"), usado no seletor e na comparação. */
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

/** Os campos de uma página que o salvar grava (também usado para regravar no Desfazer). */
function draftValuesOf(page: EditorPage): DraftValues {
  return {
    title: page.title,
    slug: page.slug,
    content: page.content,
    folderId: page.folderId,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    seoKeyword: page.seoKeyword,
  };
}

/** create/update/publicar não devolvem `author`: preserva o do GET. */
function mergeEditorPage(
  next: EditorPage,
  previous: EditorPage | null,
): EditorPage {
  return {
    ...next,
    author: next.author ?? previous?.author ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Componente                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tela do editor de página: dono do estado do formulário e das chamadas ao servidor (salvar,
 * publicar, ativar, tirar do ar, restaurar). Os componentes de apresentação (`EditorHeader`,
 * `RevisionHistoryPanel`, `RevisionCompareBar`) só recebem estado pronto e disparam callbacks.
 * `pageId === "new"` é o modo de criação: o item só existe no servidor depois do primeiro salvar.
 */
export function PageEditorScreen({
  pageId,
  initialFolderId,
  dictionary,
  revisions,
  revisionRetentionLimit = REVISION_RETENTION_DEFAULT,
  formatSettings,
  locale = "en",
}: {
  pageId: string;
  initialFolderId?: string;
  dictionary: PanelDictionary["pages"];
  revisions: PanelDictionary["revisions"];
  /** Quantas versões a retenção guarda (configuração do site), para o contador do histórico. */
  revisionRetentionLimit?: number;
  /** Fuso e formatos de data e hora do painel; sem eles valem os padrões do painel. */
  formatSettings?: PanelFormatSettings;
  locale?: string;
}) {
  const router = useRouter();
  const publishing = dictionary.publishing;
  const isNew = pageId === "new";
  const [page, setPage] = useState<EditorPage | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState(initialFolderId ?? "");
  const [seo, setSeo] = useState<SeoValues>({
    seoTitle: "",
    seoDescription: "",
    seoKeyword: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy | null>(null);
  // Guarda síncrona contra clique duplo: o estado só atualiza no próximo render.
  const busyRef = useRef<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | undefined>();
  // Sucesso some sozinho (com Desfazer, em 10 s); erro fica fixo (SC#8 fase 32).
  const {
    notice,
    action: noticeAction,
    show: showNotice,
    clear: clearNotice,
  } = useDismissibleNotice();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const history = useRevisionHistory<PageSnapshot>({
    enabled: Boolean(page?.id),
    expectedUpdatedAt: page?.updatedAt ?? null,
    fallbackError: revisions.error,
    listUrl: page?.id ? `/api/admin/pages/${page.id}/revisions` : null,
  });

  /** Data e hora no fuso e formato configurados no painel (mesma regra das listagens). */
  const formatDateTime = useCallback(
    (value: string) => formatPanelDateTime(value, formatSettings, locale),
    [formatSettings, locale],
  );

  /** Reserva a operação; false quando outra já roda (o clique duplicado não faz nada). */
  const beginBusy = (kind: Busy) => {
    if (busyRef.current) return false;
    busyRef.current = kind;
    setBusy(kind);
    return true;
  };
  /**
   * Libera a reserva feita por `beginBusy`. Todo fluxo que reservou chama aqui num `finally`, para
   * o editor nunca ficar travado depois de um erro; zera o ref junto do estado porque o ref é o
   * que a guarda síncrona consulta antes do próximo render.
   */
  const endBusy = () => {
    busyRef.current = null;
    setBusy(null);
  };

  // Carga inicial: pastas (sempre) e, fora do `/new`, a página. `active` descarta a resposta de
  // uma carga antiga quando o id muda ou o Strict Mode remonta o efeito, para não sobrescrever o
  // formulário com dados velhos. Em `/new` só escolhe a pasta base e semeia o modelo de conteúdo.
  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const collection = await requestJson<{ folders: FolderDto[] }>(
          "/api/admin/pages",
        );
        if (!active) return;
        setFolders(collection.folders);

        if (isNew) {
          setFolderId(
            initialFolderId ??
              collection.folders.find((folder) => folder.isBase)?.id ??
              "",
          );
          setContent((current) =>
            current === "" ? dictionary.newPageTemplate : current,
          );
          return;
        }

        const result = await requestJson<{ page: EditorPage }>(
          `/api/admin/pages/${pageId}`,
        );
        if (!active) return;
        setPage(result.page);
        setTitle(result.page.title);
        setSlug(result.page.slug);
        setContent(result.page.content);
        setFolderId(result.page.folderId);
        setSeo({
          seoTitle: result.page.seoTitle ?? "",
          seoDescription: result.page.seoDescription ?? "",
          seoKeyword: result.page.seoKeyword ?? "",
        });
      } catch (loadError) {
        if (active)
          setError((loadError as ApiError).message || dictionary.error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [
    dictionary.error,
    dictionary.newPageTemplate,
    initialFolderId,
    isNew,
    pageId,
  ]);

  // Limite do conteúdo (2 MiB, igual a `MAX_PAGE_CONTENT_BYTES` do servidor) e pré-condição do
  // salvar: o formulário só grava com nome, pasta e conteúdo dentro do limite.
  const contentBytes = useMemo(
    () => new TextEncoder().encode(content).byteLength,
    [content],
  );
  const contentTooLarge = contentBytes > 2 * 1024 * 1024;
  const canSave = Boolean(title.trim() && folderId && !contentTooLarge);

  /** Há edição na tela que ainda não está salva (comparação com o rascunho salvo). */
  const isDirty = useMemo(() => {
    if (!page) {
      return Boolean(
        title ||
        slug ||
        content ||
        seo.seoTitle ||
        seo.seoDescription ||
        seo.seoKeyword,
      );
    }
    return (
      title !== page.title ||
      slug !== page.slug ||
      content !== page.content ||
      folderId !== page.folderId ||
      emptyToNull(seo.seoTitle) !== page.seoTitle ||
      emptyToNull(seo.seoDescription) !== page.seoDescription ||
      emptyToNull(seo.seoKeyword) !== page.seoKeyword
    );
  }, [
    content,
    folderId,
    page,
    seo.seoDescription,
    seo.seoKeyword,
    seo.seoTitle,
    slug,
    title,
  ]);

  // Estado derivado que alimenta o cabeçalho e a faixa do bloco Versões: `inspecting` = em
  // comparação de versão (tudo pausado); `live` = no ar; `headerState` = o que o cabeçalho mostra
  // e habilita (decidido em `getEditorHeaderState`, não aqui); `draftState` = situação do rascunho.
  const inspecting = history.selectedId !== null;
  const live = page?.status === "PUBLISHED";
  const hasPublishedRevision = Boolean(page?.publishedRevisionId);
  const hasUnpublishedChanges = Boolean(page?.hasUnpublishedChanges);
  const headerState = getEditorHeaderState({
    hasResource: Boolean(page),
    hasPublishedRevision,
    live,
    hasUnpublishedChanges,
    isDirty,
    inspecting,
    formValid: canSave,
    canPreview: true,
  });
  const draftState = draftRowState({
    isDirty,
    live,
    hasPublishedRevision,
    hasUnpublishedChanges,
  });
  /** O cabeçalho só distingue as operações que mudam rótulo; as demais apenas travam. */
  const headerBusy: EditorHeaderBusy = trashing
    ? "other"
    : busy === "previewing" || busy === "undoing"
      ? "other"
      : busy;

  /* ------------------------------------------------------------------------ */
  /* 3. Salvar                                                                 */
  /* ------------------------------------------------------------------------ */

  /** Valores do formulário, no formato que o servidor grava. */
  const formValues = (): DraftValues => ({
    title,
    slug,
    content,
    folderId,
    seoTitle: emptyToNull(seo.seoTitle),
    seoDescription: emptyToNull(seo.seoDescription),
    seoKeyword: emptyToNull(seo.seoKeyword),
  });

  /** Põe um DTO salvo no estado e nos campos do formulário (salvar, restaurar e desfazer). */
  const applyPage = (next: EditorPage) => {
    setPage(next);
    setTitle(next.title);
    setSlug(next.slug);
    setContent(next.content);
    setFolderId(next.folderId);
    setSeo({
      seoTitle: next.seoTitle ?? "",
      seoDescription: next.seoDescription ?? "",
      seoKeyword: next.seoKeyword ?? "",
    });
  };

  /**
   * Núcleo do salvar: grava `values` (cria em `/new`, atualiza nos demais) com a versão otimista
   * `expectedUpdatedAt` e devolve o DTO salvo. Lança em caso de erro; quem chama decide como
   * mostrar. Não toca na tela, por isso o Desfazer reaproveita com os valores de antes.
   */
  const persistDraft = async (
    values: DraftValues,
    expectedUpdatedAt: string | null | undefined,
    previous: EditorPage | null,
  ): Promise<EditorPage> => {
    const result = await requestJson<{ page: EditorPage }>(
      isNew ? "/api/admin/pages" : `/api/admin/pages/${pageId}`,
      {
        method: isNew ? "POST" : "PUT",
        body: JSON.stringify(
          attachExpectedUpdatedAt(values, expectedUpdatedAt),
        ),
      },
    );
    return mergeEditorPage(result.page, previous);
  };

  /**
   * Mensagem de um erro de salvar. Conflito de versão (outra sessão) ≠ conflito de slug: o
   * primeiro vai para a faixa de erro, o segundo para o campo slug (`slug` preenchido).
   */
  const describeSaveError = (
    saveError: ApiError,
  ): { slug?: string; message?: string } => {
    if (isOptimisticSaveConflict(saveError.code, saveError.message)) {
      return { message: revisions.conflict };
    }
    if (saveError.code === "CONFLICT") return { slug: dictionary.slugConflict };
    if (saveError.code === "VALIDATION_ERROR" && contentTooLarge) {
      return { message: dictionary.contentTooLarge };
    }
    return { message: saveError.message || dictionary.error };
  };

  /**
   * Grava o rascunho do formulário. Devolve a página salva, ou null quando falhou (o erro já
   * está na tela e nada mais deve rodar depois). `notice` é o aviso de sucesso; o chamador que
   * ainda vai publicar passa nenhum e mostra o dele. Em `/new`, `navigate` leva para a página
   * criada; fica falso quando um passo seguinte (publicar) ainda precisa rodar antes.
   */
  const savePage = async (
    options: {
      notice?: "noticeDraftSaved" | "noticeSavedNotPublished";
      navigate?: boolean;
    } = {},
  ): Promise<EditorPage | null> => {
    if (!canSave) {
      setError(
        contentTooLarge ? dictionary.contentTooLarge : dictionary.invalidForm,
      );
      return null;
    }

    setError(null);
    setSlugError(undefined);
    clearNotice();
    try {
      const saved = await persistDraft(
        formValues(),
        isNew ? null : page?.updatedAt,
        page,
      );
      applyPage(saved);
      if (options.notice) showNotice(publishing[options.notice]);
      if (isNew && options.navigate) router.replace(`/admin/pages/${saved.id}`);
      return saved;
    } catch (saveError) {
      const described = describeSaveError(saveError as ApiError);
      if (described.slug) setSlugError(described.slug);
      else setError(described.message ?? dictionary.error);
      return null;
    }
  };

  /** Salvar sem publicar (botão "Salvar"/"Criar" fora do ar, e "Salvar sem publicar" no menu). */
  const saveDraft = async () => {
    if (!beginBusy("saving")) return;
    try {
      await savePage({
        notice: live ? "noticeSavedNotPublished" : "noticeDraftSaved",
        navigate: true,
      });
    } finally {
      endBusy();
    }
  };

  /* ------------------------------------------------------------------------ */
  /* 4. Ciclo de vida: ligar, publicar, tirar do ar, pré-visualizar, excluir    */
  /* ------------------------------------------------------------------------ */

  /** Chama publicar, ativar ou despublicar e devolve o DTO atualizado (sem tocar o formulário). */
  const callLifecycle = async (
    pageIdToCall: string,
    action: "publish" | "activate" | "unpublish",
    previous: EditorPage | null,
  ): Promise<EditorPage> => {
    const result = await requestJson<{ page: EditorPage }>(
      `/api/admin/pages/${pageIdToCall}/${action}`,
      { method: "POST" },
    );
    return mergeEditorPage(result.page, previous);
  };

  /**
   * Liga o switch (F2): coloca no ar exatamente o conteúdo do editor. Com edição não salva (ou
   * item novo) salva antes, nunca publica o que ficou para trás (C1); publica o rascunho salvo e,
   * só quando o servidor recusa por "sem alteração não publicada", volta a versão publicada ao
   * ar (`turnOn`). Falha no salvar não publica nada; falha ao publicar deixa o rascunho salvo e
   * o switch fora do ar, com a mensagem do servidor. Item novo vai para a página criada ao
   * final, ou logo após o erro se o item já tinha sido criado (evita duplicar ao tentar de novo).
   */
  const turnOnPage = async () => {
    if (!canSave || !beginBusy("turningOn")) return;
    setError(null);
    clearNotice();
    let createdId: string | null = null;
    try {
      const result = await turnOn<EditorPage>({
        save:
          isDirty || !page
            ? async () => {
                const saved = await savePage();
                if (saved) createdId = saved.id;
                return saved;
              }
            : undefined,
        publish: (saved) => {
          const target = saved ?? page!;
          return callLifecycle(target.id, "publish", target);
        },
        activate: (saved) => {
          const target = saved ?? page!;
          return callLifecycle(target.id, "activate", target);
        },
      });
      if (!result) return;
      setPage(result.resource);
      showNotice(publishing[turnOnNoticeKey(result)]);
      if (result.outcome === "published") void history.reload();
      if (isNew) router.replace(`/admin/pages/${result.resource.id}`);
    } catch (turnOnError) {
      setError((turnOnError as ApiError).message || dictionary.error);
      if (isNew && createdId) router.replace(`/admin/pages/${createdId}`);
    } finally {
      endBusy();
    }
  };

  /**
   * "Salvar e publicar" com o item no ar (F3): salva a edição, se houver, e publica o rascunho.
   * Se o salvar deixa o rascunho igual ao que já está no ar, o servidor recusa publicar ("sem
   * alteração"); é sucesso benigno, pois o ar já é igual ao editor. Como nada foi publicado, o
   * aviso é `noticeSavedAlreadyLive` ("o ar já está com esta versão"), nunca "Salvo e publicado".
   */
  const saveAndPublish = async () => {
    if (!page || !beginBusy("publishing")) return;
    setError(null);
    clearNotice();
    try {
      const didSave = isDirty;
      let current: EditorPage = page;
      if (didSave) {
        const saved = await savePage();
        if (!saved) return;
        current = saved;
      }
      try {
        setPage(await callLifecycle(current.id, "publish", current));
        void history.reload();
        showNotice(
          publishing[didSave ? "noticeSavedAndPublished" : "noticePublished"],
        );
      } catch (publishError) {
        const typed = publishError as ApiError;
        if (isNothingToPublishRefusal(typed.code, typed.message)) {
          if (didSave) showNotice(publishing.noticeSavedAlreadyLive);
          else setError(publishing.reasonNothingToPublish);
        } else {
          setError(typed.message || dictionary.error);
        }
      }
    } finally {
      endBusy();
    }
  };

  /**
   * Tira do ar (F4), depois da confirmação. O rascunho, as versões e a edição não salva
   * continuam no editor (só o DTO muda). Falha: o item continua no ar e a faixa mostra o erro.
   */
  const takeOffline = async () => {
    if (!page || !beginBusy("turningOff")) return;
    setError(null);
    clearNotice();
    try {
      setPage(await callLifecycle(page.id, "unpublish", page));
      showNotice(publishing.noticeTakenOffline);
    } catch (offlineError) {
      setError((offlineError as ApiError).message || dictionary.error);
    } finally {
      endBusy();
      setConfirmUnpublish(false);
    }
  };

  /** Clique no switch: ligar publica na hora; desligar tira a URL do ar, então pede confirmação. */
  const toggleLive = () => {
    if (live) setConfirmUnpublish(true);
    else void turnOnPage();
  };

  /** Botão principal: cria (item novo), salva e publica (no ar) ou só salva (fora do ar). */
  const runPrimary = () => {
    if (live) void saveAndPublish();
    else void saveDraft();
  };

  /**
   * Pré-visualizar (F5): grava o rascunho sem publicar, se houver edição, e abre `/p/<slug>`
   * (rota autenticada existente) numa aba nova. A aba abre JÁ, dentro do gesto do clique, porque
   * depois do salvar o navegador a trataria como popup bloqueável; `opener = null` corta o
   * vínculo antes de o HTML do rascunho carregar. Falha ao salvar fecha a aba e não abre nada.
   * ponytail: se o navegador bloquear a aba em branco, cai em `window.open` após o salvar e pode
   * ser bloqueado; trocar por uma rota de preview que não dependa do gesto se isso aparecer.
   */
  const openPreview = async () => {
    if (!page || !beginBusy("previewing")) return;
    setError(null);
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      let previewSlug = page.slug;
      if (isDirty) {
        const saved = await savePage({
          notice: live ? "noticeSavedNotPublished" : "noticeDraftSaved",
        });
        if (!saved) {
          tab?.close();
          return;
        }
        previewSlug = saved.slug;
      }
      const url = `/p/${previewSlug}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      endBusy();
    }
  };

  /** Ação escolhida no menu ⋯ (só as listadas pelo estado do cabeçalho chegam aqui). */
  const runMenuAction = (item: HeaderMenuItem) => {
    if (item === "preview") void openPreview();
    else void saveDraft();
  };

  /** Move para a lixeira; salva a edição antes para não perder trabalho (comportamento atual). */
  const trashPage = async () => {
    if (!page) return;
    setTrashing(true);
    setError(null);
    try {
      if (isDirty) {
        const savedPage = await savePage();
        if (!savedPage) return;
      }
      await requestJson(`/api/admin/pages/${page.id}`, { method: "DELETE" });
      router.push("/admin/pages");
    } catch (trashError) {
      setError((trashError as ApiError).message || dictionary.error);
    } finally {
      setTrashing(false);
      setConfirmTrash(false);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* 5. Versões: restaurar com Desfazer e campos da comparação                  */
  /* ------------------------------------------------------------------------ */

  /**
   * Desfazer após restaurar (F7): regrava no rascunho o DTO salvo ANTES do restaurar, pelo salvar
   * normal, com o `updatedAt` que o restaurar devolveu (se outra sessão mexeu, o servidor
   * recusa e nada é sobrescrito). Não publica. Só vive enquanto o aviso estiver na tela.
   */
  const undoRestore = async (previous: EditorPage, restored: EditorPage) => {
    if (!beginBusy("undoing")) return;
    setError(null);
    try {
      const saved = await persistDraft(
        draftValuesOf(previous),
        restored.updatedAt,
        restored,
      );
      applyPage(saved);
      showNotice(revisions.undone);
    } catch (undoError) {
      const described = describeSaveError(undoError as ApiError);
      clearNotice();
      setError(described.slug ?? described.message ?? dictionary.error);
    } finally {
      endBusy();
    }
  };

  /**
   * Restaura a versão no rascunho (não publica). Guarda o DTO salvo de antes para o Desfazer e
   * mostra o aviso com a ação. Erro do servidor (conflito, pasta da versão excluída) fica no
   * bloco Versões, onde o hook o publica; nada muda no formulário.
   */
  const restoreVersion = async (target: RevisionHistoryItem) => {
    if (!page) return;
    const previous = page;
    const payload = await history.restore(target.id);
    const restoredDto = payload?.page as EditorPage | undefined;
    if (!restoredDto) return;
    const restored = mergeEditorPage(restoredDto, previous);
    applyPage(restored);
    showNotice(
      fillRevisionCopy(revisions.restored, {
        date: formatDateTime(target.createdAt),
      }),
      {
        action: {
          label: revisions.undo,
          onAction: () => void undoRestore(previous, restored),
        },
      },
    );
  };

  /** Campos fora do código que o restaurar troca: editor agora → versão em comparação. */
  const fieldChanges = useMemo(
    () =>
      history.version
        ? pageFieldChanges({
            copy: revisions,
            current: {
              title,
              slug,
              folderId,
              seoTitle: emptyToNull(seo.seoTitle),
              seoDescription: emptyToNull(seo.seoDescription),
              seoKeyword: emptyToNull(seo.seoKeyword),
            },
            version: history.version,
            folderLabel: (id) => folderPath(id, folders) || undefined,
          })
        : [],
    [
      folders,
      folderId,
      history.version,
      revisions,
      seo.seoDescription,
      seo.seoKeyword,
      seo.seoTitle,
      slug,
      title,
    ],
  );

  /* ------------------------------------------------------------------------ */
  /* 6. Render                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <section className="flex w-full flex-1 items-center justify-center px-4 py-12">
        <p className="text-muted-foreground text-sm" role="status">
          {dictionary.loading}
        </p>
      </section>
    );
  }

  if (error && !folders.length && !isNew) {
    return (
      <section className="flex w-full flex-1 items-center justify-center px-4 py-12">
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive max-w-xl rounded-lg border px-4 py-3 text-sm"
          role="alert"
        >
          {error}
        </div>
      </section>
    );
  }

  /** Primeira linha do menu ⋯: quem e quando publicou a versão no ar (ou "Ainda não publicada"). */
  const publishedItem = history.items.find((item) => item.published);
  const versionInfo = fillRevisionCopy(
    publishing[headerState.menu.versionInfo],
    {
      date: publishedItem
        ? formatDateTime(publishedItem.createdAt)
        : page?.publishedAt
          ? formatDateTime(page.publishedAt)
          : "—",
      author: publishedItem?.authorName ?? "—",
    },
  );

  /**
   * Coluna Details: formulário (nome, slug, pasta, SEO), bloco Versões e metadados. O formulário
   * inteiro fica desabilitado em comparação (`inspecting`); toda edição limpa o aviso de resultado.
   */
  const details = (
    <>
      {/* Name* + bolinha no rótulo (branca até Fase 32). */}
      <label className="block space-y-1 text-sm" htmlFor="page-title">
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {dictionary.nameLabel}
            <RequiredMark />
          </span>
          <SeoDot />
        </span>
        <Input
          className="h-9 rounded-lg"
          disabled={inspecting}
          id="page-title"
          maxLength={200}
          required
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            clearNotice();
          }}
        />
      </label>

      <SlugField
        key={page?.id ?? "new"}
        autoValue={normalizeSlug(title)}
        disabled={inspecting}
        error={slugError}
        hideHint
        required
        value={slug}
        onChange={(value) => {
          setSlugError(undefined);
          setSlug(value);
          clearNotice();
        }}
      />

      {/* Folder com ícone + path (Figma). */}
      <label className="block space-y-1 text-sm" htmlFor="page-folder">
        <span className="sr-only">
          {dictionary.folderLabel}
          <RequiredMark />
        </span>
        <div className="relative">
          <FolderIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <select
            className="border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-8 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={inspecting}
            id="page-folder"
            required
            value={folderId}
            onChange={(event) => {
              setFolderId(event.target.value);
              clearNotice();
            }}
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
      </label>

      <SeoFields
        compact
        disabled={inspecting}
        labels={{
          legend: dictionary.seo,
          title: dictionary.seoTitle,
          description: dictionary.seoDescription,
          keyword: dictionary.seoKeyword,
        }}
        values={seo}
        onChange={(values) => {
          setSeo(values);
          clearNotice();
        }}
      />

      {page ? (
        <div
          className="border-border space-y-2 border-t pt-3"
          data-testid="page-revision-block"
        >
          <RevisionHistoryPanel
            busy={history.busy || busy !== null}
            conflict={history.conflict}
            copy={revisions}
            draftState={draftState}
            draftUpdatedAt={page.updatedAt ?? page.createdAt ?? ""}
            errorMessage={history.errorMessage}
            formatDateTime={formatDateTime}
            items={history.items}
            live={live}
            retentionLimit={revisionRetentionLimit}
            retryable={history.retryable}
            selectedId={history.selectedId}
            status={history.status}
            onPin={(id, pinned) => void history.pin(id, pinned)}
            onRetry={() => void history.retry(content)}
            onSelect={(id) => {
              if (id === null) history.closeView();
              else void history.select(id, content);
            }}
          />
        </div>
      ) : null}

      {page ? (
        <dl className="text-muted-foreground border-border mt-auto space-y-1.5 border-t pt-4 text-xs">
          {page.createdAt ? (
            <div className="flex justify-between gap-2">
              <dt>{dictionary.createdAtLabel}:</dt>
              <dd className="text-foreground tabular-nums">
                {new Date(page.createdAt).toLocaleDateString()}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <dt>{dictionary.publishedAtLabel}:</dt>
            <dd className="text-foreground tabular-nums">
              {page.publishedAt
                ? new Date(page.publishedAt).toLocaleDateString()
                : "—"}
            </dd>
          </div>
          {/* Author sempre no footer Details (Figma Pages EDIT). */}
          <div className="flex justify-between gap-2">
            <dt>{dictionary.author}:</dt>
            <dd className="text-foreground" data-testid="page-details-author">
              {page.author?.name ?? "—"}
            </dd>
          </div>
        </dl>
      ) : null}
    </>
  );

  /**
   * Em comparação o formulário inteiro fica pausado; a nota diz por quê. Vai no slot fixo do
   * DetailsPanel (fora da rolagem do Details) para continuar visível sem cobrir nenhum campo.
   */
  const pausedNote = inspecting ? (
    <p
      className="text-muted-foreground border-border bg-muted rounded-lg border px-2.5 py-2 text-xs"
      data-testid="editor-form-paused-note"
      role="note"
    >
      {revisions.formPausedNote}
    </p>
  ) : null;

  return (
    // Abaixo de lg a seção inteira rola (Details em faixa + conteúdo, uma rolagem natural, ver
    // `DetailsPanel flowOnMobile`); de lg em diante ocupa a altura e só as colunas rolam.
    <section className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 md:px-8 md:py-5 lg:overflow-hidden xl:px-10">
      {/* Cabeçalho: ← Voltar, depois o cabeçalho compartilhado (título, switch, salvar, ⋯). */}
      <div className="flex shrink-0 flex-col gap-2">
        <Link
          className="text-muted-foreground w-fit text-xs hover:underline"
          href="/admin/pages"
        >
          ← {dictionary.back}
        </Link>

        <EditorHeader
          busy={headerBusy}
          copy={publishing}
          state={headerState}
          title={isNew ? dictionary.create : title || dictionary.title}
          trailing={
            page && !isNew ? (
              <Button
                className="bg-destructive hover:bg-destructive/90 text-white"
                disabled={trashing || busy !== null}
                size="sm"
                type="button"
                variant="destructive"
                onClick={() => setConfirmTrash(true)}
              >
                <Trash2 className="size-3.5" />
                {dictionary.delete}
              </Button>
            ) : null
          }
          versionInfo={versionInfo}
          workingLabel={dictionary.working}
          onMenuAction={runMenuAction}
          onPrimary={runPrimary}
          onToggle={toggleLive}
        />
      </div>

      <EditorFeedback
        action={noticeAction}
        actionBusy={busy === "undoing"}
        actionBusyLabel={revisions.undoing}
        error={error}
        notice={notice}
      />

      <DetailsPanel
        detailsNotice={pausedNote}
        details={details}
        flowOnMobile
        wide
      >
        <div className="flex flex-col lg:h-full lg:min-h-0 lg:flex-1">
          {contentTooLarge ? (
            <div
              className="text-destructive border-border shrink-0 border-b px-4 py-2 text-xs"
              role="alert"
            >
              {dictionary.contentTooLarge}
            </div>
          ) : null}
          {inspecting ? (
            // Comparação: barra + diff. Abaixo de lg a coluna cresce com o conteúdo (barra, campos,
            // ações e diff de altura fixa) e a seção do editor rola; de lg em diante o diff ocupa o
            // que sobra da altura.
            <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
              {history.selected ? (
                <RevisionCompareBar
                  busy={history.busy}
                  copy={revisions}
                  dirty={isDirty}
                  draftFingerprint={page?.draftFingerprint ?? ""}
                  fieldChanges={fieldChanges}
                  formatDateTime={formatDateTime}
                  lines={history.diffLines}
                  live={live}
                  replacesUnpublished={draftState === "draftUnpublished"}
                  target={history.selected}
                  onBack={history.closeView}
                  onExpandAll={history.expandAll}
                  onRestore={() => restoreVersion(history.selected!)}
                />
              ) : null}
              <div className="h-96 shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
                <RevisionDiffPane
                  ariaLabel={revisions.versionCode}
                  emptyLabel={revisions.noDifference}
                  expandAllSignal={history.expandAllSignal}
                  foldedLabel={revisions.foldedLines}
                  footer={
                    history.selected
                      ? fillRevisionCopy(revisions.readOnlyFooter, {
                          code: revisionShortId(history.selected.fingerprint),
                          author: history.selected.authorName,
                        })
                      : undefined
                  }
                  lines={history.diffLines}
                />
              </div>
            </div>
          ) : (
            // Abaixo de lg o código tem altura própria (28rem, a mesma do PageEditor sem `fill`);
            // de lg em diante preenche a coluna.
            <div className="flex h-[28rem] shrink-0 flex-col lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
              <PageEditor
                ariaLabel={dictionary.content}
                fill
                mediaCancelLabel={dictionary.cancel}
                mediaCloseLabel={dictionary.close}
                mediaSelectLabel={dictionary.selectImage}
                mediaTitle={dictionary.chooseImage}
                placeholder={dictionary.contentPlaceholder}
                value={content}
                onChange={(value) => {
                  // O editor de código reemite onChange quando o conteúdo é trocado por fora
                  // (restaurar, desfazer): o valor já é o do estado e não é edição do usuário,
                  // então não pode apagar o aviso (que traz o Desfazer).
                  if (value === content) return;
                  setContent(value);
                  clearNotice();
                }}
              />
            </div>
          )}
          <div className="text-muted-foreground border-border shrink-0 border-t px-3 py-1.5 text-[11px]">
            {dictionary.contentBytes.replace("{count}", String(contentBytes))}
          </div>
        </div>
      </DetailsPanel>

      <ConfirmDialog
        busy={busy === "turningOff"}
        busyLabel={dictionary.working}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={publishing.unpublishConfirm}
        description={publishing.unpublishDescription}
        destructive
        open={confirmUnpublish}
        title={publishing.unpublishTitle}
        onConfirm={() => void takeOffline()}
        onOpenChange={(open) => {
          if (!open && busy !== "turningOff") setConfirmUnpublish(false);
        }}
      />

      <ConfirmDialog
        busy={trashing}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.moveToTrash}
        destructive
        description={dictionary.confirmTrashDescription}
        open={confirmTrash}
        title={dictionary.confirmTrashTitle}
        onConfirm={() => void trashPage()}
        onOpenChange={(open) => {
          if (!open && !trashing) setConfirmTrash(false);
        }}
      />
    </section>
  );
}
