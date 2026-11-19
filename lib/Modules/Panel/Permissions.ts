import type { EffectiveRole, PanelMenuItem } from "@/lib/Modules/Panel/Types";

export type { EffectiveRole, PanelMenuItem } from "@/lib/Modules/Panel/Types";

// Fase 31: Home (= site público /) + 6 abas. Setup fica na engrenagem.
export const MENU_ITEMS = [
  {
    key: "home",
    href: "/",
    labelKey: "home",
    iconKey: "home",
    roles: ["MASTER", "ADMIN", "EDITOR"],
  },
  {
    key: "panel",
    href: "/admin",
    labelKey: "panel",
    iconKey: "layoutDashboard",
    roles: ["MASTER", "ADMIN", "EDITOR"],
  },
  {
    key: "pages",
    href: "/admin/pages",
    labelKey: "pages",
    iconKey: "fileText",
    roles: ["MASTER", "ADMIN", "EDITOR"],
  },
  {
    key: "media",
    href: "/admin/media",
    labelKey: "media",
    iconKey: "image",
    roles: ["MASTER", "ADMIN", "EDITOR"],
  },
  {
    // EDITOR grava JS publicado — ver threat model em CUSTOM-CODE.md.
    key: "scripts",
    href: "/admin/custom-code",
    labelKey: "scripts",
    iconKey: "code2",
    roles: ["MASTER", "ADMIN", "EDITOR"],
  },
  {
    key: "splitTests",
    href: "/admin/split-tests",
    labelKey: "splitTests",
    iconKey: "gitBranch",
    roles: ["MASTER", "ADMIN", "EDITOR"],
  },
  {
    key: "users",
    href: "/admin/users",
    labelKey: "users",
    iconKey: "users",
    roles: ["MASTER", "ADMIN"],
  },
] as const satisfies readonly PanelMenuItem[];

// Home (site público) só no topbar desktop — no mobile não tira slot do painel.
export const PRIMARY_BOTTOM_NAV_KEYS = [
  "panel",
  "pages",
  "media",
  "scripts",
] as const;

export function toEffectiveRole(user: {
  role: unknown;
  isMaster?: boolean | null;
}): EffectiveRole {
  if (user.isMaster === true) {
    return "MASTER";
  }

  if (user.role === "ADMIN" || user.role === "EDITOR") {
    return user.role;
  }

  throw new Error("Invalid panel role");
}

export function visibleMenuItems(
  role: EffectiveRole,
): readonly PanelMenuItem[] {
  return MENU_ITEMS.filter((item) =>
    item.roles.some((allowedRole) => allowedRole === role),
  );
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function findMenuItemForPath(
  pathname: string,
): PanelMenuItem | undefined {
  const normalizedPath = normalizePath(pathname);

  return [...MENU_ITEMS]
    .filter((item) => {
      const href = normalizePath(item.href);
      // Home aponta pro site público — match exato, nunca prefixa rotas /admin.
      if (href === "/" || !href.startsWith("/admin")) {
        return normalizedPath === href;
      }
      return (
        normalizedPath === href ||
        (href !== "/admin" && normalizedPath.startsWith(`${href}/`))
      );
    })
    .sort((left, right) => right.href.length - left.href.length)[0];
}

export function partitionBottomNav(items: readonly PanelMenuItem[]): {
  primary: PanelMenuItem[];
  overflow: PanelMenuItem[];
} {
  const primaryKeys = new Set<string>(PRIMARY_BOTTOM_NAV_KEYS);

  return items.reduce(
    (partition, item) => {
      // Home = link pro site; bottom nav do painel não inclui.
      if (item.key === "home") return partition;
      partition[primaryKeys.has(item.key) ? "primary" : "overflow"].push(item);
      return partition;
    },
    { primary: [], overflow: [] } as {
      primary: PanelMenuItem[];
      overflow: PanelMenuItem[];
    },
  );
}
