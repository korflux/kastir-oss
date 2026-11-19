# Testes: armadilhas conhecidas

- Muitos módulos importam `"server-only"` e `@/lib/prisma` (que valida env
  via zod em `lib/env.ts` e lança se `DATABASE_URL`/`REDIS_URL`/etc. não
  existirem). Testes unitários que não precisam de Prisma de verdade mockam
  os dois: `vi.mock("server-only", () => ({}))` e
  `vi.mock("@/lib/prisma", () => ({ prisma: {} }))` antes do import real.
- `vitest.config.ts` (na raiz) prioriza extensões `.ts` sobre `.mjs`/`.js` na
  resolução (`resolve.extensions`). Sem isso, um import sem extensão de um
  arquivo que tem um artefato buildado do lado (ex.:
  `scripts/bootstrap-runtime.ts` + `scripts/bootstrap-runtime.mjs`) resolve
  silenciosamente pro `.mjs` velho em vez do `.ts` fonte.
