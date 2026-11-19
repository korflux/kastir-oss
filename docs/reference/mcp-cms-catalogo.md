# Catálogo atual das ferramentas MCP

Diferente de `mcp-cms.md` e `mcp-cms-acoes.md` (documentos de **desenho**,
escritos antes da implementação), este arquivo descreve o que está **de
fato registrado em código hoje** em `lib/Modules/Mcp/Tools/*.ts` via
`ToolRegistry.ts`. Serve de base pra intervenção humana: saber o que cada
ferramenta faz, se é leitura ou ação, que escopo exige, e onde a
implementação ficou aquém do desenho original.

Gerado por leitura direta do código. Atualizado na fase 45 (update
draft-only, revisões e major 2.0.0), na fase 2 do VibeFlow
(`phase-2-versoes-e-publicacao`: tools de ativar) e na fase 3
(`phase-3-erros-encontrados`: teto e formato do escopo de páginas dos
scripts) e na fase 5 (`phase-5-mcp-edicao-parcial-e-hash-de-conteudo`:
patch de conteúdo, hash e trava de versão). Revalidar se os arquivos em
`lib/Modules/Mcp/Tools/` mudarem.

## Breaking changes

### Fase 35

| Mudança | Efeito |
| --- | --- |
| Sem `structuredContent` | Só `content[0].text` com JSON |
| Mutations com envelope | `{ ok, summary, data }` em vez do registro completo |
| Reads longos sob demanda | `pages_get` / `scripts_get` / `pages_preview` omitem o corpo por padrão; usar `contentStart`/`contentLength` |
| Listagens enxutas | Sem `createdAt`/`updatedAt`/`triggerConfig` por item de lista |
| `site_get_context` | `capabilities` do caller; template HTML só com flag |

### Fase 36

| Mudança | Efeito |
| --- | --- |
| `instructions` no `initialize` | Snapshot do site + conceitos (≤ 3.000 B); builder em `Instructions.ts` |
| `concepts` removido de `site_get_context` | Texto mora só no handshake |
| `starters.scriptTemplate` | Metadados sempre; `content` + `popupContent` com `includeScriptTemplate: true` (create nunca auto-semeia) |
| `pages_create` | `data.usedStarterTemplate: true` + frase no `summary` quando semeia |
| `tools/list` por escopo | Token só-leitura não vê mutations; guards de runtime intactos |

### Fase 37

| Mudança | Efeito |
| --- | --- |
| `kastir_guide_get` | Manual estático sob demanda: sem `topic`, índice dos 8 tópicos; com `topic`, conteúdo daquele tópico |
| `instructions` | Playbook de popup sai do handshake; entra ponteiro imperativo para consultar `kastir_guide_get` antes de criar |
| Criação/duplicação | Páginas e scripts retornam `activationRequired: true` e apontam para publish; split tests nascem `PAUSED` e apontam para `kastir_split_tests_update` com `ACTIVE` |
| Painel | Criação abre confirmação de ativação; continuar mantém `DRAFT`/`PAUSED`, e refresh não reabre |
| `tools/list` | Token completo = 43 tools; token `cms:read` = 18 tools |

### Fase 38 — versão minor 1.6.0

| Mudança | Efeito |
| --- | --- |
| `folders_update` | `parentId` é persistido junto com nome/cor e segue as validações canônicas da árvore |
| Scripts live | publish exige `PUBLISH_SCRIPT`; unpublish exige `UNPUBLISH_SCRIPT`; update é draft-only |
| Risco de scripts | O servidor não executa o conteúdo; depois da publicação, HTML/JavaScript pode executar no navegador dos visitantes |
| Catálogo | A superfície nominal continua com 43 tools completas e 18 no escopo `cms:read`; tools de upload/delete continuam não expostas |

### Fase 39 — versão minor 1.7.0

