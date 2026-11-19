/**
 * Prova da trava de linha (`lib/Modules/Shared/RowLock.ts`) e do banco de
 * integração (`tests/integration/helpers/db.ts`), base dos saves de páginas e
 * scripts das tools de patch (phase-5).
 *
 * Seções:
 *  1. Sem banco (rodam em `pnpm test`): o gate do helper e o formato da
 *     consulta de trava, incluindo a allowlist de tabelas.
 *  2. Com Postgres real (só com o gate aberto; senão a suíte é pulada sem
 *     abrir conexão): duas transações concorrentes sobre a mesma linha de
 *     `Page` e de `Snippet`, mais o contrato de limpeza dos fixtures.
 *
 * Como rodar a seção 2: `AGENTS.md`, seção Comandos.
 *
 * O desenho da seção 2 evita espera fixa: a transação B informa o próprio pid
 * do backend e o teste consulta `pg_stat_activity` até B aparecer esperando um
 * lock, só então libera a A. Sem a trava (controle), B não espera e lê o valor
 * antigo, que é a corrida que a trava existe para fechar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/app/generated/prisma/client";
import {
  lockRowForUpdate,
  type LockableTable,
} from "@/lib/Modules/Shared/RowLock";

import {
  describeIntegration,
  evaluateIntegrationGate,
  openIntegrationDatabase,
  type IntegrationDatabase,
} from "./helpers/db";

/* ------------------------------ 1. sem banco ----------------------------- */

describe("gate do banco de integração", () => {
  const base = "postgresql://127.0.0.1:5432/app_test";

  it.each([
    ["127.0.0.1", base],
    ["localhost", "postgresql://localhost:5432/app_test"],
    ["IPv6 loopback", "postgresql://[::1]:5432/app_test"],
    ["esquema postgres", "postgres://127.0.0.1:5432/app_test"],
  ])("abre com URLs iguais, loopback e banco _test (%s)", (_name, url) => {
    expect(
      evaluateIntegrationGate({ DATABASE_URL: url, TEST_DATABASE_URL: url }),
    ).toEqual({ enabled: true, connectionString: url });
  });

  it.each([
    ["TEST_DATABASE_URL ausente", { DATABASE_URL: base }],
    ["DATABASE_URL ausente", { TEST_DATABASE_URL: base }],
    [
      "DATABASE_URL de outro banco (dev)",
      {
        DATABASE_URL: "postgresql://127.0.0.1:5432/app_dev",
        TEST_DATABASE_URL: base,
      },
    ],
    ["ambos vazios", {}],
  ])("fecha quando as variáveis não coincidem: %s", (_name, env) => {
    expect(evaluateIntegrationGate(env).enabled).toBe(false);
  });

  it.each([
    ["host remoto", "postgresql://db.example.com:5432/app_test"],
    [
      "host loopback só como prefixo",
      "postgresql://127.0.0.1.evil.test/app_test",
    ],
    [
      "host real depois do userinfo",
      "postgresql://127.0.0.1@evil.test/app_test",
    ],
    ["banco sem sufixo _test", "postgresql://127.0.0.1:5432/app_dev"],
    ["banco com _test no meio", "postgresql://127.0.0.1:5432/app_testing"],
    ["query que troca o host", `${base}?host=db.example.com`],
    ["query que troca o endereço", `${base}?hostaddr=10.0.0.5`],
    ["protocolo de outro banco", "mysql://127.0.0.1:3306/app_test"],
    ["texto que não é URL", "not a url"],
  ])("fecha mesmo com as variáveis iguais: %s", (_name, url) => {
    const result = evaluateIntegrationGate({
      DATABASE_URL: url,
      TEST_DATABASE_URL: url,
    });

    expect(result.enabled).toBe(false);
    // O motivo nunca cita a URL, que carrega credencial em uso real.
    if (!result.enabled) expect(result.reason).not.toContain(url);
  });
});

