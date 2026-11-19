"use client";

/**
 * Bloco "Versões" do Details dos editores de Pages e Scripts.
 *
 * Seções deste arquivo:
 *   1. Tipos e helpers puros (`RevisionHistoryItem`, `fillRevisionCopy`, `formatRevisionDateTime`,
 *      `revisionShortId`, `revisionPinBlocked`), reusados pela barra de comparação e pelos editores.
 *   2. `RevisionHistoryPanel`: cabeçalho com contador, mensagens, lista e rodapé de política.
 *   3. `RevisionRow`: uma linha-botão (Rascunho ou versão) com o alfinete ao lado.
 *
 * O painel só lista e seleciona: a comparação, o Restaurar e sua confirmação ficam na barra de
 * comparação (`RevisionCompareBar`), acima do código.
 */

import { useState } from "react";
import { Pin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DraftRowKey } from "@/lib/Modules/Revisions/Components/revisionEditorState";
import {
  REVISION_PIN_MAX,
  REVISION_RETENTION_DEFAULT,
} from "@/lib/Modules/Settings/revisionRetention";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* 1. Tipos e helpers puros                                                    */
/* -------------------------------------------------------------------------- */

export type RevisionHistoryItem = {
  id: string;
  fingerprint: string;
  authorName: string;
  createdAt: string;
  pinned: boolean;
  /** Esta é a versão publicada (ponteiro do recurso), esteja ele no ar ou não. */
  published: boolean;
};

export type RevisionHistoryCopy = PanelDictionary["revisions"];

/**
 * Selo das linhas da lista: 11px com menos respiro lateral (como o `.pill` da proposta
 * aprovada). A coluna Details é estreita e a data já vem inteira (dia/mês/ano e hora, no
 * formato do site); com o selo padrão, "Publicada" caía numa linha própria e a linha 1 deixava
 * de ser "data + selo".
 */
const ROW_BADGE_CLASS = "px-1.5 text-[11px]";

/** Prefixo visível do fingerprint — mesmo hábito do Git (7 hex). */
export function revisionShortId(fingerprint: string): string {
  return fingerprint.slice(0, 7);
}

