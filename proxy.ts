import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { authorizePanelPath } from "@/lib/Modules/Panel/Policy";
import type { PanelSession } from "@/lib/Modules/Panel/Authorization";

/**
 * Per-request nonce, so script-src can drop 'unsafe-inline'. next.config.ts
 * can't compute this (headers() has no request access), so the whole admin
 * CSP lives here instead of being split across two files.
 */
function buildAdminCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
    }`,
    // ponytail: Tailwind/Next emitem style= e <style> no admin; nonce em
    // style-src exige migrar todos os inline — só então dropar unsafe-inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${
      process.env.NODE_ENV === "development" ? " ws: wss:" : ""
    }`,
    "worker-src 'self' blob:",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const nonce = crypto.randomUUID();
  const csp = buildAdminCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const withCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  // next-themes' inline theme script reads x-nonce via the ThemeProvider
  // `nonce` prop (app/layout.tsx) to satisfy this same script-src.
  const next = () =>
    withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  // Public bearer-token pages are intentionally limited to one non-empty
  // segment. The API remains responsible for validating token state.
  const isPublicTokenPage = /^\/admin\/(?:invite|reset-password)\/[^/]+$/.test(
    pathname,
  );
  if (isPublicTokenPage) {
    const response = next();
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  // Login e consentimento OAuth do MCP se validam sozinhos: o guard do painel
  // barraria /admin/mcp/consent (não é item de menu) e o redirect pro login
  // perderia a query assinada do authorize — a própria página preserva no next=.
  if (pathname === "/admin/login" || pathname === "/admin/mcp/consent") {
    const response = next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (pathname === "/admin/forbidden") {
    return next();
  }

  const access = authorizePanelPath(pathname, session as PanelSession | null);
  if (access.status === "login") {
    return withCsp(NextResponse.redirect(new URL("/admin/login", request.url)));
  }

  if (access.status === "forbidden") {
    return withCsp(
      NextResponse.redirect(new URL("/admin/forbidden", request.url)),
    );
  }

  return next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