| Mudança | Efeito |
| --- | --- |
| `scripts_trash` / `split_tests_trash` | Soft delete reversível; não existe hard delete MCP |
| `media_upload` | Base64 padrão limitado a 20 MiB, filename validado e audit propagado |
| `media_replace` | Exige `REPLACE_MEDIA`; compensação permanece no serviço compartilhado |
| Política | Descoberta e runtime exigem simultaneamente papel permitido e scope concedido |
| Catálogo | 47 tools no token completo e 18 no token `cms:read` |

### Fase 45 — versão major 2.0.0

| Mudança | Efeito |
| --- | --- |
| `pages_update` / `scripts_update` | Gravam só o rascunho; nunca compilam nem tornam conteúdo live |
| Revisões | `kastir_{pages,scripts}_revisions_{list,get,diff,restore}` |
| Restore | Exige `expectedUpdatedAt`; copia para o draft; não publica |
| Unpublish | Desativa e mantém `publishedRevisionId` |
| Confirmação | `PUBLISH_SCRIPT` / `UNPUBLISH_SCRIPT` permanecem; `UPDATE_PUBLISHED_SCRIPT` some |
| Sem purge | Não existem `revisions_delete` / `revisions_purge` |
| Catálogo | 55 tools no token completo e 24 no token `cms:read` |

### Fase 2 VibeFlow — versões e publicação (minor, aditiva)

| Mudança | Efeito |
| --- | --- |
| `kastir_pages_activate` / `kastir_scripts_activate` | Reproduzem o "voltar ao ar" do switch do painel: religam a revisão já publicada, sem publicar o rascunho e sem criar versão. Chamam o mesmo serviço do `POST …/activate` do painel |
| Escopo e confirmação | Mesmo escopo de publish (`cms:pages:publish` / `cms:scripts:publish`); `kastir_scripts_activate` exige `PUBLISH_SCRIPT`. Sem escopo novo, então o token `cms:read` não as enxerga |
| Recusa | Item nunca publicado devolve `INVALID_STATE` ("… has no published revision"); item já no ar devolve o estado atual sem efeito nem audit |
| `publish` | Contrato inalterado. A descrição de `kastir_pages_publish` deixa de prometer "Activates if deactivated" sem ressalva: publish recusa com `INVALID_STATE` ("… has no unpublished changes") quando o rascunho é igual ao publicado, e nesse caso o caminho é activate |
| Audit | Ativação grava `PAGE_PUBLISHED` / `SCRIPT_PUBLISHED` com `source: MCP` e `tool` = nome da tool de ativar (a mesma ação de domínio que o painel já usa) |
| Catálogo | 57 tools no token completo e 24 no token `cms:read` |

### Fase 5 VibeFlow — edição parcial e hash de conteúdo (minor, aditiva)

