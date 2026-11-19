import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PanelLayout from "@/app/admin/(panel)/layout";
import { DetailsPanel } from "@/components/Shared/DetailsPanel";
import { PagesWorkspace } from "@/lib/Modules/Pages/Components/PagesWorkspace";
import { getPanelDictionary } from "@/lib/i18n/panel";

// Bordas do servidor e do cliente que o layout do painel puxa (sessão, env, banco, auth, rota).
// O que se prova aqui é a classe responsiva da casca real, não esses serviços.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { PANEL_LANGUAGE: "en" } }));
vi.mock("@/lib/Modules/Panel/Authorization", () => ({
  requirePanelSession: async () => ({
    user: {
      email: "master@example.com",
      id: "user-1",
      isMaster: true,
      name: "Master",
      role: "ADMIN",
    },
  }),
}));
vi.mock("@/lib/Modules/Notifications/Service", () => ({
  notificationsService: { unreadCount: async () => 0 },
}));
vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: {
    getSettings: async () => ({
      dateFormat: "YYYY-MM-DD",
      siteTitle: "Kastir",
      timeFormat: "24h",
      timezone: "UTC",
      weekStartsOn: 1,
    }),
  },
}));

/** Tokens de `class` do primeiro elemento cujo HTML casa com `opening` (grupo 1 = o class). */
function classTokens(html: string, opening: RegExp): string[] {
  const match = opening.exec(html);
  if (!match) throw new Error(`Elemento não renderizado: ${opening}`);
  return (match[1] ?? "").split(/\s+/);
}

