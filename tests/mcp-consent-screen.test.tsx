import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConsentScreen } from "@/lib/Modules/Mcp/Components/ConsentScreen";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en").mcpConsent;

function render(props: Partial<Parameters<typeof ConsentScreen>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ConsentScreen, {
      client: {
        clientId: "attacker-client",
        name: "Claude",
        icon: null,
        verified: false,
      },
      dictionary,
      grantedScopes: ["cms:read"],
      oauthQuery:
        "client_id=attacker-client&redirect_uri=https://evil.example/cb",
      redirectUri: "https://evil.example/cb",
      requestedScopes: ["cms:read"],
      resource: "http://localhost:3000/api/mcp",
      role: "EDITOR",
      ...props,
    }),
  );
}

describe("ConsentScreen unverified client", () => {
  it("shows the unverified badge, warning, client id, and redirect URL", () => {
    const html = render();

    expect(html).toContain(dictionary.unverifiedBadge);
    expect(html).toContain(dictionary.unverifiedWarning);
    expect(html).toContain("attacker-client");
    expect(html).toContain("https://evil.example/cb");
    expect(html).toContain(dictionary.redirectUri);
  });

  it("omits the unverified warning when the client is server-verified", () => {
    const html = render({
      client: {
        clientId: "trusted-client",
        name: "Internal",
        icon: null,
        verified: true,
      },
    });

    expect(html).not.toContain(dictionary.unverifiedBadge);
    expect(html).not.toContain(dictionary.unverifiedWarning);
    expect(html).toContain("Internal");
  });
});
