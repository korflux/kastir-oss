// @vitest-environment jsdom

import {
  act,
  createElement,
  Fragment,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomNav } from "@/components/Shared/BottomNav";
import { MENU_VISIBILITY_STORAGE_KEY } from "@/components/Shared/useMenuVisibility";
import {
  GuidedTour,
  resolveTourTarget,
} from "@/lib/Modules/Onboarding/Components/GuidedTour";
import { tourAnchorId } from "@/lib/Modules/Onboarding/tourAnchors";
import {
  GUIDED_TOUR_STORAGE_KEY,
  guidedTourStorageValue,
  shouldShowGuidedTour,
} from "@/lib/Modules/Onboarding/State";
import {
  partitionBottomNav,
  visibleMenuItems,
} from "@/lib/Modules/Panel/Permissions";
import { getPanelDictionary } from "@/lib/i18n/panel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/pages",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

describe("guided tour state", () => {
  it("shows the current tour when storage is empty or malformed", () => {
    expect(shouldShowGuidedTour(null)).toBe(true);
    expect(shouldShowGuidedTour("not-json")).toBe(true);
  });

  it("does not show a dismissed current version", () => {
    const stored = guidedTourStorageValue("dismissed");

    expect(GUIDED_TOUR_STORAGE_KEY).toBe("kastir.panel.guided-tour.v1");
    expect(shouldShowGuidedTour(stored)).toBe(false);
  });

  it("shows a newer tour version after an older one was dismissed", () => {
    const stored = JSON.stringify({ status: "dismissed", version: 0 });

    expect(shouldShowGuidedTour(stored)).toBe(true);
  });

  it("normalizes menu keys to stable tour anchors", () => {
    expect(tourAnchorId("pages")).toBe("tour-pages");
    expect(tourAnchorId("scripts")).toBe("tour-custom-code");
    expect(tourAnchorId("logs")).toBe("tour-logs");
  });
});

/**
 * Fase 3, T6 (spec A10): o cartão do tour acompanha a troca de navegação do painel em `lg`.
 * Abaixo de `lg` ele fica acima da BottomNav (bottom-20 > h-16 da nav); de `lg` em diante desce
 * para o canto. Só renderiza no cliente (o snapshot de servidor é "fechado"), por isso jsdom.
 */
describe("guided tour card: breakpoint da navegação", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fica acima da BottomNav abaixo de lg e vai para o canto de lg em diante", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(GuidedTour, { copy: getPanelDictionary("en").tour }),
      );
    });

    const card = container.querySelector<HTMLElement>(
      '[data-testid="guided-tour"]',
    );
    expect(card).not.toBeNull();
    const tokens = (card?.className ?? "").split(/\s+/);

    expect(tokens).toContain("bottom-20");
    expect(tokens).toContain("lg:right-6");
    expect(tokens).toContain("lg:bottom-6");
    expect(tokens).toContain("lg:left-auto");
    expect(tokens.filter((token) => token.startsWith("md:"))).toEqual([]);

    act(() => root.unmount());
  });
});

/**
 * Fase 3, R3 (spec A10; design › Shell › Responsivo): entre 768 e 1023 px a nav superior está
 * escondida e a BottomNav só mostra os itens primários; Users (e Split Tests) vivem no diálogo
 * "Mais", que nem monta os itens fechado. O passo do tour precisa de um alvo visível: o próprio
 * link quando ele está numa nav visível, o botão "Mais" quando o item está no overflow.
 *
 * O jsdom não aplica CSS, então o layout é emulado: `getClientRects` devolve vazio para um
 * elemento escondido pelas classes de breakpoint que a casca realmente usa (`hidden` +
 * `lg:flex` na nav superior, `lg:hidden` na BottomNav real, renderizada aqui). A nav superior é
 * um stand-in com as mesmas âncoras e classes (a real é coberta por `responsive-shell.test.tsx`).
 */
