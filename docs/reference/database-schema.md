# Inventário do banco de dados (pré-otimização)

> Documento de referência, **não** é o plan/todo da fase. Gerado a partir de
> `prisma/schema/*.prisma` + `prisma/migrations/**` em 2026-07-21, logo após o
> merge da fase 17 (Split Tests). Objetivo: base de leitura para uma futura
> rodada de otimização de banco (índices, tipos, volume, purge). Nenhuma
> mudança de schema foi feita neste documento.
>
> **Atualizado em 2026-07-21** após `/code-review` cruzar as afirmações deste
> doc com o código real (`lib/Jobs/*`, `lib/Publishing/queue.ts`,
> `lib/Modules/Notifications/*`, `app/s/[slug]/route.ts`). Duas afirmações
> estavam erradas e foram corrigidas: retenção de `Notification` e
> priorização de risco entre `LogEntry`/`SplitRedirectEvent`. Ver seção
> "Correções da review" no final.

- **Provider:** PostgreSQL (`prisma/schema.prisma`)
- **Client:** `prisma-client` → gerado em `app/generated/prisma`
- **Migrations aplicadas:** 9 (`20260716101500` → `20260721024619`)

## Sumário das tabelas

| Tabela | Domínio (arquivo) | Linhas crescem com | Observação rápida |
| --- | --- | --- | --- |
| `User` | Auth.prisma | usuários criados | baixo volume |
| `Session` | Auth.prisma | login | 1 por sessão ativa, TTL curto |
| `Account` | Auth.prisma | login/credenciais | baixo volume |
| `Verification` | Auth.prisma | fluxos de verificação/reset | efêmera |
| `InviteToken` | Auth.prisma | convites emitidos | baixo volume |
| `PageFolder` | Pages.prisma | pastas criadas | baixo volume, árvore |
| `Page` | Pages.prisma | páginas criadas | soft delete (`deletedAt`) |
| `MediaFolder` | Media.prisma | pastas criadas | baixo volume, árvore |
| `MediaFile` | Media.prisma | uploads | cresce com uso; sem soft delete |
| `Snippet` | CustomCode.prisma | scripts custom code | baixo volume |
| `SnippetPageScope` | CustomCode.prisma | escopos por página | tabela de junção pura (PK composta) |
| `Notification` | Notifications.prisma | eventos do sistema | purge diário só para **lidas** (30d); não-lidas não expiram (hoje dormente — `notify()` só é chamado em testes/e2e) |
| `SiteSettings` | Settings.prisma | — | singleton (1 linha, `id="singleton"`) |
| `LogEntry` | Logs.prisma | ação admin autenticada | append-only, sem purge — **bounded** por atividade humana no painel |
| `SplitCampaign` | SplitTests.prisma | campanhas criadas | baixo volume |
| `SplitDestination` | SplitTests.prisma | destinos por campanha | baixo volume |
| `SplitRedirectEvent` | SplitTests.prisma | **todo `GET /s/{slug}` público** | ⚠️ **maior risco real da base** — sem auth, sem rate limit, 2 escritas/hit (insert + update em `SplitDestination.hitCount`); crescimento não depende de ação humana |

---

## Auth.prisma

### `User`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| name | String | |
| email | String | `@unique` |
| emailVerified | Boolean | default false |
| image | String? | |
| role | Role (enum: ADMIN, EDITOR) | default ADMIN |
| isMaster | Boolean | default false |
| createdAt | DateTime | default now() |
| updatedAt | DateTime | @updatedAt |

Relações: `accounts[]`, `sessions[]`, `pages[]`, `splitCampaigns[]`.
**Sem índice em `role`** (usado em checagens de permissão/autorização).

### `Session`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| token | String | `@unique` |
| userId | String | FK → User, `onDelete: Cascade` |
| expiresAt | DateTime | |
| ipAddress | String? | |
| userAgent | String? | |
| createdAt / updatedAt | DateTime | default now() / @updatedAt |

Índices: `@@index([userId])`. **Sem índice em `expiresAt`** — se houver job de
limpeza de sessões expiradas, faria full scan.

### `Account`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| issuer | String | Emissor local ou OAuth da identidade. |
| accountId | String | Identificador da conta no emissor. |
| providerId | String | |
| userId | String | FK → User, cascade |
| password / accessToken / refreshToken / idToken | String? `@db.Text` | |
| accessTokenExpiresAt / refreshTokenExpiresAt | DateTime? | |
| scope | String? | |
| createdAt / updatedAt | DateTime | |

Índices: `@@unique([issuer, accountId])`, `@@index([userId])`.

