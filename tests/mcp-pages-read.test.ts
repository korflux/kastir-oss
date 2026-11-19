import { describe, expect, it, vi } from "vitest";

// Imports estáticos de propósito: o módulo das tools de Pages e o que ele importa carregam
// na fase de coleta, que não tem timeout por teste, e o timeout padrão passa a medir só o
// que cada teste afirma. Com `import()` dentro do teste, o primeiro teste pagava o
// carregamento a frio (centenas de ms sozinho, vários segundos com a suíte concorrente) e
// estourava os 5 s. Os `vi.mock` abaixo são içados pelo Vitest acima destes imports, e os
// mocks são `vi.hoisted`: o `vi.resetModules()` de tests/setup.ts não afeta referências já
// importadas.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import {
  getMcpPage,
  listMcpPageFolders,
  listMcpPages,
  previewMcpPage,
} from "@/lib/Modules/Mcp/Tools/Pages";

const listPagesPaginated = vi.hoisted(() => vi.fn());
const getPage = vi.hoisted(() => vi.fn());
const getPreviewBySlug = vi.hoisted(() => vi.fn());
const compilePreviewHtml = vi.hoisted(() => vi.fn());
const listFoldersPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: {
    listPagesPaginated,
    getPage,
    getPreviewBySlug,
    compilePreviewHtml,
  },
}));

vi.mock("@/lib/Modules/Pages/FolderService", () => ({
  folderService: { listFoldersPage },
}));

// Pages MCP create seeds template via settings; keep env/prisma out of pure read tests.
vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: { getSettings: vi.fn() },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read" as const],
  clientId: "client-1",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-1",
};

