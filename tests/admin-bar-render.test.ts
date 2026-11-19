import { describe, expect, it } from "vitest";

import { publicBarLabels } from "@/lib/i18n/publicBar";
import {
  publicScriptBarLabels,
  renderBarHtml,
  type PublicBarUser,
} from "@/public-scripts/admin-bar";

const user: PublicBarUser = {
  id: "user-id",
  name: "Visible Name",
  role: "ADMIN",
};

describe("published admin bar renderer", () => {
  it("keeps inlined script labels identical to lib/i18n/publicBar", () => {
    expect(publicScriptBarLabels).toEqual(publicBarLabels);
  });

  it.each([
    [
      "en",
      "Home",
      "Panel",
      "Pages",
      "Setup",
      "Switch to dark theme",
      "Profile",
      "Edit this page",
      "Log out",
      "Administrator",
    ],
    [
      "pt-BR",
      "Home",
      "Painel",
      "Pages",
      "Setup",
      "Ativar tema escuro",
      "Perfil",
      "Editar esta página",
      "Sair",
      "Administrador",
    ],
  ] as const)("renders the %s labels", (locale, ...expected) => {
    const html = renderBarHtml(user, "page-123", locale);

    for (const label of expected) {
      expect(html).toContain(label);
    }
  });

  it("escapes identity data and builds only internal edit links", () => {
    const html = renderBarHtml(
      {
        id: "user-id",
        name: '<script>alert("x")</script> & name',
        role: "EDITOR",
      },
      'page/" onmouseover="alert(1)',
      "en",
    );

    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain(
      "/admin/pages/page%2F%22%20onmouseover%3D%22alert(1)",
    );
    expect(html).not.toContain("http://");
  });

  it("mirrors panel shell chrome (logo 93px + topbar 93px + actions + notifications)", () => {
    const html = renderBarHtml(user, "page-123", "en");

    expect(html).toContain('id="kastir-admin-bar"');
    expect(html).toContain("position:fixed");
    expect(html).not.toContain("position:sticky");
    expect(html).toContain("z-index:2147483000");
    expect(html).toContain("height:93px");
    expect(html).toContain("width:93px");
    expect(html).toContain("/admin-brand/kastir-symbol-light.webp");
    expect(html).not.toContain("/admin-brand/k-logo.png");
    expect(html).toContain("kastir-admin-bar__brand");
    expect(html).toContain("kastir-admin-bar__nav");
    expect(html).toContain("kastir-admin-bar__actions");
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('aria-label="Open notifications"');
    expect(html).toContain('data-admin-bar-action="notifications"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Switch to dark theme"');
    expect(html).toContain('aria-label="Profile"');
    expect(html).toContain("Log out");
    expect(html).toContain('class="kastir-admin-bar__icon"');
    expect(html).toContain('class="kastir-admin-bar__avatar"');
    expect(html).toContain(">VN<");
    // Menu de perfil no formato da topbar (labels + separator + items).
    expect(html).toContain("kastir-admin-bar__menu-group");
    expect(html).toContain("kastir-admin-bar__menu-sep");
    expect(html).toContain("Visible Name");
    expect(html).toContain("Administrator");
    expect(html).not.toContain("Switch to dark theme</button>");
    expect(html).not.toContain("Profile: Visible Name");
  });

  it("omits edit link when pageId is empty (install landing)", () => {
    const html = renderBarHtml(user, "", "en");
    expect(html).not.toContain("Edit this page");
    expect(html).not.toContain("data-admin-bar-edit");
    expect(html).toContain("Panel");
  });
});