### `Verification`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| identifier | String | |
| value | String `@db.Text` | |
| expiresAt | DateTime | |
| createdAt / updatedAt | DateTime | |

Índices: `@@index([identifier])`. **Sem TTL/purge** — linhas expiradas
acumulam indefinidamente (tabela tende a ser pequena, mas sem garantia).

### `InviteToken`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK, default cuid() |
| token | String | `@unique` |
| type | TokenType (INVITE, PASSWORD_RESET) | default INVITE |
| role | Role? | |
| name | String? | |
| targetUserId | String? | sem FK declarada |
| createdById | String | sem FK declarada |
| expiresAt | DateTime | |
| usedAt | DateTime? | |
| createdAt | DateTime | |

**Sem índices além da PK/unique.** `targetUserId`/`createdById` não têm FK
nem índice — qualquer lookup por criador faz full scan.

---

## Pages.prisma

### `PageFolder`
Árvore auto-referenciada (`parentId` → `PageFolder`, `onDelete: Restrict`).
Índices: `@@index([parentId])`, `@@index([isBase])`.

### `Page`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| title | String | |
| slug | String | `@unique` |
| content | String `@db.Text` | |
| seoTitle / seoDescription / seoKeyword | String? | |
| status | PageStatus (DRAFT, PUBLISHED) | default DRAFT |
| folderId | String | FK → PageFolder, Restrict |
| authorId | String | FK → User, Restrict |
| publishedAt | DateTime? | |
| deletedAt | DateTime? | soft delete |
| createdAt / updatedAt | DateTime | |

Relações: `snippetScopes[]` (via `SnippetPageScope`).
Índices: `folderId`, `authorId`, `deletedAt`, `status`.
**Sem índice composto `[status, deletedAt]`** — listagens do painel
provavelmente filtram por ambos ao mesmo tempo (páginas publicadas e não
deletadas).
**Correção (review 2026-07-21):** já existe purge de páginas na lixeira
(`lib/Jobs/expireTrashedPages.ts`, cron diário, `PAGE_TRASH_RETENTION_MS` =
30 dias, batch de 50/execução via `PAGE_TRASH_EXPIRE_BATCH_SIZE` em
`lib/Modules/Pages/Retention.ts`). `Page` **não** entra na lista de tabelas
sem mitigação — diferente de `LogEntry` e `SplitRedirectEvent`.

---

## Media.prisma

### `MediaFolder`
Árvore igual a `PageFolder`. Índices: `parentId`, `isBase`.

### `MediaFile`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| name / fileName | String | |
| url | String | `@unique` |
| mimeType | String | |
| category | MediaCategory (enum) | |
| sizeBytes | Int | |
| alt / description | String? | |
| folderId | String | FK → MediaFolder, Restrict |
| processingStatus | MediaProcessingStatus (PROCESSING, READY, FAILED) | default READY |
| processingToken | String? | |
| createdAt / updatedAt | DateTime | |

Índices: `folderId`, `category`, `processingStatus`.
**Sem soft delete e sem índice em `createdAt`** — se a listagem ordena por
data de upload, ordena sem índice de suporte.

---

## CustomCode.prisma

### `Snippet`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| name | String | |
| location | InjectionPoint (HEADER, BODY_START, BODY_END) | |
| content | String `@db.Text` | |
| status | PageStatus (reuso do enum de Pages!) | default DRAFT |
| priority | Int? | |
| scopeType | ScopeType (ALL_PAGES, SPECIFIC_PAGES) | default ALL_PAGES |
| createdAt / updatedAt | DateTime | |

Índices: `[status, location]`, `scopeType`, `createdAt`.
Nota: `status` reutiliza o enum `PageStatus` de `Pages.prisma` — acopla os
dois domínios (mudar `PageStatus` afeta Snippet).

### `SnippetPageScope`
Tabela de junção pura, PK composta `[snippetId, pageId]`, cascade nos dois
lados. Índice extra: `[pageId]` (cobre lookup reverso; `snippetId` já é
prefixo da PK composta, então não precisa de índice próprio).

---

## Notifications.prisma

### `Notification`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| userId | String | **sem FK declarada** para User |
| message | String `@db.Text` | |
| link | String? | |
| readAt | DateTime? | |
| createdAt | DateTime | |

