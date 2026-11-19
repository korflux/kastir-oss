import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { LoginForm } from "@/lib/Modules/Auth/Components/LoginForm";
import { sanitizeLoginNext } from "@/lib/Modules/Auth/safeNext";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { env } from "@/lib/env";
import { auth } from "@/lib/auth";
import {
  getMcpConsentPath,
  type OAuthSearchParams,
} from "@/lib/Modules/Mcp/OAuthQuery";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<OAuthSearchParams>;
}) {
  // Auth da tela: build não inicializa plugins que exigem infraestrutura.
  await connection();
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextPath = getMcpConsentPath(params) ?? sanitizeLoginNext(rawNext);

  if (session) {
    redirect(nextPath ?? "/admin");
  }

  return (
    <LoginForm
      dictionary={getPanelDictionary(env.PANEL_LANGUAGE)}
      nextPath={nextPath}
    />
  );
}
