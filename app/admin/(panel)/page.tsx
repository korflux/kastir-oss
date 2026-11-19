import { Greeting } from "@/lib/Modules/Home/Components/Greeting";
import { getPanelOverview } from "@/lib/Modules/Home/Service";
import { requirePanelSession } from "@/lib/Modules/Panel/Authorization";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

export default async function AdminPage() {
  const session = await requirePanelSession();
  const role = toEffectiveRole(session.user);
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const overview = await getPanelOverview(role);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Greeting
        dictionary={dictionary.home}
        menu={dictionary.menu}
        name={session.user.name}
        overview={overview}
        role={role}
      />
    </div>
  );
}
