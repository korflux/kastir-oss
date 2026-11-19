/**
 * Banco de integração compartilhado pelos arquivos de `tests/integration/`:
 * gate de segurança, cliente Prisma sob demanda e fixtures próprios.
 *
 * Por que existe: `pnpm test` e o CI coletam `tests/**\/*.test.ts`, e as tools
 * MCP e os serviços gravam pelo `lib/prisma`, que usa o `DATABASE_URL` do
 * processo (o `kastir_dev` do `.env`). Uma suíte de integração só pode rodar
 * onde escrever é seguro, então o gate (`evaluateIntegrationGate`) exige, ao
 * mesmo tempo: `DATABASE_URL` do processo igual ao `TEST_DATABASE_URL` do
 * `.env`, host loopback e banco terminado em `_test` (regras invioláveis 1 e 4
 * do `AGENTS.md`). Fora disso a suíte é pulada por `describeIntegration`, sem
 * abrir conexão.
 *
 * Seções deste arquivo:
 *  1. Gate: `evaluateIntegrationGate` (puro, testado) e `describeIntegration`.
 *  2. Sincronização de teste: `deferred` e `waitFor` (espera por condição).
 *  3. `openIntegrationDatabase`: client Prisma por import dinâmico, fixtures
 *     (usuário, pasta, página e script com identificadores únicos), `holdRowLock`
 *     (dono de trava de linha, a barreira determinística das corridas de Save) e
 *     `close`, que solta as travas abertas e remove só o que este helper criou.
 *
 * Decisões não óbvias:
 *  - Corrida de Save não se prova com "dois pedidos ao mesmo tempo" e torcida
 *    pela sobreposição: `holdRowLock` segura a trava da linha, o teste dispara
 *    os pedidos reais, espera por `pg_blocking_pids` que todos estejam
 *    enfileirados na trava e só então a solta. Sem a trava no Save, os pedidos
 *    não bloqueiam e o teste falha por não ver ninguém na fila, em vez de passar
 *    por acaso. É a fonte única desse mecanismo (páginas e scripts).
 *  - O client gerado é importado dinamicamente dentro de
 *    `openIntegrationDatabase`, nunca no topo: sem `pnpm prisma generate` a
 *    coleta não pode quebrar antes de o gate pular a suíte.
 *  - Os arquivos de integração rodam em paralelo no mesmo banco: nada é
 *    truncado nem recriado; cada instância cria linhas com id único e apaga
 *    apenas as próprias.
 *  - Nenhuma mensagem do gate carrega a URL: o valor contém credencial.
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { describe } from "vitest";

import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import {
  lockRowForUpdate,
  type LockableTable,
} from "@/lib/Modules/Shared/RowLock";

/* ------------------------------- 1. gate -------------------------------- */

export type IntegrationGate =
  | { enabled: true; connectionString: string }
  | { enabled: false; reason: string };

/** Hosts aceitos; `URL.hostname` devolve o IPv6 entre colchetes. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Decide se a suíte pode rodar. Pura: recebe o ambiente e devolve o motivo do
 * "não" sem citar a URL. Parâmetros `host` e `hostaddr` na query também são
 * recusados, porque o driver `pg` os usa para trocar o host da conexão e
 * contornariam a checagem do host loopback.
 */
export function evaluateIntegrationGate(
  env: Readonly<Record<string, string | undefined>>,
): IntegrationGate {
  const testUrl = env["TEST_DATABASE_URL"];
  if (!testUrl) {
    return { enabled: false, reason: "TEST_DATABASE_URL ausente" };
  }
  if (env["DATABASE_URL"] !== testUrl) {
    return {
      enabled: false,
      reason: "DATABASE_URL do processo difere de TEST_DATABASE_URL",
    };
  }

  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    return { enabled: false, reason: "TEST_DATABASE_URL não é uma URL válida" };
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { enabled: false, reason: "protocolo diferente de PostgreSQL" };
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return { enabled: false, reason: "host fora do loopback" };
  }
  if (url.searchParams.has("host") || url.searchParams.has("hostaddr")) {
    return { enabled: false, reason: "a query sobrescreve o host" };
  }
  if (!decodeURIComponent(url.pathname.slice(1)).endsWith("_test")) {
    return { enabled: false, reason: "o banco não termina em _test" };
  }

  return { enabled: true, connectionString: testUrl };
}

