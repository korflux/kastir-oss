import { UsersWorkspace } from "@/lib/Modules/Users/Components/UsersWorkspace";
import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

export default async function UsersPage() {
  const { session, role } = await requirePanelAccess("/admin/users");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);

  return (
    <div
      data-tour-anchor="tour-users"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <UsersWorkspace
        actorId={session.user.id}
        actorRole={role}
        dictionary={dictionary.users}
      />
    </div>
  );
}
