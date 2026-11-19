/**
 * Prova no Postgres real das tools MCP `kastir_pages_patch` e `kastir_scripts_patch` sob
 * concorrência (phase-5, passo 4): servidor MCP real (SDK + transporte em memória), tools reais,
 * serviços reais (`PageService` e `CustomCodeService`) e o banco de teste do helper de
 * integração.
 *
 * Critérios provados aqui, cada título começa pelo ID:
 *  - A6: dois patches de página com o mesmo hash esperado e trocas diferentes chegam ao mesmo
 *    tempo; exatamente um grava, o outro recebe `CONFLICT`, e o rascunho final é só o da
 *    vencedora;
 *  - A16: o mesmo para `kastir_scripts_patch`, sobre o código do script, com os mesmos códigos;
 *  - A1 e A3 de ponta a ponta: o `contentSha256` devolvido pelo get é aceito como
 *    `expectedContentSha256` do patch depois de passar pelo Postgres, com CRLF e caracteres fora
 *    do BMP (o conteúdo volta do banco byte a byte).
 *
 * Só roda com o gate do helper aberto (`DATABASE_URL` igual a `TEST_DATABASE_URL`, loopback,
 * banco `_test`); senão a suíte é pulada sem abrir conexão. Como rodar: `AGENTS.md`, seção
 * Comandos.
 *
 * Desenho sem espera fixa nem torcida pelo relógio: uma transação "dona" segura a trava da linha
 * (`db.holdRowLock`), as duas chamadas MCP reais entram e o teste espera, por condição
 * (`pg_blocking_pids`), que as duas estejam enfileiradas na trava antes de soltá-la. Sem a trava
 * no Save as chamadas não bloqueiam e o teste falha por não ver ninguém na fila, em vez de passar
 * por acaso. A tabela de erros e os limites do patch são provados sem banco em
 * `tests/mcp-pages-patch.test.ts` e `tests/mcp-scripts-patch.test.ts`.
 *
 * Mocks só na fronteira do processo: `@/lib/prisma` (o módulo real valida o ambiente inteiro ao
 * ser importado), a fila (Redis) e os serviços singleton das tools, trocados por instâncias das
 * classes reais ligadas ao banco de teste em `beforeAll` (o gate decide depois da coleta, então o
 * singleton só pode repassar a chamada). O Save e o patch nunca enfileiram nem escrevem
 * arquivos.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));
vi.mock("@/lib/Modules/Pages/FolderService", () => ({ folderService: {} }));
vi.mock("@/lib/Modules/Settings/Service", () => ({ settingsService: {} }));

/**
 * Serviços singleton das tools, ligados ao banco de teste só depois do gate (`beforeAll`).
 * Cada chamada ao singleton é repassada à instância ligada; sem ela (gate fechado) a chamada
 * falha alto, mas nenhum teste roda nesse caso.
 */
const bound = vi.hoisted(() => {
  const target: Record<"page" | "snippet", object | undefined> = {
    page: undefined,
    snippet: undefined,
  };
  const delegate = (key: "page" | "snippet") =>
    new Proxy(
      {},
      {
        get:
          (_proxied, method) =>
          (...args: unknown[]) => {
            const service = target[key] as
              Record<string | symbol, (...a: unknown[]) => unknown> | undefined;
            if (!service) {
              throw new Error(`The ${key} service is not bound to the test DB`);
            }
            return service[method](...args);
          },
      },
    );
  return { target, delegate };
});

vi.mock("@/lib/Modules/Pages/Service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/Modules/Pages/Service")>();
  return { ...actual, pageService: bound.delegate("page") };
});
vi.mock("@/lib/Modules/CustomCode/Service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/Modules/CustomCode/Service")>();
  return { ...actual, customCodeService: bound.delegate("snippet") };
});

import { CustomCodeService } from "@/lib/Modules/CustomCode/Service";
import { registerPageTools } from "@/lib/Modules/Mcp/Tools/Pages";
import { registerScriptTools } from "@/lib/Modules/Mcp/Tools/Scripts";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { PageService, type PageDatabase } from "@/lib/Modules/Pages/Service";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";
import { createPageFileStore } from "@/lib/Publishing/fileStore";

