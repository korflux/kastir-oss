# Regras do projeto

Mapa para contribuidores e agentes de IA que trabalham no código do Kastir.

## Projeto

Kastir é um micro-CMS ultra-leve para páginas geradas por IA: cola HTML, organiza e publica arquivos estáticos, sem framework no caminho do visitante. Uma instalação = um site, multi-user (Master / Admin / Editor).

Mapa canônico do repo. Leia no início da sessão. **Se uma estrutura, módulo ou convenção mudar, atualize este arquivo no mesmo change.**

## Núcleo do projeto

- `proxy.ts`: gate de `/admin` (sessão, papel por rota, redirect para login ou forbidden) e CSP com nonce por requisição; ler antes de mexer em login, acesso a rota do painel, CSP ou headers do admin.
- `lib/Modules/Panel/Permissions.ts`: menu do painel e mapa de papéis MASTER/ADMIN/EDITOR; ler antes de incluir item de menu, tela ou papel.
- `lib/Modules/Panel/Policy.ts`: decisão `allow | login | forbidden` por caminho e `canBulkMutate`; ler antes de mudar acesso a rota ou ação em massa.
- `lib/Modules/Panel/MutationSecurity.ts`: autenticação, papel e limite de corpo das mutações do painel; ler antes de criar ou alterar rota em `app/api/admin/`.
- `lib/Modules/Mcp/Tools/`: superfície das tools MCP, um arquivo por domínio, registradas por `ToolRegistry.ts`; ler antes de criar, renomear ou alterar tool MCP.
- `lib/Modules/Mcp/Policy.ts`: allowlist de escopos MCP por papel (EDITOR sem `cms:settings:write` e `cms:logs:read`), escopos concedidos no consent OAuth e os guards `requireMcpScope` e `requireMcpAdministrator` que as tools chamam; ler antes de criar tool MCP, mudar o escopo que uma tool exige ou o acesso de um papel ao MCP.
- `lib/Modules/Mcp/Instructions.ts`: texto `initialize` enviado ao agente, com orçamento de 3000 bytes testado; ler antes de mudar conceitos do produto ou settings expostos ao agente.
- `lib/Modules/Mcp/Guide.ts`: manual `kastir_guide_get`, com tópicos em inglês; ler antes de mudar regra de uso, fluxo ou vocabulário do produto.
- `docs/reference/mcp-cms-catalogo.md`: catálogo das tools MCP e denylist de exclusão permanente; ler junto com qualquer tool MCP criada ou alterada.
- `docs/reference/features/`: spec viva por módulo; ler a feature da área antes de mudar comportamento.
- `lib/Publishing/`: compilação, fila, rebuild e reconcile dos artefatos públicos; ler antes de mudar publicação, rascunho ou publicado.
- `prisma/schema/`: schema Prisma por domínio; ler antes de qualquer alteração de modelo, que exige parada e aprovação.
- `lib/i18n/panel.ts`: dicionário do painel com blocos `en` e `pt-BR`; ler antes de alterar texto de UI.

## Ambiente

- Desenvolvimento e testes usam PostgreSQL 16+ e Redis 7+ em loopback, nativos ou via `docker compose up -d` (serviços de `docker-compose.yml`).
- Bancos separados para dev e teste (`kastir_dev`, `kastir_test`), configurados por `DATABASE_URL` e `TEST_DATABASE_URL` no `.env`.

## Produção / migrations

Migration em produção é irreversível no sentido prático. Não gerar, não aplicar, não “aproveitar o gancho”. Se a tarefa exigir schema, parar e perguntar.

## Versão (semver)

