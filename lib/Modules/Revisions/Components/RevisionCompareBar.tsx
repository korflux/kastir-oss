"use client";

/**
 * Barra de comparação de versão, compartilhada por Pages e Scripts (fica acima do diff).
 *
 * Seções deste arquivo:
 *   1. `revisionRestoreBlockedReason`: por que "Restaurar" está indisponível (regra pura).
 *   2. `RevisionCompareBar`: direção, contagem, legenda, "Outros campos que mudam", ações e a
 *      confirmação de restaurar.
 *
 * Direção: Rascunho atual → versão selecionada. `−` é o que SAI do rascunho se restaurar e `+`
 * é o que VOLTA com a versão. A lista de campos é a mesma na barra e na confirmação, para o
 * usuário nunca confirmar um campo que não viu (critério C3).
 */

import { useId, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fillRevisionCopy,
  formatRevisionDateTime,
  type RevisionHistoryCopy,
  type RevisionHistoryItem,
} from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import type { RevisionFieldChange } from "@/lib/Modules/Revisions/Components/revisionFieldChanges";
import {
  countRevisionDiff,
  foldRevisionDiff,
  type RevisionDiffLine,
} from "@/lib/Modules/Revisions/diff";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* 1. Por que Restaurar está indisponível                                      */
/* -------------------------------------------------------------------------- */

/** Chave do motivo (`PanelDictionary["revisions"]`) de "Restaurar" estar desabilitado. */
export type RestoreBlockedKey = Extract<
  keyof RevisionHistoryCopy,
  "restoreBlockedDirty" | "restoreBlockedIdentical"
>;

/**
 * Restaurar só vale com o formulário limpo (senão apagaria a edição não salva) e com uma
 * versão diferente do rascunho salvo (mesmo fingerprint = nada a trocar). Edição não salva
 * tem precedência: é o motivo que o usuário consegue resolver.
 */
export function revisionRestoreBlockedReason({
  dirty,
  versionFingerprint,
  draftFingerprint,
}: {
  dirty: boolean;
  versionFingerprint: string;
  draftFingerprint: string;
}): RestoreBlockedKey | null {
  if (dirty) return "restoreBlockedDirty";
  if (versionFingerprint === draftFingerprint) return "restoreBlockedIdentical";
  return null;
}

/* -------------------------------------------------------------------------- */
/* 2. Barra                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Contrato para os editores (T3/T4): renderizar acima de `RevisionDiffPane` enquanto
 * `history.selectedId !== null`, com `target={history.selected}`, `lines={history.diffLines}`
 * e `fieldChanges` de `pageFieldChanges` / `scriptFieldChanges`. `onRestore` chama
 * `history.restore(target.id)` e atualiza o formulário; o diálogo fecha sozinho ao terminar
 * (certo ou errado: um 409 aparece no bloco Versões, atrás do modal ficaria invisível).
 */
