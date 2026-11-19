import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BottomNav } from "@/components/Shared/BottomNav";
import { BrandRail } from "@/components/Shared/BrandRail";
import { ForbiddenView } from "@/components/Shared/PanelStub";
import { PanelFooter } from "@/components/Shared/PanelFooter";
import { Topbar } from "@/components/Shared/Topbar";
import { GuidedTour } from "@/lib/Modules/Onboarding/Components/GuidedTour";
import { notificationsService } from "@/lib/Modules/Notifications/Service";
import { requirePanelSession } from "@/lib/Modules/Panel/Authorization";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { env } from "@/lib/env";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { formatSiteTitle } from "@/lib/Modules/Settings/title";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await settingsService.getSettings();
    return { title: formatSiteTitle(settings.siteTitle, settings.tagline) };
  } catch {
    return { title: "Kastir" };
  }
}

/**
 * Casca de todas as telas de `/admin/(panel)`: BrandRail + Topbar + conteúdo + BottomNav.
 *
 * Breakpoints (fonte única da troca de navegação):
 * - `lg` (1024px): nav da Topbar visível; abaixo, a BottomNav assume. Seguem `lg` a nav da
 *   Topbar, a BottomNav, o `pb-16` do `main` (altura da BottomNav) e o cartão do GuidedTour.
 * - `md` (768px): BrandRail (só marca e versão, sem navegação) aparece e o PanelFooter some,
 *   para a versão aparecer uma única vez em cada largura. Ficam em `md`, de propósito.
 */
export default async function PanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requirePanelSession();
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);

  let role;
  try {
    role = toEffectiveRole(session.user);
  } catch {
    return (
      <div className="bg-canvas text-ink flex min-h-svh w-full flex-col">
        <ForbiddenView dictionary={dictionary} />
      </div>
    );
  }

  let initialUnreadCount = 0;
  let formatSettings;
  try {
    initialUnreadCount = await notificationsService.unreadCount(
      session.user.id,
    );
  } catch {
    // The panel shell remains usable if the optional notification read model is unavailable.
  }
  try {
    formatSettings = await settingsService.getSettings();
  } catch {
    formatSettings = undefined;
  }

  return (
    // h-svh + overflow-hidden: colunas do painel cabem na 1ª dobra (não crescem com o conteúdo).
    <div className="bg-canvas text-ink flex h-svh w-full overflow-hidden">
      {/* Brand rail substitui a sidebar de navegação (Figma: logo + version). */}
      <BrandRail dictionary={dictionary} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          dictionary={dictionary}
          initialUnreadCount={initialUnreadCount}
          locale={env.PANEL_LANGUAGE}
          role={role}
          formatSettings={
            formatSettings
              ? {
                  timezone: formatSettings.timezone,
                  dateFormat: formatSettings.dateFormat,
                  timeFormat: formatSettings.timeFormat,
                  weekStartsOn: formatSettings.weekStartsOn,
                }
              : undefined
          }
          user={{ name: session.user.name }}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-16 lg:pb-0">
          {children}
        </main>
        {/* Footer só abaixo de `md` — de `md` em diante o BrandRail já mostra a versão. */}
        <div className="shrink-0 md:hidden">
          <PanelFooter dictionary={dictionary} />
        </div>
        <BottomNav dictionary={dictionary} role={role} />
        {role === "MASTER" ? <GuidedTour copy={dictionary.tour} /> : null}
      </div>
    </div>
  );
}
