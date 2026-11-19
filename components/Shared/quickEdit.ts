/** Mantém o popover aberto enquanto a mutação assíncrona ainda pode falhar. */
export function canChangeQuickEditOpen(
  nextOpen: boolean,
  saving: boolean,
): boolean {
  return nextOpen || !saving;
}
