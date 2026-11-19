// @vitest-environment jsdom

/**
 * Fase 3, T7 (spec A9, C3) e fase 4, T4 (spec A4, A5): a listagem de Pages por largura.
 *
 * O jsdom não calcula layout nem folha de estilo; o que se prova aqui é o contrato declarado nas
 * classes e na ordem do DOM do componente real (`PagesWorkspace`, com `requestJson` mockado
 * porque o SSR só mostra o carregamento). A medição renderizada (375 a 1536px) é da prova visual.
 *
 * - ordem do DOM = ordem de leitura e de foco, em todas as larguras: checkbox → título (com copiar
 *   URL) → cluster não-destrutivo → lixeira (decisão humana de 2026-10-15);
 * - abaixo de `sm` a linha, ativa e da lixeira, tem dois níveis (título em cima; ações não-
 *   destrutivas à esquerda e a ação destrutiva sozinha à direita embaixo); de `sm` em diante a
 *   posição visual é a de antes, por colunas explícitas;
 * - abaixo de `sm` o cabeçalho de colunas some e a ordenação por nome passa a um botão na barra da
 *   lista, com o mesmo estado do cabeçalho, para a lista ativa e para a lixeira;
 * - de `lg` em diante as colunas cabem sem `min-w`; Autor e Pasta só de `2xl`;
 * - abaixo de `sm` o workspace passa à rolagem única (só a seção rola: grade, card e lista crescem
 *   com as linhas), com Folders limitado a ~12rem; de `sm` em diante a altura travada de sempre.
 */

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

