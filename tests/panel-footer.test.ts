import packageJson from "@/package.json";
import { describe, expect, it } from "vitest";

import {
  PANEL_RELEASES_URL,
  PanelFooter,
} from "@/components/Shared/PanelFooter";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("panel footer", () => {
  it("exposes the installed version and safe releases link", () => {
    const element = PanelFooter({
      dictionary: getPanelDictionary("en"),
    });
    const [, releasesLink] = element.props.children;

    expect(element.props.children[0].props.children[2].props.children).toBe(
      packageJson.version,
    );
    expect(releasesLink.props.href).toBe(PANEL_RELEASES_URL);
    expect(releasesLink.props.rel).toBe("noreferrer");
    expect(releasesLink.props.target).toBe("_blank");
  });
});
