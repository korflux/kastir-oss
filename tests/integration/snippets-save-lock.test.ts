/**
 * Prova, contra o Postgres real, do Save de scripts (Custom Code) com trava de linha e versão
 * por hash do conteúdo (phase-5, passo 2b): `CustomCodeService.updateSnippet` e
 * `CustomCodeService.patchSnippetContent` sobre `kastir_test`.
 *
 * Só roda com o gate do helper aberto (`DATABASE_URL` igual a `TEST_DATABASE_URL`, loopback,
 * banco `_test`); senão a suíte é pulada sem abrir conexão. Como rodar: `AGENTS.md`, seção
 * Comandos.
 *
 * Desenho sem espera fixa nem dependência de sorte: uma transação "dona" segura a trava da
 * linha (`db.holdRowLock`, do helper), os pedidos reais entram pelo serviço e o teste espera,
 * por condição (`pg_blocking_pids`), que todos estejam enfileirados na trava antes de soltá-la.
 * Assim a sobreposição acontece de verdade em toda execução: sem a trava no Save os pedidos
 * não bloqueiam e o teste falha por não ver ninguém na fila, em vez de passar por acaso.
 *
 * Mocks só na fronteira do processo: `@/lib/prisma` (o serviço recebe o banco de teste por
 * injeção; o módulo real valida o ambiente inteiro ao ser importado) e a fila (Redis); o Save
 * nunca enfileira, só o Publish do teste A18, que usa uma fila falsa.
 */
import { createHash } from "node:crypto";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));

import { CustomCodeService } from "@/lib/Modules/CustomCode/Service";
import { CustomCodeDomainError } from "@/lib/Modules/CustomCode/Types";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

import {
  describeIntegration,
  openIntegrationDatabase,
  type IntegrationDatabase,
} from "./helpers/db";

