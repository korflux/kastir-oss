"use client";

/**
 * Cabeçalho compartilhado dos editores de Pages e Scripts (fase 2: versões e publicação).
 *
 * Seções deste arquivo:
 *   1. Tipos públicos (`EditorHeaderCopy`, `EditorHeaderBusy`).
 *   2. `EditorHeader`: título, switch No ar / Fora do ar, indicador "Não salvo", botão
 *      principal, menu ⋯, motivos de controle indisponível, dica de pausa e faixa de
 *      "alterações salvas ainda não no ar".
 *   3. `EditorFeedback`: faixa de erro e faixa de resultado (com ação opcional, ex.: Desfazer).
 *
 * É apresentacional: não decide nada. Quem decide (rótulo, habilitação, itens do menu, motivos,
 * faixa) é `getEditorHeaderState` (revisionEditorState.ts); quem fala com o servidor é o
 * editor dono, que reage a `onPrimary`, `onToggle` e `onMenuAction`. Por isso Pages e Scripts
 * montam o mesmo componente e só diferem no dicionário (`dictionary.publishing`), em
 * `canPreview` (entra no estado, não aqui) e no botão Excluir (`trailing`).
 *
 * Contrato de uso (T3 Pages, T4 Scripts):
 *   <EditorHeader
 *     copy={dictionary.publishing}
 *     state={getEditorHeaderState({ ..., canPreview })}
 *     title={nome}
 *     versionInfo={texto pronto da 1ª linha do menu}
 *     busy={operação em andamento}
 *     workingLabel={dictionary.working}
 *     onPrimary / onToggle / onMenuAction
 *     trailing={<Button destrutivo Excluir />}
 *   />
 */

import { useId } from "react";
import { ExternalLink, MoreHorizontal } from "lucide-react";

import { StatusToggle } from "@/components/Shared/StatusToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  EditorHeaderState,
  HeaderMenuItem,
  HeaderReasonKey,
} from "@/lib/Modules/Revisions/Components/revisionEditorState";
import type { PublishingCopy } from "@/lib/i18n/panel";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* 1. Tipos públicos                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Textos do cabeçalho: o bloco `publishing` do módulo (`pages.publishing` ou
 * `customCode.publishing`). Pré-visualizar existe só em Pages, por isso os dois campos são
 * opcionais aqui e o item só aparece quando o estado o lista (`canPreview`).
 */
export type EditorHeaderCopy = PublishingCopy & {
  menuPreview?: string;
  menuPreviewHint?: string;
};

/**
 * Operação do servidor em andamento, refletida nos controles (todos ficam inertes enquanto
 * houver uma): `saving` e `publishing` trocam o rótulo do botão principal; `turningOn` e
 * `turningOff` põem o switch em estado ocupado; `other` (pré-visualizar, desfazer, excluir)
 * só trava os controles.
 */
export type EditorHeaderBusy =
  "saving" | "publishing" | "turningOn" | "turningOff" | "other" | null;

/* -------------------------------------------------------------------------- */
/* 2. Cabeçalho                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Cabeçalho do editor: título, switch No ar / Fora do ar, indicador "Não salvo", botão principal,
 * menu ⋯ e, abaixo, a faixa de "alterações salvas ainda não no ar". Renderiza só o que `state`
 * manda mostrar e habilitar; os cliques saem por `onPrimary`, `onToggle` e `onMenuAction`. Com
 * qualquer operação em andamento (`busy`) todos os controles ficam inertes (anti clique duplo).
 */
