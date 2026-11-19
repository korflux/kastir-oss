// @vitest-environment jsdom

/**
 * Split Tests em viewport estreito.
 *
 * - Lista e tabela de destinos: colunas colapsadas e overflow horizontal contido (marcação).
 * - Fase 3, T8 (spec A11): o editor usa `DetailsPanel flowOnMobile`. Abaixo de `lg` a seção do
 *   editor rola (`overflow-y-auto`) e Details e destinos empilham com a altura do conteúdo, sem
 *   rolagem aninhada; de `lg` em diante a altura é a de sempre (`lg:h-full`, `lg:overflow-hidden`).
 *   O editor é montado no jsdom com o servidor simulado em `requestJson`, porque a marcação
 *   estática só enxerga o estado de carregamento.
 * - Fase 3, T8 (spec A11, correção da prova visual em 375px): a linha de adicionar destino
 *   empilha em 1 coluna abaixo do ponto de corte das colunas (inputs em largura útil, botão
 *   abaixo); a partir dele as 7 colunas seguem idênticas.
 * - Fase 4, T2 (spec A5, decisão 11): o ponto de corte das colunas passou de `lg` para `xl`
 *   (1280px). Em 1024px a coluna de destinos tem ~543px e a tabela de 7 colunas (que exigia
 *   `min-w-[860px]`) cortava a linha em edição. Agora: abaixo de `xl` linhas de leitura
 *   compactas (4 colunas) e cabeçalho oculto; de `xl` em diante 7 colunas com as trilhas do
 *   design, SEM `min-w` nem rolagem horizontal; a linha em edição é sempre um formulário de
 *   largura total (Nome e URL lado a lado de `xl` em diante, Salvar/Cancelar embaixo à direita),
 *   nunca dentro da última trilha de 2.5rem. A altura (`lg`, Details em coluna) não mudou.
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

import { SplitTestDestinations } from "@/lib/Modules/SplitTests/Components/SplitTestDestinations";
import { SplitTestEditor } from "@/lib/Modules/SplitTests/Components/SplitTestEditor";
import { SplitTestsList } from "@/lib/Modules/SplitTests/Components/SplitTestsList";
import type { CampaignDetail } from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");

/** Campanha mínima com um destino: o suficiente para o editor sair do estado de carregamento. */
const campaign: CampaignDetail = {
  id: "campaign-id",
  name: "Campaign",
  slug: "campaign",
  status: "ACTIVE",
  author: null,
  totalHits: 4,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  destinations: [
    {
      id: "destination-id",
      url: "https://example.com",
      label: "Landing",
      status: "ACTIVE",
      sortOrder: 0,
      hitCount: 4,
      theoreticalWeight: 100,
      realPercent: 100,
    },
  ],
};

/** Separa a lista de classes em tokens, para afirmar presença exata (sem casar `lg:overflow-hidden` como `overflow-hidden`). */
function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

/** Props comuns do `SplitTestDestinations`, com callbacks inertes. */
function destinationsProps() {
  return {
    campaign,
    campaignId: "campaign-id",
    dictionary: dictionary.splitTests,
    busy: false,
    onBusyChange: vi.fn(),
    onCampaignChange: vi.fn(),
    onError: vi.fn(),
    onSaved: vi.fn(),
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  host?.remove();
  host = undefined;
  requestJsonMock.mockReset();
});

/** Monta o editor com a campanha devolvida pelo servidor simulado e espera a carga sair do loading. */
async function mountLoadedEditor(): Promise<HTMLDivElement> {
  requestJsonMock.mockResolvedValue({ campaign });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(SplitTestEditor, {
        dictionary: dictionary.splitTests,
        campaignId: "campaign-id",
        publicOrigin: "https://example.com",
      }),
    );
  });
  // A carga roda num microtask do efeito (`load` guardado por `active`): espera até o painel existir.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (host.querySelector('[data-testid="details-panel"]')) break;
    await act(async () => {
      await Promise.resolve();
    });
  }
  return host;
}