- **Major:** quebra contrato (API, schema, comportamento que caller já usa). Gatilho no bump: `!:` no tipo do título (`feat!:`, `fix!:`) ou linha do corpo começando por `BREAKING CHANGE:`/`BREAKING-CHANGE:`.
- **Minor:** adiciona sem quebrar. Gatilho no bump: título `feat:`/`feat(scope):` ou linha do corpo começando por `feat:`/`feat(scope):`.
- **Patch:** correção sem mudança de contrato. Gatilho no bump: qualquer outro caso.
- SemVer puro em `package.json#version`, sem zero-padding (`1.0.9` → `1.0.10`). O bump lê título e corpo dos commits ainda não enviados; commit de fase `task(...)` leva a linha `feat:`/`fix:` no corpo.
- **Nunca editar `package.json#version` à mão** — o bump é automático.
- Produção: migration só com plano de rollback; não rodar migration destrutiva sem o humano pedir.
- Setup único por clone: `git config core.hooksPath .githooks`.
- Checagem: `sh scripts/test-pre-push-hook.sh`.
- **Use `pnpm push`** (`node scripts/git-push.mjs`): bumpa antes do transfer, depois `git push` — exit code limpo.
- `git push` cru funciona, mas o `.githooks/pre-push` bumpa, empurra o HEAD novo e cancela o transfer original — o git imprime um `failed to push some refs` **inofensivo**; o sucesso é a linha `[pre-push] bumped version to X.Y.Z and pushed it`. O hook recusa push de múltiplas branches numa chamada e evita bump duplicado.

## Git

- `main` é o branch estável. Mudanças entram por pull request com o workflow `Quality` verde.
- Commits no padrão Conventional Commits (`feat:`, `fix:`, `docs:`…); o tipo alimenta o bump automático de versão.
- Nunca reescrever histórico publicado (force push, rebase de branch compartilhado).

## CI

Autorizado: sim
Decidido em: 2026-11-03
Observação: `.github/workflows/quality.yml` roda lint, testes, build, format, audit e gitleaks em push e PR para `main` e `homolog`; os gates de segurança bloqueiam a integração.

## Padrões de Código e Engenharia

- **Comentários Semânticos Obrigatórios:** Toda função, componente ou módulo deve ter comentário explicando o que faz, para que serve e a justificativa de decisões não óbvias. Zero funções órfãs.
- **Desenvolvimento Eficiente (YAGNI):** O melhor código é o mínimo necessário. Antes de escrever código novo, reutilizar o que já existe no projeto, na standard library ou recursos nativos da plataforma. Não criar abstrações para necessidades especulativas futuras.
- **Causa Raiz:** Correção de bugs deve atuar na causa raiz e não no sintoma. Se o problema estiver em função compartilhada, corrigir no ponto de origem.
- **Limitações Conhecidas:** Registrar limitações de soluções simplificadas com `ponytail: <limitação>, <quando será necessário melhorar>`.
- **Erros Fora do Escopo:** Erro encontrado fora do recorte da tarefa não é corrigido no mesmo change nem ignorado em silêncio: vira issue no GitHub (ou nota local em `.erros-encontrados/`, pasta fora do git) e é citado no fechamento da entrega.
- **Comunicação:** Ao explicar código, priorizar o que está acontecendo, o porquê e o impacto arquitetural, sem exigir domínio de sintaxe da linguagem.

## Segurança por Padrão

- **Entradas Não Confiáveis:** Toda informação recebida de fora (request, query, headers, forms) deve ser validada na borda com allowlist e limite de tamanho. SQL sempre parametrizado.
- **Credenciais e Segredos:** Chaves, tokens e segredos nunca ficam no código ou repositório. Usar variáveis de ambiente; o `.env` do repo segue a regra inviolável 1.
- **Autorização no Servidor:** Toda ação sensível deve validar permissões no servidor (proteção anti-IDOR).
- **Tratamento de Erros na Borda:** Respostas externas (APIs, webhooks, CLIs, MCP) devem retornar envelope padronizado com código estável em maiúsculas (`code`), mensagem segura (`message`) e status HTTP/CLI. Não expor stack traces, queries ou dados internos do banco.
- **Erros no Núcleo Interno:** Lógica interna e serviços (`Service.ts`) devem lançar exceções de domínio tipadas. A conversão para o código público de erro é responsabilidade da borda (`Api.ts` do módulo / route handler), não do serviço.

## Estrutura

### Código