describeIntegration(
  "Save de scripts com trava de linha no Postgres real",
  { timeout: 60_000 },
  () => {
    let db: IntegrationDatabase;
    let service: CustomCodeService;
    let userId: string;

    beforeAll(async () => {
      db = await openIntegrationDatabase();
      userId = (await db.owner()).userId;
      service = new CustomCodeService(
        db.prisma as never,
        { add: vi.fn(async () => ({ id: "job-id" })) } as never,
      );
    });

    afterAll(async () => {
      await db?.close();
    });

    /* ----------------------------- apoios ----------------------------- */

    const readRow = (id: string) =>
      db.prisma.snippet.findUniqueOrThrow({
        where: { id },
        include: { scopedPages: { select: { pageId: true } } },
      });

    const updateLogCount = (id: string) =>
      db.prisma.logEntry.count({
        where: { objectId: id, action: "SCRIPT_UPDATED" },
      });

    /** Resultado de uma chamada que pode ter sido recusada, sem derrubar o `Promise.all`. */
    async function settle<T>(call: Promise<T>) {
      try {
        return { ok: true as const, value: await call };
      } catch (error) {
        return { ok: false as const, error };
      }
    }

    /* ------------------------------- A8 ------------------------------- */

    const BASE = "AAA BBB";
    const racers: Array<{
      name: string;
      /** Duas chamadas com a mesma versão esperada e resultados diferentes. */
      calls: (
        id: string,
        readAt: { updatedAt: Date },
      ) => [Promise<unknown>, Promise<unknown>];
      finals: [string, string];
    }> = [
      {
        name: "update com expectedContentSha256",
        calls: (id) => [
          service.updateSnippet(userId, {
            id,
            content: "one",
            expectedContentSha256: contentSha256(BASE),
          }),
          service.updateSnippet(userId, {
            id,
            content: "two",
            expectedContentSha256: contentSha256(BASE),
          }),
        ],
        finals: ["one", "two"],
      },
      {
        name: "update com expectedUpdatedAt, como o painel",
        calls: (id, readAt) => [
          service.updateSnippet(userId, {
            id,
            content: "one",
            expectedUpdatedAt: readAt.updatedAt,
          }),
          service.updateSnippet(userId, {
            id,
            content: "two",
            expectedUpdatedAt: readAt.updatedAt,
          }),
        ],
        finals: ["one", "two"],
      },
      {
        name: "patch com expectedContentSha256 e trocas diferentes",
        calls: (id) => [
          service.patchSnippetContent(userId, {
            id,
            expectedContentSha256: contentSha256(BASE),
            operations: [{ old: "AAA", new: "one" }],
          }),
          service.patchSnippetContent(userId, {
            id,
            expectedContentSha256: contentSha256(BASE),
            operations: [{ old: "BBB", new: "two" }],
          }),
        ],
        finals: ["one BBB", "AAA two"],
      },
    ];

    it.each(racers)(
      "A8: duas gravações simultâneas com a mesma versão esperada, exatamente uma grava e a outra recebe CONFLICT ($name)",
      async ({ calls, finals }) => {
        const snippet = await db.createSnippet(BASE);
        const before = await readRow(snippet.id);
        const holder = await db.holdRowLock("Snippet", snippet.id);

        // Os dois pedidos entram juntos e ficam na fila da trava antes de qualquer um ler a
        // linha: é a corrida que, sem a trava, deixaria as duas passarem pela guarda.
        const pending = calls(snippet.id, before).map(settle);
        await holder.waitForQueued(2);
        await holder.release();
        const results = await Promise.all(pending);

        const winners = results.flatMap((result, index) =>
          result.ok ? [index] : [],
        );
        expect(winners).toHaveLength(1);
        const loser = results[winners[0] === 0 ? 1 : 0]!;
        expect(loser.ok).toBe(false);
        if (!loser.ok) {
          expect(loser.error).toBeInstanceOf(CustomCodeDomainError);
          expect(loser.error).toMatchObject({
            code: "CONFLICT",
            message: expect.stringContaining("was updated by another request"),
          });
        }
        // O rascunho final é só o da vencedora, e só ela foi auditada.
        const final = await readRow(snippet.id);
        expect(final.content).toBe(finals[winners[0]!]);
        expect(await updateLogCount(snippet.id)).toBe(1);
      },
    );

    /* ------------------------------- A5 ------------------------------- */

    it("A5: update e patch com hash antigo são recusados com o hash atual e nada é gravado", async () => {
      const snippet = await db.createSnippet("v1");
      const staleHash = contentSha256("v1");
      await service.updateSnippet(userId, {
        id: snippet.id,
        content: "v2 from another session",
        expectedContentSha256: staleHash,
      });
      const afterOther = await readRow(snippet.id);
      const currentHash = contentSha256("v2 from another session");
      expect(await updateLogCount(snippet.id)).toBe(1);

      const refusals = await Promise.all([
        settle(
          service.updateSnippet(userId, {
            id: snippet.id,
            content: "v3",
            expectedContentSha256: staleHash,
          }),
        ),
        settle(
          service.patchSnippetContent(userId, {
            id: snippet.id,
            expectedContentSha256: staleHash,
            operations: [{ old: "v2", new: "v3" }],
          }),
        ),
      ]);

      for (const refusal of refusals) {
        expect(refusal.ok).toBe(false);
        if (!refusal.ok) {
          expect(refusal.error).toMatchObject({
            code: "CONFLICT",
            message: expect.stringContaining(
              `current contentSha256: ${currentHash}`,
            ),
          });
        }
      }
      const final = await readRow(snippet.id);
      expect(final.content).toBe("v2 from another session");
      expect(final.updatedAt).toEqual(afterOther.updatedAt);
      expect(await updateLogCount(snippet.id)).toBe(1);
    });

    /* ------------------------ snapshot da linha lida ------------------------ */

    it.each([
      [
        "update de conteúdo",
        (id: string) =>
          service.updateSnippet(userId, {
            id,
            content: "changed",
            expectedContentSha256: contentSha256("base"),
          }),
      ],
      [
        "patch de conteúdo",
        (id: string) =>
          service.patchSnippetContent(userId, {
            id,
            expectedContentSha256: contentSha256("base"),
            operations: [{ old: "base", new: "changed" }],
          }),
      ],
    ])(
      "um %s conferido só pelo hash não sobrescreve nome, escopo e gatilho alterados por outra gravação",
      async (_name, save) => {
        const snippet = await db.createSnippet("base");
        const page = await db.createPage("<p>scope</p>");
        const holder = await db.holdRowLock("Snippet", snippet.id);

        const pending = settle(save(snippet.id));
        await holder.waitForQueued(1);
        // A outra sessão confirma o que já tinha gravado sob a trava: nome, escopo e gatilho
        // mudam, o conteúdo (e portanto o hash esperado) não.
        await holder.release(async (tx) => {
          await tx.snippet.update({
            where: { id: snippet.id },
            data: {
              name: "renamed by another session",
              scopeType: "SPECIFIC_PAGES",
              triggerType: "PAGE_LOAD",
              triggerConfig: { delaySeconds: 3 },
              maxDisplays: 2,
              displayResetDays: 5,
            },
          });
          await tx.snippetPageScope.create({
            data: { snippetId: snippet.id, pageId: page.id },
          });
        });
        const result = await pending;

        expect(result.ok).toBe(true);
        const final = await readRow(snippet.id);
        expect(final).toMatchObject({
          content: "changed",
          name: "renamed by another session",
          scopeType: "SPECIFIC_PAGES",
          triggerType: "PAGE_LOAD",
          triggerConfig: { delaySeconds: 3 },
          maxDisplays: 2,
          displayResetDays: 5,
        });
        expect(final.scopedPages).toEqual([{ pageId: page.id }]);
      },
    );

    /* ------------------------------- A17 ------------------------------ */

    it("A17: update e patch gravam o conteúdo byte a byte, com CRLF, espaço final e caractere fora do BMP", async () => {
      const snippet = await db.createSnippet("");
      const sent = "<script>\r\nvar a = '🚀';  \r\n\t</script>  \r\n";

      await service.updateSnippet(userId, { id: snippet.id, content: sent });
      const stored = (await readRow(snippet.id)).content;
      expect(
        Buffer.from(stored, "utf8").equals(Buffer.from(sent, "utf8")),
      ).toBe(true);
      expect(contentSha256(stored)).toBe(contentSha256(sent));

      // O patch troca só o trecho: o CRLF e os espaços fora dele sobrevivem.
      await service.patchSnippetContent(userId, {
        id: snippet.id,
        expectedContentSha256: contentSha256(sent),
        operations: [{ old: "var a = '🚀';  \r\n", new: "var a = 1;\r\n" }],
      });
      expect((await readRow(snippet.id)).content).toBe(
        "<script>\r\nvar a = 1;\r\n\t</script>  \r\n",
      );
    });

    /* ------------------------------- A18 ------------------------------ */

    /** Fórmula atual do fingerprint por extenso, independente do código sob teste. */
    function snapshotFingerprint(row: Awaited<ReturnType<typeof readRow>>) {
      return createHash("sha256")
        .update(
          JSON.stringify({
            name: row.name,
            location: row.location,
            content: row.content,
            priority: row.priority,
            scopeType: row.scopeType,
            pageIds: row.scopedPages.map((scope) => scope.pageId).sort(),
            triggerType: row.triggerType,
            triggerConfig: row.triggerConfig,
            maxDisplays: row.maxDisplays,
            displayResetDays: row.displayResetDays,
          }),
        )
        .digest("hex");
    }

    it("A18: draftFingerprint segue a fórmula do snapshot depois de update e patch, e o snapshot repetido continua deduplicado", async () => {
      const first = "<script>one();</script>";
      const second = "<script>two();</script>";
      const snippet = await db.createSnippet(first);

      await service.publishSnippet(userId, snippet.id);
      const firstRevision = await db.prisma.snippetRevision.findFirstOrThrow({
        where: { snippetId: snippet.id },
      });

      const updated = await service.updateSnippet(userId, {
        id: snippet.id,
        content: second,
        expectedContentSha256: contentSha256(first),
      });
      expect(updated.draftFingerprint).toBe(
        snapshotFingerprint(await readRow(snippet.id)),
      );
      await service.publishSnippet(userId, snippet.id);
      expect(
        await db.prisma.snippetRevision.count({
          where: { snippetId: snippet.id },
        }),
      ).toBe(2);

      // Volta ao primeiro conteúdo por patch: o fingerprint do rascunho é o da primeira revisão.
      const patched = await service.patchSnippetContent(userId, {
        id: snippet.id,
        expectedContentSha256: contentSha256(second),
        operations: [{ old: "two", new: "one" }],
      });
      expect(patched.draftFingerprint).toBe(
        snapshotFingerprint(await readRow(snippet.id)),
      );
      expect(patched.draftFingerprint).toBe(firstRevision.fingerprint);

      // Publicar o mesmo snapshot reaproveita a revisão existente (índice único por fingerprint).
      await service.publishSnippet(userId, snippet.id);
      expect(
        await db.prisma.snippetRevision.count({
          where: { snippetId: snippet.id },
        }),
      ).toBe(2);
      expect((await readRow(snippet.id)).publishedRevisionId).toBe(
        firstRevision.id,
      );
    });
  },
);