/** Preenche `{chave}` de um texto do dicionário; chave sem valor fica como está. */
export function fillRevisionCopy(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Data e hora curtas no fuso e idioma do navegador. É o padrão quando o editor não passa um
 * formatador.
 * ponytail: ignora a data, o formato de hora e o fuso configurados no painel; passar
 * `formatDateTime` (com `formatPanelDateTime`) assim que a rota do editor receber
 * `formatSettings`.
 */
export function formatRevisionDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Quarto pin: avisa, não grava. Unpin continua livre. */
export function revisionPinBlocked(
  pinned: boolean,
  pinnedCount: number,
): boolean {
  return !pinned && pinnedCount >= REVISION_PIN_MAX;
}

/* -------------------------------------------------------------------------- */
/* 2. Painel                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Lista de versões: linha Rascunho no topo (sempre) e as versões da mais nova para a mais
 * antiga. Clicar numa versão abre a comparação (`onSelect(id)`); clicar no Rascunho volta ao
 * editor (`onSelect(null)`). O alfinete é um segundo botão na mesma linha.
 *
 * Contrato para os editores (Pages e Scripts): passe `live` (item no ar agora), `draftState`
 * (`draftRowState(...)` de `revisionEditorState`), `retentionLimit`, `retryable` (do hook) e,
 * se tiver `formatSettings`, `formatDateTime`.
 */
export function RevisionHistoryPanel({
  copy,
  items,
  status,
  errorMessage,
  conflict = false,
  retryable,
  selectedId = null,
  busy = false,
  live = false,
  draftState,
  draftUpdatedAt,
  retentionLimit = REVISION_RETENTION_DEFAULT,
  formatDateTime = formatRevisionDateTime,
  onSelect,
  onPin,
  onRetry,
}: {
  copy: RevisionHistoryCopy;
  items: RevisionHistoryItem[];
  status: "loading" | "error" | "empty" | "ready";
  errorMessage?: string;
  conflict?: boolean;
  /** Mostra "Tentar de novo". Padrão: só quando a lista falhou (`status === "error"`). */
  retryable?: boolean;
  selectedId?: string | null;
  busy?: boolean;
  /** O item está no ar agora: a versão publicada leva "No ar"; fora do ar, "Publicada". */
  live?: boolean;
  /** Selo da linha Rascunho (`draftRowState` de `revisionEditorState`). */
  draftState: DraftRowKey;
  /** Quantas versões a retenção guarda (configuração do site). Padrão: o valor de fábrica. */
  retentionLimit?: number;
  draftUpdatedAt: string;
  /** Recebe o ISO da versão e devolve data e hora legíveis. Padrão: `formatRevisionDateTime`. */
  formatDateTime?: (value: string) => string;
  onSelect: (id: string | null) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRetry: () => void;
}) {
  const pinnedCount = items.filter((item) => item.pinned).length;
  const showList = status === "ready" || status === "empty";
  // Mensagem do quarto pin: aparece no clique recusado e some no próximo clique válido.
  const [pinLimitVisible, setPinLimitVisible] = useState(false);

  const requestPin = (item: RevisionHistoryItem) => {
    if (revisionPinBlocked(item.pinned, pinnedCount)) {
      setPinLimitVisible(true);
      return;
    }
    setPinLimitVisible(false);
    onPin(item.id, !item.pinned);
  };

  return (
    <section
      aria-labelledby="revision-history-heading"
      className="space-y-2"
      data-testid="revision-history"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium" id="revision-history-heading">
          {copy.title}
        </h3>
        {showList ? (
          <span
            className="text-muted-foreground text-xs tabular-nums"
            data-testid="revision-counter"
          >
            {fillRevisionCopy(copy.versionsCounter, {
              total: items.length,
              limit: retentionLimit,
              pinned: pinnedCount,
            })}
          </span>
        ) : null}
      </div>

      {conflict ? (
        <p className="text-destructive text-xs" role="alert">
          {copy.conflict}
        </p>
      ) : null}

      {status === "loading" ? (
        <p className="text-muted-foreground text-xs" role="status">
          {copy.loading}
        </p>
      ) : null}

      {status === "error" || errorMessage ? (
        <div className="space-y-2" role="alert">
          <p className="text-destructive text-xs">
            {errorMessage ?? copy.error}
          </p>
          {(retryable ?? status === "error") ? (
            <Button size="sm" type="button" variant="outline" onClick={onRetry}>
              {copy.retry}
            </Button>
          ) : null}
        </div>
      ) : null}

      {pinLimitVisible ? (
        <p className="text-destructive text-xs" role="alert">
          {copy.pinLimit}
        </p>
      ) : null}

      {showList ? (
        <>
          <ul className="max-h-56 min-h-0 space-y-0.5 overflow-y-auto">
            <RevisionRow
              badge={
                <Badge className={ROW_BADGE_CLASS} variant="outline">
                  {copy[draftState]}
                </Badge>
              }
              busy={busy}
              kind="draft"
              line1={copy.draft}
              line2={draftUpdatedAt ? formatDateTime(draftUpdatedAt) : null}
              selected={selectedId === null}
              testId="revision-row-draft"
              onSelect={() => {
                setPinLimitVisible(false);
                onSelect(null);
              }}
            />
            {items.map((item) => {
              const date = formatDateTime(item.createdAt);
              const isLive = item.published && live;
              // O aria-label do botão substitui o texto visível da linha, então o marcador do
              // Badge (No ar / Publicada) precisa entrar no nome: sem isso o leitor de tela
              // perde o que o Badge mostra (A7). Versão comum não tem marcador.
              const rowLabelTemplate = isLive
                ? copy.versionRowLabelLive
                : item.published
                  ? copy.versionRowLabelPublished
                  : copy.versionRowLabel;
              const rowLabel = fillRevisionCopy(rowLabelTemplate, {
                date,
                author: item.authorName,
              });
              const pinLabel = fillRevisionCopy(
                item.pinned ? copy.unpinVersion : copy.pinVersion,
                { date },
              );
              return (
                <RevisionRow
                  badge={
                    item.published ? (
                      isLive ? (
                        <Badge
                          className={cn(
                            ROW_BADGE_CLASS,
                            "border-brand/40 bg-brand/10 text-brand",
                          )}
                          variant="outline"
                        >
                          {copy.live}
                        </Badge>
                      ) : (
                        <Badge className={ROW_BADGE_CLASS} variant="outline">
                          {copy.publishedOffline}
                        </Badge>
                      )
                    ) : null
                  }
                  busy={busy}
                  key={item.id}
                  kind={isLive ? "live" : "version"}
                  label={rowLabel}
                  line1={date}
                  line2={
                    <>
                      {item.authorName} ·{" "}
                      <span className="font-mono">
                        {revisionShortId(item.fingerprint)}
                      </span>
                    </>
                  }
                  pin={{
                    label: pinLabel,
                    pressed: item.pinned,
                    testId: `revision-pin-${item.id}`,
                    onClick: () => requestPin(item),
                  }}
                  selected={selectedId === item.id}
                  testId={`revision-row-${item.id}`}
                  onSelect={() => {
                    setPinLimitVisible(false);
                    onSelect(item.id);
                  }}
                />
              );
            })}
          </ul>
          <p
            className="text-muted-foreground text-[11.5px] leading-snug"
            data-testid="revision-policy"
          >
            {fillRevisionCopy(copy.versionsPolicy, { limit: retentionLimit })}
          </p>
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Linha                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Linha-botão: marcador, data + selo, autor · código e alfinete. A linha inteira (marcador e
 * texto) é UM botão; o alfinete é outro, para o foco e o clique nunca se confundirem.
 */
function RevisionRow({
  badge,
  busy,
  kind,
  label,
  line1,
  line2,
  pin,
  selected,
  testId,
  onSelect,
}: {
  badge: React.ReactNode;
  busy: boolean;
  /** Marcador: no ar (cheio, verde), Rascunho (tracejado) ou versão comum (neutro). */
  kind: "draft" | "live" | "version";
  /** Nome acessível; sem ele vale o texto da linha. */
  label?: string;
  line1: React.ReactNode;
  line2: React.ReactNode;
  pin?: {
    label: string;
    pressed: boolean;
    testId: string;
    onClick: () => void;
  };
  selected: boolean;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <li
      className={cn(
        "group grid grid-cols-[1fr_auto] items-center rounded-md border border-transparent",
        selected ? "border-border bg-muted" : "hover:bg-muted/60",
      )}
      data-testid={testId}
    >
      <button
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        className="focus-visible:ring-ring/50 grid min-w-0 grid-cols-[10px_1fr] items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3 disabled:opacity-50"
        disabled={busy}
        type="button"
        onClick={onSelect}
      >
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full border-2",
            kind === "live" && "border-brand bg-brand",
            kind === "draft" && "border-muted-foreground border-dashed",
            kind === "version" && "border-muted-foreground/60",
          )}
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] tabular-nums">
            <span className="whitespace-nowrap">{line1}</span>
            {badge}
          </span>
          {line2 ? (
            <span className="text-muted-foreground truncate text-[11.5px]">
              {line2}
            </span>
          ) : null}
        </span>
      </button>
      {pin ? (
        <Button
          aria-label={pin.label}
          aria-pressed={pin.pressed}
          className="text-muted-foreground aria-pressed:text-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100"
          data-testid={pin.testId}
          disabled={busy}
          size="icon-sm"
          title={pin.label}
          type="button"
          variant="ghost"
          onClick={pin.onClick}
        >
          <Pin
            aria-hidden
            className={cn("size-3.5", pin.pressed && "fill-current")}
          />
        </Button>
      ) : (
        <span aria-hidden className="size-7" />
      )}
    </li>
  );
}
