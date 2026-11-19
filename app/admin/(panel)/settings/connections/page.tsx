import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { env } from "@/lib/env";
import { McpWorkspace } from "@/lib/Modules/Mcp/Components/McpWorkspace";
import { getMcpResourceUrl } from "@/lib/Modules/Mcp/Scopes";

/** Aba Connections — antiga /admin/mcp (reskin na Task 4). */
export default async function SetupConnectionsPage() {
  await requirePanelAccess("/admin/settings/connections");

  return (
    <McpWorkspace
      dictionary={getPanelDictionary(env.PANEL_LANGUAGE).mcpConnections}
      endpoint={getMcpResourceUrl(env.BETTER_AUTH_URL)}
    />
  );
}
