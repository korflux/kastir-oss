import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getPublicDir } from "@/lib/Publishing/fileStore";
import { buildInstallationFallbackHtml } from "@/lib/Publishing/installationFallbackHtml";

/**
 * Serve the published homepage alias (`public/index.html`) at `/`.
 * Without a configured home page → landing de instalação (marca + /admin).
 * Em Docker o Nginx faz try_files /index.html @nextjs e cai aqui.
 */
export async function GET() {
  try {
    const html = await readFile(join(getPublicDir(), "index.html"), "utf8");
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // Sem home publicada: landing de instalação + admin bar (se autenticado).
    return new Response(buildInstallationFallbackHtml(), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
