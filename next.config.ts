import type { NextConfig } from "next";

const transportSecurityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
] as const;

/** Site publicado: sem XFO/HSTS — o HTML do cliente pode ser embebido. */
const publishedTransportHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
] as const;

const nextConfig: NextConfig = {
  // Windows E2E cannot boot `.next/standalone` (pnpm symlink EPERM) and
  // `next start` refuses a standalone output. Production/Docker keep standalone.
  output: process.env.KASTIR_E2E_SERVER === "1" ? undefined : "standalone",
  // DOMPurify carrega o jsdom no servidor; mantê-lo externo preserva os
  // assets lidos por caminho relativo dentro do próprio pacote.
  serverExternalPackages: ["isomorphic-dompurify"],
  // O AGENTS.md é o mapa canônico das regras do projeto. Desde o Next 16.3,
  // `next dev` reescreve nele o bloco `nextjs-agent-rules` a cada boot (e cria
  // CLAUDE.md se faltar); desligar mantém o arquivo só com as regras do repo.
  agentRules: false,
  async headers() {
    return [
      {
        // Content-Security-Policy is set in proxy.ts instead: it needs a
        // per-request nonce that headers() has no access to. Setting it
        // here too would emit two CSP headers, which browsers AND together
        // instead of letting the more specific one win.
        source: "/admin/:path*",
        headers: [
          ...transportSecurityHeaders,
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [...transportSecurityHeaders],
      },
      {
        source: "/p/:path*",
        headers: [...transportSecurityHeaders],
      },
      {
        source: "/:path*",
        headers: [...publishedTransportHeaders],
      },
    ];
  },
  async rewrites() {
    // O arquivo fonte fica em app/; a rota fixa permite servir WebP no mesmo
    // caminho que o metadata/fallback usam, inclusive atrás do Nginx.
    return [{ source: "/icon.webp", destination: "/icon" }];
  },
};

export default nextConfig;