describe("shell responsivo do painel", () => {
  it("empilha Details e conteúdo antes do breakpoint desktop", () => {
    const html = renderToStaticMarkup(
      <DetailsPanel details={<p>Details</p>}>
        <p>Content</p>
      </DetailsPanel>,
    );

    expect(html).toContain("grid-cols-1");
    expect(html).toContain("grid-rows-[minmax(0,auto)_minmax(0,1fr)]");
    expect(html).toContain("max-h-64");
    expect(html).toContain(
      "lg:grid-cols-[minmax(15rem,17.5rem)_minmax(0,1fr)]",
    );
  });

  it("flowOnMobile: o painel cresce com o conteúdo abaixo de lg e volta a ocupar a altura de lg em diante", () => {
    const html = renderToStaticMarkup(
      <DetailsPanel details={<p>Details</p>} flowOnMobile>
        <p>Content</p>
      </DetailsPanel>,
    );
    const rootClasses = (
      /class="([^"]*)" data-testid="details-panel"/.exec(html)?.[1] ?? ""
    ).split(/[ ]+/);

    // Sem altura repartida, sem linhas minmax e sem corte abaixo de lg: quem contém rola.
    expect(rootClasses).not.toContain("h-full");
    expect(rootClasses).not.toContain("overflow-hidden");
    expect(rootClasses).not.toContain(
      "grid-rows-[minmax(0,auto)_minmax(0,1fr)]",
    );
    expect(rootClasses).toContain("shrink-0");
    // De lg em diante: a mesma altura cheia, sem rolagem do painel, da grade de sempre.
    expect(rootClasses).toContain("lg:h-full");
    expect(rootClasses).toContain("lg:overflow-hidden");
    expect(rootClasses).toContain(
      "lg:grid-cols-[minmax(15rem,17.5rem)_minmax(0,1fr)]",
    );
    // A faixa do Details mantém a altura máxima e a rolagem própria.
    expect(html).toContain("max-h-64");
  });

  it("wide alarga a coluna Details só de lg em diante; sem ele a coluna é a de sempre", () => {
    const wide = renderToStaticMarkup(
      <DetailsPanel details={<p>Details</p>} wide>
        <p>Content</p>
      </DetailsPanel>,
    );
    expect(wide).toContain("lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]");
    expect(wide).not.toContain("17.5rem");
  });

  it("detailsNotice fica entre o título e a área rolável, fora da rolagem", () => {
    const html = renderToStaticMarkup(
      <DetailsPanel details={<p>Fields</p>} detailsNotice={<p>Paused</p>}>
        <p>Content</p>
      </DetailsPanel>,
    );
    const title = html.indexOf("<h2");
    const notice = html.indexOf('data-testid="details-notice"');
    const scroller = html.indexOf("overflow-y-auto");
    expect(title).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(title);
    expect(scroller).toBeGreaterThan(notice);
    expect(html.slice(notice, scroller)).toContain("Paused");
    // Sem nota, o slot nem existe.
    expect(
      renderToStaticMarkup(
        <DetailsPanel details={<p>Fields</p>}>
          <p>Content</p>
        </DetailsPanel>,
      ),
    ).not.toContain("details-notice");
  });

  it("Pages: rolagem única abaixo de sm (só a seção rola) e altura travada com duas linhas de grade de sm em diante", () => {
    const dictionary = getPanelDictionary("en");
    const html = renderToStaticMarkup(
      createElement(PagesWorkspace, {
        bulkDictionary: dictionary.bulk,
        canBulk: false,
        dictionary: dictionary.pages,
        folderDictionary: dictionary.folders,
        publicOrigin: "https://example.com",
      }),
    );
    const section = classTokens(
      html,
      /<section class="([^"]*)" data-testid="pages-workspace"/,
    );
    const grid = classTokens(
      html,
      /<div class="([^"]*)" data-testid="pages-workspace-grid"/,
    );
    const folders = classTokens(
      html,
      /<aside class="([^"]*)" data-testid="pages-folders-panel"/,
    );

    // A seção é o único contêiner de rolagem vertical (o wrapper da rota é `overflow-hidden`).
    expect(section).toContain("overflow-y-auto");
    expect(section).toContain("overflow-x-hidden");
    // Abaixo de `sm`: a grade tem a altura do conteúdo e linhas automáticas (sem a linha fixa de
    // 14rem que deixava a lista com ~99px em 375x812); a seção rola com tudo dentro.
    expect(grid).toContain("grid-cols-1");
    expect(grid).toContain("flex-none");
    expect(grid).not.toContain("grid-rows-[minmax(0,14rem)_minmax(0,1fr)]");
    expect(grid).not.toContain("overflow-hidden");
    // Folders ~12rem com rolagem própria (a árvore já rola no wrapper interno).
    expect(folders).toContain("max-h-48");
    // De `sm` em diante: a mesma repartição de antes (Folders até 14rem, lista no resto).
    expect(grid).toContain("sm:grid-rows-[minmax(0,14rem)_minmax(0,1fr)]");
    expect(grid).toContain("sm:overflow-hidden");
    expect(folders).toContain("sm:max-h-none");
  });

  // Fase 4, T4 (A5): as trilhas de Pages de `lg` em diante cabem sem rolagem horizontal por um
  // orçamento de largura calculado sobre estas medidas da casca (lista ≈ viewport − 93 de BrandRail −
  // padding do workspace − Folders de 17rem ao lado a partir de `xl` − card). Mudar qualquer uma
  // exige refazer o orçamento em `PagesWorkspace` (constantes de trilhas).
  it("Pages: o orçamento de largura das colunas de lg em diante assume o padding do workspace e o Folders de 17rem ao lado de xl", () => {
    const dictionary = getPanelDictionary("en");
    const html = renderToStaticMarkup(
      createElement(PagesWorkspace, {
        bulkDictionary: dictionary.bulk,
        canBulk: false,
        dictionary: dictionary.pages,
        folderDictionary: dictionary.folders,
        publicOrigin: "https://example.com",
      }),
    );
    const section = classTokens(
      html,
      /<section class="([^"]*)" data-testid="pages-workspace"/,
    );
    const grid = classTokens(
      html,
      /<div class="([^"]*)" data-testid="pages-workspace-grid"/,
    );
    const card = classTokens(
      html,
      /<div class="([^"]*)" data-testid="pages-list-card"/,
    );

    expect(section).toContain("md:px-8");
    expect(section).toContain("xl:px-10");
    expect(grid).toContain("xl:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]");
    expect(card).toContain("md:p-4");
  });
});

