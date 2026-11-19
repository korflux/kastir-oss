/**
 * Fase 2, T4: filtro `ids` de `GET /api/admin/custom-code/pages` (resolução do NOME das páginas
 * do escopo na comparação de versões e no seletor de escopo) e a validação de `q`, `page` e
 * `pageSize` que passou a viver na mesma rota.
 *
 * A rota roda de verdade (auth simulada, schema zod real) e delega a um `CustomCodeService`
 * real sobre um banco simulado, então o teste cobre a borda e a regra juntas: ids em cuid com
 * limite, ids que ignoram `q`/`page`, página na lixeira fora do resultado e o shape
 * `{ items, total, page, pageSize }` igual ao da busca paginada.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, listScopePages } = vi.hoisted(() => ({
  getSession: vi.fn(),
  listScopePages: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
// A rota usa o singleton `customCodeService`; aqui ele é um espião que delega a um serviço real
// sobre o banco simulado (a classe real continua exportada para os testes do serviço).
vi.mock("@/lib/Modules/CustomCode/Service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/Modules/CustomCode/Service")>();
  return { ...actual, customCodeService: { listScopePages } };
});

import { GET } from "@/app/api/admin/custom-code/pages/route";
import { CustomCodeService } from "@/lib/Modules/CustomCode/Service";
import { BULK_IDS_MAX } from "@/lib/Modules/Shared/Bulk";

/* -------------------------------------------------------------------------- */
/* Banco simulado: só o que `listScopePages` consulta                          */
/* -------------------------------------------------------------------------- */

/** cuid sintético válido para o `bulkIdsSchema` (`c` + 24 caracteres alfanuméricos). */
const cuid = (n: number) => `c${String(n).padStart(24, "0")}`;

type StoredPage = {
  id: string;
  title: string;
  slug: string;
  deletedAt: Date | null;
};

type PageWhere = {
  deletedAt?: null;
  id?: { in: string[] };
  OR?: Array<{ title?: { contains: string }; slug?: { contains: string } }>;
};

const PAGES: StoredPage[] = [
  { id: cuid(1), title: "Landing", slug: "landing", deletedAt: null },
  { id: cuid(2), title: "Pricing", slug: "pricing", deletedAt: null },
  { id: cuid(3), title: "Old promo", slug: "old-promo", deletedAt: new Date() },
  { id: cuid(4), title: "Landing B", slug: "landing-b", deletedAt: null },
];

/** Aplica o `where` do Prisma que o serviço monta (id in, lixeira, busca por título ou slug). */
function matches(page: StoredPage, where: PageWhere = {}): boolean {
  if (where.deletedAt === null && page.deletedAt !== null) return false;
  if (where.id && !where.id.in.includes(page.id)) return false;
  if (where.OR) {
    const hit = where.OR.some((clause) => {
      const needle = (
        clause.title?.contains ??
        clause.slug?.contains ??
        ""
      ).toLowerCase();
      const field = clause.title ? page.title : page.slug;
      return field.toLowerCase().includes(needle);
    });
    if (!hit) return false;
  }
  return true;
}

function createDatabase() {
  return {
    page: {
      findUnique: vi.fn(),
      findMany: vi.fn(
        async (args: { where?: PageWhere; skip?: number; take?: number }) => {
          const found = PAGES.filter((page) => matches(page, args.where));
          const skip = args.skip ?? 0;
          return found.slice(
            skip,
            args.take === undefined ? undefined : skip + args.take,
          );
        },
      ),
      count: vi.fn(
        async (args?: { where?: PageWhere }) =>
          PAGES.filter((page) => matches(page, args?.where)).length,
      ),
    },
  };
}

let database: ReturnType<typeof createDatabase>;
let service: CustomCodeService;

beforeEach(() => {
  vi.clearAllMocks();
  database = createDatabase();
  service = new CustomCodeService(database as never, { add: vi.fn() } as never);
  listScopePages.mockImplementation((options) =>
    service.listScopePages(options),
  );
  getSession.mockResolvedValue({
    user: { id: "user-id", role: "ADMIN", isMaster: true },
  });
});

const call = (query: string) =>
  GET(
    new Request(
      `http://localhost/api/admin/custom-code/pages${query ? `?${query}` : ""}`,
    ),
  );

/* -------------------------------------------------------------------------- */
/* ids: resolução por id                                                       */
/* -------------------------------------------------------------------------- */