export function EditorHeader({
  copy,
  state,
  title,
  versionInfo,
  busy = null,
  workingLabel,
  onPrimary,
  onToggle,
  onMenuAction,
  trailing,
}: {
  copy: EditorHeaderCopy;
  /** Saída de `getEditorHeaderState`: tudo que o cabeçalho mostra e habilita. */
  state: EditorHeaderState;
  /** Texto do h1 (nome do item, ou o rótulo de "novo"). */
  title: string;
  /** Primeira linha do menu ⋯ já preenchida ("Versão no ar: <data> · <autor>" etc.). */
  versionInfo: string;
  busy?: EditorHeaderBusy;
  /** Rótulo genérico de ocupado (`dictionary.working`), usado no switch ao tirar do ar. */
  workingLabel: string;
  /** Clique no botão principal (Salvar, Salvar e publicar ou Criar, conforme `state.primary`). */
  onPrimary: () => void;
  /** Clique no switch: o editor decide entre ligar (salvar e publicar) e pedir confirmação. */
  onToggle: () => void;
  /** Clique num item do menu ⋯ (só os listados em `state.menu.items`). */
  onMenuAction: (item: HeaderMenuItem) => void;
  /** Destrutivo (Excluir): fica sozinho na ponta direita, separado das demais ações (lei E/D). */
  trailing?: React.ReactNode;
}) {
  const reasonsId = useId();
  const pausedHintId = useId();
  const inert = busy !== null;
  const primaryLabel =
    busy === "saving"
      ? copy.buttonSaving
      : busy === "publishing"
        ? copy.buttonPublishing
        : copy[state.primary.label];

  // Motivos de controle indisponível, sem repetir o mesmo texto (o formulário inválido bloqueia
  // o switch e o botão ao mesmo tempo). A pausa da comparação tem a própria dica, ao lado do
  // título, então não entra aqui.
  const reasons = [
    ...new Set(
      [
        state.primary.disabledReason,
        state.switch.disabledReason,
        state.menu.disabledReason,
      ].filter(
        (key): key is Exclude<HeaderReasonKey, "reasonInspecting"> =>
          key !== null && key !== "reasonInspecting",
      ),
    ),
  ];

  /** Controle indisponível aponta para o motivo visível: a dica de pausa ou a linha de motivos. */
  const describedBy = (enabled: boolean) =>
    enabled
      ? undefined
      : state.showPausedHint
        ? pausedHintId
        : reasons.length
          ? reasonsId
          : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Esquerda: onde o item está (título → switch → dica de pausa). */}
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-foreground max-w-full min-w-0 truncate text-xl font-medium tracking-tight md:text-2xl">
            {title}
          </h1>
          <StatusToggle
            appearance="switch"
            busy={busy === "turningOn" || busy === "turningOff"}
            busyLabel={
              busy === "turningOn" ? copy.buttonPublishing : workingLabel
            }
            disabled={!state.switch.enabled || inert}
            draftLabel={copy[state.switch.label]}
            published={state.switch.on}
            publishedLabel={copy.switchLive}
            publishLabel={copy.switchTurnOn}
            unpublishLabel={copy.switchTurnOff}
            onToggle={onToggle}
          />
          {state.showPausedHint ? (
            <span
              className="text-muted-foreground text-xs"
              data-testid="editor-paused-hint"
              id={pausedHintId}
            >
              {copy.reasonInspecting}
            </span>
          ) : null}
        </div>

        {/* Direita: o que falta salvar → ação principal → ações raras → destrutivo. */}
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full">
          {reasons.length ? (
            <span
              className="text-muted-foreground max-w-xs text-xs max-sm:max-w-none max-sm:basis-full"
              data-testid="editor-header-reasons"
              id={reasonsId}
            >
              {reasons.map((key) => (
                <span className="mr-1.5" data-reason={key} key={key}>
                  {copy[key]}
                </span>
              ))}
            </span>
          ) : null}

          {state.showUnsavedIndicator ? (
            <span
              className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
              data-testid="editor-unsaved-indicator"
            >
              <span
                aria-hidden
                className="bg-foreground size-1.5 shrink-0 rounded-full"
              />
              {/* No mobile só o ponto aparece; o texto segue como nome acessível. */}
              <span className="max-sm:sr-only">{copy.unsavedIndicator}</span>
            </span>
          ) : null}

          <Button
            aria-describedby={describedBy(state.primary.enabled)}
            data-testid="editor-primary-action"
            disabled={!state.primary.enabled || inert}
            size="sm"
            type="button"
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-describedby={describedBy(state.menu.enabled)}
              aria-label={copy.moreActions}
              data-testid="editor-more-actions"
              disabled={!state.menu.enabled || inert}
              render={
                <Button
                  size="icon-sm"
                  title={copy.moreActions}
                  variant="ghost"
                />
              }
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel data-testid="editor-version-info">
                  {versionInfo}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              {state.menu.items.length ? <DropdownMenuSeparator /> : null}
              {state.menu.items.map((item) => (
                <HeaderMenuEntry
                  copy={copy}
                  item={item}
                  key={item}
                  onSelect={() => onMenuAction(item)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {trailing ? (
            <>
              <span
                aria-hidden
                className="bg-border mx-1 h-5 w-px max-sm:hidden"
              />
              {trailing}
            </>
          ) : null}
        </div>
      </div>

      {state.showPendingBanner ? (
        <p
          className="border-border bg-muted rounded-lg border px-3 py-2 text-sm"
          data-testid="editor-pending-banner"
          role="note"
        >
          {copy.pendingBanner}
        </p>
      ) : null}
    </div>
  );
}

/** Item do menu ⋯: rótulo e uma linha de ajuda em texto muted logo abaixo. */
function HeaderMenuEntry({
  copy,
  item,
  onSelect,
}: {
  copy: EditorHeaderCopy;
  item: HeaderMenuItem;
  onSelect: () => void;
}) {
  const label =
    item === "preview" ? copy.menuPreview : copy.menuSaveWithoutPublishing;
  const hint =
    item === "preview"
      ? copy.menuPreviewHint
      : copy.menuSaveWithoutPublishingHint;
  // Item que o dicionário do módulo não define (Scripts não tem Pré-visualizar) nunca renderiza.
  if (!label) return null;

  return (
    <DropdownMenuItem
      className="flex-col items-stretch gap-0.5 py-1.5"
      data-testid={`editor-menu-${item}`}
      onClick={onSelect}
    >
      <span className="flex items-center justify-between gap-2">
        {label}
        {item === "preview" ? (
          <ExternalLink
            aria-hidden
            className="text-muted-foreground size-3.5"
          />
        ) : null}
      </span>
      {hint ? (
        <span className="text-muted-foreground text-xs leading-snug">
          {hint}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Faixas de erro e de resultado                                            */
/* -------------------------------------------------------------------------- */

/**
 * Faixas de feedback do editor, compartilhadas por Pages e Scripts: erro (`role="alert"`, fica
 * até o próximo clique) e resultado (`role="status"`, some sozinha via `useDismissibleNotice`).
 * O resultado pode carregar UMA ação (ex.: Desfazer após restaurar); `actionBusy` troca o rótulo
 * por `actionBusyLabel` ("Desfazendo…") e trava o botão enquanto a ação roda. O texto já chega
 * pronto: quem decide o que dizer (ex.: "Salvo e publicado" vs "O ar já está com esta versão")
 * é o editor dono, para o aviso descrever o resultado real.
 */
export function EditorFeedback({
  error,
  notice,
  action,
  actionBusy = false,
  actionBusyLabel,
}: {
  error: string | null;
  notice: string | null;
  action?: { label: string; onAction: () => void } | null;
  actionBusy?: boolean;
  actionBusyLabel?: string;
}) {
  return (
    <>
      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          className={cn(
            "border-primary/30 bg-primary/5 text-primary shrink-0 rounded-lg border px-3 py-2 text-sm",
            action && "flex flex-wrap items-center justify-between gap-2",
          )}
          role="status"
        >
          <span>{notice}</span>
          {action ? (
            <Button
              data-testid="editor-notice-action"
              disabled={actionBusy}
              size="xs"
              type="button"
              variant="ghost"
              onClick={action.onAction}
            >
              {actionBusy && actionBusyLabel ? actionBusyLabel : action.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