import {
  describeIntegration,
  openIntegrationDatabase,
  type IntegrationDatabase,
} from "./helpers/db";

/** SHA-256 calculado direto no `node:crypto`, independente do código sob teste. */
const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

type ToolBody = {
  ok?: true;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
  /** Campos de topo do get. */
  contentSha256?: string;
  contentBytes?: number;
  contentTotal?: number;
};
type ToolResult = { isError: boolean; body: ToolBody };

describeIntegration(
  "tools MCP de patch sob concorrência no Postgres real",
  { timeout: 60_000 },
  () => {
    let db: IntegrationDatabase;
    let client: Client;
    let server: McpServer;
    let userId: string;
    let publicDir: string;
    let context: McpToolContext;

    beforeAll(async () => {
      db = await openIntegrationDatabase();
      userId = (await db.owner()).userId;
      publicDir = await mkdtemp(join(tmpdir(), "kastir-mcp-patch-"));
      bound.target.page = new PageService(
        db.prisma as unknown as PageDatabase,
        createPageFileStore(publicDir),
        async (page) => `compiled:${page.content}`,
        createMediaStorage(publicDir, join(publicDir, ".staging")),
        publicDir,
      );
      bound.target.snippet = new CustomCodeService(
        db.prisma as never,
        { add: vi.fn(async () => ({ id: "job-id" })) } as never,
      );

      // EDITOR com escrita e leitura: o papel mais restrito que pode editar conteúdo.
      context = {
        actor: { id: userId, name: "Integration owner", email: "it@x.invalid" },
        userId,
        role: "EDITOR",
        scopes: ["cms:read", "cms:pages:write", "cms:scripts:write"],
        clientId: "client-1",
        resource: "https://public.example/api/mcp",
        requestId: "request-it",
      };
      server = new McpServer({ name: "test-server", version: "1.0.0" });
      registerPageTools(server, context);
      registerScriptTools(server, context);
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      client = new Client({ name: "test-client", version: "1.0.0" });
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
    });

    afterAll(async () => {
      await client?.close();
      await server?.close();
      await db?.close();
      if (publicDir) await rm(publicDir, { recursive: true, force: true });
    });

    /** Chama uma tool e devolve o envelope JSON já decodificado. */
    async function call(
      name: string,
      args: Record<string, unknown>,
    ): Promise<ToolResult> {
      const result = await client.callTool({ name, arguments: args });
      const text =
        (result.content as Array<{ type: string; text?: string }>)[0]?.text ??
        "{}";
      return { isError: result.isError === true, body: JSON.parse(text) };
    }

    const readPage = (id: string) =>
      db.prisma.page.findUniqueOrThrow({ where: { id } });
    const readSnippet = (id: string) =>
      db.prisma.snippet.findUniqueOrThrow({ where: { id } });

    /** Linhas de audit do recurso, com a tool de origem. */
    const auditRows = (objectId: string, action: string) =>
      db.prisma.logEntry.findMany({
        where: { objectId, action },
        select: { tool: true, source: true, userId: true },
      });

    /**
     * Segura a trava da linha, dispara os dois patches reais e só solta quando os dois estão
     * enfileirados nela. Devolve os dois resultados, na ordem em que foram disparados.
     */
    async function raceTwoPatches(
      table: "Page" | "Snippet",
      id: string,
      calls: [() => Promise<ToolResult>, () => Promise<ToolResult>],
    ): Promise<[ToolResult, ToolResult]> {
      const holder = await db.holdRowLock(table, id);
      const pending = Promise.all([calls[0](), calls[1]()]);
      await holder.waitForQueued(2);
      await holder.release();
      return pending;
    }

    const BASE = "AAA BBB";

    it("A6: dois patches de página simultâneos com o mesmo hash, uma grava e a outra recebe CONFLICT", async () => {
      const { id } = await db.createPage(BASE);
      const expectedContentSha256 = sha256(BASE);
      const patch = (old: string, replacement: string) => () =>
        call("kastir_pages_patch", {
          id,
          expectedContentSha256,
          operations: [{ old, new: replacement }],
        });

      const results = await raceTwoPatches("Page", id, [
        patch("AAA", "one"),
        patch("BBB", "two"),
      ]);

      const winnerIndex = results.findIndex((result) => !result.isError);
      const loserIndex = 1 - winnerIndex;
      expect(results.filter((result) => !result.isError)).toHaveLength(1);
      const finalContent = winnerIndex === 0 ? "one BBB" : "AAA two";
      // O rascunho final corresponde só à vencedora.
      expect((await readPage(id)).content).toBe(finalContent);
      expect(results[winnerIndex]!.body.data).toMatchObject({
        id,
        contentSha256: sha256(finalContent),
        contentBytes: Buffer.byteLength(finalContent, "utf8"),
      });
      // A perdedora recebe CONFLICT com o hash atual (o da vencedora) e nada dela foi gravado.
      expect(results[loserIndex]!.body.error).toEqual({
        code: "CONFLICT",
        message: expect.stringContaining(sha256(finalContent)),
      });
      // Só a vencedora foi auditada, com a tool de origem.
      expect(await auditRows(id, "PAGE_UPDATED")).toEqual([
        { tool: "kastir_pages_patch", source: "MCP", userId },
      ]);
    });

    it("A16: dois patches de script simultâneos com o mesmo hash, um grava e o outro recebe CONFLICT", async () => {
      const { id } = await db.createSnippet(BASE);
      const expectedContentSha256 = sha256(BASE);
      const patch = (old: string, replacement: string) => () =>
        call("kastir_scripts_patch", {
          id,
          expectedContentSha256,
          operations: [{ old, new: replacement }],
        });

      const results = await raceTwoPatches("Snippet", id, [
        patch("AAA", "one"),
        patch("BBB", "two"),
      ]);

      const winnerIndex = results.findIndex((result) => !result.isError);
      const loserIndex = 1 - winnerIndex;
      expect(results.filter((result) => !result.isError)).toHaveLength(1);
      const finalContent = winnerIndex === 0 ? "one BBB" : "AAA two";
      expect((await readSnippet(id)).content).toBe(finalContent);
      expect(results[winnerIndex]!.body.data).toMatchObject({
        id,
        contentSha256: sha256(finalContent),
        contentBytes: Buffer.byteLength(finalContent, "utf8"),
      });
      expect(results[loserIndex]!.body.error).toEqual({
        code: "CONFLICT",
        message: expect.stringContaining(sha256(finalContent)),
      });
      expect(await auditRows(id, "SCRIPT_UPDATED")).toEqual([
        { tool: "kastir_scripts_patch", source: "MCP", userId },
      ]);
    });

    it("A1: o hash devolvido pelo get é aceito pelo patch depois de passar pelo Postgres, com CRLF e fora do BMP", async () => {
      const original = "<p>\r\n  🚀 é  \r\n</p>   ";
      const { id } = await db.createPage(original);

      const read = await call("kastir_pages_get", { pageId: id });
      expect(read.body).toMatchObject({
        contentSha256: sha256(original),
        contentBytes: Buffer.byteLength(original, "utf8"),
        contentTotal: original.length,
      });

      const patched = await call("kastir_pages_patch", {
        id,
        expectedContentSha256: read.body.contentSha256,
        operations: [{ old: "🚀", new: "✅" }],
      });
      expect(patched.isError).toBe(false);
      const expected = "<p>\r\n  ✅ é  \r\n</p>   ";
      expect((await readPage(id)).content).toBe(expected);
      expect(patched.body.data).toMatchObject({
        contentSha256: sha256(expected),
      });
    });

    it("A1: o hash devolvido pelo get de script é aceito pelo patch depois de passar pelo Postgres", async () => {
      const original = "<script>\r\n  window.a = '🚀';\r\n</script>   ";
      const { id } = await db.createSnippet(original);

      const read = await call("kastir_scripts_get", { scriptId: id });
      expect(read.body).toMatchObject({
        contentSha256: sha256(original),
        contentBytes: Buffer.byteLength(original, "utf8"),
        contentTotal: original.length,
      });

      const patched = await call("kastir_scripts_patch", {
        id,
        expectedContentSha256: read.body.contentSha256,
        operations: [{ old: "'🚀'", new: "'✅'" }],
      });
      expect(patched.isError).toBe(false);
      expect((await readSnippet(id)).content).toBe(
        "<script>\r\n  window.a = '✅';\r\n</script>   ",
      );
    });
  },
);