describe("consulta da trava de linha", () => {
  type Tx = Parameters<typeof lockRowForUpdate>[0];

  /** Fronteira do Prisma: guarda a tagged template recebida, sem banco. */
  function fakeTx() {
    const queryRaw = vi.fn().mockResolvedValue([]);
    return { tx: { $queryRaw: queryRaw } as unknown as Tx, queryRaw };
  }

  it.each([
    ["Page", 'FROM "Page"'],
    ["Snippet", 'FROM "Snippet"'],
  ] as const)(
    "%s: trava com FOR UPDATE e envia o id como parâmetro, nunca no texto",
    async (table, from) => {
      const { tx, queryRaw } = fakeTx();
      const id = 'x\'; DROP TABLE "Page"; --';

      await lockRowForUpdate(tx, table, id);

      expect(queryRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const text = strings.join("$");
      expect(text).toContain(from);
      expect(text).toContain("FOR UPDATE");
      expect(text).not.toContain(id);
      expect(values).toEqual([id]);
    },
  );

  it("recusa tabela fora da allowlist antes de tocar o banco", async () => {
    const { tx, queryRaw } = fakeTx();

    await expect(
      lockRowForUpdate(tx, "User" as LockableTable, "id-1"),
    ).rejects.toThrow("not allowed");

    expect(queryRaw).not.toHaveBeenCalled();
  });
});

/* ----------------------------- 2. Postgres real --------------------------- */

/** Promise que o teste resolve de fora para sincronizar as duas transações. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Espera por condição (nunca por tempo fixo), com teto para não travar a suíte. */
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

/** Folga das transações interativas do Prisma (padrão: 5 s) em máquina carregada. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

describeIntegration(
  "trava de linha no Postgres real",
  { timeout: 30_000 },
  () => {
    let db: IntegrationDatabase;

    beforeAll(async () => {
      db = await openIntegrationDatabase();
    });

    afterAll(async () => {
      await db?.close();
    });

    /** O que muda entre as tabelas: como criar, ler e gravar o `content`. */
    const subjects: Record<
      LockableTable,
      {
        create(): Promise<{ id: string }>;
        read(tx: Prisma.TransactionClient, id: string): Promise<string>;
        write(
          tx: Prisma.TransactionClient,
          id: string,
          content: string,
        ): Promise<unknown>;
      }
    > = {
      Page: {
        create: () => db.createPage("v0"),
        read: async (tx, id) =>
          (
            await tx.page.findUniqueOrThrow({
              where: { id },
              select: { content: true },
            })
          ).content,
        write: (tx, id, content) =>
          tx.page.update({ where: { id }, data: { content } }),
      },
      Snippet: {
        create: () => db.createSnippet("v0"),
        read: async (tx, id) =>
          (
            await tx.snippet.findUniqueOrThrow({
              where: { id },
              select: { content: true },
            })
          ).content,
        write: (tx, id, content) =>
          tx.snippet.update({ where: { id }, data: { content } }),
      },
    };

    /**
     * A trava a linha e a segura; B começa depois e tenta o mesmo caminho.
     * `withLock: false` é o controle: B pula a trava e só lê e grava.
     */
    async function raceTwoTransactions(
      table: LockableTable,
      withLock: boolean,
    ) {
      const subject = subjects[table];
      const { id } = await subject.create();

      const aHoldsLock = deferred();
      const releaseA = deferred();
      const bBackendPid = deferred<number>();
      const bRead = deferred();
      const observed = { bSaw: "", bFinished: false };

      const txA = db.prisma.$transaction(async (tx) => {
        await lockRowForUpdate(tx, table, id);
        aHoldsLock.resolve();
        await releaseA.promise;
        await subject.write(tx, id, "from-A");
      }, TX_OPTIONS);
      // Falha de A antes de segurar a trava não pode deixar o teste esperando.
      await Promise.race([aHoldsLock.promise, txA]);

      const txB = db.prisma
        .$transaction(async (tx) => {
          const [{ pid }] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          bBackendPid.resolve(pid);
          if (withLock) await lockRowForUpdate(tx, table, id);
          observed.bSaw = await subject.read(tx, id);
          bRead.resolve();
          await subject.write(tx, id, "from-B");
        }, TX_OPTIONS)
        .finally(() => {
          observed.bFinished = true;
        });
      // Se B falhar antes de sinalizar, o teste vê o erro em vez de esperar.
      txB.catch((error) => bBackendPid.reject(error));

      const pid = await bBackendPid.promise;
      const bIsWaitingForLock = async () => {
        const rows = await db.prisma.$queryRaw<
          { waiting: boolean }[]
        >`SELECT (wait_event_type = 'Lock') AS waiting FROM pg_stat_activity WHERE pid = ${pid}::int`;
        return rows[0]?.waiting === true;
      };

      // Com a trava, B espera na linha; sem ela, B segue e lê sem esperar.
      if (withLock) {
        await waitFor(bIsWaitingForLock, "B to wait for the row lock");
      } else {
        await Promise.race([bRead.promise, txB]);
      }
      const readBeforeRelease = observed.bSaw;
      const finishedBeforeRelease = observed.bFinished;

      releaseA.resolve();
      await Promise.all([txA, txB]);

      const final = await db.prisma.$transaction((tx) => subject.read(tx, id));
      return { ...observed, readBeforeRelease, finishedBeforeRelease, final };
    }

    it.each(["Page", "Snippet"] as const)(
      "%s: a segunda transação espera a primeira e lê o valor confirmado",
      async (table) => {
        const result = await raceTwoTransactions(table, true);

        // B ficou bloqueada na trava: não leu nada nem terminou enquanto A
        // segurava a linha.
        expect(result.readBeforeRelease).toBe("");
        expect(result.finishedBeforeRelease).toBe(false);
        // Depois do commit de A, B leu o valor de A (não o v0) e gravou por cima
        // dele: nenhuma das duas gravações partiu de leitura velha.
        expect(result.bSaw).toBe("from-A");
        expect(result.final).toBe("from-B");
      },
    );

    it.each(["Page", "Snippet"] as const)(
      "%s: controle sem a trava, B lê o valor antigo enquanto A não confirma",
      async (table) => {
        const result = await raceTwoTransactions(table, false);

        // É a corrida de ler, decidir e gravar que a trava fecha: B decide sobre
        // v0 mesmo com A já dona da linha.
        expect(result.bSaw).toBe("v0");
        expect(result.final).toBe("from-B");
      },
    );

    it("close apaga só os fixtures da própria instância", async () => {
      const mine = await openIntegrationDatabase();
      const other = await openIntegrationDatabase();
      try {
        const myPage = await mine.createPage("x");
        const mySnippet = await mine.createSnippet("y");
        const { userId, folderId } = await mine.owner();
        await mine.prisma.logEntry.create({
          data: {
            userId,
            action: "TEST",
            objectType: "PAGE",
            objectLabel: "row-lock fixture",
            objectId: myPage.id,
          },
        });
        const otherPage = await other.createPage("z");

        await mine.close();

        const count = {
          page: await other.prisma.page.count({ where: { id: myPage.id } }),
          snippet: await other.prisma.snippet.count({
            where: { id: mySnippet.id },
          }),
          folder: await other.prisma.pageFolder.count({
            where: { id: folderId },
          }),
          user: await other.prisma.user.count({ where: { id: userId } }),
          log: await other.prisma.logEntry.count({
            where: { objectId: myPage.id },
          }),
          otherPage: await other.prisma.page.count({
            where: { id: otherPage.id },
          }),
        };
        expect(count).toEqual({
          page: 0,
          snippet: 0,
          folder: 0,
          user: 0,
          log: 0,
          otherPage: 1,
        });
      } finally {
        await other.close();
      }
    });
  },
);