const gate = evaluateIntegrationGate(process.env);

/** `describe` que pula a suíte inteira (hooks incluídos) quando o gate fecha. */
export const describeIntegration = describe.skipIf(!gate.enabled);

/* ------------------------ 2. sincronização de teste ----------------------- */

/** Promise que o teste resolve de fora para sincronizar as transações. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Espera por condição, nunca por tempo fixo: o intervalo só limita o custo da
 * consulta e o teto impede que uma barreira que nunca abre trave a suíte.
 */
async function waitFor(
  condition: () => Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/* ------------------------- 3. cliente e fixtures ------------------------- */

/**
 * Folga das transações interativas do Prisma (padrão: 5 s) para a transação
 * dona da trava, que espera o teste enfileirar os pedidos, em máquina carregada.
 */
const HOLD_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/** Gravação que o dono da trava faz na própria transação antes de confirmar. */
export type RowLockChanges = (tx: Prisma.TransactionClient) => Promise<void>;

/** Transação dona da trava de uma linha, aberta por `holdRowLock`. */
export type RowLockHolder = {
  /**
   * Espera, por condição, que ao menos `count` backends estejam bloqueados
   * nesta transação, direta ou indiretamente (o primeiro espera o dono, os
   * seguintes esperam o primeiro: `pg_blocking_pids` encadeia os dois casos).
   * Lança por timeout se os pedidos não chegarem à trava, o que prova que o
   * Save sob teste não está travando a linha.
   */
  waitForQueued(count: number): Promise<void>;
  /**
   * Roda `changes` dentro da transação ainda dona da trava (o que "a outra
   * sessão" já gravou), confirma e resolve quando a transação termina. Os
   * pedidos enfileirados seguem a partir daí; o chamador os aguarda à parte.
   */
  release(changes?: RowLockChanges): Promise<void>;
};

export type IntegrationDatabase = {
  /** Client Prisma ligado ao banco de teste, para o que os fixtures não cobrem. */
  prisma: PrismaClient;
  /**
   * Usuário e pasta de teste, criados na primeira chamada e reaproveitados:
   * `userId` serve de autor e de ator nos serviços sob teste.
   */
  owner(): Promise<{ userId: string; folderId: string }>;
  /** Página DRAFT nova, com slug único, na pasta e com o autor do `owner()`. */
  createPage(content?: string): Promise<{ id: string; slug: string }>;
  /** Script DRAFT novo, com nome único. */
  createSnippet(content?: string): Promise<{ id: string; name: string }>;
  /**
   * Segura a trava (`lockRowForUpdate`, a mesma dos Saves) da linha `id` de
   * `table` numa transação à parte, como uma gravação em andamento de outra
   * sessão. Resolve quando a trava já está tomada. O teste dispara os pedidos,
   * chama `waitForQueued` e só então `release`. Travas ainda abertas quando o
   * teste falha são soltas por `close`, para não bloquear a limpeza.
   */
  holdRowLock(table: LockableTable, id: string): Promise<RowLockHolder>;
  /** Solta as travas abertas, apaga só os fixtures desta instância e encerra a conexão. */
  close(): Promise<void>;
};

/**
 * Abre o banco de teste. Só chamar de dentro de `describeIntegration`: com o
 * gate fechado, lança em vez de conectar.
 */
export async function openIntegrationDatabase(): Promise<IntegrationDatabase> {
  if (!gate.enabled) {
    throw new Error(`Integration database is disabled: ${gate.reason}`);
  }

  const { PrismaClient: Client } =
    await import("@/app/generated/prisma/client");
  const prisma = new Client({
    adapter: new PrismaPg({ connectionString: gate.connectionString }),
  });

  const pageIds: string[] = [];
  const snippetIds: string[] = [];
  const folderIds: string[] = [];
  const userIds: string[] = [];
  let ownerPromise: Promise<{ userId: string; folderId: string }> | undefined;

  /** Cria usuário e pasta uma única vez; chamadas concorrentes dividem o resultado. */
  function owner() {
    ownerPromise ??= (async () => {
      const suffix = randomUUID();
      const user = await prisma.user.create({
        data: {
          id: `it-user-${suffix}`,
          name: "Integration owner",
          email: `it-${suffix}@integration.invalid`,
          role: "EDITOR",
        },
        select: { id: true },
      });
      userIds.push(user.id);
      const folder = await prisma.pageFolder.create({
        data: { name: `it-folder-${suffix}` },
        select: { id: true },
      });
      folderIds.push(folder.id);
      return { userId: user.id, folderId: folder.id };
    })();
    return ownerPromise;
  }

  async function createPage(content = "") {
    const { userId, folderId } = await owner();
    const suffix = randomUUID();
    const page = await prisma.page.create({
      data: {
        title: `it-page-${suffix}`,
        slug: `it-page-${suffix}`,
        content,
        folderId,
        authorId: userId,
      },
      select: { id: true, slug: true },
    });
    pageIds.push(page.id);
    return page;
  }

  async function createSnippet(content = "") {
    const snippet = await prisma.snippet.create({
      data: {
        name: `it-script-${randomUUID()}`,
        location: "HEADER",
        content,
      },
      select: { id: true, name: true },
    });
    snippetIds.push(snippet.id);
    return snippet;
  }

  /** Donos de trava ainda não soltos; `close` os solta antes de apagar os fixtures. */
  const openHolders: RowLockHolder[] = [];

  async function holdRowLock(table: LockableTable, id: string) {
    const ready = deferred<number>();
    const releaseSignal = deferred<RowLockChanges | undefined>();
    const done = prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, table, id);
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      ready.resolve(pid);
      const changes = await releaseSignal.promise;
      if (changes) await changes(tx);
    }, HOLD_TX_OPTIONS);
    // Falha antes de segurar a trava não pode deixar o teste esperando.
    done.catch((error) => ready.reject(error));
    const holderPid = await ready.promise;

    async function queued() {
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        WITH RECURSIVE chain(pid) AS (
          SELECT pid FROM pg_stat_activity
          WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a
          JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
        )
        SELECT count(*)::int AS n FROM chain`;
      return rows[0]?.n ?? 0;
    }

    const holder: RowLockHolder = {
      waitForQueued: (count) =>
        waitFor(
          async () => (await queued()) >= count,
          `${count} request(s) to queue on the ${table} row lock`,
        ),
      async release(changes) {
        releaseSignal.resolve(changes);
        await done;
      },
    };
    openHolders.push(holder);
    return holder;
  }

  /**
   * Ordem por dependência: travas abertas primeiro (um teste que falhou antes
   * de soltar a sua deixaria a linha travada até o timeout da transação), depois
   * logs (sem FK) e páginas (revisões saem em cascata) antes de pasta e usuário,
   * que as páginas referenciam com Restrict. Só ids criados aqui; o log apagado
   * é o gerado sobre eles ou pelo usuário de teste.
   */
  async function close() {
    try {
      for (const holder of openHolders.splice(0)) {
        await holder.release().catch(() => undefined);
      }
      await prisma.logEntry.deleteMany({
        where: {
          OR: [
            { objectId: { in: [...pageIds, ...snippetIds] } },
            { userId: { in: userIds } },
          ],
        },
      });
      await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
      await prisma.snippet.deleteMany({ where: { id: { in: snippetIds } } });
      await prisma.pageFolder.deleteMany({ where: { id: { in: folderIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }

  return { prisma, owner, createPage, createSnippet, holdRowLock, close };
}
