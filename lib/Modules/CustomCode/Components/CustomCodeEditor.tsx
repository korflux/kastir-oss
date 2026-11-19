"use client";

/**
 * Editor de script (`/admin/custom-code/<id>`), no modelo do switch da fase 2: o switch
 * No ar / Fora do ar é o publicar; o botão principal diz se mexe no ar; o menu ⋯ guarda as
 * ações raras (Scripts não tem Pré-visualizar: script não tem página própria); o bloco Versões
 * compara na direção rascunho → versão. Mesmo comportamento do editor de Pages
 * (`PageEditorScreen`), com o cabeçalho compartilhado `EditorHeader`.
 *
 * Seções deste arquivo:
 *   1. Tipos e helpers puros (gatilho tipado, rascunho ↔ DTO, formatação de data).
 *   2. Estado do formulário, carga do script e "sujo" (`isDirty`).
 *   3. Salvar: `persistDraft` (núcleo) e `saveSnippet` (formulário → servidor, com erros).
 *   4. Ciclo de vida: ligar (`turnOnSnippet`), Salvar e publicar (`saveAndPublish`), tirar do ar
 *      (`takeOffline`) e excluir (`remove`).
 *   5. Versões: restaurar com Desfazer e campos da comparação (páginas do escopo por nome).
 *   6. Render: Details (formulário + bloco Versões), cabeçalho, área de código ou comparação.
 *
 * Regra que atravessa tudo (spec C1): nada vai ao ar além do que está no editor. Ligar o switch
 * com edição não salva SEMPRE salva antes de publicar, e a escolha entre publicar e reativar a
 * versão publicada é do servidor (recusa "sem alteração não publicada"), nunca de uma
 * comparação no navegador. Em comparação de versão, formulário, switch, botão e menu ficam
 * pausados (o hook de histórico só vira `selectedId` quando a versão carregou).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { DetailsPanel } from "@/components/Shared/DetailsPanel";
import { RequiredMark } from "@/components/Shared/RequiredMark";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { useDismissibleNotice } from "@/components/Shared/useDismissibleNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CustomCodeScopeSelector,
  fetchScopePagesByIds,
} from "@/lib/Modules/CustomCode/Components/CustomCodeScopeSelector";
import { CustomCodeTriggerFields } from "@/lib/Modules/CustomCode/Components/CustomCodeTriggerFields";
import type {
  CustomCodeCopy as WorkspaceCopy,
  PageDto,
  SnippetDto,
  TriggerConfig,
  TriggerType,
} from "@/lib/Modules/CustomCode/Components/CustomCodeTypes";
import { PageEditor } from "@/lib/Modules/Pages/Components/PageEditor";
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
import { scriptFieldChanges } from "@/lib/Modules/Revisions/Components/revisionFieldChanges";
import { useRevisionHistory } from "@/lib/Modules/Revisions/Components/useRevisionHistory";
import type { SnippetSnapshot } from "@/lib/Modules/Revisions/Types";
import { REVISION_RETENTION_DEFAULT } from "@/lib/Modules/Settings/revisionRetention";
import {
  formatPanelDateTime,
  type PanelFormatSettings,
} from "@/lib/Modules/Settings/format";
import { requestJson, type ApiError } from "@/lib/requestJson";
import type { PanelDictionary } from "@/lib/i18n/panel";

/* -------------------------------------------------------------------------- */
/* 1. Tipos e helpers puros                                                    */
/* -------------------------------------------------------------------------- */

/** Obtém a configuração tipada do gatilho por seletor. */
function selectorConfig(config: TriggerConfig | null) {
  return config && "selector" in config ? config : null;
}
/** Obtém a configuração tipada do gatilho de carregamento. */
function pageLoadConfig(config: TriggerConfig | null) {
  return config && "delaySeconds" in config ? config : null;
}
/** Obtém a configuração tipada do gatilho de scroll. */
function scrollConfig(config: TriggerConfig | null) {
  return config && "percentage" in config ? config : null;
}
/** Obtém a configuração tipada do gatilho de referência. */
function referrerConfig(config: TriggerConfig | null) {
  return config && "matches" in config ? config : null;
}