export function RevisionCompareBar({
  copy,
  target,
  live = false,
  lines,
  fieldChanges,
  dirty,
  draftFingerprint,
  busy = false,
  replacesUnpublished = false,
  formatDateTime = formatRevisionDateTime,
  onRestore,
  onBack,
  onExpandAll,
}: {
  copy: RevisionHistoryCopy;
  /** A versão em comparação (item da lista). */
  target: RevisionHistoryItem;
  /** O item está no ar agora: a versão publicada leva "No ar"; fora do ar, "Publicada". */
  live?: boolean;
  /** Diff editor → versão (`history.diffLines`): origem da contagem e dos trechos recolhíveis. */
  lines: RevisionDiffLine[];
  /** Campos fora do código que mudam ao restaurar. */
  fieldChanges: RevisionFieldChange[];
  /** Há edição não salva no formulário. */
  dirty: boolean;
  /** Fingerprint do rascunho salvo (`page.draftFingerprint`). */
  draftFingerprint: string;
  /** Uma chamada ao servidor está em andamento (restaurar, carregar versão, fixar). */
  busy?: boolean;
  /** O rascunho tem alterações salvas ainda não publicadas: a confirmação avisa que somem. */
  replacesUnpublished?: boolean;
  formatDateTime?: (value: string) => string;
  /** Confirmação aceita: restaura. O resultado só decide o aviso do editor; o diálogo fecha. */
  onRestore: () => unknown;
  /** "Voltar a editar": sai da comparação sem mudar nada. */
  onBack: () => void;
  /** "Expandir tudo" (o dono repassa ao painel do diff). */
  onExpandAll?: () => void;
}) {
  const reasonId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const stats = useMemo(() => countRevisionDiff(lines), [lines]);
  const foldable = useMemo(() => foldRevisionDiff(lines).length > 0, [lines]);
  const blockedReason = revisionRestoreBlockedReason({
    dirty,
    versionFingerprint: target.fingerprint,
    draftFingerprint,
  });
  const date = formatDateTime(target.createdAt);
  const isLive = target.published && live;

  return (
    <section
      aria-label={copy.compareTitle}
      className="border-border grid gap-2 border-b p-3 text-sm"
      data-testid="revision-compare-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{copy.compareTitle}</span>
        <Badge variant="outline">{copy.compareDraftBadge}</Badge>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <Badge
          className={cn(
            "max-w-full",
            isLive && "border-brand/40 bg-brand/10 text-brand",
          )}
          data-testid="revision-compare-target"
          variant="outline"
        >
          {target.published
            ? `${isLive ? copy.live : copy.publishedOffline} · `
            : ""}
          {date} · {target.authorName}
        </Badge>
        <span
          className="text-muted-foreground ml-auto text-xs tabular-nums max-md:ml-0 max-md:basis-full"
          data-testid="revision-compare-stats"
        >
          {fillRevisionCopy(copy.compareStats, stats)}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          <b className="bg-destructive/20 text-destructive mr-1 inline-block w-4 rounded text-center font-mono">
            −
          </b>
          {copy.legendRemoved}
        </span>
        <span>
          <b className="bg-brand/20 text-brand mr-1 inline-block w-4 rounded text-center font-mono">
            +
          </b>
          {copy.legendAdded}
        </span>
        <Button
          className="ml-auto"
          disabled={!foldable || !onExpandAll}
          size="xs"
          type="button"
          variant="ghost"
          onClick={onExpandAll}
        >
          {copy.expandAll}
        </Button>
      </div>

      <div
        className="border-border bg-muted/50 grid gap-1 rounded-lg border p-2 text-xs"
        data-testid="revision-compare-fields"
      >
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {copy.otherFieldsTitle}
        </p>
        {fieldChanges.length ? (
          fieldChanges.map((change) => (
            <div
              className="grid grid-cols-[120px_1fr] items-baseline gap-2 max-md:grid-cols-1 max-md:gap-0.5"
              data-testid={`revision-field-${change.field}`}
              key={change.field}
            >
              <span className="text-muted-foreground">{change.label}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <del className="text-muted-foreground">{change.current}</del>
                {" → "}
                <ins className="font-medium no-underline">{change.next}</ins>
              </span>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">{copy.otherFieldsNone}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 max-md:flex-col max-md:items-stretch">
        <Button
          aria-describedby={blockedReason ? reasonId : undefined}
          disabled={blockedReason !== null || busy}
          size="sm"
          type="button"
          onClick={() => setConfirmOpen(true)}
        >
          {copy.restoreAction}
        </Button>
        <Button
          disabled={busy}
          size="sm"
          type="button"
          variant="outline"
          onClick={onBack}
        >
          {copy.backToEditing}
        </Button>
        {blockedReason ? (
          <span
            className="text-muted-foreground text-xs"
            data-testid="revision-restore-reason"
            id={reasonId}
          >
            {copy[blockedReason]}
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        busy={busy}
        busyLabel={copy.working}
        cancelLabel={copy.cancel}
        closeLabel={copy.close}
        confirmLabel={copy.restore}
        contentClassName="sm:max-w-[460px]"
        description={copy.confirmRestoreDescription}
        open={confirmOpen}
        title={fillRevisionCopy(copy.confirmRestoreTitle, {
          date,
          author: target.authorName,
        })}
        onConfirm={async () => {
          try {
            await onRestore();
          } finally {
            setConfirmOpen(false);
          }
        }}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmOpen(false);
        }}
      >
        <div className="grid gap-3">
          <ul
            className="text-muted-foreground list-disc space-y-1 pl-5 text-sm"
            data-testid="revision-restore-list"
          >
            <li>{fillRevisionCopy(copy.restoreConfirmCode, stats)}</li>
            {fieldChanges.map((change) => (
              <li key={change.field}>
                {change.label}: {change.next}
              </li>
            ))}
          </ul>
          {replacesUnpublished ? (
            <p
              className="border-border bg-muted rounded-lg border px-3 py-2 text-sm"
              data-testid="revision-restore-warning"
              role="note"
            >
              {copy.restoreConfirmUnpublishedWarning}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </section>
  );
}