// Diálogo e popover de edição rápida ficam fora da prova (Radix/portal): o popover vira só o botão
// gatilho, com o mesmo nome acessível do real, para o cluster manter os cinco controles.
vi.mock("@/components/Shared/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));
vi.mock("@/lib/Modules/Pages/Components/PageQuickEditPopover", () => ({
  PageQuickEditPopover: ({
    dictionary,
    page,
  }: {
    dictionary: { quickEdit: string };
    page: { title: string };
  }) =>
    createElement("button", {
      "aria-label": `${dictionary.quickEdit}: ${page.title}`,
      type: "button",
    }),
}));

import { nameSortAriaValue } from "@/components/Shared/NameSortHeader";
import { ListViewport } from "@/components/Shared/ResponsiveList";
import { PagesWorkspace } from "@/lib/Modules/Pages/Components/PagesWorkspace";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");
const pagesCopy = dictionary.pages;
const bulkCopy = dictionary.bulk;

/** Duas páginas: a ordem alfabética (Alpha, Beta) define a ordem das linhas. */
const PAGES = [
  { id: "p-alpha", title: "Alpha", status: "DRAFT" },
  { id: "p-beta", title: "Beta", status: "PUBLISHED" },
].map((page) => ({
  ...page,
  slug: page.id,
  folderId: "base",
  authorId: "u1",
  author: { id: "u1", name: "Ana" },
  publishedRevisionId: page.status === "PUBLISHED" ? "rev-1" : null,
  publishedAt: null,
  deletedAt: null,
  createdAt: "2026-08-10T00:00:00.000Z",
}));

/** Duas páginas na lixeira: a ordem alfabética (Delta, Gamma) define a ordem das linhas. */
const TRASHED = [
  { id: "t-delta", title: "Delta" },
  { id: "t-gamma", title: "Gamma" },
].map((page) => ({
  ...page,
  slug: page.id,
  status: "DRAFT",
  folderId: "base",
  authorId: "u1",
  author: { id: "u1", name: "Ana" },
  deletedBy: { id: "u2", name: "Bia" },
  publishedRevisionId: null,
  publishedAt: null,
  deletedAt: "2026-08-12T00:00:00.000Z",
  createdAt: "2026-08-10T00:00:00.000Z",
}));

const FOLDERS = [
  { id: "base", name: "Base", color: null, parentId: null, isBase: true },
];

let mounted: { root: Root; container: HTMLElement } | null = null;

/**
 * Monta o workspace real com o servidor falso e espera a lista carregar. O servidor falso devolve
 * as páginas ativas e, no pedido da lixeira (`?trash=1`), as da lixeira; `pages: []` simula a
 * listagem vazia.
 */
async function mountWorkspace(
  options: { pages?: typeof PAGES } = {},
): Promise<HTMLElement> {
  requestJsonMock.mockImplementation(async (url: string) => ({
    pages: url.includes("trash=1") ? TRASHED : (options.pages ?? PAGES),
    folders: FOLDERS,
  }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(
      createElement(PagesWorkspace, {
        bulkDictionary: bulkCopy,
        canBulk: true,
        dictionary: pagesCopy,
        folderDictionary: dictionary.folders,
        publicOrigin: "https://example.com",
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  });
  return container;
}

afterEach(async () => {
  requestJsonMock.mockReset();
  if (mounted) {
    await act(async () => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

const byTestId = (root: ParentNode, id: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`data-testid="${id}" não encontrado`);
  return element;
};

/** Tokens de `class` do elemento. */
const tokens = (element: Element): string[] =>
  (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

/** Linhas de dados (as que têm a célula `page-row-actions`), na ordem do DOM. */
const dataRows = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>('[role="row"]')].filter((row) =>
    row.querySelector('[data-testid="page-row-actions"]'),
  );

/** Linhas da lixeira (as que têm a célula `trash-row-delete`), na ordem do DOM. */
const trashRows = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>('[role="row"]')].filter((row) =>
    row.querySelector('[data-testid="trash-row-delete"]'),
  );

/** Linha de cabeçalho de colunas (a que tem `columnheader`), da lista que estiver na tela. */
const headerRow = (container: HTMLElement): HTMLElement =>
  container
    .querySelector('[role="columnheader"]')!
    .closest<HTMLElement>('[role="row"]')!;

/** Cabeçalho da coluna Nome: o `columnheader` que contém o botão de ordenação. */
const nameColumnHeader = (container: HTMLElement): HTMLElement =>
  container
    .querySelector<HTMLElement>('[role="columnheader"] button')!
    .closest<HTMLElement>('[role="columnheader"]')!;

/** Botão de ordenação mobile da barra da lista. */
const sortToggle = (container: HTMLElement): HTMLButtonElement =>
  byTestId(container, "pages-sort-toggle") as HTMLButtonElement;

/** Títulos das linhas visíveis (ativas ou da lixeira), na ordem em que aparecem. */
const rowTitles = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll<HTMLElement>('[role="row"]')]
    .filter((row) => row.querySelector('[data-testid$="-row-title"]'))
    .map(
      (row) =>
        row.querySelector('[data-testid$="-row-title"] .truncate')
          ?.textContent ?? null,
    );

/** Clica um elemento dentro do `act` e deixa a atualização assentar. */
async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** Liga o modo "Deleted Pages" e espera a lista da lixeira carregar. */
async function openTrash(container: HTMLElement): Promise<void> {
  const toggle = [
    ...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  ].find((button) => button.textContent?.includes(pagesCopy.deletedPages));
  if (!toggle) throw new Error("botão Deleted Pages não encontrado");
  await click(toggle);
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  });
}

type Breakpoint = "base" | "sm" | "lg" | "2xl";

/**
 * Largura mínima em px de uma faixa de trilhas `[bp:]grid-cols-[...]`: `minmax(a,b)` conta `a`, as
 * demais trilhas contam o próprio valor (1rem = 16px), mais os gaps de 12px (`lg:gap-3`) entre
 * trilhas e o recuo `px-1` (4px de cada lado). É o que a lista precisa ter para não rolar.
 */
function minimumWidth(grid: string): number {
  const list = /\[(.+)\]$/.exec(grid)![1]!;
  const tracks = list.match(/minmax\([^)]*\)|[^_]+/g)!;
  const total = tracks.reduce((sum, track) => {
    const minmax = /^minmax\(([^,]+),/.exec(track);
    return sum + Number.parseFloat(minmax ? minmax[1]! : track) * 16;
  }, 0);
  return total + (tracks.length - 1) * 12 + 8;
}

/**
 * Posição efetiva de uma célula num breakpoint, lida das classes como o CSS mobile-first a
 * resolve: vale o último token `[bp:]axis-N` entre os da base e dos breakpoints até o pedido.
 */
function placement(
  cell: Element,
  axis: "col" | "row",
  breakpoint: Breakpoint,
): string | undefined {
  const prefixes = {
    base: [""],
    sm: ["", "sm:"],
    lg: ["", "sm:", "lg:"],
    "2xl": ["", "sm:", "lg:", "2xl:"],
  }[breakpoint];
  let value: string | undefined;
  for (const prefix of prefixes) {
    const token = tokens(cell).find((candidate) =>
      new RegExp(`^${prefix}${axis}-(\\d+|\\[.+\\])$`).test(candidate),
    );
    if (token) value = token.slice(prefix.length + axis.length + 1);
  }
  return value;
}

/** Células nomeadas da primeira linha de dados. */
function rowCells(container: HTMLElement) {
  const row = dataRows(container)[0]!;
  const cells = [
    ...row.querySelectorAll<HTMLElement>(':scope > [role="cell"]'),
  ];
  return {
    row,
    cells,
    checkbox: row
      .querySelector('input[type="checkbox"]')!
      .closest<HTMLElement>('[role="cell"]')!,
    title: byTestId(row, "page-row-title"),
    actions: byTestId(row, "page-row-actions"),
    trash: byTestId(row, "page-row-trash"),
    author: cells[3]!,
    folder: cells[4]!,
    created: cells[5]!,
  };
}

describe("linha de Pages: ordem de foco = ordem de leitura", () => {
  it("o DOM segue checkbox → título → cluster de ações → colunas extras → lixeira", async () => {
    const container = await mountWorkspace();
    const { cells, checkbox, title, actions, author, folder, created, trash } =
      rowCells(container);

    // Sete células (checkbox, título, cluster, autor, pasta, criado, lixeira), nessa ordem.
    expect(cells).toHaveLength(7);
    expect(
      [checkbox, title, actions, author, folder, created, trash].map((cell) =>
        cells.indexOf(cell),
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([author.textContent, folder.textContent]).toEqual(["Ana", "Base"]);
  });

  it("o Tab percorre checkbox, título (copiar URL), as cinco ações não-destrutivas e a lixeira por último", async () => {
    const container = await mountWorkspace();
    const [alpha, beta] = dataRows(container);
    const order = (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLElement>("input, a[href], button")].map(
        (element) => element.getAttribute("aria-label"),
      );

    // Alpha: rascunho nunca publicado (liga e abre o preview).
    expect(order(alpha!)).toEqual([
      `${bulkCopy.selectItem}: Alpha`,
      pagesCopy.copyUrl,
      pagesCopy.publishing.switchTurnOn,
      pagesCopy.preview,
      pagesCopy.duplicate,
      `${pagesCopy.edit}: Alpha`,
      `${pagesCopy.quickEdit}: Alpha`,
      pagesCopy.moveToTrash,
    ]);
    // Beta: no ar (desliga e abre a página publicada).
    expect(order(beta!)).toEqual([
      `${bulkCopy.selectItem}: Beta`,
      pagesCopy.copyUrl,
      pagesCopy.publishing.switchTurnOff,
      pagesCopy.viewPublished,
      pagesCopy.duplicate,
      `${pagesCopy.edit}: Beta`,
      `${pagesCopy.quickEdit}: Beta`,
      pagesCopy.moveToTrash,
    ]);
  });

  it("lei E/D: a lixeira mora só na célula da direita; o cluster é só não-destrutivo", async () => {
    const container = await mountWorkspace();
    const { actions, trash } = rowCells(container);
    const trashLabel = `[aria-label="${pagesCopy.moveToTrash}"]`;

    expect(actions.querySelector(trashLabel)).toBeNull();
    expect(trash.querySelectorAll("button, a")).toHaveLength(1);
    expect(trash.querySelector(trashLabel)).not.toBeNull();
    expect(tokens(trash)).toContain("justify-end");
  });
});

describe("linha de Pages: dois níveis abaixo de sm", () => {
  it("a grade tem três trilhas (recuo do checkbox, 1fr, lixeira) e o cabeçalho de colunas some", async () => {
    const container = await mountWorkspace();
    const { row } = rowCells(container);

    expect(tokens(row)).toContain("grid-cols-[2rem_minmax(0,1fr)_auto]");
    // O cabeçalho (linha com `columnheader`) só aparece de `sm` em diante.
    const header = container
      .querySelector('[role="columnheader"]')!
      .closest<HTMLElement>('[role="row"]')!;
    expect(tokens(header)).toContain("hidden");
    expect(tokens(header)).toContain("sm:grid");
    expect(tokens(header)).not.toContain("grid");
  });

  it("nível 1: checkbox na col 1 e título nas col 2-3; nível 2: cluster na col 2 e lixeira sozinha na col 3", async () => {
    const container = await mountWorkspace();
    const { checkbox, title, actions, trash } = rowCells(container);

    expect([
      placement(checkbox, "col", "base"),
      placement(checkbox, "row", "base"),
    ]).toEqual(["1", "1"]);
    expect([
      placement(title, "col", "base"),
      placement(title, "row", "base"),
    ]).toEqual(["[2/span_2]", "1"]);
    expect([
      placement(actions, "col", "base"),
      placement(actions, "row", "base"),
    ]).toEqual(["2", "2"]);
    expect([
      placement(trash, "col", "base"),
      placement(trash, "row", "base"),
    ]).toEqual(["3", "2"]);
  });

  it("o caminho da página cai numa linha própria sob o título, com reticências", async () => {
    const container = await mountWorkspace();
    const { title } = rowCells(container);
    const inner = title.firstElementChild as HTMLElement;
    const [titleText, copyUrl, slug] = [...inner.children] as HTMLElement[];

    expect(tokens(inner)).toContain("grid");
    expect(tokens(inner)).toContain("sm:flex");
    expect(tokens(titleText!)).toContain("truncate");
    expect(copyUrl!.getAttribute("data-testid")).toBe("page-copy-url");
    expect(tokens(slug!)).toContain("col-span-2");
    expect(tokens(slug!)).toContain("sm:col-auto");
    expect(tokens(slug!)).toContain("truncate");
  });
});

describe("linha de Pages: de sm em diante a posição visual é a de antes", () => {
  it("em sm: checkbox | cluster | título | lixeira, todos na linha 1", async () => {
    const container = await mountWorkspace();
    const { checkbox, title, actions, trash } = rowCells(container);

    expect(
      [checkbox, actions, title, trash].map((cell) => [
        placement(cell, "col", "sm"),
        placement(cell, "row", "sm"),
      ]),
    ).toEqual([
      ["1", "1"],
      ["2", "1"],
      ["3", "1"],
      ["4", "1"],
    ]);
  });
});

/**
 * Fase 4, T4 (A5): de `lg` em diante as colunas cabem na área útil sem `min-w` (a causa da rolagem
 * horizontal que escondia Criado e a lixeira); Autor e Pasta só de `2xl`.
 */
describe("lista ativa de Pages: colunas de lg em diante, sem rolagem horizontal", () => {
  // Trilhas esperadas por faixa. O piso de 15rem das ações do design não cabe o switch com o rótulo
  // "Fora do ar · nunca publicada" (~363px), então a trilha vai de 15rem a 23rem em lg e fica em
  // 23rem em 2xl, onde quem cede é Autor/Pasta (ver o orçamento no componente).
  const TRACKS = {
    sm: "sm:grid-cols-[2rem_auto_minmax(0,1fr)_auto]",
    lg: "lg:grid-cols-[2.5rem_minmax(15rem,23rem)_minmax(12rem,1fr)_7rem_3rem]",
    "2xl":
      "2xl:grid-cols-[2.5rem_23rem_minmax(12rem,1fr)_minmax(5rem,9rem)_minmax(5rem,9rem)_7rem_3rem]",
  };

  it("a linha tem 4 trilhas em sm, 5 em lg (checkbox, ações, título, Criado, lixeira) e 7 em 2xl (+ Autor e Pasta)", async () => {
    const container = await mountWorkspace();
    const { row } = rowCells(container);

    for (const track of Object.values(TRACKS)) {
      expect(tokens(row)).toContain(track);
    }
    expect(tokens(row)).toContain("lg:gap-3");
  });

  it("os mínimos das trilhas cabem na lista mais estreita de cada faixa: ~774px em 1280 para lg e ~1030px em 1536 para 2xl", () => {
    expect(minimumWidth(TRACKS.lg)).toBeLessThanOrEqual(774);
    expect(minimumWidth(TRACKS["2xl"])).toBeLessThanOrEqual(1030);
  });

  it("cabeçalho e linha usam as mesmas trilhas, gaps e recuo: as colunas alinham porque cada grid é independente", async () => {
    const container = await mountWorkspace();
    const { row } = rowCells(container);
    const header = headerRow(container);
    const layout = (element: HTMLElement) =>
      tokens(element).filter((token) =>
        /^(sm:|lg:|2xl:)?(grid-cols-|gap-|px-)/.test(token),
      );

    for (const track of Object.values(TRACKS)) {
      expect(tokens(header)).toContain(track);
    }
    // Mesmo conjunto de trilhas/gaps/recuo; só o grid base (3 trilhas, nível 1/2) é da linha.
    expect(layout(header).sort()).toEqual(
      layout(row)
        .filter((token) => token !== "grid-cols-[2rem_minmax(0,1fr)_auto]")
        .sort(),
    );
  });

  it("sem `min-w` no cabeçalho, no grupo de linhas nem nas linhas: nada força rolagem horizontal", async () => {
    const container = await mountWorkspace();
    const { row } = rowCells(container);
    const rowgroup = row.closest<HTMLElement>('[role="rowgroup"]')!;

    for (const element of [headerRow(container), rowgroup, row]) {
      expect(tokens(element).filter((token) => /min-w-/.test(token))).toEqual(
        [],
      );
    }
  });

  it("em lg: checkbox | cluster | título | Criado | lixeira, todos na linha 1; Autor e Pasta ficam ocultos", async () => {
    const container = await mountWorkspace();
    const { checkbox, title, actions, author, folder, created, trash } =
      rowCells(container);

    expect(
      [checkbox, actions, title, created, trash].map((cell) => [
        placement(cell, "col", "lg"),
        placement(cell, "row", "lg"),
      ]),
    ).toEqual([
      ["1", "1"],
      ["2", "1"],
      ["3", "1"],
      ["4", "1"],
      ["5", "1"],
    ]);
    // Criado aparece de lg; Autor e Pasta só de 2xl (sem `lg:block`).
    expect(tokens(created)).toContain("hidden");
    expect(tokens(created)).toContain("lg:block");
    for (const cell of [author, folder]) {
      expect(tokens(cell)).toContain("hidden");
      expect(tokens(cell)).toContain("2xl:block");
      expect(tokens(cell)).not.toContain("lg:block");
    }
  });

  it("em 2xl: checkbox | cluster | título | Autor | Pasta | Criado | lixeira, todos na linha 1", async () => {
    const container = await mountWorkspace();
    const { checkbox, title, actions, author, folder, created, trash } =
      rowCells(container);

    expect(
      [checkbox, actions, title, author, folder, created, trash].map((cell) => [
        placement(cell, "col", "2xl"),
        placement(cell, "row", "2xl"),
      ]),
    ).toEqual([
      ["1", "1"],
      ["2", "1"],
      ["3", "1"],
      ["4", "1"],
      ["5", "1"],
      ["6", "1"],
      ["7", "1"],
    ]);
  });

  it("o cabeçalho de colunas mostra Autor e Pasta só de 2xl e Criado de lg, como as linhas", async () => {
    const container = await mountWorkspace();
    const header = headerRow(container);
    const column = (label: string) =>
      [...header.querySelectorAll<HTMLElement>('[role="columnheader"]')].find(
        (cell) => cell.textContent === label,
      )!;

    for (const label of [pagesCopy.author, pagesCopy.folderLabel]) {
      expect(tokens(column(label))).toContain("2xl:block");
      expect(tokens(column(label))).not.toContain("lg:block");
    }
    expect(tokens(column(pagesCopy.created))).toContain("lg:block");
    // Autor e Pasta cabem nas trilhas de 2xl, entre o título e Criado (colunas 4 e 5 de 7).
    const visibleAt2xl = [
      ...header.querySelectorAll<HTMLElement>('[role="columnheader"]'),
    ].map((cell) => cell.textContent);
    expect(visibleAt2xl).toEqual([
      "",
      "",
      pagesCopy.pageColumn,
      pagesCopy.author,
      pagesCopy.folderLabel,
      pagesCopy.created,
      "",
    ]);
  });
});

/**
 * Fase 4, T4 (A4): ordenação por nome abaixo de `sm`, onde o cabeçalho de colunas não existe.
 * O botão da barra e o `NameSortHeader` de `sm`+ alternam o MESMO estado, nas duas listas.
 */
describe("ordenação por nome: botão da barra abaixo de sm", () => {
  it("mostra Name + seta, com o nome acessível da direção atual, só abaixo de sm e dentro da barra da lista", async () => {
    const container = await mountWorkspace();
    const toggle = sortToggle(container);

    expect(toggle.textContent).toBe(pagesCopy.nameLabel);
    expect(toggle.getAttribute("aria-label")).toBe(pagesCopy.sortNameAsc);
    expect(pagesCopy.sortNameAsc).toBe("Sort by name, A to Z");
    // Texto + ícone (não só ícone) e alvo de toque de 32px; some de sm em diante.
    expect(toggle.querySelector("svg.lucide-chevron-up")).not.toBeNull();
    expect(tokens(toggle)).toEqual(
      expect.arrayContaining(["sm:hidden", "h-8"]),
    );
    expect(tokens(toggle)).not.toContain("hidden");
    // Mora na barra (ao lado do Deleted Pages), não dentro da tabela.
    expect(toggle.closest('[role="table"]')).toBeNull();
    expect(toggle.previousElementSibling?.getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("tocar alterna A→Z e Z→A: a ordem das linhas, o nome acessível e a seta mudam juntos", async () => {
    const container = await mountWorkspace();
    expect(rowTitles(container)).toEqual(["Alpha", "Beta"]);

    await click(sortToggle(container));
    expect(rowTitles(container)).toEqual(["Beta", "Alpha"]);
    expect(sortToggle(container).getAttribute("aria-label")).toBe(
      pagesCopy.sortNameDesc,
    );
    expect(pagesCopy.sortNameDesc).toBe("Sort by name, Z to A");
    expect(
      sortToggle(container).querySelector("svg.lucide-chevron-down"),
    ).not.toBeNull();

    await click(sortToggle(container));
    expect(rowTitles(container)).toEqual(["Alpha", "Beta"]);
    expect(sortToggle(container).getAttribute("aria-label")).toBe(
      pagesCopy.sortNameAsc,
    );
  });

  it("o botão e o cabeçalho de sm em diante compartilham o estado (o toque num move o outro)", async () => {
    const container = await mountWorkspace();
    const headerButton = nameColumnHeader(container).querySelector("button")!;

    await click(sortToggle(container));
    expect(nameColumnHeader(container).getAttribute("aria-sort")).toBe(
      "descending",
    );

    await click(headerButton);
    expect(sortToggle(container).getAttribute("aria-label")).toBe(
      pagesCopy.sortNameAsc,
    );
    expect(rowTitles(container)).toEqual(["Alpha", "Beta"]);
  });

  it("sem linhas não há o que ordenar: o botão não aparece na listagem vazia", async () => {
    const container = await mountWorkspace({ pages: [] });

    expect(
      container.querySelector('[data-testid="pages-sort-toggle"]'),
    ).toBeNull();
    // O Deleted Pages continua na barra.
    expect(container.querySelector("button[aria-pressed]")).not.toBeNull();
  });

  it("serve também a lixeira: a direção vale nas duas listas e o botão segue na barra", async () => {
    const container = await mountWorkspace();
    await click(sortToggle(container));
    expect(rowTitles(container)).toEqual(["Beta", "Alpha"]);

    await openTrash(container);
    expect(rowTitles(container)).toEqual(["Gamma", "Delta"]);
    expect(sortToggle(container).getAttribute("aria-label")).toBe(
      pagesCopy.sortNameDesc,
    );

    await click(sortToggle(container));
    expect(rowTitles(container)).toEqual(["Delta", "Gamma"]);
  });
});

/**
 * Fase 4, T4 (A4): o estado da ordenação é anunciado no cabeçalho da coluna (`aria-sort`, padrão
 * ARIA de tabela ordenável), que só é válido em `columnheader` dentro de uma `table`.
 */
describe("ordenação por nome: direção anunciada no cabeçalho da coluna", () => {
  it("lista ativa: a coluna Nome tem aria-sort e as outras não; o botão de dentro não leva o atributo", async () => {
    const container = await mountWorkspace();
    const name = nameColumnHeader(container);

    expect(name.getAttribute("aria-sort")).toBe("ascending");
    expect(name.querySelector("button")!.hasAttribute("aria-sort")).toBe(false);
    expect([
      ...container.querySelectorAll('[role="columnheader"][aria-sort]'),
    ]).toEqual([name]);
    // `aria-sort` exige columnheader dentro de uma table.
    expect(name.closest('[role="table"]')).not.toBeNull();

    await click(name.querySelector("button")!);
    expect(name.getAttribute("aria-sort")).toBe("descending");
  });

  it("lixeira: a coluna Nome também anuncia a direção, no mesmo estado", async () => {
    const container = await mountWorkspace();
    await click(nameColumnHeader(container).querySelector("button")!);
    await openTrash(container);

    const name = nameColumnHeader(container);
    expect(name.getAttribute("aria-sort")).toBe("descending");
    expect(name.closest('[role="table"]')).not.toBeNull();
    expect([
      ...container.querySelectorAll('[role="columnheader"][aria-sort]'),
    ]).toEqual([name]);
  });

  it("nameSortAriaValue mapeia asc/desc nos valores do ARIA", () => {
    expect(nameSortAriaValue("asc")).toBe("ascending");
    expect(nameSortAriaValue("desc")).toBe("descending");
  });
});

/**
 * Fase 4, T4 (A4): a linha da lixeira ("Deleted Pages") ganha a composição em dois níveis da linha
 * ativa abaixo de `sm`, onde o título tinha ~50px úteis.
 */
describe("linha da lixeira de Pages: dois níveis abaixo de sm", () => {
  /** Células nomeadas da primeira linha da lixeira. */
  function trashCells(container: HTMLElement) {
    const row = trashRows(container)[0]!;
    const cells = [
      ...row.querySelectorAll<HTMLElement>(':scope > [role="cell"]'),
    ];
    return {
      row,
      cells,
      checkbox: cells[0]!,
      title: byTestId(row, "trash-row-title"),
      restore: byTestId(row, "trash-row-restore"),
      author: cells[3]!,
      deletedBy: cells[4]!,
      deleted: cells[5]!,
      remove: byTestId(row, "trash-row-delete"),
    };
  }

  it("a grade tem três trilhas e o cabeçalho de colunas da lixeira some abaixo de sm", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const { row } = trashCells(container);
    const header = headerRow(container);

    expect(tokens(row)).toContain("grid-cols-[2rem_minmax(0,1fr)_auto]");
    expect(tokens(header)).toContain("hidden");
    expect(tokens(header)).toContain("sm:grid");
    expect(tokens(header)).not.toContain("grid");
  });

  it("nível 1: checkbox na col 1 e título nas col 2-3; nível 2: Restaurar na col 2 e Excluir permanentemente sozinho na col 3", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const { checkbox, title, restore, remove } = trashCells(container);

    expect(
      [checkbox, title, restore, remove].map((cell) => [
        placement(cell, "col", "base"),
        placement(cell, "row", "base"),
      ]),
    ).toEqual([
      ["1", "1"],
      ["[2/span_2]", "1"],
      ["2", "2"],
      ["3", "2"],
    ]);
    // O título ocupa a largura toda do nível 1 e trunca com reticências (título + caminho).
    expect(tokens(title)).toContain("min-w-0");
    expect(
      [...title.querySelectorAll("span")].map((span) => tokens(span)),
    ).toEqual([
      expect.arrayContaining(["truncate"]),
      expect.arrayContaining(["truncate"]),
    ]);
  });

  it("ordem do DOM e do foco: checkbox → título → Restaurar → colunas extras → Excluir permanentemente", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const {
      cells,
      checkbox,
      title,
      restore,
      author,
      deletedBy,
      deleted,
      remove,
    } = trashCells(container);

    expect(cells).toHaveLength(7);
    expect(
      [checkbox, title, restore, author, deletedBy, deleted, remove].map(
        (cell) => cells.indexOf(cell),
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // Tab percorre só os controles: checkbox, Restaurar e, por último, Excluir permanentemente.
    const row = trashRows(container)[0]!;
    expect(
      [...row.querySelectorAll<HTMLElement>("input, a[href], button")].map(
        (element) => element.getAttribute("aria-label") ?? element.textContent,
      ),
    ).toEqual([
      `${bulkCopy.selectItem}: Delta`,
      pagesCopy.restore,
      pagesCopy.permanentlyDelete,
    ]);
  });

  it("lei E/D: Restaurar (não-destrutivo) à esquerda; Excluir permanentemente sozinho na célula da direita", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const { restore, remove } = trashCells(container);

    expect(restore.querySelectorAll("button")).toHaveLength(1);
    expect(restore.textContent).toBe(pagesCopy.restore);
    expect(remove.querySelectorAll("button")).toHaveLength(1);
    expect(remove.textContent).toBe(pagesCopy.permanentlyDelete);
    expect(tokens(remove)).toContain("justify-end");
    // Os dois níveis embaixo: Restaurar na col 2 (esquerda), Excluir na col 3 (direita).
    expect(Number(placement(restore, "col", "base"))).toBeLessThan(
      Number(placement(remove, "col", "base")),
    );
    // Alvo de toque de 32px abaixo de sm; de sm em diante o tamanho sm de sempre.
    for (const button of [restore, remove].map((cell) =>
      cell.querySelector("button")!,
    )) {
      expect(tokens(button)).toEqual(expect.arrayContaining(["h-8", "sm:h-7"]));
    }
  });

  it("de sm a lg a posição visual é a de antes: checkbox | Restaurar | título | Excluir, todos na linha 1", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const { checkbox, title, restore, remove } = trashCells(container);

    expect(
      [checkbox, restore, title, remove].map((cell) => [
        placement(cell, "col", "sm"),
        placement(cell, "row", "sm"),
      ]),
    ).toEqual([
      ["1", "1"],
      ["2", "1"],
      ["3", "1"],
      ["4", "1"],
    ]);
  });
});

/**
 * Fase 4, T4 (A5, pendência do relatório): a lixeira ("Deleted Pages") de `lg` em diante cabe na
 * lista sem rolagem horizontal, com a mesma regra da lista ativa: Autor e Excluída por só de `2xl`.
 * Antes eram 7 trilhas em `lg` (~872px de mínimos) contra ~774px de lista em 1280 e ~818px em 1024.
 */
describe("lixeira de Pages: colunas de lg em diante, sem rolagem horizontal", () => {
  // Mínimos por faixa (soma das trilhas de mínimo fixo + gaps + recuo), em px de 16px/rem. O teto é a
  // lista de ~774px em 1280 (a mais estreita entre lg e 2xl) e ~1030px em 1536.
  const TRACKS = {
    sm: "sm:grid-cols-[2rem_auto_minmax(0,1fr)_auto]",
    lg: "lg:grid-cols-[2.5rem_6rem_minmax(12rem,1fr)_7rem_11rem]",
    "2xl": "2xl:grid-cols-[2.5rem_6rem_minmax(12rem,1fr)_9rem_9rem_7rem_11rem]",
  };

  it("a linha tem 5 trilhas em lg (checkbox, Restaurar, título, Excluída em, Excluir) e 7 em 2xl (+ Autor e Excluída por)", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const row = trashRows(container)[0]!;

    for (const track of Object.values(TRACKS)) {
      expect(tokens(row)).toContain(track);
    }
    expect(tokens(row)).toContain("lg:gap-3");
  });

  it("os mínimos das trilhas cabem na lista mais estreita de cada faixa: ~774px em 1280 para lg e ~1030px em 1536 para 2xl", () => {
    expect(minimumWidth(TRACKS.lg)).toBeLessThanOrEqual(774);
    expect(minimumWidth(TRACKS["2xl"])).toBeLessThanOrEqual(1030);
    // O botão "Excluir permanentemente" (pt-BR, ~171px com padding e borda) cabe na trilha de 11rem.
    expect(11 * 16).toBeGreaterThanOrEqual(171);
  });

  it("cabeçalho e linha usam as mesmas trilhas, gaps e recuo, e nenhum leva `min-w`", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const row = trashRows(container)[0]!;
    const header = headerRow(container);
    const rowgroup = row.closest<HTMLElement>('[role="rowgroup"]')!;
    const layout = (element: HTMLElement) =>
      tokens(element).filter((token) =>
        /^(sm:|lg:|2xl:)?(grid-cols-|gap-|px-)/.test(token),
      );

    for (const track of Object.values(TRACKS)) {
      expect(tokens(header)).toContain(track);
    }
    expect(layout(header).sort()).toEqual(
      layout(row)
        .filter((token) => token !== "grid-cols-[2rem_minmax(0,1fr)_auto]")
        .sort(),
    );
    for (const element of [header, rowgroup, row]) {
      expect(tokens(element).filter((token) => /min-w-/.test(token))).toEqual(
        [],
      );
    }
  });

  it("em lg: checkbox | Restaurar | título | Excluída em | Excluir, todos na linha 1; Autor e Excluída por ficam ocultos", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const row = trashRows(container)[0]!;
    const cells = [
      ...row.querySelectorAll<HTMLElement>(':scope > [role="cell"]'),
    ];
    const [checkbox, title, restore, author, deletedBy, deleted, remove] =
      cells as [
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
      ];

    expect(
      [checkbox, restore, title, deleted, remove].map((cell) => [
        placement(cell, "col", "lg"),
        placement(cell, "row", "lg"),
      ]),
    ).toEqual([
      ["1", "1"],
      ["2", "1"],
      ["3", "1"],
      ["4", "1"],
      ["5", "1"],
    ]);
    expect(tokens(deleted)).toContain("hidden");
    expect(tokens(deleted)).toContain("lg:block");
    for (const cell of [author, deletedBy]) {
      expect(tokens(cell)).toContain("hidden");
      expect(tokens(cell)).toContain("2xl:block");
      expect(tokens(cell)).not.toContain("lg:block");
    }
  });

  it("em 2xl: checkbox | Restaurar | título | Autor | Excluída por | Excluída em | Excluir, todos na linha 1", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const row = trashRows(container)[0]!;
    const cells = [
      ...row.querySelectorAll<HTMLElement>(':scope > [role="cell"]'),
    ];
    const [checkbox, title, restore, author, deletedBy, deleted, remove] =
      cells as [
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
      ];

    expect(
      [checkbox, restore, title, author, deletedBy, deleted, remove].map(
        (cell) => [
          placement(cell, "col", "2xl"),
          placement(cell, "row", "2xl"),
        ],
      ),
    ).toEqual([
      ["1", "1"],
      ["2", "1"],
      ["3", "1"],
      ["4", "1"],
      ["5", "1"],
      ["6", "1"],
      ["7", "1"],
    ]);
  });

  it("o cabeçalho da lixeira mostra Autor e Excluída por só de 2xl e Excluída em de lg, como as linhas", async () => {
    const container = await mountWorkspace();
    await openTrash(container);
    const columns = [
      ...headerRow(container).querySelectorAll<HTMLElement>(
        '[role="columnheader"]',
      ),
    ];
    const column = (label: string) =>
      columns.find((cell) => cell.textContent === label)!;

    for (const label of [pagesCopy.author, pagesCopy.deletedBy]) {
      expect(tokens(column(label))).toContain("2xl:block");
      expect(tokens(column(label))).not.toContain("lg:block");
    }
    expect(tokens(column(pagesCopy.deleted))).toContain("lg:block");
    expect(columns.map((cell) => cell.textContent)).toEqual([
      "",
      "",
      pagesCopy.pageColumn,
      pagesCopy.author,
      pagesCopy.deletedBy,
      pagesCopy.deleted,
      "",
    ]);
  });
});

describe("workspace de Pages: rolagem única abaixo de sm", () => {
  it("a seção é o único contêiner de rolagem vertical (como antes): ocupa a altura do main e rola com tudo dentro", async () => {
    const container = await mountWorkspace();
    const section = tokens(byTestId(container, "pages-workspace"));

    // O wrapper da rota é `overflow-hidden`: a seção precisa ter altura própria (`flex-1` +
    // `min-h-0`) e rolar (`overflow-y-auto`); crescer sem teto seria cortado pelo wrapper.
    for (const scroller of ["flex-1", "min-h-0", "overflow-y-auto"]) {
      expect(section).toContain(scroller);
    }
    // Eixo X contido em todas as larguras.
    expect(section).toContain("overflow-x-hidden");
  });

  it("a grade perde as linhas fixas e o corte abaixo de sm; de sm em diante a repartição de linhas é a de antes", async () => {
    const container = await mountWorkspace();
    const grid = tokens(byTestId(container, "pages-workspace-grid"));

    for (const locked of [
      "grid-rows-[minmax(0,14rem)_minmax(0,1fr)]",
      "overflow-hidden",
      "flex-1",
      "min-h-0",
    ]) {
      expect(grid).not.toContain(locked);
    }
    expect(grid).toContain("grid-cols-1");
    // Abaixo de sm a grade tem a altura do conteúdo; a seção é quem rola.
    expect(grid).toContain("flex-none");
    expect(grid).toContain("sm:grid-rows-[minmax(0,14rem)_minmax(0,1fr)]");
    expect(grid).toContain("sm:overflow-hidden");
    expect(grid).toContain("sm:flex-1");
    expect(grid).toContain("sm:min-h-0");
    expect(grid).toContain("xl:grid-rows-1");
    expect(grid).toContain("xl:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]");
  });

  it("Folders fica limitado a ~12rem (max-h-48) com árvore rolável; de sm em diante sem teto", async () => {
    const container = await mountWorkspace();
    const folders = byTestId(container, "pages-folders-panel");

    expect(tokens(folders)).toContain("max-h-48");
    expect(tokens(folders)).toContain("sm:max-h-none");
    // A árvore rola dentro do painel limitado.
    expect(folders.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  it("o card da lista cresce com as linhas abaixo de sm; h-full e corte só de sm em diante", async () => {
    const container = await mountWorkspace();
    const card = tokens(byTestId(container, "pages-list-card"));

    expect(card).not.toContain("h-full");
    expect(card).not.toContain("overflow-hidden");
    expect(card).toContain("sm:h-full");
    expect(card).toContain("sm:overflow-hidden");
  });

  it("o ListViewport de Pages flui abaixo de sm e devolve a rolagem interna de sm em diante", async () => {
    const container = await mountWorkspace();
    const viewport = tokens(byTestId(container, "pages-list-viewport"));

    expect(viewport).toContain("flex-none");
    expect(viewport).toContain("overflow-y-visible");
    expect(viewport).not.toContain("flex-1");
    expect(viewport).not.toContain("overflow-y-auto");
    expect(viewport).not.toContain("overscroll-contain");
    expect(viewport).toContain("sm:flex-1");
    expect(viewport).toContain("sm:overflow-y-auto");
    expect(viewport).toContain("sm:overscroll-contain");
  });

  it("o ListViewport compartilhado não muda (outros módulos mantêm a rolagem interna)", () => {
    const html = renderToStaticMarkup(createElement(ListViewport));
    const base = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);

    expect(base).toEqual([
      "min-h-0",
      "min-w-0",
      "flex-1",
      "overflow-x-hidden",
      "overflow-y-auto",
      "overscroll-contain",
    ]);
  });
});

describe("workspace de Pages: seleção em massa (bulk-selected)", () => {
  it("linhas marcadas ganham o fundo de seleção e a barra mantém E à esquerda e D (lixeira) à direita", async () => {
    const container = await mountWorkspace();

    for (const row of dataRows(container)) {
      expect(tokens(row)).not.toContain("bg-primary/5");
      const checkbox = row.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      )!;
      await act(async () => {
        checkbox.click();
      });
    }

    for (const row of dataRows(container)) {
      expect(tokens(row)).toContain("bg-primary/5");
    }
    const bar = byTestId(container, "bulk-action-bar");
    const nonDestructive = bar.querySelector<HTMLElement>(
      '[data-slot="bulk-actions"]',
    )!;
    const destructive = bar.querySelector<HTMLElement>(
      '[data-slot="bulk-destructive"]',
    )!;
    const buttonTexts = (slot: HTMLElement) =>
      [...slot.querySelectorAll("button")].map((button) => button.textContent);

    expect(buttonTexts(nonDestructive)).toEqual([bulkCopy.moveFolder]);
    expect(buttonTexts(destructive)).toEqual([bulkCopy.moveToTrash]);
  });
});
