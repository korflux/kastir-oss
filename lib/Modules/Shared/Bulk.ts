import { z } from "zod";

import { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";

export { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";

/** Validação de borda comum; a action e os campos extras ficam no schema da rota. */
export const bulkIdsSchema = z
  .array(z.string().trim().cuid())
  .min(1)
  .max(BULK_IDS_MAX);

export type BulkFailure = {
  id: string;
  code: string;
  message: string;
};

export type BulkResult = {
  ok: string[];
  failed: BulkFailure[];
};

/** Mantém só a primeira ocorrência para não repetir efeitos colaterais no lote. */
export function normalizeBulkIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()))];
}

/** A falha de qualquer item torna a resposta parcial, inclusive se todos falharem. */
export function bulkResponseStatus(result: BulkResult): 200 | 207 {
  return result.failed.length > 0 ? 207 : 200;
}

/** Processa cada ID em ordem e permite reportar falhas sem abortar os próximos itens. */
export async function runBulk<T>(
  ids: readonly string[],
  execute: (id: string) => Promise<T>,
  toFailure: (id: string, error: unknown) => BulkFailure,
): Promise<BulkResult> {
  const result: BulkResult = { ok: [], failed: [] };

  for (const id of normalizeBulkIds(ids)) {
    try {
      await execute(id);
      result.ok.push(id);
    } catch (error) {
      result.failed.push(toFailure(id, error));
    }
  }

  return result;
}
