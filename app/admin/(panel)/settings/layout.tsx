import type { ReactNode } from "react";

import { SetupNav } from "@/lib/Modules/Settings/Components/SetupNav";
import { requirePanelSession } from "@/lib/Modules/Panel/Authorization";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { env } from "@/lib/env";

/**
 * Shell do Setup: menu interno (General/Settings/Connections/Logs/Backup)
 * + conteúdo da aba à direita. Sub-rotas em settings/{aba}/page.tsx.
 */
export default async function SetupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requirePanelSession();
  const role = toEffectiveRole(session.user);
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      data-testid="setup-shell"
    >
      <SetupNav labels={dictionary.setup.nav} role={role} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
