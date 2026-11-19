import { ForbiddenView } from "@/components/Shared/PanelStub";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

export default function ForbiddenPage() {
  return <ForbiddenView dictionary={getPanelDictionary(env.PANEL_LANGUAGE)} />;
}
