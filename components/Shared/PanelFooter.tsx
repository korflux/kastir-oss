import packageJson from "@/package.json";

import type { PanelDictionary } from "@/lib/i18n/panel";

export const PANEL_RELEASES_URL =
  "https://github.com/korflux/kastir-oss/releases";

export function PanelFooter({ dictionary }: { dictionary: PanelDictionary }) {
  return (
    <footer className="text-muted-foreground flex items-center justify-between border-t px-4 py-4 text-xs md:px-6">
      <span>
        {dictionary.footer.version}{" "}
        <span data-testid="panel-version">{packageJson.version}</span>
      </span>
      <a
        className="hover:text-foreground underline-offset-4 hover:underline"
        href={PANEL_RELEASES_URL}
        rel="noreferrer"
        target="_blank"
      >
        {dictionary.footer.releases}
      </a>
    </footer>
  );
}
