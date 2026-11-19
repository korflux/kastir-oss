import {
  findMenuItemForPath,
  toEffectiveRole,
  visibleMenuItems,
} from "@/lib/Modules/Panel/Permissions";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";

import type { PanelSession } from "@/lib/Modules/Panel/Authorization";

export type PanelAccess =
  | { status: "allow"; role: EffectiveRole }
  | { status: "login" }
  | { status: "forbidden"; role?: EffectiveRole };

/**
 * Bulk e exclusão permanente são privilegiados (MASTER/ADMIN).
 * Soft-delete e restore individuais continuam liberados ao EDITOR.
 */
export function canBulkMutate(
  role: unknown,
): role is Extract<EffectiveRole, "MASTER" | "ADMIN"> {
  return role === "MASTER" || role === "ADMIN";
}

/** Alias semântico do permanent delete; mesma matriz do bulk privilegiado. */
export function canPermanentlyDelete(
  role: unknown,
): role is Extract<EffectiveRole, "MASTER" | "ADMIN"> {
  return canBulkMutate(role);
}

/** Admin paths reachable without a MENU_ITEMS entry (still require a session). */
export const PANEL_PATHS_WITHOUT_MENU = ["/admin/forbidden"] as const;

/**
 * Rotas de Setup (engrenagem → /admin/settings/*). Fora do MENU_ITEMS.
 * connections herda os papéis da antiga /admin/mcp (inclui EDITOR).
 * Match por prefixo mais longo — connections antes de settings genérico.
 */
const SETUP_PATH_ACCESS = [
  {
    href: "/admin/settings/connections",
    roles: ["MASTER", "ADMIN", "EDITOR"] as const,
  },
  {
    href: "/admin/settings",
    roles: ["MASTER", "ADMIN"] as const,
  },
] as const;

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function findSetupPathAccess(pathname: string) {
  const normalizedPath = normalizePath(pathname);
  return [...SETUP_PATH_ACCESS]
    .filter((item) => {
      const href = normalizePath(item.href);
      return normalizedPath === href || normalizedPath.startsWith(`${href}/`);
    })
    .sort((left, right) => right.href.length - left.href.length)[0];
}

export function authorizePanelPath(
  pathname: string,
  session: PanelSession | null,
): PanelAccess {
  if (!session) {
    return { status: "login" };
  }

  let role: EffectiveRole;
  try {
    role = toEffectiveRole(session.user);
  } catch {
    return { status: "forbidden" };
  }

  const normalizedPath = normalizePath(pathname);

  if (
    (PANEL_PATHS_WITHOUT_MENU as readonly string[]).includes(normalizedPath)
  ) {
    return { status: "allow", role };
  }

  const menuItem = findMenuItemForPath(normalizedPath);
  if (menuItem) {
    if (visibleMenuItems(role).some((item) => item.key === menuItem.key)) {
      return { status: "allow", role };
    }
    return { status: "forbidden", role };
  }

  // Setup fora do MENU_ITEMS — autoriza por role, não por presença no menu.
  const setupPath = findSetupPathAccess(normalizedPath);
  if (setupPath) {
    if (setupPath.roles.some((allowed) => allowed === role)) {
      return { status: "allow", role };
    }
    return { status: "forbidden", role };
  }

  // Fail closed: unknown /admin paths are not open just because the user is logged in.
  return { status: "forbidden", role };
}