/** Formata timestamps da API sem quebrar o painel diante de valor inválido. */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Operação em andamento. O cabeçalho só distingue as que mudam rótulo (`EditorHeaderBusy`). */
type Busy =
  "saving" | "publishing" | "turningOn" | "turningOff" | "undoing" | "deleting";

/**
 * Rascunho do script no formato que o salvar grava (o corpo do PUT, sem `expectedUpdatedAt`).
 * É a fonte única do que "o editor tem agora": o salvar, o Desfazer e a comparação de campos
 * leem daqui, então os três nunca divergem sobre o que é um gatilho ou um escopo.
 */
type ScriptDraft = {
  name: string;
  location: SnippetDto["location"];
  content: string;
  priority: number | null;
  scopeType: SnippetDto["scopeType"];
  /** Só vale com escopo de páginas específicas; com todas as páginas vai vazio. */
  pageIds: string[];
  trigger: { triggerType: TriggerType; triggerConfig: TriggerConfig } | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
};

/** O rascunho que um script salvo representa (também usado para regravar no Desfazer). */
function draftOfSnippet(item: SnippetDto): ScriptDraft {
  return {
    name: item.name,
    location: item.location,
    content: item.content,
    priority: item.priority,
    scopeType: item.scopeType,
    pageIds:
      item.scopeType === "SPECIFIC_PAGES"
        ? (item.scopedPages?.map((scope) => scope.pageId) ?? [])
        : [],
    trigger:
      item.triggerType && item.triggerConfig
        ? { triggerType: item.triggerType, triggerConfig: item.triggerConfig }
        : null,
    maxDisplays: item.maxDisplays,
    displayResetDays: item.displayResetDays,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Componente                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tela do editor de script: dona do estado do formulário (um `useState` por campo, ver
 * `draftOfForm`) e das chamadas ao servidor (salvar, publicar, ativar, tirar do ar, restaurar).
 * Os componentes de apresentação (`EditorHeader`, `RevisionHistoryPanel`, `RevisionCompareBar`)
 * só recebem estado pronto e disparam callbacks.
 */
export function CustomCodeEditor({
  dictionary,
  revisions,
  snippetId,
  revisionRetentionLimit = REVISION_RETENTION_DEFAULT,
  formatSettings,
  locale = "en",
}: {
  dictionary: WorkspaceCopy;
  revisions: PanelDictionary["revisions"];
  snippetId: string;
  /** Quantas versões a retenção guarda (configuração do site), para o contador do histórico. */
  revisionRetentionLimit?: number;
  /** Fuso e formatos de data e hora do painel; sem eles valem os padrões do painel. */
  formatSettings?: PanelFormatSettings;
  locale?: string;
}) {
  const router = useRouter();
  const publishing = dictionary.publishing;
  const [snippet, setSnippet] = useState<SnippetDto | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState<SnippetDto["location"]>("HEADER");
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState("");
  const [scopeType, setScopeType] =
    useState<SnippetDto["scopeType"]>("ALL_PAGES");
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [triggerType, setTriggerType] = useState<TriggerType | "">("");
  const [selector, setSelector] = useState("");
  const [selectorEvent, setSelectorEvent] = useState<"click" | "submit">(
    "click",
  );
  const [delaySeconds, setDelaySeconds] = useState("");
  const [percentage, setPercentage] = useState("");
  const [referrerMatches, setReferrerMatches] = useState("");
  const [maxDisplays, setMaxDisplays] = useState("");
  const [displayResetDays, setDisplayResetDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy | null>(null);
  // Guarda síncrona contra clique duplo: o estado só atualiza no próximo render.
  const busyRef = useRef<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sucesso some sozinho (com Desfazer, em 10 s); erro fica fixo.
  const {
    notice,
    action: noticeAction,
    show: showNotice,
    clear: clearNotice,
  } = useDismissibleNotice();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  // Nome de cada página do escopo citada numa comparação: título achado, `null` quando a página
  // não existe mais (excluída ou na lixeira) e o próprio id quando a consulta falhou.
  // ponytail: cache só da sessão do editor, página renomeada em outra aba aparece com o nome
  // antigo até recarregar, resolver de novo a cada comparação se isso incomodar.
  const [pageNames, setPageNames] = useState<Record<string, string | null>>({});
  const history = useRevisionHistory<SnippetSnapshot>({
    enabled: Boolean(snippetId),
    expectedUpdatedAt: snippet?.updatedAt ?? null,
    fallbackError: revisions.error,
    listUrl: `/api/admin/custom-code/${snippetId}/revisions`,
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

  // Aplica o snapshot do server no form (compartilhado por load inicial, salvar, restaurar,
  // desfazer e retry).
  const applySnippet = useCallback((item: SnippetDto) => {
    setSnippet(item);
    setName(item.name);
    setLocation(item.location);
    setContent(item.content);
    setPriority(item.priority === null ? "" : String(item.priority));
    setScopeType(item.scopeType);
    setPageIds(item.scopedPages?.map((scope) => scope.pageId) ?? []);
    setTriggerType(item.triggerType ?? "");
    setSelector(selectorConfig(item.triggerConfig)?.selector ?? "");
    setSelectorEvent(selectorConfig(item.triggerConfig)?.event ?? "click");
    setDelaySeconds(
      String(pageLoadConfig(item.triggerConfig)?.delaySeconds ?? ""),
    );
    setPercentage(String(scrollConfig(item.triggerConfig)?.percentage ?? ""));
    setReferrerMatches(referrerConfig(item.triggerConfig)?.matches ?? "");
    setMaxDisplays(item.maxDisplays === null ? "" : String(item.maxDisplays));
    setDisplayResetDays(
      item.displayResetDays === null ? "" : String(item.displayResetDays),
    );
  }, []);

  /**
   * Única carga do snippet (GET `/api/admin/custom-code/<id>`): serve à montagem do editor e ao
   * "Tentar de novo" e reaplica o snapshot da API no form. `isCurrent` descarta a resposta de um
   * chamador que já não vale; o padrão (sempre vale) é o do retry, que só existe com a tela de erro
   * aberta, sem outra carga em voo.
   */
  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setLoading(true);
      setError(null);
      try {
        const snippetResult = await requestJson<{ snippet: SnippetDto }>(
          `/api/admin/custom-code/${snippetId}`,
        );
        if (!isCurrent()) return;
        applySnippet(snippetResult.snippet);
      } catch (loadError) {
        if (!isCurrent()) return;
        setError((loadError as ApiError).message || dictionary.error);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [applySnippet, dictionary.error, snippetId],
  );

  // Carga inicial. Strict Mode monta, desmonta e remonta o effect: a chamada fica num microtask
  // e só sai se o cleanup ainda não rodou, então a rede vê um único pedido, e `active` descarta
  // a resposta de uma montagem antiga pra não sobrescrever o form. A chamada fora do corpo
  // síncrono do effect também atende o eslint (sem setState síncrono no body do effect).
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load(() => active);
    });
    return () => {
      active = false;
    };
  }, [load]);

  // Nomes das páginas do escopo da versão em comparação e do escopo atual (um pedido por `ids`,
  // só dos ids ainda não resolvidos): a comparação mostra nome, não cuid.
  useEffect(() => {
    const version = history.version;
    if (!version) return;
    const missing = [...new Set([...pageIds, ...version.pageIds])].filter(
      (id) => !(id in pageNames),
    );
    if (!missing.length) return;
    let active = true;
    fetchScopePagesByIds(missing)
      .then((found) => ({ found, failed: false }))
      .catch(() => ({ found: {} as Record<string, PageDto>, failed: true }))
      .then(({ found, failed }) => {
        if (!active) return;
        setPageNames((current) => {
          const next = { ...current };
          for (const id of missing) {
            next[id] = found[id]?.title ?? (failed ? id : null);
          }
          return next;
        });
      });
    return () => {
      active = false;
    };
  }, [history.version, pageIds, pageNames]);

  // "Sujo": há edição na tela que ainda não está salva. Compara cada campo do formulário (texto)
  // com o script salvo, na mesma forma normalizada que `draftOfForm` envia ao servidor.
  const isDirty = snippet
    ? name !== snippet.name ||
      location !== snippet.location ||
      content !== snippet.content ||
      (priority.trim() ? Number(priority) : null) !== snippet.priority ||
      scopeType !== snippet.scopeType ||
      pageIds.join(",") !==
        (snippet.scopedPages?.map((scope) => scope.pageId) ?? []).join(",") ||
      (triggerType || null) !== (snippet.triggerType ?? null) ||
      selector !== (selectorConfig(snippet.triggerConfig)?.selector ?? "") ||
      selectorEvent !==
        (selectorConfig(snippet.triggerConfig)?.event ?? "click") ||
      delaySeconds !==
        String(pageLoadConfig(snippet.triggerConfig)?.delaySeconds ?? "") ||
      percentage !==
        String(scrollConfig(snippet.triggerConfig)?.percentage ?? "") ||
      referrerMatches !==
        (referrerConfig(snippet.triggerConfig)?.matches ?? "") ||
      maxDisplays !==
        (snippet.maxDisplays === null ? "" : String(snippet.maxDisplays)) ||
      displayResetDays !==
        (snippet.displayResetDays === null
          ? ""
          : String(snippet.displayResetDays))
    : false;
  // Estado derivado que alimenta o cabeçalho e a faixa do bloco Versões: `formValid` = só o nome
  // é obrigatório; `inspecting` = em comparação de versão (tudo pausado); `live` = no ar;
  // `headerState` = o que o cabeçalho mostra e habilita (decidido em `getEditorHeaderState`, não
  // aqui); `draftState` = situação do rascunho.
  const formValid = Boolean(name.trim());
  const inspecting = history.selectedId !== null;
  const live = snippet?.status === "PUBLISHED";
  const hasPublishedRevision = Boolean(snippet?.publishedRevisionId);
  const hasUnpublishedChanges = Boolean(snippet?.hasUnpublishedChanges);
  const headerState = getEditorHeaderState({
    hasResource: Boolean(snippet),
    hasPublishedRevision,
    live,
    hasUnpublishedChanges,
    isDirty,
    inspecting,
    formValid,
    canPreview: false,
  });
  const draftState = draftRowState({
    isDirty,
    live,
    hasPublishedRevision,
    hasUnpublishedChanges,
  });
  /** O cabeçalho só distingue as operações que mudam rótulo; as demais apenas travam. */
  const headerBusy: EditorHeaderBusy =
    busy === "undoing" || busy === "deleting" ? "other" : busy;

  /* ------------------------------------------------------------------------ */
  /* 3. Salvar                                                                 */
  /* ------------------------------------------------------------------------ */

  /** O que o formulário tem agora, no formato que o servidor grava. */
  const draftOfForm = (): ScriptDraft => {
    const trigger: ScriptDraft["trigger"] = triggerType
      ? {
          triggerType,
          triggerConfig:
            triggerType === "SELECTOR_EVENT"
              ? { selector, event: selectorEvent }
              : triggerType === "PAGE_LOAD"
                ? { delaySeconds: Number(delaySeconds) || 0 }
                : triggerType === "SCROLL"
                  ? { percentage: Number(percentage) || 0 }
                  : { matches: referrerMatches },
        }
      : null;
    return {
      name,
      location,
      content,
      priority: priority.trim() ? Number(priority) : null,
      scopeType,
      pageIds: scopeType === "SPECIFIC_PAGES" ? pageIds : [],
      trigger,
      maxDisplays: trigger && maxDisplays.trim() ? Number(maxDisplays) : null,
      displayResetDays:
        trigger && maxDisplays.trim() && displayResetDays.trim()
          ? Number(displayResetDays)
          : null,
    };
  };

  /**
   * Núcleo do salvar: grava `draft` com a versão otimista `expectedUpdatedAt` e devolve o DTO
   * salvo. Lança em caso de erro; quem chama decide como mostrar. Não toca na tela, por isso o
   * Desfazer reaproveita com os valores de antes.
   */
  const persistDraft = async (
    draft: ScriptDraft,
    expectedUpdatedAt: string | null | undefined,
  ): Promise<SnippetDto> => {
    const result = await requestJson<{ snippet: SnippetDto }>(
      `/api/admin/custom-code/${snippetId}`,
      {
        method: "PUT",
        body: JSON.stringify(attachExpectedUpdatedAt(draft, expectedUpdatedAt)),
      },
    );
    return result.snippet;
  };

  /** Mensagem de um erro de salvar: conflito de versão (outra sessão) ≠ erro genérico. */
  const describeSaveError = (saveError: ApiError): string =>
    isOptimisticSaveConflict(saveError.code, saveError.message)
      ? revisions.conflict
      : saveError.message || dictionary.error;

  /**
   * Grava o rascunho do formulário. Devolve o script salvo, ou null quando falhou (o erro já
   * está na tela e nada mais deve rodar depois). `notice` é o aviso de sucesso; o chamador que
   * ainda vai publicar não passa nenhum e mostra o dele.
   */
  const saveSnippet = async (
    options: { notice?: "noticeDraftSaved" | "noticeSavedNotPublished" } = {},
  ): Promise<SnippetDto | null> => {
    if (
      (triggerType === "SELECTOR_EVENT" && !selector.trim()) ||
      (triggerType === "SCROLL" &&
        !(Number(percentage) >= 1 && Number(percentage) <= 100))
    ) {
      setError(dictionary.triggerValidationError);
      return null;
    }
    setError(null);
    clearNotice();
    try {
      const saved = await persistDraft(draftOfForm(), snippet?.updatedAt);
      applySnippet(saved);
      if (options.notice) showNotice(publishing[options.notice]);
      return saved;
    } catch (saveError) {
      setError(describeSaveError(saveError as ApiError));
      return null;
    }
  };

  /** Salvar sem publicar (botão "Salvar" fora do ar, e "Salvar sem publicar" no menu). */
  const saveDraft = async () => {
    if (!beginBusy("saving")) return;
    try {
      await saveSnippet({
        notice: live ? "noticeSavedNotPublished" : "noticeDraftSaved",
      });
    } finally {
      endBusy();
    }
  };

  /* ------------------------------------------------------------------------ */
  /* 4. Ciclo de vida: ligar, publicar, tirar do ar, excluir                    */
  /* ------------------------------------------------------------------------ */

  /** Chama publicar, ativar ou despublicar e devolve o DTO atualizado (sem tocar o formulário). */
  const callLifecycle = async (
    action: "publish" | "activate" | "unpublish",
  ): Promise<SnippetDto> => {
    const result = await requestJson<{ snippet: SnippetDto }>(
      `/api/admin/custom-code/${snippetId}/${action}`,
      { method: "POST" },
    );
    return result.snippet;
  };

  /**
   * Liga o switch (F2): coloca no ar exatamente o conteúdo do editor. Com edição não salva salva
   * antes, nunca publica o que ficou para trás (C1); publica o rascunho salvo e, só quando o
   * servidor recusa por "sem alteração não publicada", volta a versão publicada ao ar
   * (`turnOn`). Falha no salvar não publica nada; falha ao publicar deixa o rascunho salvo e o
   * switch fora do ar, com a mensagem do servidor.
   */
  const turnOnSnippet = async () => {
    if (!formValid || !beginBusy("turningOn")) return;
    setError(null);
    clearNotice();
    try {
      const result = await turnOn<SnippetDto>({
        save: isDirty ? () => saveSnippet() : undefined,
        publish: () => callLifecycle("publish"),
        activate: () => callLifecycle("activate"),
      });
      if (!result) return;
      setSnippet(result.resource);
      showNotice(publishing[turnOnNoticeKey(result)]);
      if (result.outcome === "published") void history.reload();
    } catch (turnOnError) {
      setError((turnOnError as ApiError).message || dictionary.error);
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
    if (!snippet || !beginBusy("publishing")) return;
    setError(null);
    clearNotice();
    try {
      const didSave = isDirty;
      if (didSave) {
        const saved = await saveSnippet();
        if (!saved) return;
      }
      try {
        setSnippet(await callLifecycle("publish"));
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
    if (!snippet || !beginBusy("turningOff")) return;
    setError(null);
    clearNotice();
    try {
      setSnippet(await callLifecycle("unpublish"));
      showNotice(publishing.noticeTakenOffline);
    } catch (offlineError) {
      setError((offlineError as ApiError).message || dictionary.error);
    } finally {
      endBusy();
      setConfirmUnpublish(false);
    }
  };

  /** Clique no switch: ligar publica na hora; desligar tira o script do site, então pede confirmação. */
  const toggleLive = () => {
    if (live) setConfirmUnpublish(true);
    else void turnOnSnippet();
  };

  /** Botão principal: salva e publica (no ar) ou só salva (fora do ar). */
  const runPrimary = () => {
    if (live) void saveAndPublish();
    else void saveDraft();
  };

  /** Ação escolhida no menu ⋯ (Scripts só tem "Salvar sem publicar"). */
  const runMenuAction = (item: HeaderMenuItem) => {
    if (item === "saveWithoutPublishing") void saveDraft();
  };

  /** Envia o snippet para a lixeira e retorna à lista após sucesso. */
  const remove = async () => {
    if (!beginBusy("deleting")) return;
    try {
      await requestJson(`/api/admin/custom-code/${snippetId}`, {
        method: "DELETE",
      });
      router.push("/admin/custom-code");
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
      endBusy();
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
  const undoRestore = async (previous: SnippetDto, restored: SnippetDto) => {
    if (!beginBusy("undoing")) return;
    setError(null);
    try {
      const saved = await persistDraft(
        draftOfSnippet(previous),
        restored.updatedAt,
      );
      applySnippet(saved);
      showNotice(revisions.undone);
    } catch (undoError) {
      clearNotice();
      setError(describeSaveError(undoError as ApiError));
    } finally {
      endBusy();
    }
  };

  /**
   * Restaura a versão no rascunho (não publica). Guarda o DTO salvo de antes para o Desfazer e
   * mostra o aviso com a ação. Erro do servidor (conflito) fica no bloco Versões, onde o hook o
   * publica; nada muda no formulário.
   */
  const restoreVersion = async (target: RevisionHistoryItem) => {
    if (!snippet) return;
    const previous = snippet;
    const payload = await history.restore(target.id);
    const restored = payload?.snippet as SnippetDto | undefined;
    if (!restored) return;
    applySnippet(restored);
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

  /* ------------------------------------------------------------------------ */
  /* 6. Render                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div
        className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm"
        role="status"
      >
        {dictionary.loading}
      </div>
    );
  }

  if (!snippet) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-8"
        role="alert"
      >
        <p>{error ?? dictionary.error}</p>
        <Button variant="outline" onClick={() => void load()}>
          {dictionary.retry}
        </Button>
      </div>
    );
  }

  /** Campos fora do código que o restaurar troca: editor agora → versão em comparação. */
  const formDraft = draftOfForm();
  const fieldChanges = history.version
    ? scriptFieldChanges({
        copy: revisions,
        labels: dictionary,
        current: {
          name: formDraft.name,
          location: formDraft.location,
          priority: formDraft.priority,
          scopeType: formDraft.scopeType,
          pageIds: formDraft.pageIds,
          triggerType: formDraft.trigger?.triggerType ?? null,
          triggerConfig: formDraft.trigger?.triggerConfig ?? null,
          maxDisplays: formDraft.maxDisplays,
          displayResetDays: formDraft.displayResetDays,
        },
        version: history.version,
        // Página ainda sem resposta mostra reticências; a que não existe mais, o rótulo
        // legível (nunca o cuid cru).
        pageName: (id) =>
          id in pageNames ? (pageNames[id] ?? dictionary.pageUnavailable) : "…",
      })
    : [];

  /** Primeira linha do menu ⋯: quem e quando publicou a versão no ar (ou "Ainda não publicado"). */
  const publishedItem = history.items.find((item) => item.published);
  const versionInfo = fillRevisionCopy(
    publishing[headerState.menu.versionInfo],
    {
      date: publishedItem ? formatDateTime(publishedItem.createdAt) : "—",
      author: publishedItem?.authorName ?? "—",
    },
  );

  // Selects do Details: chevron próprio (appearance-none some a seta nativa).
  const selectClassName =
    "border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-2.5 text-sm outline-none focus-visible:ring-3";

  // Tamanho do código em bytes, mostrado no rodapé da área de código contra o limite de 2 MiB
  // (o sufixo do limite vem do dicionário e o número segue o idioma do painel).
  const contentBytes = new TextEncoder().encode(content).byteLength;

  // Coluna Details: Name/Injection/Priority + Scope + Trigger + Versões (mockup Scripts EDIT).
  const details = (
    <>
      <fieldset
        className="flex flex-col gap-2.5 border-0 p-0 disabled:pointer-events-none"
        disabled={inspecting}
      >
        <label className="block space-y-1 text-sm" htmlFor="snippet-name">
          <span className="flex items-center gap-0.5">
            {dictionary.name}
            <RequiredMark />
          </span>
          <Input
            className="h-9 rounded-lg"
            id="snippet-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clearNotice();
            }}
          />
        </label>

        <label className="block space-y-1 text-sm" htmlFor="snippet-location">
          <span className="flex items-center gap-0.5">
            {dictionary.location}
            <RequiredMark />
          </span>
          <div className="relative">
            <select
              className={selectClassName}
              id="snippet-location"
              value={location}
              onChange={(event) => {
                setLocation(event.target.value as SnippetDto["location"]);
                clearNotice();
              }}
            >
              <option value="HEADER">{dictionary.header}</option>
              <option value="BODY_START">{dictionary.bodyStart}</option>
              <option value="BODY_END">{dictionary.bodyEnd}</option>
            </select>
            <SelectChevron />
          </div>
        </label>

        <label className="block space-y-1 text-sm" htmlFor="snippet-priority">
          <span className="flex items-center gap-0.5">
            {dictionary.priority}
            <RequiredMark />
          </span>
          <Input
            className="h-9 w-full rounded-lg"
            id="snippet-priority"
            inputMode="numeric"
            min="0"
            type="number"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              clearNotice();
            }}
          />
        </label>

        <div className="border-border border-t pt-3">
          <fieldset className="space-y-2">
            <legend className="text-foreground mb-1 flex items-center gap-0.5 text-sm font-medium">
              {dictionary.scope}
              <RequiredMark />
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={scopeType === "ALL_PAGES"}
                name="scope"
                type="radio"
                value="ALL_PAGES"
                onChange={() => {
                  setScopeType("ALL_PAGES");
                  clearNotice();
                }}
              />
              {dictionary.allPages}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={scopeType === "SPECIFIC_PAGES"}
                name="scope"
                type="radio"
                value="SPECIFIC_PAGES"
                onChange={() => {
                  setScopeType("SPECIFIC_PAGES");
                  clearNotice();
                }}
              />
              {dictionary.specificPages}
            </label>
          </fieldset>
          {scopeType === "SPECIFIC_PAGES" ? (
            <div className="mt-2">
              <CustomCodeScopeSelector
                dictionary={dictionary}
                pageIds={pageIds}
                onChange={(ids) => {
                  setPageIds(ids);
                  clearNotice();
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="border-border space-y-2.5 border-t pt-3">
          <p className="text-foreground text-sm font-medium">
            {dictionary.trigger}
          </p>

          <CustomCodeTriggerFields
            dictionary={dictionary}
            snippetId={snippetId}
            selectClassName={selectClassName}
            triggerType={triggerType}
            selector={selector}
            selectorEvent={selectorEvent}
            delaySeconds={delaySeconds}
            percentage={percentage}
            referrerMatches={referrerMatches}
            maxDisplays={maxDisplays}
            displayResetDays={displayResetDays}
            onTriggerTypeChange={setTriggerType}
            onSelectorChange={setSelector}
            onSelectorEventChange={setSelectorEvent}
            onDelaySecondsChange={setDelaySeconds}
            onPercentageChange={setPercentage}
            onReferrerMatchesChange={setReferrerMatches}
            onMaxDisplaysChange={setMaxDisplays}
            onDisplayResetDaysChange={setDisplayResetDays}
            onDirty={clearNotice}
          />
        </div>
      </fieldset>

      <div
        className="border-border shrink-0 space-y-2 border-t pt-3"
        data-testid="script-revision-block"
      >
        <RevisionHistoryPanel
          busy={history.busy || busy !== null}
          conflict={history.conflict}
          copy={revisions}
          draftState={draftState}
          draftUpdatedAt={snippet.updatedAt}
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

      <dl className="text-muted-foreground border-border mt-auto space-y-1.5 border-t pt-4 text-xs">
        <div className="flex justify-between gap-2">
          <dt>{dictionary.created}:</dt>
          <dd className="text-foreground tabular-nums">
            {formatDate(snippet.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{dictionary.updated}:</dt>
          <dd className="text-foreground tabular-nums">
            {formatDate(snippet.updatedAt)}
          </dd>
        </div>
      </dl>
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
    // Layout Figma Scripts EDIT: header + DetailsPanel (meta) + editor de conteúdo. Abaixo de lg
    // a seção inteira rola (uma rolagem natural, ver `DetailsPanel flowOnMobile`); de lg em
    // diante ocupa a altura e só as colunas rolam.
    <section className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 md:px-8 md:py-5 lg:overflow-hidden xl:px-10">
      {/* Cabeçalho: ← Voltar, depois o cabeçalho compartilhado (título, switch, salvar, ⋯). */}
      <div className="flex shrink-0 flex-col gap-2">
        <Link
          className="text-muted-foreground w-fit text-xs hover:underline"
          href="/admin/custom-code"
        >
          ← {dictionary.back}
        </Link>

        <EditorHeader
          busy={headerBusy}
          copy={publishing}
          state={headerState}
          title={name || dictionary.newSnippet}
          trailing={
            <Button
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={busy !== null}
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              {dictionary.moveToTrash}
            </Button>
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
                  draftFingerprint={snippet.draftFingerprint ?? ""}
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
            {contentBytes.toLocaleString(locale)} {dictionary.contentLimit}
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
        busy={busy === "deleting"}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.moveToTrash}
        destructive
        description={dictionary.confirmTrashDescription}
        open={confirmDelete}
        title={dictionary.confirmTrashTitle}
        onConfirm={() => void remove()}
        onOpenChange={(open) => {
          if (!open && busy !== "deleting") setConfirmDelete(false);
        }}
      />
    </section>
  );
}
