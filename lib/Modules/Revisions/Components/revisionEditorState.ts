/**
 * Regras de estado do cabeçalho do editor de Pages e Scripts (fase 2: versões e publicação).
 *
 * Modelo: o switch No ar / Fora do ar é o "publicar"; o botão principal diz se mexe no ar
 * ("Salvar e publicar" com o item no ar, "Salvar" fora do ar, "Criar" em item novo) e o
 * menu ⋯ guarda as ações raras. Tudo aqui é puro (sem React, sem rede) e é a fonte única
 * consumida por PageEditorScreen, CustomCodeEditor e pelas listagens.
 *
 * Seções deste arquivo:
 *   1. Cabeçalho: `getEditorHeaderState` e `statusSwitchLabelKey`.
 *   2. Linha Rascunho do bloco Versões: `draftRowState`.
 *   3. Ligar o switch: `turnOn` (salvar, publicar, ativar só na recusa) e seus apoios.
 *   4. Salvar com versão otimista: `attachExpectedUpdatedAt`, `isOptimisticSaveConflict`.
 *
 * Convenção de chaves de texto: os campos `label`, `disabledReason`, `versionInfo` e
 * `turnOnNoticeKey` devolvem a CHAVE do dicionário (`PublishingCopy` ou
 * `PanelDictionary["revisions"]`), para o componente fazer `copy[state.x]` sem tabela de
 * tradução própria. O tipo garante que a chave existe nos dois idiomas.
 */

import type { PanelDictionary, PublishingCopy } from "@/lib/i18n/panel";

/* -------------------------------------------------------------------------- */
/* 1. Cabeçalho do editor                                                      */
/* -------------------------------------------------------------------------- */

/** Chave do rótulo do switch (No ar, Fora do ar, Fora do ar · nunca publicada). */
export type SwitchLabelKey = Extract<
  keyof PublishingCopy,
  "switchLive" | "switchOff" | "switchNeverPublished"
>;

/** Chave do rótulo do botão principal do cabeçalho. */
export type PrimaryLabelKey = Extract<
  keyof PublishingCopy,
  "buttonCreate" | "buttonSave" | "buttonSaveAndPublish"
>;

/** Motivo (chave de texto) de um controle do cabeçalho estar desabilitado. */
export type HeaderReasonKey = Extract<
  keyof PublishingCopy,
  | "reasonInspecting"
  | "reasonInvalidForm"
  | "reasonNothingToSave"
  | "reasonNothingToPublish"
  | "reasonNewItem"
>;

/** Linha de versão do menu ⋯: no ar, publicada porém fora do ar, ou nunca publicada. */
export type MenuVersionInfoKey = Extract<
  keyof PublishingCopy,
  "menuLiveVersion" | "menuStoredVersion" | "menuNeverPublished"
>;

/** Ação rara do menu ⋯. `preview` só existe para Pages. */
export type HeaderMenuItem = "saveWithoutPublishing" | "preview";

/** O que o componente sabe sobre o item e o formulário; tudo o mais é derivado. */
export type EditorStateInput = {
  /** false enquanto o item ainda não existe no servidor (`/admin/pages/new`). */
  hasResource: boolean;
  /** O item já foi publicado alguma vez (ponteiro da versão publicada). */
  hasPublishedRevision: boolean;
  /** O item está no ar agora (`status === "PUBLISHED"`). */
  live: boolean;
  /** Rascunho salvo difere da versão publicada. Vem do servidor, nunca de comparação local. */
  hasUnpublishedChanges: boolean;
  /** Há edição ainda não salva no formulário. */
  isDirty: boolean;
  /** Comparação com uma versão aberta: o formulário e os controles ficam pausados. */
  inspecting: boolean;
  /** O formulário passa nas validações de salvar (nome, pasta, tamanho). */
  formValid: boolean;
  /** Pages tem Pré-visualizar no menu ⋯; Scripts não. */
  canPreview: boolean;
};

/** Estado completo do cabeçalho; os componentes só renderizam, não decidem. */
export type EditorHeaderState = {
  /** Switch No ar / Fora do ar. Desligar nunca exige formulário válido; ligar exige. */
  switch: {
    on: boolean;
    label: SwitchLabelKey;
    enabled: boolean;
    disabledReason: Extract<
      HeaderReasonKey,
      "reasonInspecting" | "reasonInvalidForm"
    > | null;
  };
  /** Botão principal. `publishes` indica se o clique também atualiza o ar. */
  primary: {
    label: PrimaryLabelKey;
    publishes: boolean;
    enabled: boolean;
    disabledReason: Exclude<HeaderReasonKey, "reasonNewItem"> | null;
  };
  /** Menu ⋯: trigger, linha de versão e as ações disponíveis (as indisponíveis não aparecem). */
  menu: {
    enabled: boolean;
    disabledReason: Extract<
      HeaderReasonKey,
      "reasonInspecting" | "reasonNewItem"
    > | null;
    versionInfo: MenuVersionInfoKey;
    items: HeaderMenuItem[];
  };
  /** Indicador "Não salvo" ao lado do botão principal. */
  showUnsavedIndicator: boolean;
  /** Faixa "Há alterações salvas que ainda não estão no ar." (no ar, salvo, sem edição). */
  showPendingBanner: boolean;
  /** Dica de pausa ao lado do título enquanto compara. */
  showPausedHint: boolean;
};