describe("GET /api/admin/custom-code/pages?ids=", () => {
  it("exige sessão do painel", async () => {
    getSession.mockResolvedValue(null);

    const response = await call(`ids=${cuid(1)}`);

    expect(response.status).toBe(401);
    expect(listScopePages).not.toHaveBeenCalled();
  });

  it("devolve só as páginas pedidas, no mesmo shape da busca paginada", async () => {
    const response = await call(`ids=${cuid(2)},${cuid(1)}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      items: [
        { id: cuid(1), title: "Landing", slug: "landing" },
        { id: cuid(2), title: "Pricing", slug: "pricing" },
      ],
      total: 2,
      page: 1,
      pageSize: 2,
    });
    expect(Object.keys(body).sort()).toEqual(
      ["items", "page", "pageSize", "total"].sort(),
    );
  });

  it("ignora q, page e pageSize quando há ids (sem paginação nem busca)", async () => {
    const response = await call(
      `ids=${cuid(1)},${cuid(2)}&q=nada-bate&page=5&pageSize=1`,
    );

    expect(response.status).toBe(200);
    expect(listScopePages).toHaveBeenCalledWith({ ids: [cuid(1), cuid(2)] });
    const body = await response.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      cuid(1),
      cuid(2),
    ]);
    expect(body.page).toBe(1);
    // A consulta ao banco também não carrega busca: só `id in` e a lixeira.
    const where = database.page.findMany.mock.calls[0]![0].where;
    expect(where).toEqual({
      id: { in: [cuid(1), cuid(2)] },
      deletedAt: null,
    });
  });

  it("não devolve página na lixeira nem id que não existe (o cliente mostra o rótulo legível)", async () => {
    const missing = cuid(99);
    const response = await call(`ids=${cuid(3)},${cuid(1)},${missing}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([
      { id: cuid(1), title: "Landing", slug: "landing" },
    ]);
    expect(body.total).toBe(1);
    // pageSize é o tamanho do pedido, não do resultado: o cliente sabe quantos faltaram.
    expect(body.pageSize).toBe(3);
  });

  it("colapsa ids repetidos antes de consultar", async () => {
    await call(`ids=${cuid(1)},${cuid(1)},${cuid(2)}`);

    const where = database.page.findMany.mock.calls[0]![0].where;
    expect(where?.id?.in).toEqual([cuid(1), cuid(2)]);
  });

  it("aceita exatamente o limite de ids do bulk e recusa um a mais", async () => {
    const atLimit = Array.from({ length: BULK_IDS_MAX }, (_, i) => cuid(i + 1));
    const overLimit = [...atLimit, cuid(BULK_IDS_MAX + 1)];

    const ok = await call(`ids=${atLimit.join(",")}`);
    expect(ok.status).toBe(200);
    expect(listScopePages).toHaveBeenCalledTimes(1);

    const refused = await call(`ids=${overLimit.join(",")}`);
    expect(refused.status).toBe(400);
    await expect(refused.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(listScopePages).toHaveBeenCalledTimes(1);
  });

  it("recusa id que não é cuid e lista vazia, sem consultar o banco", async () => {
    for (const query of [
      "ids=page-1",
      `ids=${cuid(1)},nao-e-cuid`,
      "ids=",
      `ids=${cuid(1)},`,
    ]) {
      const response = await call(query);
      expect(response.status, query).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expect(listScopePages).not.toHaveBeenCalled();
    expect(database.page.findMany).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* q, page e pageSize: agora validados na rota                                 */
/* -------------------------------------------------------------------------- */

describe("GET /api/admin/custom-code/pages (busca paginada)", () => {
  it("sem parâmetros usa a primeira página de 25, como antes", async () => {
    const response = await call("");

    expect(response.status).toBe(200);
    expect(listScopePages).toHaveBeenCalledWith({
      search: undefined,
      page: 1,
      pageSize: 25,
    });
    const body = await response.json();
    // Lixeira fora também na busca.
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      cuid(1),
      cuid(2),
      cuid(4),
    ]);
    expect(body.total).toBe(3);
  });

  it("repassa q (aparado), page e pageSize válidos", async () => {
    const response = await call("q=%20landing%20&page=1&pageSize=1");

    expect(response.status).toBe(200);
    expect(listScopePages).toHaveBeenCalledWith({
      search: "landing",
      page: 1,
      pageSize: 1,
    });
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(2);
    expect(body.pageSize).toBe(1);
  });

  it("recusa q acima do limite de tamanho e aceita q no limite", async () => {
    const tooLong = await call(`q=${"a".repeat(201)}`);
    expect(tooLong.status).toBe(400);
    await expect(tooLong.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(listScopePages).not.toHaveBeenCalled();

    const atLimit = await call(`q=${"a".repeat(200)}`);
    expect(atLimit.status).toBe(200);
  });

  it("recusa page e pageSize fora do contrato em vez de normalizar em silêncio", async () => {
    for (const query of [
      "page=0",
      "page=-1",
      "page=abc",
      "page=1.5",
      "page=10001",
      "pageSize=0",
      "pageSize=101",
      "pageSize=abc",
    ]) {
      const response = await call(query);
      expect(response.status, query).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expect(listScopePages).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Serviço                                                                     */
/* -------------------------------------------------------------------------- */

describe("CustomCodeService.listScopePages", () => {
  it("com ids resolve só pelo id, sem busca nem paginação, e sem consultar com lista vazia", async () => {
    const result = await service.listScopePages({
      ids: [cuid(4)],
      search: "pricing",
      page: 9,
      pageSize: 1,
    });

    expect(result).toEqual({
      items: [{ id: cuid(4), title: "Landing B", slug: "landing-b" }],
      total: 1,
      page: 1,
      pageSize: 1,
    });

    database.page.findMany.mockClear();
    const empty = await service.listScopePages({ ids: [] });
    expect(empty).toEqual({ items: [], total: 0, page: 1, pageSize: 0 });
    expect(database.page.findMany).not.toHaveBeenCalled();
  });

  it("sem ids continua buscando por título ou slug com paginação", async () => {
    const result = await service.listScopePages({
      search: "landing",
      page: 2,
      pageSize: 1,
    });

    expect(result.items.map((item) => item.id)).toEqual([cuid(4)]);
    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(1);
    // O total vem sempre da contagem do banco (mesmo `where` da busca), nunca do tamanho da
    // página devolvida: o serviço não tem mais caminho alternativo sem `page.count`.
    expect(database.page.count).toHaveBeenCalledTimes(1);
    expect(database.page.count).toHaveBeenCalledWith({
      where: database.page.findMany.mock.calls[0]![0].where,
    });
  });
});