describe("MCP Pages read tools", () => {
  it("returns a stable paginated list without page content", async () => {
    listPagesPaginated.mockResolvedValueOnce({
      items: [
        {
          id: "page-1",
          title: "Home",
          slug: "home",
          content: "<p>private page body</p>",
          seoTitle: "Home SEO",
          seoDescription: null,
          seoKeyword: null,
          status: "PUBLISHED",
          folderId: "folder-1",
          authorId: "user-1",
          author: { id: "user-1", name: "Admin" },
          activeSnippetCount: 2,
          publishedAt: new Date("2026-07-22T10:00:00.000Z"),
          deletedAt: null,
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
          updatedAt: new Date("2026-07-22T10:00:00.000Z"),
        },
      ],
      total: 7,
      page: 2,
      pageSize: 5,
    });

    const result = await listMcpPages(context, {
      page: 2,
      pageSize: 5,
      status: "PUBLISHED",
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "page-1",
          title: "Home",
          slug: "home",
          activeSnippetCount: 2,
        }),
      ],
      pagination: {
        page: 2,
        pageSize: 5,
        totalItems: 7,
        hasNextPage: false,
      },
    });
    expect(result.items[0]).not.toHaveProperty("content");
    expect(result.items[0]).not.toHaveProperty("seoTitle");
    expect(listPagesPaginated).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      status: "PUBLISHED",
    });
  });

  it("requires cms:read before touching the Pages service", async () => {
    listPagesPaginated.mockClear();
    await expect(
      listMcpPages({ ...context, scopes: [] }, {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(listPagesPaginated).not.toHaveBeenCalled();
  });

  it("returns page metadata without content by default and previews by block", async () => {
    const page = {
      id: "page-1",
      title: "Home",
      slug: "home",
      content: "<p>private page body</p>",
      seoTitle: "Home SEO",
      seoDescription: null,
      seoKeyword: null,
      status: "DRAFT" as const,
      folderId: "folder-1",
      authorId: "user-1",
      author: { id: "user-1", name: "Admin" },
      activeSnippetCount: 0,
      publishedAt: null,
      deletedAt: null,
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
      updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    };
    getPage.mockResolvedValueOnce(page);
    getPreviewBySlug.mockResolvedValue(page);
    compilePreviewHtml.mockResolvedValue(
      '<html data-preview="true">raw</html>',
    );

    const detail = await getMcpPage(context, { pageId: "page-1" });
    expect(detail).toMatchObject({
      id: "page-1",
      title: "Home",
      seoTitle: "Home SEO",
      contentTotal: page.content.length,
    });
    expect(detail).not.toHaveProperty("content");

    await expect(
      previewMcpPage(context, { slug: "home" }),
    ).resolves.toMatchObject({
      pageId: "page-1",
      slug: "home",
      status: "DRAFT",
      contentTotal: '<html data-preview="true">raw</html>'.length,
    });
    expect(compilePreviewHtml).toHaveBeenCalledWith(page);

    await expect(
      previewMcpPage(context, {
        slug: "home",
        contentStart: 7,
        contentLength: 10,
      }),
    ).resolves.toMatchObject({
      html: "ata-previe",
      contentStart: 7,
      contentLength: 10,
      contentTotal: '<html data-preview="true">raw</html>'.length,
      nextStart: 17,
    });
  });

  /** Página mínima com o conteúdo dado; só o que o get lê. */
  const pageWithContent = (content: string) => ({
    id: "page-1",
    title: "Home",
    slug: "home",
    content,
    seoTitle: null,
    seoDescription: null,
    seoKeyword: null,
    status: "DRAFT" as const,
    folderId: "folder-1",
    authorId: "user-1",
    publishedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    updatedAt: new Date("2026-07-22T10:00:00.000Z"),
  });

  it("A3: get devolve contentSha256, contentBytes e contentTotal do rascunho", async () => {
    getPage.mockResolvedValueOnce(pageWithContent("abc"));

    await expect(
      getMcpPage(context, { pageId: "page-1" }),
    ).resolves.toMatchObject({
      contentSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      contentBytes: 3,
      contentTotal: 3,
    });
  });

  // Tabela de A4: contentTotal em unidades UTF-16 e contentBytes em bytes UTF-8.
  it.each([
    { content: "abc", contentTotal: 3, contentBytes: 3 },
    { content: "é", contentTotal: 1, contentBytes: 2 },
    { content: "🚀", contentTotal: 2, contentBytes: 4 },
    { content: "<p>\r\n</p>", contentTotal: 9, contentBytes: 9 },
  ])(
    "A4: $contentTotal unidades UTF-16 e $contentBytes bytes UTF-8 para $content",
    async ({ content, contentTotal, contentBytes }) => {
      getPage.mockResolvedValueOnce(pageWithContent(content));

      await expect(
        getMcpPage(context, { pageId: "page-1" }),
      ).resolves.toMatchObject({ contentTotal, contentBytes });
    },
  );

  it("A3: o hash e os bytes valem para o conteúdo inteiro, também quando o get devolve só um bloco", async () => {
    getPage.mockResolvedValueOnce(pageWithContent("abc"));

    const block = await getMcpPage(context, {
      pageId: "page-1",
      contentStart: 0,
      contentLength: 1,
    });

    expect(block).toMatchObject({
      content: "a",
      contentLength: 1,
      nextStart: 1,
      contentSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      contentBytes: 3,
      contentTotal: 3,
    });
  });

  it("returns a coded validation error when preview has no locator", async () => {
    getPage.mockClear();
    getPreviewBySlug.mockClear();

    await expect(previewMcpPage(context, {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "pageId or slug is required",
    });
    expect(getPage).not.toHaveBeenCalled();
    expect(getPreviewBySlug).not.toHaveBeenCalled();
  });

  it("reads page content in blocks and reconstructs the original", async () => {
    const hugeContent = "a".repeat(120_000);
    getPage.mockResolvedValue({
      id: "page-1",
      title: "Home",
      slug: "home",
      content: hugeContent,
      status: "DRAFT" as const,
      folderId: "folder-1",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      authorId: "user-1",
      publishedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const meta = await getMcpPage(context, { pageId: "page-1" });
    expect(meta).not.toHaveProperty("content");
    expect(meta.contentTotal).toBe(120_000);

    let start = 0;
    let rebuilt = "";
    while (true) {
      const block = await getMcpPage(context, {
        pageId: "page-1",
        contentStart: start,
        contentLength: 40_000,
      });
      rebuilt += block.content as string;
      if (block.nextStart === undefined) break;
      start = block.nextStart as number;
    }
    expect(rebuilt).toBe(hugeContent);
  });

  it("omits updatedAt from page list items", async () => {
    listPagesPaginated.mockResolvedValueOnce({
      items: [
        {
          id: "page-1",
          title: "Home",
          slug: "home",
          status: "PUBLISHED",
          folderId: "folder-1",
          author: { id: "user-1", name: "Admin" },
          activeSnippetCount: 0,
          publishedAt: new Date(),
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const result = await listMcpPages(context, {});
    expect(result.items[0]).not.toHaveProperty("updatedAt");
    expect(result.items[0]).not.toHaveProperty("createdAt");
  });

  it("filters folder results by parent and uses the common pagination envelope", async () => {
    listFoldersPage.mockResolvedValueOnce({
      items: [
        { id: "a", name: "A", parentId: "base", color: null, isBase: false },
      ],
      total: 2,
    });

    await expect(
      listMcpPageFolders(context, { parentId: "base", page: 1, pageSize: 1 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: "a" })],
      pagination: {
        page: 1,
        pageSize: 1,
        totalItems: 2,
        hasNextPage: true,
      },
    });
    expect(listFoldersPage).toHaveBeenCalledWith({
      parentId: "base",
      skip: 0,
      take: 1,
    });
  });

  it("restricts deleted page visibility to administrators", async () => {
    const editor = { ...context, role: "EDITOR" as const };

    await expect(
      listMcpPages(editor, { includeDeleted: true }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    await expect(
      getMcpPage(editor, { pageId: "page-1", includeDeleted: true }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(listPagesPaginated).not.toHaveBeenCalledWith(
      expect.objectContaining({ includeDeleted: true }),
    );
    expect(getPage).not.toHaveBeenCalledWith("page-1", {
      includeDeleted: true,
    });
  });
});