/** Monta só os destinos no jsdom (a marcação estática não permite clicar em "Editar"). */
async function mountDestinations(): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(SplitTestDestinations, destinationsProps()));
  });
  return host;
}

describe("Split Tests em viewport estreito", () => {
  it("colapsa destino para ações, label, URL e remoção abaixo de xl, sem min-w nem rolagem horizontal", () => {
    const html = renderToStaticMarkup(
      createElement(SplitTestDestinations, destinationsProps()),
    );

    expect(html).toContain(
      "grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_minmax(0,1fr)_auto]",
    );
    // Métricas (Theoretical/Real/Hits) só de xl em diante.
    expect(html).toContain("hidden xl:block");
    // Sem largura mínima na tabela e sem wrapper que a rolasse na horizontal: a página e a
    // lista nunca ganham barra horizontal (o 860px do `lg` era a causa do corte em 1024px).
    expect(html).not.toMatch(/min-w-\[/);
    expect(html).not.toContain("overflow-x-auto");
    expect(html).toContain("overflow-x-hidden");
    // O ponto de corte das colunas é xl: nenhuma classe de coluna ou de exibição fica em lg.
    expect(html).not.toMatch(/lg:grid-cols|lg:block|lg:gap/);
  });

  it("destinos: altura e rolagem vertical próprias só de lg em diante; abaixo de lg sem limite nem rolagem aninhada", () => {
    const html = renderToStaticMarkup(
      createElement(SplitTestDestinations, destinationsProps()),
    );
    // Ordem do documento: raiz do bloco, depois o contêiner de rolagem vertical da lista.
    const [rootClass = "", scrollerClass = ""] = Array.from(
      html.matchAll(/class="([^"]*)"/g),
      (match) => match[1],
    );
    const rootTokens = tokens(rootClass);
    const scrollerTokens = tokens(scrollerClass);

    // Abaixo de lg: sem `h-full`, `flex-1`, `min-h-0`, corte nem rolagem vertical declarados.
    for (const token of ["h-full", "min-h-0", "flex-1", "overflow-hidden"]) {
      expect(rootTokens).not.toContain(token);
    }
    for (const token of ["min-h-0", "flex-1", "overflow-y-auto"]) {
      expect(scrollerTokens).not.toContain(token);
    }
    // De lg em diante: a coluna preenche a altura e a lista rola dentro dela, como sempre.
    for (const token of [
      "lg:h-full",
      "lg:min-h-0",
      "lg:flex-1",
      "lg:overflow-hidden",
    ]) {
      expect(rootTokens).toContain(token);
    }
    for (const token of ["lg:min-h-0", "lg:flex-1", "lg:overflow-y-auto"]) {
      expect(scrollerTokens).toContain(token);
    }
    // Largura segue contida: o scroll horizontal fica no wrapper da tabela, não na página.
    expect(rootTokens).toContain("min-w-0");
    expect(scrollerTokens).toContain("overflow-x-hidden");
  });

  it("editor: seção rola abaixo de lg e o DetailsPanel flui com o conteúdo (flowOnMobile)", async () => {
    const container = await mountLoadedEditor();
    const panel = container.querySelector('[data-testid="details-panel"]');
    expect(panel).not.toBeNull();

    // Seção raiz do editor: o contêiner que rola abaixo de lg e ocupa a altura de lg em diante.
    const section = panel?.parentElement;
    expect(section?.tagName).toBe("SECTION");
    const sectionTokens = tokens(section?.className ?? "");
    expect(sectionTokens).toContain("overflow-y-auto");
    expect(sectionTokens).toContain("lg:overflow-hidden");
    expect(sectionTokens).not.toContain("overflow-hidden");

    // DetailsPanel em modo `flowOnMobile`: sem altura repartida nem corte abaixo de lg.
    const panelTokens = tokens(panel?.className ?? "");
    for (const token of [
      "h-full",
      "min-h-0",
      "flex-1",
      "overflow-hidden",
      "grid-rows-[minmax(0,auto)_minmax(0,1fr)]",
    ]) {
      expect(panelTokens).not.toContain(token);
    }
    expect(panelTokens).toContain("shrink-0");
    // De lg em diante idêntico ao de antes: altura cheia, sem rolagem do painel, coluna não `wide`.
    for (const token of [
      "lg:h-full",
      "lg:min-h-0",
      "lg:flex-1",
      "lg:overflow-hidden",
      "lg:grid-cols-[minmax(15rem,17.5rem)_minmax(0,1fr)]",
    ]) {
      expect(panelTokens).toContain(token);
    }

    // Os destinos moram na seção de conteúdo do painel e não impõem altura abaixo de lg.
    const destinationsRoot = panel?.lastElementChild?.firstElementChild;
    expect(destinationsRoot?.querySelector('[role="rowgroup"]')).not.toBeNull();
    const destinationsTokens = tokens(destinationsRoot?.className ?? "");
    expect(destinationsTokens).not.toContain("h-full");
    expect(destinationsTokens).not.toContain("overflow-hidden");
    expect(destinationsTokens).toContain("lg:h-full");
  });

  it("colunas: abaixo de xl leitura em 4 colunas e adicionar empilhado, sem cabeçalho; de xl em diante 7 colunas com as trilhas do design e cabeçalho", async () => {
    const container = await mountDestinations();
    const compact =
      "grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_minmax(0,1fr)_auto]";
    const wide =
      "xl:grid-cols-[minmax(6.5rem,8rem)_minmax(6rem,1fr)_minmax(8rem,1.3fr)_5.5rem_4.5rem_4rem_2.5rem]";
    const rowsOf = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '[role="rowgroup"] > [role="row"]',
        ),
      );

    // Cabeçalho: só existe de xl em diante (display none abaixo), nas mesmas 7 trilhas das
    // linhas; abaixo de xl as linhas compactas/empilhadas dispensam o cabeçalho de colunas.
    const header = container.querySelector<HTMLElement>(
      '[role="row"]:not([role="rowgroup"] > [role="row"])',
    );
    const headerTokens = tokens(header?.className ?? "");
    expect(headerTokens).toContain("hidden");
    expect(headerTokens).toContain("xl:grid");
    expect(headerTokens).toContain(wide);
    expect(headerTokens).not.toContain("grid");
    expect(headerTokens).not.toContain(compact);
    expect(header?.querySelectorAll('[role="columnheader"]')).toHaveLength(7);

    // Destino só de leitura: 4 colunas abaixo de xl, 7 de xl em diante.
    const [readRow, addRow] = rowsOf();
    expect(tokens(readRow.className)).toContain(compact);
    expect(tokens(readRow.className)).not.toContain("grid-cols-1");
    expect(tokens(readRow.className)).toContain(wide);
    // Theoretical/Real/Hits: só de xl em diante.
    const metricCells = Array.from(
      readRow.querySelectorAll<HTMLElement>('[role="cell"]'),
    ).filter((cell) => tokens(cell.className).includes("tabular-nums"));
    expect(metricCells).toHaveLength(3);
    for (const cell of metricCells) {
      expect(tokens(cell.className)).toContain("hidden");
      expect(tokens(cell.className)).toContain("xl:block");
    }

    // Adicionar: Nome, URL e botão em coluna abaixo de xl (em 375px as 4 colunas deixavam os
    // inputs com ~31px); a célula vazia da 1ª coluna só existe de xl em diante.
    const addTokens = tokens(addRow.className);
    expect(addTokens).toContain("grid-cols-1");
    expect(addTokens).not.toContain(compact);
    expect(addTokens).toContain(wide);
    expect(tokens(addRow.firstElementChild?.className ?? "")).toEqual([
      "hidden",
      "xl:block",
    ]);
    expect(addRow.querySelector("#split-dest-name")).not.toBeNull();
    expect(addRow.querySelector("#split-dest-url")).not.toBeNull();

    // Nada na tabela fica preso ao ponto de corte antigo (lg) nem a uma largura mínima.
    expect(container.innerHTML).not.toMatch(/lg:grid-cols|lg:block|lg:gap/);
    expect(container.innerHTML).not.toMatch(/min-w-\[/);
  });

  it("editar destino: a linha vira formulário de largura total (sem as 7 colunas), com Nome e URL lado a lado de xl em diante e Salvar/Cancelar embaixo à direita", async () => {
    const container = await mountDestinations();
    const compact =
      "grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_minmax(0,1fr)_auto]";
    const wide =
      "xl:grid-cols-[minmax(6.5rem,8rem)_minmax(6rem,1fr)_minmax(8rem,1.3fr)_5.5rem_4.5rem_4rem_2.5rem]";
    const editing =
      "xl:grid-cols-[minmax(6.5rem,8rem)_minmax(0,1fr)_minmax(0,1.3fr)]";
    const rowsOf = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '[role="rowgroup"] > [role="row"]',
        ),
      );

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          `button[aria-label="${dictionary.splitTests.editDestination}"]`,
        )
        ?.click();
    });
    const editingRow = rowsOf()[0];
    const editingTokens = tokens(editingRow.className);
    // Uma coluna abaixo de xl e interruptor | Nome | URL de xl em diante; nunca as 7 colunas.
    expect(editingTokens).toContain("grid-cols-1");
    expect(editingTokens).toContain(editing);
    expect(editingTokens).not.toContain(compact);
    expect(editingTokens).not.toContain(wide);

    // Células: interruptor, Nome, URL e ações (sem Theoretical/Real/Hits, que são colunas da
    // tabela). Nome e URL são as células 2 e 3, lado a lado de xl em diante.
    const cells = Array.from(editingRow.children) as HTMLElement[];
    expect(cells).toHaveLength(4);
    expect(editingRow.querySelectorAll("input")).toHaveLength(2);
    expect(cells[1].querySelector("input")?.getAttribute("aria-label")).toBe(
      dictionary.splitTests.destinationLabel,
    );
    expect(cells[2].querySelector("input")?.getAttribute("aria-label")).toBe(
      dictionary.splitTests.destinationUrl,
    );

    // Salvar/Cancelar: célula própria na linha inteira (`col-span-full`), à direita, embaixo,
    // com respiro (gap-2) em todas as larguras; antes ficavam na última trilha de 2.5rem.
    const actionsTokens = tokens(cells[3].className);
    expect(actionsTokens).toContain("col-span-full");
    expect(actionsTokens).toContain("justify-end");
    expect(actionsTokens).toContain("gap-2");
    expect(actionsTokens).not.toContain("gap-0.5");
    expect(actionsTokens.some((token) => token.startsWith("lg:"))).toBe(false);
    expect(cells[3].textContent).toContain(
      dictionary.splitTests.saveDestination,
    );
    expect(cells[3].textContent).toContain(dictionary.splitTests.cancel);

    // Cancelar devolve a linha às 4 colunas de leitura (e as 7 de xl).
    act(() => {
      Array.from(editingRow.querySelectorAll("button"))
        .find((button) => button.textContent === dictionary.splitTests.cancel)
        ?.click();
    });
    expect(tokens(rowsOf()[0].className)).toContain(compact);
    expect(tokens(rowsOf()[0].className)).toContain(wide);
    expect(tokens(rowsOf()[0].className)).not.toContain("grid-cols-1");
  });

  it("mantém o shell da lista sem overflow horizontal no documento", () => {
    const html = renderToStaticMarkup(
      createElement(SplitTestsList, {
        bulkDictionary: dictionary.bulk,
        canBulk: false,
        dictionary: dictionary.splitTests,
        publicOrigin: "https://example.com",
      }),
    );

    expect(html).toContain("min-w-0");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("overflow-y-auto");
  });
});
