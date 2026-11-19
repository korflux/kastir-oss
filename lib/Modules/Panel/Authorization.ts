import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/lib/auth";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import { authorizePanelPath } from "@/lib/Modules/Panel/Policy";

export type PanelSessionUser = {
  id: string;
  name: string;
  email: string;
  role: unknown;
  isMaster?: boolean | null;
};

export type PanelSession = {
  user: PanelSessionUser;
};

export type { PanelAccess } from "@/lib/Modules/Panel/Policy";
export {
  authorizePanelPath,
  canBulkMutate,
  canPermanentlyDelete,
} from "@/lib/Modules/Panel/Policy";

/**
 * Better Auth's additional user fields are included in getSession at runtime.
 * Keep the cast at this server boundary so client components receive only the
 * explicitly selected panel session fields.
 */
export function asPanelSession(session: unknown): PanelSession | null {
  if (!session || typeof session !== "object" || !("user" in session)) {
    return null;
  }

  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") {
    return null;
  }

  return session as PanelSession;
}

/** Auth do painel: só cria Better Auth quando já existe uma request real. */
async function loadPanelSession(): Promise<PanelSession | null> {
  // Build hermética: `connection()` interrompe o prerender antes do proxy lazy.
  await connection();
  return asPanelSession(
    await auth.api.getSession({ headers: await headers() }),
  );
}

export async function requirePanelSession(): Promise<PanelSession> {
  const session = await loadPanelSession();

  if (!session) {
    redirect("/admin/login");
  }

  return session as PanelSession;
}

export async function requirePanelAccess(pathname: string): Promise<{
  session: PanelSession;
  role: EffectiveRole;
}> {
  const session = await loadPanelSession();
  const access = authorizePanelPath(pathname, session);

  if (access.status === "login") {
    redirect("/admin/login");
  }

  if (access.status === "forbidden") {
    redirect("/admin/forbidden");
  }

  return { session: session as PanelSession, role: access.role };
}
