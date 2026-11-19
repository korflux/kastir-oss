"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";

/**
 * Cabeçalho compartilhado de seleção em massa.
 * Eixo E/D: `actions` (não-destrutivo) e `destructiveActions` (só destrutivo)
 * em slots distintos — callers não misturam lixeira no mesmo grupo do mover.
 */
export function BulkActionBar({
  allSelected,
  clearLabel,
  onClear,
  onToggleAll,
  selectedCount,
  selectedLabel,
  selectAllLabel,
  someSelected = false,
  visibleCount,
  busy = false,
  selectionLimit = BULK_IDS_MAX,
  selectionLimitLabel,
  actions,
  destructiveActions,
}: {
  allSelected: boolean;
  clearLabel: string;
  onClear: () => void;
  onToggleAll: () => void;
  selectedCount: number;
  selectedLabel: string;
  selectAllLabel: string;
  someSelected?: boolean;
  visibleCount: number;
  busy?: boolean;
  selectionLimit?: number;
  selectionLimitLabel?: string;
  /** Ações não-destrutivas (mover, restaurar, converter…). */
  actions?: ReactNode;
  /** Só ações destrutivas (lixeira / exclusão permanente). */
  destructiveActions?: ReactNode;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A propriedade nativa comunica a seleção parcial a leitores de tela.
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [allSelected, someSelected]);

  const hasSelection = selectedCount > 0;
  // A affordance inicial fica nos checkboxes das linhas; a barra só disputa
  // espaço quando já existe uma seleção real para operar.
  if (visibleCount === 0 || !hasSelection) return null;

  const selectAllDisabled = busy || visibleCount > selectionLimit;
  const limitReached =
    visibleCount > selectionLimit || selectedCount >= selectionLimit;
  const formattedLimitLabel = selectionLimitLabel?.replace(
    "{count}",
    String(selectionLimit),
  );

  const hasActions = Boolean(actions);
  const hasDestructive = Boolean(destructiveActions);

  return (
    <div
      className="border-border bg-background flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
      data-testid="bulk-action-bar"
      role="toolbar"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <label className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
          <input
            ref={checkboxRef}
            aria-label={selectAllLabel}
            aria-checked={someSelected ? "mixed" : allSelected}
            checked={allSelected}
            className="accent-primary size-4"
            disabled={selectAllDisabled}
            onChange={onToggleAll}
            title={
              visibleCount > selectionLimit ? formattedLimitLabel : undefined
            }
            type="checkbox"
          />
          <span aria-live="polite" className="truncate">
            {hasSelection
              ? `${selectedCount} ${selectedLabel}`
              : selectAllLabel}
          </span>
        </label>
        {hasSelection ? (
          <Button
            disabled={busy}
            onClick={onClear}
            type="button"
            variant="ghost"
          >
            {clearLabel}
          </Button>
        ) : null}
        {limitReached && formattedLimitLabel ? (
          <span
            aria-live="polite"
            className="text-muted-foreground text-xs"
            role="status"
          >
            {formattedLimitLabel}
          </span>
        ) : null}
        {/* Não-destrutivos ao lado da seleção (lado esquerdo do eixo E/D). */}
        {hasSelection && hasActions ? (
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            data-slot="bulk-actions"
          >
            {actions}
          </div>
        ) : null}
      </div>
      {/* Só destrutivo à direita — nunca no mesmo slot das ações de alterar. */}
      {hasSelection && hasDestructive ? (
        <div
          className="flex min-w-0 flex-wrap items-center justify-end gap-2"
          data-slot="bulk-destructive"
        >
          {destructiveActions}
        </div>
      ) : null}
    </div>
  );
}
