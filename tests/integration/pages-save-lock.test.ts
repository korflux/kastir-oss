/**
 * Prova no Postgres real do Save e do Patch de páginas com trava de linha e
 * versão por hash (phase-5, passo 2a): `PageLifecycle.save` e `patchContent`
 * por `PageService`, sobre o banco de teste do helper de integração.
 *
 * Critérios provados aqui, cada título começa pelo ID:
 *  - A5: update e patch com hash antigo recusam com o hash atual e não gravam;
 *  - A7: painel com `expectedUpdatedAt` antigo depois de um update do MCP;
 *  - A8: duas gravações simultâneas com a mesma versão esperada, uma vence;
 *  - A9: hash lido continua valendo depois de um publish (muda o `updatedAt`);
 *  - A17: conteúdo gravado byte a byte, inclusive CRLF e espaços finais;
 *  - A18: `draftFingerprint` segue a fórmula do snapshot e as revisões
 *    continuam deduplicadas.
 *
 * Só roda com o gate do helper aberto (`DATABASE_URL` igual a
 * `TEST_DATABASE_URL`, loopback, banco `_test`); senão é pulado sem abrir
 * conexão. Como rodar: `AGENTS.md`, seção Comandos.
 *
 * Fronteiras externas: o purge de CDN é mockado; o HTML publicado vai para um
 * diretório temporário (`PUBLIC_DIR` do serviço, nunca o `public/` do projeto)
 * e o compilador é um stub. O banco e os serviços de domínio são reais.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({
  cloudflarePurge: vi.fn(async () => ({ status: "SKIPPED" })),
}));

import { PageService, type PageDatabase } from "@/lib/Modules/Pages/Service";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";
import { createPageFileStore } from "@/lib/Publishing/fileStore";

import {
  describeIntegration,
  openIntegrationDatabase,
  type IntegrationDatabase,
} from "./helpers/db";

describeIntegration(
  "save de páginas com trava de linha no Postgres real",
  { timeout: 60_000 },
  () => {
    let db: IntegrationDatabase;
    let service: PageService;
    let userId: string;
    let publicDir: string;

    beforeAll(async () => {
      // Origem pública do purge de CDN; o `.env` de dev já define, o fallback
      // só protege um ambiente sem ele.
      process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
      db = await openIntegrationDatabase();
      userId = (await db.owner()).userId;
      publicDir = await mkdtemp(join(tmpdir(), "kastir-pages-save-lock-"));
      service = new PageService(
        db.prisma as unknown as PageDatabase,
        createPageFileStore(publicDir),
        async (page) => `compiled:${page.content}`,
        createMediaStorage(publicDir, join(publicDir, ".staging")),
        publicDir,
      );
    });

    afterAll(async () => {
      await db?.close();
      if (publicDir) await rm(publicDir, { recursive: true, force: true });
    });

    const readPage = (id: string) =>
      db.prisma.page.findUniqueOrThrow({ where: { id } });

    const countUpdates = (id: string) =>
      db.prisma.logEntry.count({
        where: { objectId: id, action: "PAGE_UPDATED" },
      });

    /**
     * Página com `updatedAt` recuado em 1 minuto: a gravação seguinte sempre
     * muda a data, então a conferência por `expectedUpdatedAt` não depende de
     * duas gravações caírem em milissegundos diferentes.
     */
    async function createAgedPage(content: string) {
      const page = await db.createPage(content);
      await db.prisma.page.update({
        where: { id: page.id },
        data: { updatedAt: new Date(Date.now() - 60_000) },
      });
      return page;
    }

    /** SHA-256 do snapshot pela fórmula do `draftFingerprint`, sem o helper do projeto. */
    function snapshotFingerprint(row: {
      title: string;
      slug: string;
      content: string;
      seoTitle: string | null;
      seoDescription: string | null;
      seoKeyword: string | null;
      folderId: string;
    }) {
      return createHash("sha256")
        .update(
          JSON.stringify({
            title: row.title,
            slug: row.slug,
            content: row.content,
            seoTitle: row.seoTitle,
            seoDescription: row.seoDescription,
            seoKeyword: row.seoKeyword,
            folderId: row.folderId,
          }),
        )
        .digest("hex");
    }

    /* ------------------------------- A5 -------------------------------- */

    const staleHashAttempts = {
      update: (id: string, hash: string) =>
        service.updatePage(userId, {
          id,
          expectedContentSha256: hash,
          content: "v3",
        }),
      patch: (id: string, hash: string) =>
        service.patchPageContent(userId, {
          id,
          expectedContentSha256: hash,
          operations: [{ old: "v2", new: "v3" }],
        }),
    } as const;

    it.each(["update", "patch"] as const)(
      "A5: %s com hash antigo recusa com o hash atual e não grava",
      async (kind) => {
        const { id } = await db.createPage("v1");
        const staleHash = contentSha256("v1");
        // Outra sessão grava depois da leitura que gerou o hash.
        await service.updatePage(userId, { id, content: "v2" });
        const before = await readPage(id);

        await expect(
          staleHashAttempts[kind](id, staleHash),
        ).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining(contentSha256("v2")),
        });

        const after = await readPage(id);
        expect(after.content).toBe("v2");
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(await countUpdates(id)).toBe(1);
      },
    );

    /* ------------------------------- A7 -------------------------------- */

    it("A7: painel com expectedUpdatedAt antigo depois de update do MCP recebe conflito e o rascunho do MCP permanece", async () => {
      const { id } = await createAgedPage("v1");
      // O painel abriu a página e guardou a versão que leu.
      const opened = await readPage(id);
      await service.updatePage(
        userId,
        { id, content: "from-mcp" },
        { source: "MCP", tool: "kastir_pages_update" },
      );

      await expect(
        service.updatePage(
          userId,
          { id, expectedUpdatedAt: opened.updatedAt, content: "from-panel" },
          { source: "PANEL" },
        ),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        // Frase que o editor do painel reconhece.
        message: expect.stringContaining("was updated by another request"),
      });

      expect((await readPage(id)).content).toBe("from-mcp");
    });

    /* ------------------------------- A8 -------------------------------- */

    /**
     * Cada variante cria a sua página, segura a trava da linha numa transação
     * dona (`db.holdRowLock`), dispara as duas gravações reais e espera, por
     * condição (`pg_blocking_pids`), que as duas estejam enfileiradas na trava
     * antes de soltá-la: a sobreposição acontece de verdade em toda execução,
     * sem espera fixa nem torcida pelo relógio. Sem a trava no Save, as duas
     * leem a versão antiga, passam pela guarda e a última sobrescreve a
     * primeira (e o teste falha por não ver ninguém na fila); com ela, a
     * segunda espera, lê o valor confirmado e recebe CONFLICT.
     */
    const racers = {
      "update com expectedUpdatedAt (painel)": async (id: string) => {
        const { updatedAt } = await readPage(id);
        return [
          () =>
            service.updatePage(userId, {
              id,
              expectedUpdatedAt: updatedAt,
              content: "from-A",
            }),
          () =>
            service.updatePage(userId, {
              id,
              expectedUpdatedAt: updatedAt,
              content: "from-B",
            }),
        ];
      },
      "update com expectedContentSha256": async (id: string) => {
        const expectedContentSha256 = contentSha256(
          (await readPage(id)).content,
        );
        return [
          () =>
            service.updatePage(userId, {
              id,
              expectedContentSha256,
              content: "from-A",
            }),
          () =>
            service.updatePage(userId, {
              id,
              expectedContentSha256,
              content: "from-B",
            }),
        ];
      },
      "update e patch com o mesmo hash": async (id: string) => {
        const expectedContentSha256 = contentSha256(
          (await readPage(id)).content,
        );
        return [
          () =>
            service.updatePage(userId, {
              id,
              expectedContentSha256,
              content: "from-A",
            }),
          () =>
            service.patchPageContent(userId, {
              id,
              expectedContentSha256,
              operations: [{ old: "v1", new: "from-B" }],
            }),
        ];
      },
    } as const;

    it.each(Object.keys(racers) as Array<keyof typeof racers>)(
      "A8: duas gravações simultâneas, %s: exatamente uma grava e a outra recebe CONFLICT",
      async (name) => {
        const { id } = await createAgedPage("v1");
        const [first, second] = await racers[name](id);
        const holder = await db.holdRowLock("Page", id);

        // Os dois pedidos entram juntos e ficam na fila antes de qualquer um ler a linha.
        const pending = Promise.allSettled([first(), second()]);
        await holder.waitForQueued(2);
        await holder.release();
        const results = await pending;

        const winners = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const losers = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0]).toMatchObject({ code: "CONFLICT" });
        // O rascunho final é o da vencedora, e só ela foi auditada.
        expect((await readPage(id)).content).toBe(winners[0]!.content);
        expect(await countUpdates(id)).toBe(1);
      },
    );

    /* ------------------------------- A9 -------------------------------- */

    it("A9: update com o hash lido passa depois do publish, mesmo com expectedUpdatedAt anterior a ele", async () => {
      const { id } = await createAgedPage("<h1>v1</h1>");
      const read = await readPage(id);
      await service.publishPage(userId, id);
      expect((await readPage(id)).updatedAt.getTime()).toBeGreaterThan(
        read.updatedAt.getTime(),
      );

      // Controle: sem hash vale a data, e a data anterior ao publish é recusada.
      await expect(
        service.updatePage(userId, {
          id,
          expectedUpdatedAt: read.updatedAt,
          content: "<h1>v2</h1>",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      await service.updatePage(userId, {
        id,
        expectedContentSha256: contentSha256(read.content),
        expectedUpdatedAt: read.updatedAt,
        content: "<h1>v2</h1>",
      });

      expect((await readPage(id)).content).toBe("<h1>v2</h1>");
    });

    /* ------------------------------ A17 -------------------------------- */

    it("A17: update com o conteúdo inteiro grava byte a byte, com CRLF, espaços finais e caracteres fora do BMP", async () => {
      const { id } = await db.createPage("");
      const sent = "<p>\r\n  texto  \r\n</p>   \r\n\t \r\n🚀 é   ";

      await service.updatePage(userId, { id, content: sent });

      const stored = (await readPage(id)).content;
      expect(
        Buffer.from(stored, "utf8").equals(Buffer.from(sent, "utf8")),
      ).toBe(true);
      expect(contentSha256(stored)).toBe(contentSha256(sent));
    });

    it("A17: o patch troca só o trecho casado e preserva o resto byte a byte", async () => {
      const original = "<p>\r\n  texto  \r\n</p>   \r\n\t \r\n🚀 é ";
      const { id } = await db.createPage(original);

      await service.patchPageContent(userId, {
        id,
        expectedContentSha256: contentSha256(original),
        operations: [{ old: "texto", new: "TEXTO" }],
      });

      expect((await readPage(id)).content).toBe(
        "<p>\r\n  TEXTO  \r\n</p>   \r\n\t \r\n🚀 é ",
      );
    });

    it("A17: o casamento não normaliza CRLF: LF não casa com CRLF e CRLF casa", async () => {
      const crlf = "<p>\r\n</p>";
      const { id } = await db.createPage(crlf);
      const expectedContentSha256 = contentSha256(crlf);

      await expect(
        service.patchPageContent(userId, {
          id,
          expectedContentSha256,
          operations: [{ old: "<p>\n</p>", new: "<p></p>" }],
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringMatching(/Operation 0.*0 times/),
      });
      expect((await readPage(id)).content).toBe(crlf);

      await service.patchPageContent(userId, {
        id,
        expectedContentSha256,
        operations: [{ old: crlf, new: "<p></p>" }],
      });
      expect((await readPage(id)).content).toBe("<p></p>");
    });

    /* ------------------------------ A18 -------------------------------- */

    it("A18: draftFingerprint do update e do patch segue a fórmula do snapshot", async () => {
      const { id } = await db.createPage("<h1>v1</h1>");

      const updated = await service.updatePage(userId, {
        id,
        content: "<h1>v2</h1>",
        seoTitle: "Título",
      });
      expect(updated.draftFingerprint).toBe(
        snapshotFingerprint(await readPage(id)),
      );

      const patched = await service.patchPageContent(userId, {
        id,
        expectedContentSha256: contentSha256("<h1>v2</h1>"),
        operations: [{ old: "v2", new: "v3" }],
      });
      expect(patched.draftFingerprint).toBe(
        snapshotFingerprint(await readPage(id)),
      );
      // O fingerprint é o hash do snapshot inteiro, não o hash do conteúdo.
      expect(patched.draftFingerprint).not.toBe(contentSha256(patched.content));
    });

    it("A18: voltar ao snapshot publicado por patch reaproveita a revisão (dedup por fingerprint)", async () => {
      const { id } = await db.createPage("<h1>A</h1>");
      await service.publishPage(userId, id);
      const first = await readPage(id);

      await service.patchPageContent(userId, {
        id,
        expectedContentSha256: contentSha256("<h1>A</h1>"),
        operations: [{ old: "<h1>A</h1>", new: "<h1>B</h1>" }],
      });
      await service.publishPage(userId, id);
      expect(
        await db.prisma.pageRevision.count({ where: { pageId: id } }),
      ).toBe(2);

      await service.patchPageContent(userId, {
        id,
        expectedContentSha256: contentSha256("<h1>B</h1>"),
        operations: [{ old: "<h1>B</h1>", new: "<h1>A</h1>" }],
      });
      const republished = await service.publishPage(userId, id);

      const revisions = await db.prisma.pageRevision.findMany({
        where: { pageId: id },
      });
      expect(revisions).toHaveLength(2);
      expect(republished.publishedRevisionId).toBe(first.publishedRevisionId);
      expect(republished.draftFingerprint).toBe(
        revisions.find((revision) => revision.id === first.publishedRevisionId)!
          .fingerprint,
      );
    });
  },
);
