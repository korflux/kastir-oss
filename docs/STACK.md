# Kastir — Stack Técnica

> Documento de referência técnica do projeto Kastir. Para identidade visual e componentes, ver [`DESIGN.md`](./DESIGN.md). Para o conceito do produto, ver o [`README.md`](../README.md) da raiz.

## Infraestrutura

**Decisão central:** o Kastir **não presume uma infraestrutura fixa**. Ele é distribuído como um **`Dockerfile` único** no repositório — sobe em qualquer host que rode Docker, sem instalador de SO, sem dependência de distro específica. A instalação de referência (documentada, testada) é o **[EasyPanel](https://easypanel.io)** apontando direto pro repositório no GitHub; qualquer outro host Docker (VPS própria, Coolify etc.) funciona do mesmo jeito, porque não há nada hardcoded pro EasyPanel no software.

| Camada | Tecnologia | Observações |
|---|---|---|
| Empacotamento | Docker (`Dockerfile` multi-stage) | Build do Next.js + runtime, distribuído via GitHub. Deploy de referência: EasyPanel (App a partir de repositório GitHub) |
| Web Server (dentro do container) | Nginx | Serve `public/` (HTML compilado + uploads) direto do disco e faz proxy reverso de `/admin/*` e `/api/*` pro processo Node do Next.js — mesmo papel que o LiteSpeed cumpria antes, agora empacotado dentro da própria imagem em vez de depender de uma VPS configurada manualmente |
| Banco de Dados | PostgreSQL 16+ (**externo**) | Não roda dentro do container do Kastir — cada instalação conecta no Postgres que já tem, via `DATABASE_URL`. No EasyPanel isso costuma ser um serviço-irmão no mesmo projeto; em outro host, pode ser qualquer Postgres gerenciado |
| Cache/Filas | Redis (**externo**) | Mesma lógica do Postgres — conectado via `REDIS_URL`, nunca embutido na imagem. Sessões, rate limiting, cache de queries, fila de jobs em background (rebuild em massa de páginas — ver `CUSTOM-CODE.md` — e expiração automática de Lixeira/Notificações) |
| CDN | CloudFlare (**opcional**) | Configurado dentro do painel (`SETTINGS.md` → Cache), não por variável de ambiente — continua puramente opcional: sem CloudFlare, o site funciona normalmente, só não tem purge de CDN |

> Postgres e Redis ficarem de fora da imagem é proposital: como cada instalação tem sua própria infra (não existe um "servidor de produção do Kastir" único), embutir banco/cache no container prenderia dados ao ciclo de vida de um container efêmero — exatamente o tipo de problema que builds/redeploys expõem primeiro.

## Aplicação

| Camada | Tecnologia | Observações |
|---|---|---|
| Linguagem | TypeScript | |
| Package Manager | pnpm | |
| Framework | Next.js (único) | Painel admin dinâmico (App Router/RSC). Páginas publicadas **não** passam por framework — ver pipeline de publicação estática em [`reference/features/PAGES.md`](./reference/features/PAGES.md) |
| ORM | Prisma | |
| Login | Better Auth | Email/senha com sessões persistidas em PostgreSQL |
| Persistência de Auth | `@better-auth/prisma-adapter` + Prisma 7 (`@prisma/adapter-pg`) | O mesmo singleton Prisma atende bootstrap, sessões e rotas Better Auth |
| Validação | Zod | Validação de `.env` e de formulários/inputs |
| Rate Limiting | Upstash Ratelimit + Redis | |

## Variáveis de Ambiente

Toda a configuração de instalação vem de variáveis de ambiente, lidas na subida do container — não existe wizard nem arquivo de config gerado interativamente (ver [`ONBOARDING.md`](./features/ONBOARDING.md)).

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | Sim | Connection string do Postgres externo |
| `REDIS_URL` | Sim | Connection string do Redis externo |
| `NEXTAUTH_SECRET` | Sim | Secret explícita do Better Auth para cookies e sessões |
| `BETTER_AUTH_URL` | Sim | Origin público da aplicação (ex: `http://localhost:3000` ou `https://painel.exemplo.com`) — baseURL do Better Auth para cookies, CSRF e redirects |
| `AUTH_TRUST_PROXY` | Não | `true` somente atrás de reverse proxy que **sobrescreve** `X-Forwarded-For`/`X-Real-IP`; default `false` (rate limit de login **não** confia em headers de IP do cliente) |
| `MASTER_EMAIL` | Sim | E-mail do Administrador Master, usado no bootstrap do primeiro boot (ver `USERS.md`) |
| `MASTER_PASSWORD` | Sim | Senha do Administrador Master, usada no bootstrap do primeiro boot |
| `MASTER_FORCE_RESET` | Não | `true` força o Kastir a resincronizar `MASTER_EMAIL`/`MASTER_PASSWORD` no Master já existente nesse boot — mecanismo de recuperação de senha (ver `USERS.md`) |
| `SITE_TITLE` | Não | Valor inicial do campo Título do Site (`SETTINGS.md`); editável depois pelo painel |
| `PANEL_LANGUAGE` | Não | Idioma da **interface do painel administrativo** (ex: `en`, `pt-BR`) — diferente do Idioma do Site (`SETTINGS.md#5-idioma-do-site`), que é por conteúdo publicado, não da UI. Lida em **todo boot** (não é dado de usuário salvo no banco, é config de deploy, igual `NEXTAUTH_SECRET`) — trocar o valor e reiniciar o container já muda o idioma da UI. Default: `en` se não definida |

**Bootstrap do Master — só no primeiro boot:** ao subir, o container roda as migrations pendentes e verifica se já existe um usuário Master no banco. Se não existir, cria um com `MASTER_EMAIL`/`MASTER_PASSWORD`. Se já existir, essas duas variáveis são **ignoradas** nos boots seguintes — evita que um redeploy comum resete a senha do Master sem querer. Detalhes completos em [`USERS.md`](./features/USERS.md#a-senha-do-master--sempre-via-variável-de-ambiente).

## Frontend

| Camada | Tecnologia | Observações |
|---|---|---|
| CSS | Tailwind CSS | |
| Componentes | shadcn/ui | |
| Tema | next-themes | Alterna claro/escuro, detecta `prefers-color-scheme` do navegador por padrão, persiste a escolha manual do usuário (ícone de toggle — ver `DESIGN.md` e `PANEL.md`) |
| Design System | Ver [`DESIGN.md`](./DESIGN.md) | Tokens, cores, tipografia e componentes |

## Mídia & Uploads

| Item | Definição |
|---|---|
| Armazenamento | Pasta local dentro do container — `public/uploads/<mediaFileId>/<fileName>.<ext>` — **precisa ser um volume Docker persistente** mapeado pelo host (ver "Servidor em Produção" abaixo); sem volume, uploads e páginas publicadas somem a cada redeploy da imagem. O caminho usa o `id` do arquivo, não o nome/posição da pasta: pastas de Mídia (`MediaFolder`) são só organização no banco/UI, igual `PageFolder` já funciona hoje — renomear ou mover uma pasta nunca move arquivo em disco nem muda a URL pública já colada em uma página |
| Tipos aceitos | Imagem raster (jpg/png/webp/gif), SVG, PDF, MP4 — lista branca, ver [`MEDIA.md`](./features/MEDIA.md) |
| Processamento de imagem | `sharp` (libvips) converte para **WebP** — qualidade 82, effort 6 (máximo), `smartSubsample` ativo (conversão RGB→YUV mais lenta e precisa). Roda sempre na **fila assíncrona do Redis** (mesmo worker do rebuild, ver `CUSTOM-CODE.md`), nunca bloqueando a resposta do upload — necessário porque `effort 6` é a configuração mais lenta do WebP. Toggle liga/desliga em [`SETTINGS.md`](./features/SETTINGS.md#13-conversão-de-imagem-webp). Só se aplica à imagem raster; PDF/vídeo/SVG não passam por processamento |

## Serviços Externos

| Serviço | Uso |
|---|---|
| ~~Brevo~~ | **Fora do escopo do MVP.** Convite de usuário virou link com token gerado pelo Administrador (sem e-mail automático) — ver [`reference/features/USERS.md`](./reference/features/USERS.md). Reavaliar entrada do Brevo se um fluxo de e-mail transacional (ex: recuperação de senha) entrar em versão futura |
| GitHub | Versionamento e controle de código-fonte. Também é o canal de distribuição: cada instalação (EasyPanel ou outro host Docker) aponta direto pro repositório e builda o `Dockerfile` a partir dele — atualizar a instalação é atualizar a referência do repositório e redeployar a imagem |

---

## Estrutura de Pastas

### Convenção de Nomenclatura

Inglês. Duas convenções:

| Contexto | Convenção | Exemplo |
|---|---|---|
| Pastas, arquivos e módulos de código | `PascalCase` | `CustomCode/`, `DataTable.tsx`, `Schema.ts` |
| Rotas do App Router (URL) | `kebab-case` | `/admin/custom-code` |

Exceções obrigatórias (fora do nosso controle, não são escolha de estilo):
- Arquivos especiais do Next.js ficam sempre em minúsculo exato — `page.tsx`, `layout.tsx`, `route.ts` — o framework exige esse nome literal.
- Variáveis, funções e campos de model do Prisma ficam em `camelCase` — sintaxe padrão de TypeScript/JavaScript e default nativo do Prisma, não é uma convenção "à parte" que escolhemos. Só o **nome do model** no Prisma é `PascalCase` (`model Page { folderId String }`).

### Repositório (Código-Fonte)

```
app/
  admin/
    (auth)/
      layout.tsx
      login/page.tsx
      invite/[token]/page.tsx
      reset-password/[token]/page.tsx
    (panel)/
      layout.tsx
      page.tsx                         ← Início — /admin (HOME.md)
      pages/
        page.tsx                        ← /admin/pages (PAGES.md)
        [pageId]/page.tsx
      media/page.tsx                    ← /admin/media (MEDIA.md)
      custom-code/
        page.tsx                         ← /admin/custom-code (CUSTOM-CODE.md)
        [snippetId]/page.tsx
      users/page.tsx                    ← /admin/users (USERS.md)
      logs/page.tsx                      ← /admin/logs (LOGS.md)
      settings/page.tsx                   ← /admin/settings (SETTINGS.md)
components/
  ui/                                  ← primitivos shadcn/ui (Button, Input, Dialog, Badge...), tokens de DESIGN.md
  Shared/                              ← componentes Kastir reaproveitados por 2+ módulos (ver seção própria abaixo)
lib/
  Modules/
    Auth/
    Pages/                             ← inclui pastas de página (PageFolder)
    Media/                             ← inclui pastas de mídia (MediaFolder), árvore separada
    CustomCode/
    Users/
    Logs/
    Notifications/
    Settings/
    Home/
    <Modulo>/
      Schema.ts                         ← validação Zod
      Service.ts                         ← regras de negócio (criar, publicar, disparar rebuild/purge...)
      Types.ts
      Components/                        ← componente exclusivo desse módulo (não reaproveitado em outro lugar)
prisma/
  schema/                              ← ver "Schema Prisma" abaixo
```

### Dentro do Container (Runtime — imagem Docker)

```
/app/                     ← build do Next.js (processo Node numa porta interna, ex: 3000)
  .next/
  node_modules/
  prisma/
/etc/nginx/                ← config do Nginx, já embutida na imagem (não editável por env var)
/app/public/                ← volume Docker persistente — sobrevive a redeploys da imagem
  index.html                 ← página inicial, só existe se definida em SETTINGS.md
  <slug>/
    index.html                ← cada página publicada (PAGES.md)
  uploads/
    <mediaFileId>/
      <fileName>.webp          ← mídia (MEDIA.md); path por id, pasta é só organização (STACK.md#pastas--duas-árvores-paralelas)
  favicon.ico                  ← Ícone do Site (SETTINGS.md)
  robots.txt                    ← Indexação/Crawlers de IA (SETTINGS.md)
  sitemap.xml                    ← toda página publicada, regenerado a cada publish/unpublish (SETTINGS.md)
```

Nginx expõe uma única porta do container (a que o host — EasyPanel ou outro — mapeia pro domínio público): `/admin/*` e `/api/*` viram proxy reverso pro processo Node em `localhost:<porta interna>`; todo o resto serve direto de `public/`, 404 nativo quando o arquivo não existe. Postgres e Redis **não moram no container** — são serviços externos, ver "Infraestrutura" acima.

> **Importante para quem instala:** o único diretório que precisa de volume persistente é `public/` (uploads + HTML compilado). O restante do container (`/app`, exceto `public/`) é descartável e recriado a cada deploy da imagem — é justamente o que faz o Docker ser reproduzível.

### Schema Prisma — Modular

```
prisma/schema/
  Auth.prisma           ← User, Session, Account e Verification (Better Auth), InviteToken
  Pages.prisma           ← Page, PageFolder
  Media.prisma            ← MediaFile, MediaFolder (árvore separada de PageFolder)
  CustomCode.prisma        ← Snippet
  Logs.prisma               ← LogEntry
  Notifications.prisma       ← Notification
  Settings.prisma             ← SiteSettings (seed no bootstrap — ver seção própria abaixo)
```

Um arquivo por módulo, mesmo recorte de `lib/Modules/` e de `docs/reference/features/*.md`. Ativar `previewFeatures = ["prismaSchemaFolder"]` no `generator client` (checar se já é estável na versão do Prisma em uso).

## Escala — Como Adicionar uma Nova Feature

Toda feature nova (ex: **Formulários**, planejado para depois do MVP) segue o mesmo molde das atuais:

1. `prisma/schema/<Feature>.prisma` — models novos.
2. `lib/Modules/<Feature>/` — `Schema.ts`, `Service.ts`, `Types.ts`, `Components/`.
3. `app/admin/(panel)/<feature-em-kebab-case>/` — rotas do painel.
4. Item novo no menu lateral (`PANEL.md`), coluna nova na matriz de permissões (`USERS.md`), categoria nova em `LOGS.md` se gerar eventos.
5. `docs/reference/features/<FEATURE>.md` com a spec viva da feature.

Exemplo — Formulários encaixaria como `prisma/schema/Forms.prisma` (Form, FormField, FormSubmission), `lib/Modules/Forms/`, rota `/admin/forms`.

## Componentes Visuais — Reaproveitamento

- **`components/ui/`** — primitivos shadcn/ui puros (Button, Input, Dialog, Badge, Select...), consomem os tokens de `DESIGN.md` direto. Nunca editados à mão fora do fluxo do shadcn CLI.
- **`components/Shared/`** — composto Kastir, usado por **2 ou mais módulos**. Exemplos já previsíveis pelas telas descritas nos docs:
  - `DataTable` — listagens de Páginas, Mídia, Usuários, Logs, Scripts.
  - `ConfirmDialog` — exclusão de Página, Mídia, Pasta, Usuário.
  - `StatusToggle` — Rascunho/Publicado (Páginas e Scripts).
  - `ColorPicker` — cor de pasta (PageFolder e MediaFolder).
  - `SlugField` — campo de slug com geração automática (Páginas).
  - `EmptyState` — Início, listagens vazias.
- **`lib/Modules/<Feature>/Components/`** — componente usado só dentro daquele módulo (ex: o editor de código HTML/CSS/JS só existe em Páginas).

Regra única: **2+ módulos usam → `components/Shared/`. 1 módulo usa → fica local no próprio módulo.** Tudo consome os tokens de `DESIGN.md` (claro/escuro) — nenhum componente hardcoda cor, raio ou espaçamento.

## Cache

- Página publicada já nasce estática (`PAGES.md`) — sem plugin de cache, sem geração dinâmica por requisição pra cachear.
- **Sem cache local a purgar:** o Nginx dentro do container serve o arquivo direto do disco a cada request — assim que o rebuild regrava o `.html`, essa já é a versão servida, sem camada de cache própria no meio (diferente de um setup com LiteSpeed/LSCache, que precisava de purge explícito). Isso simplifica o pipeline: só existe **uma** camada de cache real a se preocupar, que é o CDN opcional.
- **CloudFlare (opcional):** purge automático via API "Purge by URL" — exige **API Token** e **Zone ID**, configurados em `SETTINGS.md` → Cache (CloudFlare). Sem essas credenciais preenchidas, o purge simplesmente não dispara; como não há cache local, o site continua servindo a versão certa de qualquer forma — só o CDN (se configurado) fica com uma cópia velha até expirar/ser purgado.
- O worker do rebuild (fila Redis, `CUSTOM-CODE.md`) dispara o purge do CloudFlare (quando configurado) logo após regravar cada `.html`.
- Eventos que disparam purge: publicar/despublicar/lixeira/restaurar página (inclui regeneração do `sitemap.xml`); publicar/despublicar snippet; trocar Ícone do Site/Página Inicial/Indexável pelo Google/Permitir Crawlers de IA em Configurações; substituir arquivo na Biblioteca de Mídia.
- `Cache-Control` de TTL longo nos arquivos estáticos — seguro porque a invalidação é sempre ativa (por evento) no CDN, nunca por expiração passiva; localmente nem se aplica, já que não há cache a expirar.

## Decisões Fechadas

- ✅ Nomenclatura: `PascalCase` em pastas/arquivos/módulos de código, `kebab-case` em rotas/URLs. `camelCase` continua só onde a linguagem/Prisma exigem (variáveis, funções, campos de model).
- ✅ App Router: dois route groups sob `/admin` — `(auth)` sem shell do painel, `(panel)` com shell e sessão obrigatória.
- ✅ Arquivos `.html` compilados em `public/<slug>/index.html`; uploads em `public/uploads/<mediaFileId>/`; ambos fora do processo Node, dentro do volume persistente `public/`.
- ✅ Schema Prisma modular, um arquivo por módulo em `prisma/schema/`.
- ✅ Toda feature nova segue o mesmo molde de 5 passos (seção "Escala" acima).
- ✅ Componentes: `components/ui` (shadcn puro) → `components/Shared` (2+ módulos) → `lib/Modules/<Feature>/Components` (1 módulo só).
- ✅ Distribuição: `Dockerfile` único no repositório, sem instalador de SO. Instalação de referência: EasyPanel via GitHub. Infraestrutura não é fixa — qualquer host Docker funciona.
- ✅ Postgres e Redis são serviços **externos** (via `DATABASE_URL`/`REDIS_URL`), nunca embutidos na imagem.
- ✅ Nginx embutido no container assume o papel que o LiteSpeed cumpria: serve `public/` direto, proxy reverso de `/admin`/`/api` pro Next.js.
- ✅ Cache: sem camada local (Nginx serve direto do disco). CloudFlare continua opcional, purga via API Token + Zone ID configurados em `SETTINGS.md`.
- ✅ Configuração de instalação via variáveis de ambiente (`DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_TRUST_PROXY`, `MASTER_EMAIL`, `MASTER_PASSWORD`, `MASTER_FORCE_RESET`, `SITE_TITLE`, `PANEL_LANGUAGE`) — sem wizard interativo.
- ✅ Idioma do painel administrativo é resolvido por variável de ambiente (`PANEL_LANGUAGE`), lida a cada boot — não é um campo dentro de Configurações nem um dado salvo no banco, é config de deploy.
- ✅ Multi-processo no container: entrypoint shell simples (Nginx + Node), sem supervisor dedicado no MVP.
- ✅ `SiteSettings` semeado no bootstrap junto do Master (`SITE_TITLE` só no primeiro seed).
- ✅ Pastas de Páginas e de Mídia: mesmas regras de UX, árvores de dados separadas.

## Tooling e Decisões de Implementação

Decisões fechadas nas specs de fase e espelhadas aqui para quem lê só `docs/`. Detalhes por fase continuam em [`spec/`](../spec/).

| Área | Escolha | Onde se aplica |
|---|---|---|
| Runtime | **Node.js 22 LTS** (`engines.node` no `package.json`) | Todo o projeto |
| Lint / Format | **ESLint + Prettier** | Todo o repositório |
| Testes unit/integration | **Vitest** | `lib/`, utilitários, serviços |
| Testes e2e | **Playwright** | Fluxos críticos de UI |
| Hash de senha | **argon2id** | Auth (bootstrap Master, convite, reset) |
| Sessão Better Auth | **Database session** (tabela `Session`, revogável) | Logout/remoção de usuário efetivos na hora |
| Fila de jobs | **BullMQ** sobre Redis | Rebuild em massa, WebP, expiração Lixeira/Notificações |
| Editor de código (HTML blob) | **CodeMirror 6** | Páginas e Scripts no painel |
| Validação magic bytes | **`file-type`** | Upload de mídia |
| Sanitização SVG | **DOMPurify** (`isomorphic-dompurify`) | Upload SVG |
| Validação HTML de snippet | **`htmlparser2`** + contagem de tags | Publicar Script |
| `robots.txt` / `sitemap.xml` | Arquivos estáticos gravados em `public/` (não rotas dinâmicas do Next) | Publish/settings |
| Token CloudFlare em repouso | AES-256-GCM com chave derivada de `NEXTAUTH_SECRET` | Settings → Cache |
| Multi-processo no container | **Entrypoint shell simples** (`nginx & exec node …`), sem `s6-overlay`/`supervisord` no MVP | Dockerfile / Fase 14 |

## Bootstrap de `SiteSettings`

No mesmo boot que cria o Master (primeiro boot ou entrypoint Docker), se ainda não existir a linha singleton de `SiteSettings`, o Kastir a cria com `siteTitle` = valor de `SITE_TITLE` (ou string vazia se a env não estiver definida). As demais defaults seguem [`SETTINGS.md`](./features/SETTINGS.md). Boots seguintes **não** sobrescrevem o título já salvo no banco a partir da env — só o primeiro seed.

## Pastas — duas árvores paralelas

Páginas e Mídia usam o **mesmo desenho de UX** (Base obrigatória, até 3 níveis, 6 cores + hex livre), mas **dados separados**: pastas de páginas e pastas de mídia não compartilham o mesmo grafo no banco (ex.: `PageFolder` / `MediaFolder`, ou `Folder` com discriminador de domínio). Excluir pasta de páginas não mexe em mídia, e vice-versa.

## Perguntas em Aberto

*(nenhuma pendência no momento — multi-processo no container fechado a favor de entrypoint shell simples; revisitar `s6-overlay` só se instabilidade de restart aparecer em produção)*