Índices: `@@index([userId, readAt])`.
**Correção (review 2026-07-21):** existe purge diário
(`lib/Jobs/expireReadNotifications.ts`, agendado via BullMQ em
`lib/Publishing/queue.ts:88-105`, cron `0 0 * * *`), que apaga notificações
com `readAt < now - 30d` (`NOTIFICATION_RETENTION_MS`,
`lib/Modules/Notifications/Types.ts`). **Mas o filtro é `readAt: { lt: cutoff }`
— não-lidas (`readAt: null`) nunca são apagadas, em nenhuma idade.** Hoje é
inofensivo porque nenhum código de produção chama `notify()` (só
`tests/*` chamam) — não há produtor ligado
ainda. Vira risco real no dia em que uma feature começar a criar
notificações em produção sem que o usuário as leia.

---

## Settings.prisma

### `SiteSettings`
Singleton (`id` fixo `"singleton"`, sempre 1 linha). ~20 colunas de
configuração (título, SEO, timezone, Cloudflare token *encrypted*, flags de
sitemap/AI crawlers/webp). Sem índices (não precisa — é sempre lookup por PK
fixa). Não é candidata a otimização de performance, só de schema/tipagem.

---

## Logs.prisma

### `LogEntry`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| userId | String | **sem FK declarada** |
| action | String | |
| objectType | LogObjectType (enum: PAGE, FOLDER, MEDIA, SCRIPT, USER, SETTINGS, SPLIT_TEST) | |
| objectLabel | String | |
| createdAt | DateTime | |

Índices: `userId`, `createdAt`, `objectType`.
**Append-only, sem purge/retenção.**
**Correção (review 2026-07-21):** o doc original colocava `LogEntry` no
mesmo nível de risco que `SplitRedirectEvent` — não são comparáveis.
`logEvent()` só é chamado de dentro de Services admin autenticados (Pages,
Media, Users, CustomCode, Settings, SplitTests), então o volume é **bounded**
pela atividade humana no painel (cliques de admin). `SplitRedirectEvent`
cresce com tráfego público anônimo, sem esse limite (ver seção da tabela
abaixo). `LogEntry` ainda é candidata a retenção/particionamento a médio
prazo, mas com urgência bem menor.
**Sem índice composto** para o padrão provável de filtro do painel de logs
(`objectType` + `createdAt` juntos, ou `userId` + `createdAt` juntos).

---

## SplitTests.prisma

### `SplitCampaign`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| name | String | |
| slug | String | `@unique` |
| status | SplitCampaignStatus (ACTIVE, PAUSED) | default ACTIVE |
| authorId | String | FK → User, Restrict |
| createdAt / updatedAt | DateTime | |

Relações: `destinations[]`, `events[]`. Índices: `status`.
**Sem índice em `authorId`** (diferente de `Page.authorId`, que tem índice) —
inconsistência entre módulos parecidos.

### `SplitDestination`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| campaignId | String | FK → SplitCampaign, Cascade |
| url | String | (validado na camada de app, não no banco) |
| label | String? | |
| status | SplitDestinationStatus (ACTIVE, PAUSED) | default ACTIVE |
| sortOrder | Int | default 0 |
| hitCount | Int | default 0 — contador denormalizado, hidrata Redis |
| createdAt / updatedAt | DateTime | |

Índices: `[campaignId, status]`, `[campaignId, sortOrder]`.

### `SplitRedirectEvent`
| Coluna | Tipo | Constraints/Default |
| --- | --- | --- |
| id | String | PK |
| campaignId | String | FK → SplitCampaign, Cascade |
| destinationId | String | FK → SplitDestination, Cascade |
| createdAt | DateTime | default now() |

Índices: `[campaignId, createdAt]`, `[destinationId, createdAt]`.
**1 linha por redirect público servido** — de todas as tabelas, é a que
tem potencial de crescimento mais rápido e mais imprevisível (depende de
tráfego, não de ação humana no painel). Já documentado como risco aceito na
fase 17, sem mitigação de purge ainda.
**Correção/aprofundamento (review 2026-07-21):** confirmado em código —
`app/s/[slug]/route.ts` (`GET`) e `RedirectService.recordHit` /
`persistDurableHit` (`lib/Modules/SplitTests/RedirectService.ts:197-235`)
não têm **nenhum** rate limit. Qualquer request GET não autenticado a
`/s/{slug}` gera 1 `SplitRedirectEvent.create` **+** 1
`SplitDestination.update` (increment `hitCount`) — 2 escritas por hit, a
segunda com lock de linha em `SplitDestination`. `HEAD` não conta (correto,
usado por healthcheck/bots). Isso é o item de maior prioridade da fase de
otimização: não é só "vai crescer com o tempo", é "qualquer request GET em
loop infla a tabela agora, sem fricção".

