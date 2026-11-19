"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  GUIDED_TOUR_STORAGE_KEY,
  guidedTourStorageValue,
  shouldShowGuidedTour,
} from "@/lib/Modules/Onboarding/State";
import type { PanelDictionary } from "@/lib/i18n/panel";

type TourStep = {
  anchor: string;
  description: string;
  href: string;
  title: string;
};

/** Elemento está na tela: `display: none` (a nav que o breakpoint esconde) não gera caixa. */
function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Resolve o elemento que o passo destaca a partir do `data-tour-anchor` do passo, em ordem:
 *
 * 1. Âncora de navegação visível: `[data-tour-anchor]` dentro de um `<nav>` (Topbar de `lg` em
 *    diante, BottomNav abaixo). A nav que o breakpoint esconde é ignorada, senão o destaque
 *    cairia num link sem caixa. Os wrappers de rota (`<div data-tour-anchor>` das páginas) ficam
 *    de fora de propósito: marcam a página inteira, não o item de menu que o passo apresenta.
 * 2. Botão "Mais" da BottomNav, quando o item do passo está no overflow dessa nav (entre 768 e
 *    1023 px, por exemplo, Users só existe no diálogo). O botão declara em
 *    `data-tour-anchor-proxy` os anchors que abriga; é um atributo próprio, para não duplicar
 *    `data-tour-anchor` no DOM. Vale para qualquer item de overflow, não só Users.
 * 3. Primeiro `[data-tour-anchor]` do documento: comportamento anterior, que ainda cobre o item
 *    ocultado da nav pela preferência de menu (cai no wrapper da rota).
 *
 * Só lê o DOM e não move foco: o destaque é o atributo `data-tour-current`, aplicado pelo efeito.
 */
export function resolveTourTarget(anchor: string): HTMLElement | null {
  const anchored = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour-anchor="${anchor}"]`),
  );

  const visibleNavAnchor = anchored.find(
    (element) => element.closest("nav") !== null && isRendered(element),
  );
  if (visibleNavAnchor) return visibleNavAnchor;

  const visibleOverflowTrigger = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-tour-anchor-proxy~="${anchor}"]`,
    ),
  ).find(isRendered);
  if (visibleOverflowTrigger) return visibleOverflowTrigger;

  return anchored[0] ?? null;
}

export function GuidedTour({ copy }: { copy: PanelDictionary["tour"] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const open = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("kastir-guided-tour-change", onStoreChange);
      return () =>
        window.removeEventListener("kastir-guided-tour-change", onStoreChange);
    },
    () =>
      shouldShowGuidedTour(
        window.localStorage.getItem(GUIDED_TOUR_STORAGE_KEY),
      ),
    () => false,
  );

  const steps = useMemo<TourStep[]>(
    () => [
      {
        anchor: "tour-pages",
        description: copy.pagesDescription,
        href: "/admin/pages",
        title: copy.pagesTitle,
      },
      {
        anchor: "tour-media",
        description: copy.mediaDescription,
        href: "/admin/media",
        title: copy.mediaTitle,
      },
      {
        anchor: "tour-custom-code",
        description: copy.customCodeDescription,
        href: "/admin/custom-code",
        title: copy.customCodeTitle,
      },
      {
        anchor: "tour-users",
        description: copy.usersDescription,
        href: "/admin/users",
        title: copy.usersTitle,
      },
      // Logs saiu do menu de topo (Setup); passo removido pra não apontar âncora morta.
    ],
    [copy],
  );
  const step = steps[stepIndex];

  // Destaca o alvo do passo atual (ver `resolveTourTarget`). Roda ao abrir, trocar de passo ou de
  // rota. ponytail: não re-resolve ao redimensionar durante o passo (girar o tablet entre as
  // faixas de `lg` mantém o destaque no elemento anterior), tratar se o destaque ganhar estilo
  // visual ou se o tour passar a ser usado em tablets com rotação.
  useEffect(() => {
    if (!open || !step) return;

    const target = resolveTourTarget(step.anchor);
    if (!target) return;

    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.dataset.tourCurrent = "true";

    return () => {
      delete target.dataset.tourCurrent;
    };
  }, [open, pathname, step]);

  function close(status: "completed" | "dismissed") {
    window.localStorage.setItem(
      GUIDED_TOUR_STORAGE_KEY,
      guidedTourStorageValue(status),
    );
    window.dispatchEvent(new Event("kastir-guided-tour-change"));
  }

  function goTo(nextIndex: number) {
    const nextStep = steps[nextIndex];
    if (!nextStep) {
      close("completed");
      return;
    }

    setStepIndex(nextIndex);
    if (pathname !== nextStep.href) {
      router.push(nextStep.href);
    }
  }

  if (!open || !step) return null;

  const progress = copy.progress
    .replace("{current}", String(stepIndex + 1))
    .replace("{total}", String(steps.length));
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  // Cartão flutuante: abaixo de `lg` fica acima da BottomNav (bottom-20 > h-16 da nav); de `lg`
  // em diante a nav é a da Topbar e o cartão desce para o canto. Mesmo breakpoint da troca de
  // navegação do painel (ver PanelLayout).
  return (
    <aside
      aria-label={copy.title}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-20 z-50 flex justify-end lg:right-6 lg:bottom-6 lg:left-auto"
      data-testid="guided-tour"
      data-tour-step={stepIndex + 1}
    >
      <div className="bg-paper border-border pointer-events-auto w-full max-w-sm rounded-2xl border p-4 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">
              {progress}
            </p>
            <h2 className="mt-1 text-base font-semibold">{copy.title}</h2>
          </div>
          <Button
            aria-label={copy.close}
            onClick={() => close("dismissed")}
            size="icon-sm"
            variant="ghost"
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{step.title}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {step.description}
          </p>
          <p className="text-muted-foreground mt-3 text-xs">
            {copy.description}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button onClick={() => close("dismissed")} variant="ghost">
            {copy.skip}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              disabled={isFirst}
              onClick={() => goTo(stepIndex - 1)}
              variant="outline"
            >
              {copy.previous}
            </Button>
            <Button
              onClick={() => goTo(stepIndex + 1)}
              variant={isLast ? "default" : "outline"}
            >
              {isLast ? copy.finish : copy.next}
            </Button>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="bg-muted mt-4 h-1 overflow-hidden rounded-full"
        >
          <div
            className="bg-foreground h-full transition-[width]"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </aside>
  );
}