| Caminho                                       | Responsabilidade                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `app/admin/`                                  | Painel admin (auth + panel)                                                 |
| `app/api/`                                    | Route handlers HTTP — finos; lógica em `lib/Modules/*/Service.ts`           |
| `app/api/mcp/`, `app/.well-known/`            | Endpoint MCP remoto + metadata OAuth 2.1                                    |
| `app/p/[slug]`                                | Preview privado de rascunho (autenticado)                                   |
| `lib/Modules/<Feature>/`                      | Lógica + UI de cada módulo (Pages, Media, Users, Backup…)                   |
| `lib/Modules/Revisions/`                      | Snapshots, ponteiro publicado e política de histórico (Pages + Custom Code) |
| `lib/Modules/Mcp/`                            | Servidor MCP — exceção ao padrão dos módulos (ver Arquitetura)              |
| `lib/Publishing/`                             | Compilação, fila, rebuild, artefatos públicos                               |
| `lib/Jobs/`                                   | Jobs periódicos (retenção, notificações)                                    |
| `lib/SideEffects/`                            | Efeitos colaterais entre módulos                                            |
| `lib/Processing/`, `lib/Cdn/`, `lib/Logging/` | Helpers de baixo nível (mídia, purge de CDN, log)                           |
| `lib/i18n/panel.ts`                           | `PanelDictionary` — blocos `en`/`pt-BR` sempre atualizados juntos           |
| `components/Shared/`                          | Shell do painel                                                             |
| `components/ui/`                              | Primitivos shadcn — sem lógica de domínio                                   |
| `prisma/schema/`                              | Schema Prisma por domínio                                                   |
| `public-scripts/admin-bar.ts`                 | Fonte da barra no site publicado                                            |
| `scripts/bundle-bootstrap.mjs`                | Gera `bootstrap-runtime.mjs` no builder do Docker                           |

`lib/Modules/X` ↔ `docs/reference/features/X.md` quando o doc existe, com o nome do módulo em maiúsculas (`CustomCode` usa `CUSTOM-CODE.md`). `Auth`, `Backup`, `Mcp`, `Shared` e `SplitTests` não têm doc de feature; o MCP é descrito em `docs/reference/mcp-cms-catalogo.md`.

### Documentação

| Pasta                      | Uso                                                   |
| -------------------------- | ----------------------------------------------------- |
| `docs/reference/features/` | Spec viva por módulo (Pages, Media, Users…)           |
| `docs/reference/`          | Referência entre módulos (MCP, schema do banco, scan) |
| `docs/STACK.md`            | Stack técnica e convenções                            |
| `docs/DESIGN.md`           | Design system do painel                               |
| `docs/DEPLOY.md`           | Deploy self-host com Docker                           |

- Pasta nova ou renomeada entra também em `docs/README.md`, no mesmo change.

## Decisões vigentes

| ID       | Decisão vigente                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DADOS-01 | O save de páginas e scripts (painel, update e patch MCP) trava a linha com `SELECT ... FOR UPDATE` na transação antes de ler, confere a versão e grava; com `expectedContentSha256` só o hash do conteúdo (SHA-256 dos bytes UTF-8, comparado em minúsculas) é conferido e `expectedUpdatedAt` é ignorado; sem ele vale `expectedUpdatedAt`; o patch exige o hash. |

## Regras deste repo

### Regras invioláveis

1. **Segredos / `.env` de teste**: `.env` é **sempre** o stack local de dev/teste — **não** é produção nem host de cliente. Postgres e Redis em **loopback** (`localhost` / `127.0.0.1`), como os serviços nativos descritos em `## Ambiente`, sem Docker nos testes. `prisma migrate dev`, `pnpm dev` e a sessão Chrome DevTools usam esse `.env` sem medo. Nunca commitar o arquivo, logar URL/credencial/token, nem apontar `.env` pra host de cliente/produção. `.mcp.json` e `.mcp-metadata.json` são config local do cliente MCP do agente (máquina); ficam no disco, gitignored, nunca no commit.
2. **Erro fora do escopo nunca é ignorado em silêncio**: segue o item "Erros Fora do Escopo" de Padrões de Código e Engenharia.
3. **MCP nunca expõe exclusão permanente** de páginas, scripts, split tests, pastas ou mídias. Páginas/scripts/split tests: só soft delete reversível. Mídias: upload e replace sim; `delete` e `bulk delete` ficam fora.
4. **Nunca apontar Vitest, scripts ou Chrome DevTools** para Postgres/Redis que não seja loopback pra fazer teste passar.
5. **Arquivo do `.gitignore` que aparecer no worktree se apaga** — não se reorganiza pra dentro de `docs/`: `coverage/`, `test-results/`, `.next/`, `out/`, `build/`, `*.tsbuildinfo`, `node_modules/`, `.env`, `public/uploads/`, `.media-staging/`, `public/_kastir/*.js`, `app/generated/prisma/`, `desktop.ini`, `*.log`.
6. **MCP acompanha o produto inteiro**: o MCP capaz de fazer tudo é o principal diferencial do Kastir. Toda mudança de funcionalidade, regra, fluxo ou vocabulário no painel ou nos serviços deve atualizar no mesmo change o que o MCP expõe (tools em `lib/Modules/Mcp/Tools/`, `Instructions.ts`, `Guide.ts`, `docs/reference/mcp-cms-catalogo.md` e testes MCP), para que um agente consiga fazer pelo MCP o que o painel faz, com o mesmo vocabulário. Feature sem cobertura MCP só entra com justificativa registrada na spec. Limite: regra inviolável 3.

