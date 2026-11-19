/**
 * Trava de linha comum aos saves de páginas e scripts (`Pages/lifecycle.ts`,
 * `CustomCode/lifecycle.ts`): "ler, conferir a versão e gravar" sobre a mesma
 * linha precisa ser atômico no banco (regra 24 do usuário), não decidido em
 * memória nem em cache.
 *
 * Como funciona: `SELECT ... FOR UPDATE` dentro da transação interativa do
 * Prisma faz a segunda transação esperar, no Postgres, até a primeira
 * confirmar ou desfazer. No isolamento padrão (READ COMMITTED), a leitura que
 * vem depois da trava enxerga o valor já confirmado pela vencedora; por isso
 * o chamador trava ANTES de ler o que vai conferir.
 *
 * Decisões não óbvias:
 *  - Tabelas por allowlist fixa, cada uma com a sua consulta literal. O nome
 *    de uma tabela não pode ir como parâmetro vinculado (`$1`) e concatená-lo
 *    abriria injeção; o `id` sempre vai vinculado pela tagged template do
 *    Prisma (equivalente a `Prisma.sql`), que também evita importar o client
 *    gerado em tempo de execução neste módulo leve, carregado por backfill e
 *    pelas tools MCP.
 *  - Nomes físicos entre aspas (`"Page"`, `"Snippet"`): os modelos não têm
 *    `@@map`, então a tabela no Postgres tem o mesmo nome do modelo.
 *  - Sem retorno: linha inexistente não é erro aqui (o `SELECT` volta vazio e
 *    nada fica travado); o chamador já trata ausência na leitura que se segue.
 *  - `FOR UPDATE` (e não `FOR NO KEY UPDATE`) é o que a spec da phase-5 pede;
 *    ele conflita também com o `FOR KEY SHARE` que o insert de uma revisão
 *    (FK) toma na linha pai, então revisões novas esperam a transação
 *    travada, o que é a serialização desejada.
 *
 * Provado em `tests/integration/row-lock.test.ts` contra o Postgres real.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

/** Tabelas físicas que aceitam a trava; o domínio decide qual passar. */
export type LockableTable = "Page" | "Snippet";

/** Só o que a trava usa do cliente de transação, para aceitar `tx` e mocks. */
type RowLockTx = Pick<PrismaClient, "$queryRaw">;

/**
 * Trava a linha `id` de `table` até o fim da transação `tx`. Deve rodar dentro
 * de `prisma.$transaction(async (tx) => ...)`; fora dela a trava termina no
 * próprio comando e não protege nada.
 */
export async function lockRowForUpdate(
  tx: RowLockTx,
  table: LockableTable,
  id: string,
): Promise<void> {
  switch (table) {
    case "Page":
      await tx.$queryRaw`SELECT "id" FROM "Page" WHERE "id" = ${id} FOR UPDATE`;
      return;
    case "Snippet":
      await tx.$queryRaw`SELECT "id" FROM "Snippet" WHERE "id" = ${id} FOR UPDATE`;
      return;
    default: {
      // Defesa em tempo de execução para chamador sem tipagem (JS, `as`).
      const unsupported: never = table;
      throw new Error(`Row lock is not allowed for table: ${unsupported}`);
    }
  }
}