describe("guided tour: alvo do passo entre nav superior, BottomNav e overflow", () => {
  const dictionary = getPanelDictionary("en");
  const menuItems = visibleMenuItems("MASTER");
  const { overflow } = partitionBottomNav(menuItems);
  const NARROW = 768;
  const WIDE = 1024;

  /** `display: none` por classe de breakpoint, subindo pelos ancestrais (como o CSS faz). */
  function isDisplayed(element: Element, width: number): boolean {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const tokens =
        typeof node.className === "string" ? node.className.split(/\s+/) : [];
      const hiddenByDefault = tokens.includes("hidden");
      const shownFromLg = tokens.includes("lg:flex");
      const hiddenFromLg = tokens.includes("lg:hidden");
      const hidden =
        width >= 1024
          ? hiddenFromLg || (hiddenByDefault && !shownFromLg)
          : hiddenByDefault;
      if (hidden) return false;
    }
    return true;
  }

  /** Monta o shell (nav superior, wrapper de rota, BottomNav real e tour) numa largura. */
  function renderShell(
    width: number,
    options: { hiddenKeys?: string[]; tourDismissed?: boolean } = {},
  ) {
    const hiddenKeys = options.hiddenKeys ?? [];
    window.localStorage.setItem(
      MENU_VISIBILITY_STORAGE_KEY,
      JSON.stringify(hiddenKeys),
    );
    if (options.tourDismissed) {
      window.localStorage.setItem(
        GUIDED_TOUR_STORAGE_KEY,
        guidedTourStorageValue("dismissed"),
      );
    }
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      return (isDisplayed(this, width) ? [{}] : []) as unknown as DOMRectList;
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(
            "nav",
            {
              className: "hidden min-w-0 items-center gap-4 lg:flex xl:gap-8",
              "data-testid": "panel-top-nav",
            },
            menuItems
              .filter((item) => !hiddenKeys.includes(item.key))
              .map((item) =>
                createElement(
                  "a",
                  {
                    "data-tour-anchor": tourAnchorId(item.key),
                    href: item.href,
                    key: item.key,
                  },
                  dictionary.menu[item.labelKey],
                ),
              ),
          ),
          // Wrapper de rota (página de Users): âncora fora de qualquer nav, sempre visível.
          createElement(
            "main",
            null,
            createElement("div", { "data-tour-anchor": "tour-users" }),
          ),
          createElement(BottomNav, { dictionary, role: "MASTER" }),
          createElement(GuidedTour, { copy: dictionary.tour }),
        ),
      );
    });

    const moreButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="panel-bottom-nav"] button',
      ),
    ).find((button) => button.textContent?.includes(dictionary.shell.more));
    return {
      bottomNav: container.querySelector<HTMLElement>(
        '[data-testid="panel-bottom-nav"]',
      ),
      container,
      moreButton,
      root,
      topNav: container.querySelector<HTMLElement>(
        '[data-testid="panel-top-nav"]',
      ),
      /** Clica em "Next" `times` vezes (cada clique troca de passo). */
      next(times: number) {
        for (let i = 0; i < times; i += 1) {
          const button = Array.from(
            container.querySelectorAll<HTMLButtonElement>("button"),
          ).find((candidate) => candidate.textContent === dictionary.tour.next);
          act(() => button?.click());
        }
      },
      /** Todos os elementos que o tour marca como destaque atual. */
      current: () =>
        Array.from(
          container.querySelectorAll<HTMLElement>("[data-tour-current]"),
        ),
    };
  }

  beforeEach(() => {
    window.localStorage.clear();
    // O jsdom não implementa `scrollIntoView`; o tour o chama no alvo.
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    document.body.innerHTML = "";
  });

  it("abaixo de lg, passo cuja âncora está visível na BottomNav usa a própria âncora, não a da nav superior escondida", () => {
    const shell = renderShell(NARROW);

    const current = shell.current();
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("data-tour-anchor")).toBe("tour-pages");
    expect(shell.bottomNav?.contains(current[0] ?? null)).toBe(true);
    expect(shell.moreButton?.hasAttribute("data-tour-current")).toBe(false);

    act(() => shell.root.unmount());
  });

  it("abaixo de lg, passo cujo item está no overflow destaca o botão Mais, sem duplicar âncora, roubar foco ou esconder o rótulo", () => {
    const shell = renderShell(NARROW);
    shell.next(3); // Pages, Media, Scripts -> Users

    expect(
      shell.container.querySelector('[data-tour-step="4"]'),
    ).not.toBeNull();
    expect(shell.current()).toEqual([shell.moreButton]);
    // Rótulo intacto, foco onde estava e aria-current só onde já era (link da página aberta).
    expect(shell.moreButton?.textContent).toContain(dictionary.shell.more);
    expect(document.activeElement).toBe(document.body);
    expect(shell.moreButton?.hasAttribute("aria-current")).toBe(false);
    expect(
      shell.bottomNav
        ?.querySelector('[data-tour-anchor="tour-pages"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    // Nenhum data-tour-anchor novo: só a nav superior e o wrapper de rota têm tour-users.
    expect(
      shell.bottomNav?.querySelector('[data-tour-anchor="tour-users"]'),
    ).toBeNull();
    expect(
      shell.container.querySelectorAll('[data-tour-anchor="tour-users"]'),
    ).toHaveLength(2);

    // Ao desmontar o tour, o destaque é removido do botão.
    act(() => shell.root.unmount());
    expect(document.querySelectorAll("[data-tour-current]")).toHaveLength(0);
  });

  it("de lg em diante nada muda: o passo destaca o link da nav superior e o Mais não é tocado", () => {
    const shell = renderShell(WIDE);

    expect(shell.current()).toEqual([
      shell.topNav?.querySelector('[data-tour-anchor="tour-pages"]'),
    ]);
    shell.next(3); // Users
    expect(shell.current()).toEqual([
      shell.topNav?.querySelector('[data-tour-anchor="tour-users"]'),
    ]);
    expect(shell.moreButton?.hasAttribute("data-tour-current")).toBe(false);

    act(() => shell.root.unmount());
  });

  it("o botão Mais declara exatamente os anchors do overflow", () => {
    const shell = renderShell(NARROW, { tourDismissed: true });

    const declared = (
      shell.moreButton?.getAttribute("data-tour-anchor-proxy") ?? ""
    ).split(" ");
    expect(declared).toEqual(overflow.map((item) => tourAnchorId(item.key)));
    expect(declared).toContain("tour-users");
    expect(declared).toContain("tour-splitTests");
    for (const primary of [
      "tour-panel",
      "tour-pages",
      "tour-media",
      "tour-custom-code",
    ]) {
      expect(declared).not.toContain(primary);
    }

    act(() => shell.root.unmount());
  });

  it("é genérico: qualquer item de overflow cai no Mais abaixo de lg e na nav superior de lg em diante", () => {
    for (const item of overflow) {
      const anchor = tourAnchorId(item.key);

      const narrow = renderShell(NARROW, { tourDismissed: true });
      expect(resolveTourTarget(anchor)).toBe(narrow.moreButton);
      act(() => narrow.root.unmount());
      document.body.innerHTML = "";
      vi.restoreAllMocks();

      const wide = renderShell(WIDE, { tourDismissed: true });
      expect(resolveTourTarget(anchor)).toBe(
        wide.topNav?.querySelector(`[data-tour-anchor="${anchor}"]`),
      );
      act(() => wide.root.unmount());
      document.body.innerHTML = "";
      vi.restoreAllMocks();
    }
  });

  it("item ocultado da nav pela preferência de menu não é anunciado pelo Mais: o passo cai no wrapper da rota, como antes", () => {
    const shell = renderShell(NARROW, { hiddenKeys: ["users"] });

    expect(
      shell.moreButton?.getAttribute("data-tour-anchor-proxy"),
    ).not.toContain("tour-users");
    shell.next(3); // Users
    const current = shell.current();
    expect(current).toHaveLength(1);
    expect(current[0]?.closest("main")).not.toBeNull();
    expect(current[0]?.getAttribute("data-tour-anchor")).toBe("tour-users");

    act(() => shell.root.unmount());
  });
});