---

## Padrões e inconsistências observadas (sem julgar prioridade ainda)

1. **Duas árvores de pasta quase idênticas** (`PageFolder` / `MediaFolder`) —
   mesma forma, sem tabela genérica compartilhada.
2. **FKs "soft" sem constraint no banco:** `Notification.userId`,
   `LogEntry.userId`, `InviteToken.targetUserId`/`createdById` referenciam
   `User.id` só por convenção de nome, sem `@relation` nem FK real. Nenhuma
   garantia de integridade referencial nessas colunas.
3. **Enums de status duplicados por módulo:** `PageStatus`,
   `MediaProcessingStatus`, `SplitCampaignStatus`, `SplitDestinationStatus` —
   todos com forma parecida (ACTIVE/PAUSED ou DRAFT/PUBLISHED), sem enum
   compartilhado. `Snippet.status` inclusive reaproveita `PageStatus` direto.
4. **Tabelas sem índice de suporte para paginação por data:**
   `MediaFile.createdAt`, `SplitCampaign` (nenhum índice de data).
5. **Duas tabelas append-only sem purge, com urgência diferente:**
   `LogEntry` (bounded por ação admin autenticada) e `SplitRedirectEvent`
   (não-bounded, tráfego público anônimo sem rate limit — ver correção
   acima). Ambas já filtram por `createdAt` nos índices (bom sinal de que
   paginação por data é o acesso esperado), nenhuma tem
   purge/particionamento.
6. **`hitCount` em `SplitDestination` é denormalizado** e reidratado a
   partir do Redis (`RedisMiss → hidratar hashes/contadores a partir de
   SplitDestination.hitCount`) — ponto de
   possível divergência entre contador Postgres e Redis sob concorrência,
   já assumido como risco aceito na fase 17. Cada hit grava **2x** no
   Postgres (insert do evento + update do contador), dobrando a escrita
   por request no path mais exposto da base.
7. **`Notification.notify()` sem produtor em produção:** função exportada
   como "boundary para futuros emissores de evento", mas hoje só é chamada
   em `tests/`. Retenção cobre só lidas — risco de acúmulo
   ilimitado de não-lidas fica dormente até o primeiro caller de produção
   aparecer.

## Correções da review (2026-07-21)

Levantamento cruzado com o código real (`/code-review`, foco em
"coisas que inflam o banco rapidamente"). Resumo do que mudou desde a
primeira versão deste doc:

| Afirmação original | Estava errada? | Correção |
| --- | --- | --- |
| `Notification`: "sem retenção/purge hoje" | **Sim** | Existe purge diário, mas só para lidas (`readAt < 30d`); não-lidas nunca expiram |
| `Page` trashed: implícito "sem mitigação" | **Sim** (por omissão) | Já existe `expireTrashedPages` (30d, batch 50, cron diário) |
| `LogEntry` ≈ `SplitRedirectEvent` em risco | **Sim** (priorização) | `LogEntry` é bounded por ação admin; `SplitRedirectEvent` não tem bound (tráfego público sem rate limit) |
| `SplitRedirectEvent`: "sem mitigação de purge" | Não, mas incompleto | Confirmado sem rate limit também — o problema é a escrita não ter fricção, não só a falta de purge |

**Prioridade revisada para a fase de otimização (mais urgente primeiro):**
1. `SplitRedirectEvent` — sem rate limit no `/s/{slug}` público (risco ativo, não só "vai crescer").
2. `LogEntry` — sem purge, mas bounded (risco de médio prazo).
3. `Notification` não-lidas — sem expiry, mas hoje dormente (sem produtor em prod); fechar antes de ligar qualquer feature de notificação.
4. Índices faltantes / enums duplicados / FKs soft — qualidade de schema, não bloat.

Próximo passo (fora deste arquivo): spec formal da fase de otimização.

## Estado após fase 18 (2026-07-21)

Implementado conforme a spec e o plano internos da fase 18.
Todos os defaults propostos na spec foram
mantidos sem ajuste durante a implementação.

- **Hot path `/s/{slug}` protegido (T18.2):** `GET`/`HEAD` continuam sem rate
  limit na resposta, mas a escrita durável em `SplitRedirectEvent` +
  `SplitDestination.hitCount` agora passa por um limiter (20 req/10s por
  IP+campanha, `lib/Modules/SplitTests/telemetryRateLimit.ts`, chave via
  `resolveClientIp` de `lib/auth-rate-limit.ts`). O contador Redis do
  seletor **não** é afetado pelo limite — só o excesso de escrita crua é
  descartado. Fail-open se o limiter falhar.
