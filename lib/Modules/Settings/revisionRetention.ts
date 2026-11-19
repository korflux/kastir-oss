/**
 * Limites da retenção normal de revisões — um lugar só para Settings, job e
 * serviço de revisões. Não espalhar 5/30/3 nos callers.
 */
export const REVISION_RETENTION_MIN = 5;
export const REVISION_RETENTION_MAX = 30;
export const REVISION_RETENTION_DEFAULT = 5;
export const REVISION_PIN_MAX = 3;

/** Lê o valor efetivo: fora da allowlist ou ausente volta ao padrão 5. */
export function effectiveRevisionRetentionLimit(
  value: number | null | undefined,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < REVISION_RETENTION_MIN ||
    value > REVISION_RETENTION_MAX
  ) {
    return REVISION_RETENTION_DEFAULT;
  }
  return value;
}
