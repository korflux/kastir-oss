# Checklist de scan de segurança do repositório

11 partes do código do Kastir a verificar, cobrindo a estrutura real do
repo (ver `AGENTS.md`). Este documento só lista as partes — a execução
(rodar o scan em cada uma, revisar achados, corrigir) acontece em sessão
separada, sob pedido explícito.

1. **`app/admin/` + `proxy.ts` (raiz)** — painel admin (auth + panel) e o
   gate na frente dele: `authorizePanelPath`, CSP por request via nonce.
2. **Rotas de `app/` (`api/`, `uploads/`, `s/`)** — `app/api/` (handlers
   HTTP finos, lógica nos módulos); `app/uploads/[mediaId]/[fileName]`
   (mídia em dev/E2E); `app/s/[slug]` (redirect público de split test).
3. **`app/api/mcp/`, `app/.well-known/` + `lib/Modules/Mcp/`** — servidor
   MCP remoto, metadata OAuth 2.1 (`oauth-authorization-server`,
   `oauth-protected-resource`) e OAuth (`TokenIntrospection.ts`,
   `TokenVerification.ts`, `Consent.ts`, `Tools/`, `Audit.ts`).
4. **`app/p/[slug]`** — preview privado de rascunho (autenticado).
5. **`lib/Modules/<Feature>/`** — cada módulo (Pages, Media, Users,
   Backup…) no padrão `Types/Schema/Service/Api`. RBAC central em
   `lib/Modules/Panel/` (`Permissions.ts` / `Authorization.ts` /
   `Policy.ts`), aplicado nos módulos.
6. **Auth core (`lib/auth.ts`, `lib/auth-rate-limit.ts`,
   `lib/ratelimit.ts`)** — better-auth (sessão cookie, JWT, provider
   OAuth, hash de senha), rate limit de sign-in e janela fixa
   compartilhada.
7. **`lib/Processing/`, `lib/Cdn/`, `lib/Logging/`** — helpers de baixo
   nível compartilhados (processamento de mídia, purge de CDN, log de
   eventos).
8. **`lib/Publishing/`** — compilação, fila, rebuild e artefatos públicos.
9. **`lib/Jobs/`** — jobs periódicos (retenção, notificações).
10. **`lib/SideEffects/`** — efeitos colaterais entre módulos.
11. **Infraestrutura** — `prisma/schema/`, `public-scripts/admin-bar.ts`,
    `scripts/bundle-bootstrap.mjs`, Dockerfile/Nginx, variáveis de
    ambiente do deploy, e `.github/workflows/quality.yml` (gates de merge:
    gitleaks com digest pinado + `pnpm audit --prod --audit-level=high`).