- **`SplitRedirectEvent` com retenção (T18.3):** job diário
  (`expire-split-redirect-events`, 02:00 UTC) agrega eventos com mais de 30
  dias em `SplitRedirectDailyStat` (um registro por destino/dia) e purga os
  eventos crus já agregados, em batches de 500.
- **`LogEntry` com retenção (T18.4):** job diário
  (`expire-log-entries`, 03:00 UTC) purga entradas com mais de 180 dias, em
  batches de 500.
- **Gap de notificações não-lidas fechado (T18.5):** job diário
  (`expire-stale-notifications`, 04:00 UTC) apaga qualquer notificação
  (lida ou não) com mais de 90 dias — o job de 30 dias existente
  (`expire-read-notifications`) continua intocado e só cobre lidas.
- **`Session`/`Verification` expiradas com purge (T18.6):** dois jobs
  diários (`expire-expired-sessions` 05:00 UTC, `expire-expired-verifications`
  05:30 UTC — horários escalonados de propósito, ver correções abaixo) apagam
  linhas com `expiresAt` no passado.
- **Índices novos (T18.1):** `Page[status, deletedAt]`,
  `MediaFile.createdAt`, `LogEntry[objectType, createdAt]`,
  `SplitCampaign.authorId`, `Session.expiresAt` — migration
  `20260721142253_optimize_db_phase18_indexes_and_rollup`.
- **Não implementado nesta fase (fora de escopo, "Ask first" na spec):** FK
  real em `Notification.userId`/`LogEntry.userId`; consolidação dos enums de
  status duplicados; unificação de `PageFolder`/`MediaFolder` (non-goal
  explícito). Continuam válidos os pontos 1–3 da seção "Padrões e
  inconsistências observadas" acima.
- **Achado fora de escopo, não corrigido:** `pnpm lint` no repo completo
  falha em `components/Shared/MediaPickerDialog.tsx` (duas violações de
  `react-hooks/set-state-in-effect`) — pré-existente, não tocado por nenhuma
  tarefa desta fase; sinalizado aqui para uma fase de manutenção futura.

### Correções da `/code-review` da implementação (2026-07-21)

Uma review pós-implementação encontrou 6 problemas na própria entrega da
fase 18 (não no inventário, no código que a fase produziu). Todos corrigidos
no mesmo dia, com testes cobrindo o comportamento corrigido:

1. **Rollup não era atômico** (`Aggregation.ts`) — `upsert` do agregado e
   `deleteMany` dos eventos crus eram chamadas separadas; falha entre as
   duas (ex.: timeout no delete) fazia o retry do BullMQ reprocessar o
   mesmo lote e **duplicar** o `hits` em `SplitRedirectDailyStat`. Corrigido
   envolvendo as duas em `database.$transaction`.
2. **O rate limit atrasava o 307** — o novo `await isTelemetryAllowed(...)`
   estava no caminho síncrono de `recordHit`, que `route.ts` aguarda antes
   de responder. Agora o check de rate limit entrou para dentro do mesmo
   bloco fire-and-forget do write no Postgres — o 307 só depende do `INCR`
   do Redis (que já existia antes da fase 18).
3. **Rate limit "por IP+campanha" na prática era só "por campanha"** —
   `resolveClientIp` retorna `null` quando `AUTH_TRUST_PROXY=false` (default
   em `.env`/`.env.example`), colapsando o budget de 20 req/10s para toda a
   campanha, não por visitante. Não mudamos o comportamento (mudar o default
   afetaria também o rate limit de login) — documentamos a dependência
   explicitamente em `telemetryRateLimit.ts` e em `.env.example`, deixando
   claro que produção detrás do `nginx.conf` (que sobrescreve
   `X-Real-IP`/`X-Forwarded-For`) deve setar `AUTH_TRUST_PROXY=true`.
4. **`expireStaleNotifications` não era batchado** — único job de purge da
   fase que fazia um `deleteMany` sem paginação, diferente de todos os
   outros. Corrigido para o mesmo padrão find-ids-então-delete-por-id em
   lote dos demais.
5. **Cron de `Session`/`Verification` colidia** (ambos 05:00 UTC) —
   inofensivo com `concurrency:1` no worker, mas sem motivo para colidir.
   `Verification` movido para 05:30 UTC.
6. **`SplitRedirectDailyStat` sem FK** — comportamento intencional (a tabela
   existe para sobreviver à purga dos eventos crus), mas não estava
   documentado. Comentário adicionado no schema explicando o tradeoff.