| Mudança | Efeito |
| --- | --- |
| `kastir_pages_patch` / `kastir_scripts_patch` | Edição parcial do rascunho por busca e troca exata: `operations` de `{old, new}` aplicadas em sequência, tudo ou nada, só no conteúdo. Detalhes na seção [Edição parcial e hash de conteúdo](#edição-parcial-e-hash-de-conteúdo) |
| Escopo, audit e rate limit | Mesmo escopo e guarda de escrita do update (`cms:pages:write` / `cms:scripts:write`); token sem o escopo não vê a tool e a chamada vira "Tool <tool> not found". Audit com a mesma ação do update e `tool` = nome da tool de patch. Contam no bucket de mutation (30 chamadas por 60 s) |
| `expectedContentSha256` | Obrigatório no patch; opcional em `kastir_pages_update` e `kastir_scripts_update`. Quando presente é a única versão conferida e `expectedUpdatedAt` é ignorado; sem ele vale `expectedUpdatedAt`, como antes |
| `contentSha256` / `contentBytes` | Em `kastir_pages_get`, `kastir_scripts_get`, update e patch, sobre o conteúdo inteiro. `contentTotal` continua em unidades UTF-16 |
| Trava de linha | O save de páginas e scripts, do painel e do MCP, trava a linha (`SELECT ... FOR UPDATE`) antes de conferir a versão: duas gravações simultâneas com a mesma versão esperada resultam em uma gravação e um `CONFLICT` |
| Catálogo | 59 tools no token completo e 24 no token `cms:read` |

Playbook do "ligar" do painel para o agente (também em `kastir_guide_get`,
tópicos `pages`, `scripts` e `publishing`, e no handshake): **No ar** = publish
quando há alteração não publicada; se a recusa for `INVALID_STATE` "sem
alteração", activate. **Fora do ar** = unpublish.

Versão do servidor = `package.json` (`MCP_SERVER_INFO.version`). O major do
contrato MCP sai do commit `feat!:` — não editar `package.json#version` à mão.

## Transporte e autenticação

- Endpoint único: `app/api/mcp/route.ts` (GET/POST/DELETE), Streamable HTTP
  (`WebStandardStreamableHTTPServerTransport`, `enableJsonResponse: true`).
- Auth: Bearer token OAuth 2.1, verificado em `TokenVerification.ts`. 401
  sem token retorna `WWW-Authenticate: Bearer resource_metadata="…"`
  apontando pra `/.well-known/oauth-protected-resource`.
- Descoberta: `app/.well-known/oauth-protected-resource/route.ts` e
  `app/.well-known/oauth-authorization-server/[...issuerPath]/route.ts`.
- Rate limit por token antes de autenticar (`RateLimit.ts`).
- `createMcpServer()` é **async**: monta `instructions` (settings + origin) e
  registra tools **só** se o token tiver o escopo correspondente. Runtime
  ainda valida com `requireMcpScope` / `requireMcpAdministrator`.
- **Orçamento de descoberta:** token completo = **59 tools** e token
  `cms:read` = **24 tools** (só leitura; payload menor). A gordura residual
  é schema (ex.: `trigger` discriminado), não description livre (≤ 160
  chars no teste).
- A descoberta e o handler compõem **papel + scope**: possuir scope forjado
  não concede tools administrativas a um papel sem permissão no domínio.
- Denylist nominal: `kastir_pages_permanently_delete`,
  `kastir_pages_revisions_delete`, `kastir_pages_revisions_purge`,
  `kastir_scripts_delete`, `kastir_scripts_revisions_delete`,
  `kastir_scripts_revisions_purge`, `kastir_page_folders_delete`,
  `kastir_media_folders_delete`, `kastir_media_delete`,
  `kastir_media_bulk_delete`, `kastir_split_tests_delete` e
  `kastir_split_tests_destinations_delete` não são registrados.

## Convenção de risco (annotations)

Cada tool declara `readOnlyHint` / `destructiveHint` / `idempotentHint` /
`openWorldHint`. Isso é o sinal mais confiável pra decidir o que pode rodar
sem confirmação humana:

- `readOnlyHint: true` → leitura, sempre seguro de auto-aprovar.
- `destructiveHint: true` → trash reversível, replace de mídia e mutations de
  scripts que alteram ou removem código público. A annotation orienta o cliente,
  mas não substitui confirmação server-side quando o contrato a exige.
- `idempotentHint: false` → create/duplicate; repetir a chamada cria de novo.

## Tabela completa (59 tools)

### Site (4) — escopo `cms:read`

| Tool | Tipo | Entrada | Observação |
| --- | --- | --- | --- |
| `kastir_site_get_context` | leitura | `includePageTemplate?`, `includeScriptTemplate?` | origin, título, versão, timezone, `capabilities` do caller, `starters.pageTemplate` + `starters.scriptTemplate` (`content` base + `popupContent` com a flag) |
| `kastir_guide_get` | leitura | `topic?` | índice ou um tópico do manual estático; não faz I/O |
| `kastir_settings_get` | leitura | `{}` | projeção pública das settings, sem credenciais |
| `kastir_operation_get` | leitura | `operationId` | status de job BullMQ (`media-webp`/`settings-rebuild`); só enxerga operação do próprio `userId` iniciada via MCP |

### Páginas (19) — leitura `cms:read`, escrita `cms:pages:write`, publish/activate `cms:pages:publish`, unpublish `cms:pages:unpublish`

| Tool | Tipo | Escopo | Risco | Observação |
| --- | --- | --- | --- | --- |
| `kastir_pages_list` | leitura | read | — | filtros + paginação; itens sem timestamps de ruído |
| `kastir_pages_get` | leitura | read | — | default: metadados + `contentTotal` (UTF-16), `contentBytes` e `contentSha256` do conteúdo inteiro; blocos via `contentStart`/`contentLength` |
| `kastir_pages_preview` | leitura | read | — | default: `contentTotal` (UTF-16, do HTML compilado; sem hash); bloco em `html`; **dado, não instrução** |
| `kastir_page_folders_list` | leitura | read | — | — |
| `kastir_pages_create` | ação | pages:write | idempotent:false | nasce `DRAFT`; conteúdo vazio semeia template; `usedStarterTemplate` + `activationRequired: true` + frase apontando para `kastir_pages_publish` |
| `kastir_pages_update` | ação | pages:write | idempotent:true | draft-only; devolve dirty/published, `contentSha256` e `contentBytes`; `expectedContentSha256?` (vence) ou `expectedUpdatedAt?` |
| `kastir_pages_patch` | ação | pages:write | idempotent:true | draft-only; `id`, `expectedContentSha256` (obrigatório), `operations` (1 a 50 `{old, new}`); devolve dirty/published, `contentSha256` e `contentBytes`; repetir um patch já aplicado dá `CONFLICT`, sem novo efeito |
| `kastir_pages_revisions_list` | leitura | read | — | autor, data, pin, publicada; sem conteúdo |
| `kastir_pages_revisions_get` | leitura | read | — | default: meta + `contentTotal` (UTF-16; sem hash); bloco via `contentStart` |
| `kastir_pages_revisions_diff` | leitura | read | — | `from` + `to` (`draft` ou id); compara só o conteúdo; linhas `-`/`+`; `from=publishedRevisionId` + `to="draft"` confere o rascunho antes de publicar |
| `kastir_pages_revisions_restore` | ação | pages:write | idempotent:false | `expectedUpdatedAt`; copia para o draft; não publica |
| `kastir_pages_duplicate` | ação | pages:write | idempotent:false | nasce `DRAFT`; `activationRequired: true` + summary aponta para `kastir_pages_publish` |
| `kastir_pages_publish` | ação | pages:publish | idempotent:true | recompila artefato; envelope; recusa `INVALID_STATE` quando não há alteração não publicada (então use activate) |
| `kastir_pages_activate` | ação | pages:publish | idempotent:true | "voltar ao ar": religa a revisão publicada sem publicar o rascunho nem criar versão; `INVALID_STATE` se nunca publicada; summary informa `Unpublished changes` |
| `kastir_pages_unpublish` | ação | pages:unpublish | idempotent:true | desativa; mantém o ponteiro publicado |
| `kastir_pages_trash` | ação | pages:write | **destructiveHint:true** (reversível) | envelope |
| `kastir_pages_restore` | ação | pages:write | idempotent:true | envelope |
| `kastir_page_folders_create` | ação | pages:write | idempotent:false | envelope |
| `kastir_page_folders_update` | ação | pages:write | idempotent:true | nome, cor e `parentId` no mesmo update; move atômico |

**Gap vs. desenho** (`mcp-cms.md`): `kastir_pages_permanently_delete` e
`kastir_page_folders_delete` estavam planejadas e **não existem** no código
— não há como excluir permanentemente uma página nem uma pasta via MCP hoje.

### Mídias (10) — leitura `cms:read`, escrita `cms:media:write`

| Tool | Tipo | Observação |
| --- | --- | --- |
| `kastir_media_list` | leitura | filtros + paginação, sem `processingToken`/timestamps |
| `kastir_media_get` | leitura | detalhe inclui `createdAt`/`updatedAt` (listagem não) |
| `kastir_media_download` | leitura | URL assinada de curta duração |
| `kastir_media_folders_list` | leitura | — |
| `kastir_media_upload` | ação | base64 padrão até 20 MiB; filename, alt e descrição validados; nunca retorna bytes/path/token |
| `kastir_media_replace` | ação | exige `REPLACE_MEDIA`; mantém o ID e usa compensação de storage/DB/fila |
| `kastir_media_update` | ação | só metadados; envelope de sucesso |
| `kastir_media_convert_to_webp` | ação | assíncrona; envelope com `operationId` |
| `kastir_media_folders_create` | ação | envelope |
| `kastir_media_folders_update` | ação | nome, cor e `parentId` no mesmo update; move atômico |

`kastir_media_delete`, `kastir_media_bulk_delete` e
`kastir_media_folders_delete` **não existem**: upload e replace são suportados,
mas exclusão de mídia/pasta continua fora da superfície MCP.

### Scripts / custom code (15) — leitura `cms:read`, escrita `cms:scripts:write`, publish/activate `cms:scripts:publish`, unpublish `cms:scripts:unpublish`

| Tool | Tipo | Observação |
| --- | --- | --- |
| `kastir_scripts_list` | leitura | sem `content`/`triggerConfig`/timestamps |
| `kastir_scripts_get` | leitura | default: meta + `contentTotal` (UTF-16), `contentBytes` e `contentSha256` do conteúdo inteiro; blocos via `contentStart`; o servidor não executa o conteúdo; após publish, o navegador pode executá-lo |
| `kastir_scripts_scope_pages_list` | leitura | páginas elegíveis pra `SPECIFIC_PAGES`; é de onde saem os ids de `pageIds` |
| `kastir_scripts_create` | ação | trigger popup opcional; `pageIds` com o teto do escopo (abaixo); nasce `DRAFT`; `activationRequired: true` + summary aponta para `kastir_scripts_publish` |
| `kastir_scripts_update` | ação | draft-only; `trigger: null` limpa; `pageIds` com o mesmo teto do create; nunca publica; devolve `contentSha256` e `contentBytes`; `expectedContentSha256?` (vence) ou `expectedUpdatedAt?` |
| `kastir_scripts_patch` | ação | draft-only; `id`, `expectedContentSha256` (obrigatório), `operations` (1 a 50 `{old, new}`) sobre o código do script; devolve `contentSha256` e `contentBytes`; repetir um patch já aplicado dá `CONFLICT`, sem novo efeito; nunca publica |
| `kastir_scripts_revisions_list` | leitura | autor, data, pin, publicada; sem conteúdo |
| `kastir_scripts_revisions_get` | leitura | default omite conteúdo e devolve `contentTotal` (UTF-16; sem hash); o servidor não executa |
| `kastir_scripts_revisions_diff` | leitura | `from` + `to` (`draft` ou id); compara só o conteúdo; `from=publishedRevisionId` + `to="draft"` confere o rascunho antes de publicar |
| `kastir_scripts_revisions_restore` | ação | `expectedUpdatedAt`; copia para o draft; não publica |
| `kastir_scripts_duplicate` | ação | nasce `DRAFT`; `activationRequired: true` + summary aponta para `kastir_scripts_publish` |
| `kastir_scripts_trash` | ação | **destructiveHint:true**; soft delete reversível, retorno mínimo e auditado |
| `kastir_scripts_publish` | ação | exige `PUBLISH_SCRIPT`; recompila páginas afetadas; o navegador pode executar o conteúdo publicado; recusa `INVALID_STATE` quando não há alteração não publicada (então use activate) |
| `kastir_scripts_activate` | ação | **destructiveHint:true**; exige `PUBLISH_SCRIPT` (escopo `scripts:publish`); religa a revisão publicada sem publicar o rascunho nem criar versão; `INVALID_STATE` se nunca publicado |
| `kastir_scripts_unpublish` | ação | exige `UNPUBLISH_SCRIPT`; desativa e mantém o ponteiro publicado |

`kastir_scripts_delete` **não existe**: o MCP move para a lixeira, mas não
oferece exclusão permanente.

**Escopo de páginas (`pageIds`, create e update).** Mesma regra do painel,
definida uma vez em `lib/Modules/CustomCode/Schema.ts`
(`SCOPE_PAGE_IDS_MAX`): cada item é um `cuid` de página (use os ids de
`kastir_scripts_scope_pages_list`), a lista tem de 0 a **1000** itens
(`maxItems` no `tools/list`) e ids repetidos viram uma ocorrência. Id fora do
formato ou lista acima do teto é recusado como `VALIDATION_ERROR`, sem
reaproveitar o valor enviado na mensagem e antes de tocar no banco. O teto é
checado no payload bruto, antes do dedupe. Scripts já gravados com mais de 1000
páginas não são alterados até a próxima edição. No painel o seletor não limita
a seleção; a recusa acontece ao salvar.

### Split tests (9) — leitura `cms:read`, escrita `cms:split-tests:write`

| Tool | Tipo | Observação |
| --- | --- | --- |
| `kastir_split_tests_list` | leitura | — |
| `kastir_split_tests_get` | leitura | destinos, pesos, contadores |
| `kastir_split_tests_stats` | leitura | agregado diário UTC; hits muito recentes podem não ter rollup ainda |
| `kastir_split_tests_create` | ação | nasce `PAUSED`; `activationRequired: true` |
| `kastir_split_tests_update` | ação | use `status: ACTIVE` para ativar o redirect |
| `kastir_split_tests_destinations_create` | ação | — |
| `kastir_split_tests_destinations_update` | ação | — |
| `kastir_split_tests_destinations_reorder` | ação | reordena todos os IDs de uma vez |
| `kastir_split_tests_trash` | ação | **destructiveHint:true**; soft delete reversível, retorno mínimo e auditado |

`kastir_split_tests_delete` e `kastir_split_tests_destinations_delete` **não
existem**: não há hard delete nem exclusão individual de destino via MCP.

### Settings (1) — `cms:settings:write` + role Admin/Master

| Tool | Tipo | Observação |
| --- | --- | --- |
| `kastir_settings_update` | ação | nunca aceita `cloudflareApiToken`/`cloudflareZoneId`, mesmo com o escopo. Trocar `siteUrl` exige `confirmSiteUrl: true` (mesmo gate do painel). `revisionRetentionLimit` (5–30) é opcional: omitir preserva o valor vigente; não usa default 5. |

### Logs (1) — `cms:logs:read` + role Admin/Master

| Tool | Tipo | Observação |
| --- | --- | --- |
| `kastir_audit_logs_list` | leitura | inclui ações feitas pelo próprio MCP; sem purge/export |

## Edição parcial e hash de conteúdo

Vale igual para páginas (`kastir_pages_patch`) e scripts
(`kastir_scripts_patch`, sobre o código do script). A fonte comum é
`lib/Modules/Shared/ContentPatch.ts` (hash e aplicação do patch) e
`lib/Modules/Shared/ContentPatchContract.ts` (teto de operações e formato do
hash); o texto servido ao agente está em `kastir_guide_get`, tópicos `pages`,
`scripts` e `publishing`.

**Entrada do patch** (`.strict()`, validada antes do handler):

- o identificador do recurso (`id`), `expectedContentSha256` e `operations`;
- `expectedContentSha256` é obrigatório e tem 64 caracteres hexadecimais (a
  borda aceita maiúsculas; a saída é sempre minúscula);
- de 1 a 50 operações `{old, new}` por chamada;
- `old` não vazio (ao menos 1 caractere); `old` e `new` até o limite de conteúdo do
  domínio (2 MiB em UTF-8, páginas e scripts);
- o resultado do patch também respeita 2 MiB em UTF-8.

**Aplicação.** Cada `old` deve ocorrer exatamente uma vez no conteúdo corrente
(ocorrências sobrepostas contam como repetição, então `aa` em `aaa` ocorre 2
vezes). As operações rodam em sequência, cada uma sobre o resultado da
anterior, e a chamada é tudo ou nada. O casamento é exato, por unidade de
código UTF-16: não normaliza CRLF nem Unicode. O patch altera só o conteúdo;
título, slug, SEO, pasta e os campos do script seguem pelo update. Patch cujo
resultado é idêntico ao conteúdo atual termina com sucesso sem escrita:
`updatedAt` e revisões não mudam.

**Erros.** Em toda recusa o rascunho, o `updatedAt` e as revisões ficam como
estavam.

| Situação | Código | Mensagem |
| --- | --- | --- |
| `expectedContentSha256` diferente do hash atual (outra gravação chegou antes) | `CONFLICT` | `<Page\|Script> was updated by another request (current contentSha256: <hash>)` |
| `old` com 0 ocorrências, ou mais de 1 | `VALIDATION_ERROR` | `Operation <i>: old text occurs <n> times, expected exactly 1` (`i` a partir de 0) |
| `old` ou `new` com surrogate isolado | `VALIDATION_ERROR` | `Operation <i>: old and new text must not contain an unpaired surrogate` |
| Resultado acima de 2 MiB em UTF-8 | `VALIDATION_ERROR` | `Patched content must be at most <max> bytes` |
| Argumento inválido: 51 operações, `old` vazio, campo fora da allowlist, hash sem 64 hexadecimais ou ausente | `VALIDATION_ERROR` | `Invalid arguments for tool <tool>`, sem o campo nem o valor enviado |

A recusa de argumento inválido acontece antes do handler. Pela rota
`/api/mcp`, o normalizador de resposta
(`lib/Modules/Mcp/ResponseNormalization.ts`) devolve só essa frase fixa, como
nas demais tools; o texto bruto do SDK, com o nome do campo, só aparece em
cliente em memória, fora da rota. Um patch repetido depois de aplicado dá
`CONFLICT`, porque o hash esperado já não é o atual.

**Hash e tamanhos.** `kastir_pages_get`, `kastir_scripts_get`, update e patch
devolvem, sobre o conteúdo inteiro (mesmo quando o get devolve só um bloco):

| Campo | Significado |
| --- | --- |
| `contentSha256` | SHA-256 dos bytes UTF-8 do conteúdo, em hexadecimal minúsculo de 64 caracteres; é o valor que o agente reenvia como `expectedContentSha256` |
| `contentBytes` | bytes UTF-8 do conteúdo, a unidade do limite de 2 MiB |
| `contentTotal` | unidades UTF-16 (`text.length`), a unidade de `contentStart` e `contentLength`; não é a unidade do limite |

| Conteúdo | `contentTotal` | `contentBytes` |
| --- | --- | --- |
| `abc` | 3 | 3 |
| `é` | 1 | 2 |
| `🚀` | 2 | 4 |
| `<p>\r\n</p>` | 9 | 9 |

O CRLF conta 2 nas duas unidades, e um caractere fora do BMP conta 2 em
`contentTotal` e 4 em `contentBytes`; por isso a contagem UTF-16 pode diferir
da de bytes e não serve para conferir o limite nem a integridade. O hash é
calculado na hora, sem coluna nem migration; `abc` tem `contentSha256`
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
`kastir_pages_revisions_get`, `kastir_scripts_revisions_get` e
`kastir_pages_preview` mantêm `contentTotal` em UTF-16 e não expõem hash:
revisão é histórico imutável e o preview é o HTML compilado, não o rascunho.

**Versão esperada e precedência.** O `contentSha256` lido é o
`expectedContentSha256` da próxima edição. No update, com
`expectedContentSha256` só ele é conferido e `expectedUpdatedAt` é ignorado,
mesmo que enviado junto: publish, activate e unpublish mudam `updatedAt` sem
mudar o conteúdo e, por data, gerariam `CONFLICT` falso. Sem
`expectedContentSha256`, vale `expectedUpdatedAt`, como antes. A conferência e a
gravação acontecem na mesma transação, com a linha travada por
`SELECT ... FOR UPDATE`, e valem também para o PUT do painel: duas gravações
simultâneas com a mesma versão esperada resultam em uma gravação e um
`CONFLICT`.

**`draftFingerprint` não é o hash do conteúdo.** É o SHA-256 do snapshot
(páginas: título, slug, conteúdo, SEO e pasta; scripts: os campos do snippet),
usado pelo painel e na deduplicação de revisões; o `fingerprint` dos itens de
`kastir_*_revisions_list` segue a mesma fórmula. A fórmula não mudou e o MCP
não expõe `draftFingerprint`: para conferir conteúdo, use `contentSha256`.

**Conferir antes de publicar.** `kastir_pages_revisions_diff` com
`from=publishedRevisionId` (de `kastir_pages_get`) e `to="draft"` mostra a
mudança do rascunho contra a revisão publicada; o diff compara só o conteúdo,
linha a linha. `kastir_scripts_revisions_diff` faz o mesmo para scripts.
Publish, activate, unpublish e restauração de revisão se comportam como antes.

## Contrato de resposta (pós fase 35)

1. **`toMcpToolJson`** devolve só `content[0].text` (JSON). Sem
   `structuredContent` (custo de contexto).
2. **Mutations** usam `toMcpSuccess(summary, data?)` →
   `{ ok: true, summary, data? }` com `data` enxuto (ids/status/timestamps).
   O `summary` identifica o registro pelo **id**; titulo/nome (texto do
   usuario) fica so em `data`, como dado.
3. **Conteúdo longo** via `readMcpTextSlice` (blocos 50k default / 100k máx.).
   `contentTotal` é em unidades UTF-16; hash e bytes do conteúdo inteiro
   vêm de `contentSha256` e `contentBytes` (ver [Edição parcial e hash de
   conteúdo](#edição-parcial-e-hash-de-conteúdo)).
4. **Erros** inalterados: `toMcpToolError` → `{ error: { code, message } }`,
   `isError: true`.

Conexão de clientes: ver [`mcp-clientes.md`](./mcp-clientes.md).

## Starters e manual de popup (fases 36–37)

| Starter | Onde | Notas |
| --- | --- | --- |
| Página | `lib/Modules/Pages/newPageTemplate.ts` | Painel + MCP `pages_create` + `site_get_context` |
| Script (base) | `lib/Modules/CustomCode/newScriptTemplate.ts` | Painel (POST criação) + MCP `scriptTemplate.content` |
| Script (popup) | mesmo módulo, `{ popup: true }` → `scriptTemplate.popupContent` | Botão fechar, ESC, `role=dialog`, foco adiado até o wrapper abrir, foco cíclico e título com id único; **não** recria `data-kastir-trigger`; `scripts_create` não semeia |

As regras de popup vivem em `MCP_POPUP_PLAYBOOK`, em
`lib/Modules/Mcp/Guide.ts`, e são servidas só pelo MCP, via `kastir_guide_get`
no tópico `popups`, apenas em inglês. O painel não exibe o playbook nem guarda
cópia dele no dicionário (`lib/i18n/panel.ts`). O starter é apenas uma semente:
HTML de popup já publicado continua sendo autoria do usuário e não é reescrito.

## Gaps ainda em aberto (dívida)

- Delete/bulk delete de mídia, hard delete de página/script/split test e delete
  de pastas/destinos — **não** existem no MCP (só no painel).

## Perguntas operacionais (checklist manual)

- Codex: reproduzir handshake e anotar etapa + `resource` literal se falhar.
- Checklist dos 4 provedores em `mcp-clientes.md`.

## Fontes

- `lib/Modules/Mcp/ToolRegistry.ts`, `Tools/*.ts`, `Scopes.ts`, `Policy.ts`
- `app/api/mcp/route.ts`, `TokenVerification.ts`
- Comparação com `docs/reference/mcp-cms.md` e `mcp-cms-acoes.md`
