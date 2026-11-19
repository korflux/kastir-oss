"use client";

import { useCallback, useState } from "react";

import { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";

/** Remove duplicatas mantendo a ordem para que a UI envie um lote previsível. */
function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Alterna uma linha sem permitir duplicata no estado compartilhado. */
export function toggleRowSelection(
  selectedIds: readonly string[],
  id: string,
): string[] {
  const selected = uniqueIds(selectedIds);
  if (selected.includes(id)) {
    return selected.filter((selectedId) => selectedId !== id);
  }
  if (selected.length >= BULK_IDS_MAX) return selected;
  return [...selected, id];
}

/** Alterna somente as linhas visíveis; IDs fora do filtro atual são preservados. */
export function toggleAllRows(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const selected = uniqueIds(selectedIds);
  const visible = uniqueIds(visibleIds);
  const allVisibleSelected =
    visible.length > 0 && visible.every((id) => selected.includes(id));

  if (allVisibleSelected) {
    return selected.filter((id) => !visible.includes(id));
  }

  const additions = visible.filter((id) => !selected.includes(id));
  return [
    ...selected,
    ...additions.slice(0, Math.max(0, BULK_IDS_MAX - selected.length)),
  ];
}

/** Remove sucessos do lote sem depender do snapshot de seleção capturado pela UI. */
export function removeRowSelection(
  selectedIds: readonly string[],
  idsToRemove: readonly string[],
): string[] {
  const removed = new Set(idsToRemove);
  return uniqueIds(selectedIds).filter((id) => !removed.has(id));
}

/** Calcula o checkbox do cabeçalho sem considerar itens fora do filtro carregado. */
export function getRowSelectionState(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): { allSelected: boolean; someSelected: boolean } {
  const selected = new Set(selectedIds);
  const visible = uniqueIds(visibleIds);
  const selectedVisibleCount = visible.filter((id) => selected.has(id)).length;

  return {
    allSelected: visible.length > 0 && selectedVisibleCount === visible.length,
    someSelected:
      selectedVisibleCount > 0 && selectedVisibleCount < visible.length,
  };
}

/** Centraliza seleção, reset de contexto e estado indeterminate das listagens. */
export function useRowSelection({
  resetKey,
  visibleIds = [],
}: {
  resetKey?: string;
  visibleIds?: readonly string[];
} = {}) {
  const [state, setState] = useState<{
    resetKey?: string;
    selectedIds: string[];
  }>({ resetKey, selectedIds: [] });

  if (state.resetKey !== resetKey) {
    // Derivar o reset durante a renderização evita o efeito que causaria um
    // segundo render e impede seleção antiga de piscar no novo filtro.
    setState({ resetKey, selectedIds: [] });
  }

  const selectedIds = state.resetKey === resetKey ? state.selectedIds : [];

  const toggle = useCallback(
    (id: string) => {
      setState((current) => ({
        resetKey,
        selectedIds: toggleRowSelection(
          current.resetKey === resetKey ? current.selectedIds : [],
          id,
        ),
      }));
    },
    [resetKey],
  );

  const toggleAll = useCallback(
    (ids: readonly string[]) => {
      setState((current) => ({
        resetKey,
        selectedIds: toggleAllRows(
          current.resetKey === resetKey ? current.selectedIds : [],
          ids,
        ),
      }));
    },
    [resetKey],
  );

  const clear = useCallback(() => {
    setState({ resetKey, selectedIds: [] });
  }, [resetKey]);

  const remove = useCallback(
    (ids: readonly string[]) => {
      setState((current) => ({
        resetKey,
        selectedIds: removeRowSelection(
          current.resetKey === resetKey ? current.selectedIds : [],
          ids,
        ),
      }));
    },
    [resetKey],
  );

  return {
    selectedIds,
    toggle,
    toggleAll,
    clear,
    remove,
    atLimit: selectedIds.length >= BULK_IDS_MAX,
    ...getRowSelectionState(selectedIds, visibleIds),
  };
}
