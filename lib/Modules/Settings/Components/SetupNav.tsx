"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { cn } from "@/lib/utils";

type SetupNavCopy = PanelDictionary["setup"]["nav"];

/** Itens do menu interno do Setup (Figma: barra vertical com indicador verde). */
const SETUP_NAV_ITEMS = [
  {
    key: "general",
    href: "/admin/settings/general",
    roles: ["MASTER", "ADMIN"] as const,
  },
  {
    key: "settings",
    href: "/admin/settings/settings",
    roles: ["MASTER", "ADMIN"] as const,
  },
  {
    key: "connections",
    href: "/admin/settings/connections",
    // Mesmos papéis da antiga /admin/mcp — EDITOR só vê Connections.
    roles: ["MASTER", "ADMIN", "EDITOR"] as const,
  },
  {
    key: "logs",
    href: "/admin/settings/logs",
    roles: ["MASTER", "ADMIN"] as const,
  },
  {
    key: "backup",
    href: "/admin/settings/backup",
    roles: ["MASTER", "ADMIN"] as const,
  },
] as const;

export function SetupNav({
  role,
  labels,
}: {
  role: EffectiveRole;
  labels: SetupNavCopy;
}) {
  const pathname = usePathname();
  const items = SETUP_NAV_ITEMS.filter((item) =>
    item.roles.some((allowed) => allowed === role),
  );

  return (
    <nav
      aria-label="Setup"
      className="border-border bg-background/40 flex w-44 shrink-0 flex-col gap-1 border-r px-3 py-6 md:w-48 md:px-4"
      data-testid="setup-nav"
    >
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5",
            )}
            href={item.href}
          >
            {/* Indicador verde do item ativo (Figma Setup.png). */}
            {active ? (
              <span
                aria-hidden="true"
                className="bg-primary absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-full"
              />
            ) : null}
            {labels[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