/**
 * Fase 3, T6 (spec A10): a troca nav superior ↔ BottomNav sobe de `md` para `lg`, porque em 768px
 * as abas e o chrome da Topbar não cabem lado a lado. Renderiza a casca real do painel
 * (`PanelLayout`) e confere cada consumidor do breakpoint de navegação e os que ficam em `md`.
 * O cartão do GuidedTour só renderiza no cliente: seu breakpoint é provado em
 * `guided-tour-state.test.ts`.
 */
describe("casca do painel: troca de navegação em lg", () => {
  async function renderShell() {
    return renderToStaticMarkup(
      await PanelLayout({ children: createElement("p", null, "Conteúdo") }),
    );
  }

  it("a nav da Topbar só aparece de lg em diante", async () => {
    const html = await renderShell();
    const nav = classTokens(
      html,
      /<nav aria-label="[^"]*" class="([^"]*)" data-testid="panel-top-nav"/,
    );

    expect(nav).toContain("hidden");
    expect(nav).toContain("lg:flex");
    expect(nav).not.toContain("md:flex");
  });

  it("a nav da Topbar usa gap-4 em lg e só alarga para gap-8 em xl: em 1024px as 7 abas (~544px) + gaps (96px) cabem nos ~667px livres sem cobrir o chrome", async () => {
    const html = await renderShell();
    const nav = classTokens(
      html,
      /<nav aria-label="[^"]*" class="([^"]*)" data-testid="panel-top-nav"/,
    );

    // Medido no navegador (fase 3, T6): gap-8 exige ~736px e em 1024px só há ~667px (o último
    // link passava 53px sobre o chrome); gap-4 usa ~640px. gap-8 volta de xl (1280px) em diante.
    expect(nav).toContain("gap-4");
    expect(nav).toContain("xl:gap-8");
    expect(nav).not.toContain("lg:gap-8");
    expect(nav).not.toContain("gap-6");
    // O chrome da direita não encolhe: a nav é quem precisa caber ao lado dele.
    const chrome = classTokens(
      html,
      /<div class="([^"]*shrink-0[^"]*)"><button[^>]*aria-label="Switch to/,
    );
    expect(chrome).toContain("shrink-0");
  });

  it("a BottomNav assume abaixo de lg e some de lg em diante", async () => {
    const html = await renderShell();
    const nav = classTokens(
      html,
      /<nav aria-label="[^"]*" class="([^"]*)" data-testid="panel-bottom-nav"/,
    );

    expect(nav).toContain("fixed");
    expect(nav).toContain("h-16");
    expect(nav).toContain("lg:hidden");
    expect(nav).not.toContain("md:hidden");
  });

  it("o main reserva a altura da BottomNav (pb-16) até lg", async () => {
    const html = await renderShell();
    const main = classTokens(html, /<main class="([^"]*)"/);

    expect(main).toContain("pb-16");
    expect(main).toContain("lg:pb-0");
    expect(main).not.toContain("md:pb-0");
  });

  it("BrandRail e PanelFooter continuam trocando em md: a versão aparece uma vez por largura", async () => {
    const html = await renderShell();
    const rail = classTokens(
      html,
      /<aside aria-label="[^"]*" class="([^"]*)" data-testid="panel-brand-rail"/,
    );
    const footerWrapper = classTokens(html, /<div class="([^"]*)"><footer/);

    expect(rail).toContain("hidden");
    expect(rail).toContain("md:flex");
    expect(footerWrapper).toContain("md:hidden");
  });
});