### Arquitetura — o que não é óbvio

**Stack:** Next.js 16 App Router + Prisma 7/PostgreSQL + Redis (BullMQ + rate limit) + better-auth. Deploy: imagem Docker única (Next standalone + Nginx + entrypoint).

- **Módulos**: `Types.ts` + `Schema.ts` (zod) + `Service.ts` + `Api.ts` + `Components/`. Papéis `MASTER`/`ADMIN`/`EDITOR` em `Panel/Permissions.ts` + `Authorization.ts` + `Policy.ts` — Editor é bloqueado **no server**, não só na UI.
- **Sem `middleware.ts`; o `proxy.ts` (Next 16) cobre só `/admin`**: com matcher `/admin/:path*`, faz o gate de sessão e papel por rota (via `Panel/Policy.ts`, redirect para login ou forbidden) e aplica a CSP com nonce por requisição. A separação `/admin` ÷ `/api` ÷ público no deploy é do `nginx.conf`. `app/s/**` (redirects de Split Test) é sempre dinâmico; `app/[...slug]/route.ts` existe só pra paridade em `pnpm dev` — em produção o Nginx serve o HTML do disco.
- **Publicação**: HTML estático em disco (`public/<slug>/index.html`), não SSR. `reconcile.ts` roda no boot e reconstrói páginas `PUBLISHED` sem HTML no disco (hosts que resetam volume).
- **Mídia**: arquivos em `public/uploads/{mediaId}/...`. `READY` no banco **não garante** que o arquivo existe — `MediaService.reconcilePublicReadiness` corrige órfãos.
- **Backup**: restore/import é replace total numa transação que **apaga a tabela `Session` inteira**, inclusive a sessão de quem disparou. Um 401 no polling logo depois costuma significar sucesso, não falha.
- **Jobs vs. fila**: `lib/Jobs/` = manutenção agendada; `lib/Publishing/queue.ts` = fila de publicação; `lib/SideEffects/` = reação entre módulos (evita import circular com o `Service.ts` dono).
- **MCP** (exceção ao padrão de módulo): OAuth 2.1 próprio (`TokenIntrospection.ts`, `TokenVerification.ts`, `Consent.ts`), tools em `Tools/` (`ToolRegistry.ts` + um arquivo por domínio: Pages, Media, Logs, SplitTests, Settings, Scripts, Site; mais `Shared.ts`, com guards de escopo e helpers comuns, e `publicSiteSettings.ts`, com a allowlist de settings não sensíveis expostos pelo MCP), manual sob demanda em `Guide.ts` (servido pelo MCP; o painel não exibe), audit em `Audit.ts`. Contrato de exclusão: regra inviolável 3 (MCP nunca expõe exclusão permanente).

### Comandos

Scripts padrão (`dev`, `build`, `lint`, `test`, `prisma migrate dev`) em `package.json`. Alvo específico:

```bash
pnpm vitest run tests/media-public-url.test.ts -t "reconcilePublicReadiness"
```