/**
 * Rótulo do switch a partir só do que a listagem também conhece: no ar, ou fora do ar
 * com ou sem versão publicada guardada.
 */
export function statusSwitchLabelKey(state: {
  live: boolean;
  hasPublishedRevision: boolean;
}): SwitchLabelKey {
  if (state.live) return "switchLive";
  return state.hasPublishedRevision ? "switchOff" : "switchNeverPublished";
}

/**
 * Decide switch, botão principal, menu ⋯, indicador e faixas para um estado do editor.
 *
 * Matriz (cada linha vale com e sem edição não salva; em comparação tudo pausa):
 *   - item novo ............ switch "nunca publicada" (ligar = criar e publicar), botão "Criar"
 *   - nunca publicada ...... switch "nunca publicada", botão "Salvar" (só com edição)
 *   - fora do ar ........... switch "Fora do ar", botão "Salvar" (só com edição)
 *   - no ar em dia ......... switch "No ar", botão "Salvar e publicar" desabilitado sem edição
 *   - no ar com alteração .. como acima, botão habilitado e faixa de alteração salva
 * Controle indisponível devolve o motivo; nenhum controle some por estado, exceto as
 * ações do menu ⋯, que simplesmente não são listadas quando não se aplicam.
 */
export function getEditorHeaderState(
  input: EditorStateInput,
): EditorHeaderState {
  const {
    hasResource,
    hasPublishedRevision,
    live,
    hasUnpublishedChanges,
    isDirty,
    inspecting,
    formValid,
    canPreview,
  } = input;

  // Switch: desligar só tira do ar (sem validar o formulário); ligar salva e publica o que
  // está no editor, então precisa de formulário válido.
  const switchReason = inspecting
    ? "reasonInspecting"
    : !live && !formValid
      ? "reasonInvalidForm"
      : null;

  // Botão principal: "o que ele faz" depende de existir, e de estar no ar.
  let primaryLabel: PrimaryLabelKey;
  let primaryReason: Exclude<HeaderReasonKey, "reasonNewItem"> | null;
  if (!hasResource) {
    primaryLabel = "buttonCreate";
    primaryReason = inspecting
      ? "reasonInspecting"
      : !formValid
        ? "reasonInvalidForm"
        : null;
  } else if (live) {
    const pending = isDirty || hasUnpublishedChanges;
    primaryLabel = "buttonSaveAndPublish";
    primaryReason = inspecting
      ? "reasonInspecting"
      : !pending
        ? "reasonNothingToPublish"
        : !formValid
          ? "reasonInvalidForm"
          : null;
  } else {
    primaryLabel = "buttonSave";
    primaryReason = inspecting
      ? "reasonInspecting"
      : !isDirty
        ? "reasonNothingToSave"
        : !formValid
          ? "reasonInvalidForm"
          : null;
  }

  // Menu ⋯: ações que salvam só são oferecidas com formulário válido.
  const menuReason = inspecting
    ? "reasonInspecting"
    : !hasResource
      ? "reasonNewItem"
      : null;
  const items: HeaderMenuItem[] = [];
  if (live && isDirty && formValid) items.push("saveWithoutPublishing");
  if (canPreview && hasResource && (!isDirty || formValid)) {
    items.push("preview");
  }

  return {
    switch: {
      on: live,
      label: statusSwitchLabelKey({ live, hasPublishedRevision }),
      enabled: switchReason === null,
      disabledReason: switchReason,
    },
    primary: {
      label: primaryLabel,
      publishes: primaryLabel === "buttonSaveAndPublish",
      enabled: primaryReason === null,
      disabledReason: primaryReason,
    },
    menu: {
      enabled: menuReason === null,
      disabledReason: menuReason,
      versionInfo: live
        ? "menuLiveVersion"
        : hasPublishedRevision
          ? "menuStoredVersion"
          : "menuNeverPublished",
      items,
    },
    showUnsavedIndicator: isDirty,
    showPendingBanner: live && hasUnpublishedChanges && !isDirty,
    showPausedHint: inspecting,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Linha Rascunho do bloco Versões                                          */
/* -------------------------------------------------------------------------- */

/** Chave do selo da linha Rascunho (`PanelDictionary["revisions"]`). */
export type DraftRowKey = Extract<
  keyof PanelDictionary["revisions"],
  | "draftUnsaved"
  | "draftUnpublished"
  | "draftSameAsLive"
  | "draftSameAsPublished"
>;

/**
 * Selo da linha Rascunho: "não salvo" (edição na tela), "não publicado" (salvo, diferente
 * da versão publicada ou nunca publicada) ou "igual" à versão publicada guardada, que se diz
 * "igual ao ar" só quando o item está no ar; fora do ar, "igual à publicada" (nada está no ar
 * para ser igual).
 */
export function draftRowState(state: {
  isDirty: boolean;
  /** O item está no ar agora (`status === "PUBLISHED"`). */
  live: boolean;
  hasPublishedRevision: boolean;
  hasUnpublishedChanges: boolean;
}): DraftRowKey {
  if (state.isDirty) return "draftUnsaved";
  if (!state.hasPublishedRevision || state.hasUnpublishedChanges) {
    return "draftUnpublished";
  }
  return state.live ? "draftSameAsLive" : "draftSameAsPublished";
}

/* -------------------------------------------------------------------------- */
/* 3. Ligar o switch                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Recusa do servidor ao publicar um item cujo rascunho já é igual à versão publicada
 * (`INVALID_STATE`, "Page|Script has no unpublished changes"). É feita antes de qualquer
 * efeito (nada compilado, gravado ou versionado), por isso é seguro seguir para ativar.
 * Reconhecida por código + mensagem, como `isOptimisticSaveConflict`: o código sozinho
 * também cobre "has no published revision", que NÃO é essa recusa.
 */
export function isNothingToPublishRefusal(
  code: string | undefined,
  message: string | undefined,
): boolean {
  return (
    code === "INVALID_STATE" &&
    /has no unpublished changes/i.test(message ?? "")
  );
}

/** Como o item foi colocado no ar: versão nova publicada, ou versão publicada reativada. */
export type TurnOnOutcome = "published" | "activated";

export type TurnOnResult<T> = {
  /** Houve gravação do rascunho antes de publicar. */
  saved: boolean;
  outcome: TurnOnOutcome;
  /** Item devolvido pela última chamada ao servidor (publicar ou ativar). */
  resource: T;
};

/**
 * "Ligar" o switch: coloca no ar exatamente o rascunho (o do editor, quando há edição).
 *
 *   1. `save`, se informado: grava a edição. Resolve `null` quando falhou (o chamador já
 *      mostrou o erro) e então NADA é publicado e o resultado é `null`.
 *   2. `publish`: cria a versão e põe no ar.
 *   3. Só se o servidor recusar com `isNothingToPublishRefusal` (rascunho igual à versão
 *      publicada), `activate` volta essa mesma versão ao ar. Qualquer outro erro, de
 *      publish ou de activate, é propagado intacto para o chamador exibir.
 *
 * O servidor decide se há alteração não publicada; o cliente nunca compara conteúdo.
 * `save` fica de fora quando não há edição (listagens, ou editor sem alteração).
 * `saved` é repassado a `publish` e `activate` porque item novo só ganha id depois do save.
 *
 * ponytail: entre a recusa e o ativar há uma janela; se outra sessão mudar o rascunho aí,
 * o ar recebe a versão publicada (igual ao rascunho no instante da recusa), não o rascunho
 * novo. Aceitável hoje; fechar com um endpoint único de "ligar" se o uso concorrente
 * do mesmo item crescer.
 */
export async function turnOn<T>(steps: {
  save?: () => Promise<T | null>;
  publish: (saved: T | null) => Promise<T>;
  activate: (saved: T | null) => Promise<T>;
}): Promise<TurnOnResult<T> | null> {
  let saved: T | null = null;
  if (steps.save) {
    saved = await steps.save();
    if (saved === null) return null;
  }
  const didSave = saved !== null;

  try {
    const resource = await steps.publish(saved);
    return { saved: didSave, outcome: "published", resource };
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (!isNothingToPublishRefusal(code, message)) throw error;
  }

  const resource = await steps.activate(saved);
  return { saved: didSave, outcome: "activated", resource };
}

/** Chave do aviso de sucesso de um "ligar" (`PublishingCopy`). */
export type TurnOnNoticeKey = Extract<
  keyof PublishingCopy,
  "noticeSavedAndPublished" | "noticePublished" | "noticeBackLive"
>;

/** Aviso fiel ao que aconteceu: ativar nunca é "publicado", salvar+publicar é "salvo e publicado". */
export function turnOnNoticeKey(
  result: Pick<TurnOnResult<unknown>, "saved" | "outcome">,
): TurnOnNoticeKey {
  if (result.outcome === "activated") return "noticeBackLive";
  return result.saved ? "noticeSavedAndPublished" : "noticePublished";
}

/* -------------------------------------------------------------------------- */
/* 4. Salvar com versão otimista                                               */
/* -------------------------------------------------------------------------- */

/** Save manda o timestamp do rascunho carregado; create/primeira tela não tem. */
export function attachExpectedUpdatedAt<T extends Record<string, unknown>>(
  payload: T,
  expectedUpdatedAt: string | null | undefined,
): T | (T & { expectedUpdatedAt: string }) {
  if (!expectedUpdatedAt) return payload;
  return { ...payload, expectedUpdatedAt };
}

/** 409 de versão (outra sessão) ≠ 409 de slug/nome já em uso. */
export function isOptimisticSaveConflict(
  code: string | undefined,
  message: string | undefined,
): boolean {
  return (
    code === "CONFLICT" && /updated by another request/i.test(message ?? "")
  );
}
