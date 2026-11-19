import Link from "next/link";

import packageJson from "@/package.json";
import { BrandLogo } from "@/components/Shared/BrandLogo";
import type { PanelDictionary } from "@/lib/i18n/panel";

/**
 * Faixa de marca 93px do Figma (logo K no topo, wordmark + version embaixo).
 * Desktop only — mobile não tem rail lateral.
 */
export function BrandRail({ dictionary }: { dictionary: PanelDictionary }) {
  return (
    <aside
      aria-label={dictionary.shell.brand}
      className="bg-canvas border-border sticky top-0 hidden h-svh w-[93px] shrink-0 flex-col items-center border-r md:flex"
      data-testid="panel-brand-rail"
    >
      <Link
        aria-label={dictionary.shell.brand}
        className="flex size-[93px] items-center justify-center"
        href="https://korflux.com.br"
        rel="noopener noreferrer"
        target="_blank"
      >
        <BrandLogo className="h-[29px] w-6" kind="symbol" priority />
      </Link>
      <div className="mt-auto flex flex-col items-center gap-1 pb-6">
        <BrandLogo
          className="h-4 w-[60px]"
          kind="logo"
          label={dictionary.shell.brand}
        />
        <p className="text-[10px] leading-none">
          <span className="text-brand font-medium">version</span>{" "}
          <span
            className="text-foreground font-extralight"
            data-testid="panel-version"
          >
            {packageJson.version}
          </span>
        </p>
      </div>
    </aside>
  );
}