Integração em `tests/integration/` (Postgres local, fixtures próprios): o helper `tests/integration/helpers/db.ts` só abre a suíte quando o `DATABASE_URL` do processo é igual ao `TEST_DATABASE_URL` do `.env`, com host loopback e banco terminado em `_test` (`kastir_test`); em qualquer outro caso ela é pulada sem abrir conexão, e é assim que `pnpm test` e o CI seguem verdes (eles coletam `tests/**/*.test.ts`). Os serviços e as tools gravam pelo `lib/prisma`, que usa o `DATABASE_URL`, por isso o processo precisa apontar para o banco de teste. Pré-requisitos: Postgres nativo ativo, `pnpm prisma generate` e migrations aplicadas em `kastir_test`. Os comandos copiam a URL do `.env` para o processo sem imprimi-la:

```powershell
$env:DATABASE_URL = node -p "require('dotenv').parse(require('fs').readFileSync('.env')).TEST_DATABASE_URL"
pnpm exec prisma migrate deploy
pnpm vitest run tests/integration
```

```bash
export DATABASE_URL="$(node -p "require('dotenv').parse(require('fs').readFileSync('.env')).TEST_DATABASE_URL")"
```

Arquivo novo de integração: importe `describeIntegration` e `openIntegrationDatabase` do helper (o client Prisma entra por import dinâmico lá dentro, nunca no topo do teste) e crie os dados pelos fixtures do helper (ids únicos, apagados só os próprios em `close()`), porque os arquivos rodam em paralelo no mesmo banco.

Unit/integration = Vitest. **UI no browser = Chrome DevTools MCP**, não Playwright.

### Verificação no browser (Chrome DevTools)

MCP `chrome-devtools` (`.mcp.json`, `--isolated`). App em `pnpm dev` + Postgres/Redis em **loopback** (regras de `.env` e de teste). Sem spec Playwright.

Protocolo da fatia user-visible:

1. Abrir/navegar a rota no Chrome isolado (`new_page` / `navigate_page`).
2. `take_snapshot` — comportamento (role, label, URL, estado). Interagir (`click`, `fill` / `fill_form`, `wait_for`) como o usuário.
3. `take_screenshot` do alvo (página | dialog | popup | trecho).
4. IA lê a imagem. Falha visual = fatia incompleta.
5. Layout/estilo: desktop e mobile (`resize_page`). Rotas que compartilham o estado tocado também.
6. `list_console_messages`: zero erro/warning novo.

Mapa de o quê verificar (não “printar tudo”):

- Telas canônicas do painel, auth, popups do shell, menu mobile, diálogos de criação, etapas do tour.
- **Estados nomeados** das listagens CMS: empty, rows, bulk, trash, quick-edit, confirms, folder-context, mobile — por módulo se a peça existir; tema claro e escuro quando a fatia toca tema.
- **Disciplina:** só o estado que a mudança exige (ex.: `bulk-selected` prova bulk; `empty` **não**). Sem PNG por item real do banco.

- Guard: o `.env` canônico **já deve** ser localhost — se o processo herdar URL remota, sobrescreva **só as variáveis do processo** para loopback.
- Stack local: os serviços de `## Ambiente`; confirme que estão ativos antes de testar. Depois: `pnpm exec prisma migrate deploy` e boot do app (Master via instrumentation). URLs canônicas no `.env` = loopback.

### Eixos de ações no CMS (lei E/D)

Layout global das listagens e da barra de seleção em massa:

| Lado         | Papel                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Esquerda** | Não-destrutivo: editar, alterar, duplicar, quick-edit (raio), mover, restaurar, status, abrir/preview, copiar URL… |
| **Direita**  | **Só** destrutivo: lixeira / exclusão permanente / equivalentes                                                    |

- **Linha (referência Pages):** no cluster esquerdo a ordem desejada é `duplicar → editar (lápis) → quick-edit (raio)` (peças ausentes em outros módulos são omitidas, não inventadas). Lixeira sozinha à direita.
- **Bulk (`BulkActionBar`):** slots explícitos `actions` (E) e `destructiveActions` (D) — não misturar lixeira no mesmo grupo do mover.
- Users e telas fora do padrão de lista/bulk **não** entram no mapa de estados só por completude; a lei ainda vale se a tela ganhar o mesmo padrão.
