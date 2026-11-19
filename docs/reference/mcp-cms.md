# Mapa do MCP do CMS Kastir

Documento de desenho do servidor MCP do Kastir. O catálogo **implementado**
está em [`mcp-cms-catalogo.md`](./mcp-cms-catalogo.md); conexão de clientes em
[`mcp-clientes.md`](./mcp-clientes.md).

O contrato implementado é o da versão major `2.0.0`, estendido de forma
aditiva pelas tools de ativar (fase 2 do VibeFlow) e pelas tools de patch de
conteúdo (fase 5): 59 tools no token completo e 24 com `cms:read`.
`kastir_pages_update` e `kastir_scripts_update` gravam
só o rascunho; o live exige `kastir_pages_publish` / `kastir_scripts_publish`.
Para alterar um trecho sem reenviar o conteúdo, `kastir_pages_patch` e
`kastir_scripts_patch` fazem busca e troca exata sobre o rascunho, e
`contentSha256` / `contentBytes` provam o que foi gravado (ver
[`mcp-cms-catalogo.md`](./mcp-cms-catalogo.md#edição-parcial-e-hash-de-conteúdo)).
Para voltar ao ar o que já foi publicado, sem alteração nova, use
`kastir_pages_activate` / `kastir_scripts_activate` (o "ligar" do switch do
painel: No ar / Fora do ar). Hard deletes e purge/delete de revisão continuam
fora da superfície MCP.

Contrato de resposta (fase 35): sem `structuredContent`; mutations com
`{ ok, summary, data }`; conteúdo longo em blocos (`contentStart`/
`contentLength`); `capabilities` derivadas do caller em
`kastir_site_get_context`.

Handshake (fases 36–37): `createMcpServer` é async e passa `instructions` no
`initialize` (`lib/Modules/Mcp/Instructions.ts`) — snapshot público do site,
conceitos de domínio e ponteiro imperativo para `kastir_guide_get`. O manual
detalhado, incluindo o playbook de popup, é carregado sob demanda por tópico;
o snapshot envelhece na sessão: revalidar com `kastir_settings_get` após
`kastir_settings_update`. `revisionRetentionLimit` (5–30) é opcional nesse
update: omitir preserva o valor vigente. Trocar `siteUrl` exige
`confirmSiteUrl: true`. `tools/list` filtra por escopo do token (guards de
runtime permanecem).

## Objetivo e limites

O MCP deve permitir que um agente consulte e opere o CMS usando os mesmos
serviços de domínio do painel. Ele não deve acessar Prisma diretamente nem
chamar as rotas HTTP do painel como cliente interno.

Prioridade inicial:

1. listar e consultar páginas, mídias, scripts e split tests;
2. visualizar preview e referências sem expor segredos;
3. editar/publicar apenas quando o token tiver escopo de escrita explícito;
4. manter ações destrutivas separadas e sempre confirmadas.

O conteúdo retornado pelo CMS (HTML, JavaScript, URLs e texto de páginas) é
**dado não confiável**. O servidor MCP não deve avaliá-lo nem tratá-lo como
instrução para o agente; depois de publicado, HTML/JavaScript pode ser
interpretado pelo navegador do visitante.

## Convenções do contrato

### Nomes

Usar nomes estáveis em `kastir_<dominio>_<acao>`:

```text
kastir_pages_list
kastir_pages_get
kastir_scripts_publish
```

Para entidades filhas, manter o domínio do pai no nome:

```text
kastir_split_tests_destinations_update
```

### Paginação

Toda ferramenta `*_list` deve aceitar:

```ts
type PageInput = {
  page?: number;      // default 1
  pageSize?: number;  // default 20, máximo 100
};

type PageResult<T> = {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    hasNextPage: boolean;
  };
};
```

Entregue nas fases 23/24: `kastir_pages_list` e `kastir_media_list` já
consultam de forma paginada e devolvem os totais acima. Não carregar uma
biblioteca inteira no contexto do agente.

### Erros

Toda falha deve seguir o mesmo formato, com `isError: true` na resposta MCP e
um payload estruturado:

```ts
type KastirMcpError = {
  error: {
    code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_STATE"
      | "CONFIRMATION_REQUIRED"
      | "PAYLOAD_TOO_LARGE"
      | "OPERATION_FAILED"
      | "RATE_LIMITED"
      | "MCP_RATE_LIMIT_UNAVAILABLE"
      | "INTERNAL_ERROR";
    message: string;
    details?: Record<string, unknown>;
  };
};
```

Não misturar `null`, exceções soltas e objetos `{ error }` dependendo da
ferramenta. IDs e `updatedAt` devem ser aceitos nas mutações para permitir
controle otimista de concorrência:

```ts
type MutationGuard = {
  expectedUpdatedAt?: string;
  confirmation?: string;
};
```

Se `expectedUpdatedAt` estiver desatualizado, retornar `CONFLICT` sem alterar
o registro.

No save de conteúdo de páginas e scripts, a versão esperada pode ser o hash do
conteúdo lido (fase 5):

```ts
type ContentVersionGuard = {
  // SHA-256 dos bytes UTF-8 do conteúdo (64 hexadecimais). Opcional no update,
  // obrigatório no patch. Quando presente, é a única versão conferida e
  // `expectedUpdatedAt` é ignorado.
  expectedContentSha256?: string;
};
```

Hash diferente do atual retorna `CONFLICT` com o hash atual na mensagem, sem
alterar o registro. O hash não muda com publish, activate e unpublish, que
alteram `updatedAt`; por isso não gera `CONFLICT` falso depois deles.

Validações de argumentos feitas pelo SDK antes do handler também são
normalizadas para `VALIDATION_ERROR` no transporte HTTP do Kastir.

## Itens que o MCP pode listar

### Páginas e pastas

Fonte: `lib/Modules/Pages/`, `prisma/schema/Pages.prisma`.

| Item | Campos de lista | Campos de detalhe / observações |
| --- | --- | --- |
| `page_folder` | `id`, `name`, `color`, `parentId`, `isBase` | raízes independentes com até três níveis; `Base` não aceita filhos nem pode ser apagada |
| `page` | `id`, `title`, `slug`, `status`, `folderId`, `author`, `activeSnippetCount`, `publishedAt`, `updatedAt` | detalhe inclui `content`, SEO, `createdAt`, `deletedAt`, `contentSha256` e `contentBytes` (do conteúdo inteiro); `contentTotal` em unidades UTF-16; lixeira só quando solicitado |
| `page_preview` | `pageId`, `slug`, `status` | HTML compilado sem admin bar e sem escrita em disco; retorna `contentTotal` (UTF-16, sem hash) por padrão e blocos em `html`; o servidor não avalia o HTML |

Filtros de `kastir_pages_list`:

```ts
type ListPagesInput = PageInput & {
  search?: string;
  folderId?: string;
  status?: "DRAFT" | "PUBLISHED";
  includeDeleted?: boolean;
};
```

O `includeDeleted` deve ser restrito a um escopo de leitura administrativa. A
listagem padrão nunca mistura páginas ativas e páginas na lixeira.

### Mídias e pastas

Fonte: `lib/Modules/Media/`, `prisma/schema/Media.prisma`.

| Item | Campos de lista | Campos de detalhe / observações |
| --- | --- | --- |
| `media_folder` | `id`, `name`, `color`, `parentId`, `isBase` | raízes independentes com até três níveis; mesma proteção da pasta `Base` |
| `media` | `id`, `name`, `fileName`, `url`, `mimeType`, `category`, `sizeBytes`, `alt`, `description`, `folderId`, `processingStatus`, datas | `publicUrl` só deve ser considerado utilizável quando o status for `READY` e os bytes existirem |
| `media_binary` | `mediaId`, `mimeType`, `sizeBytes`, URI temporária | devolver por URI/recurso, não em base64 dentro da resposta normal |

Categorias atuais: `IMAGE_RASTER`, `IMAGE_SVG`, `DOCUMENT_PDF` e `VIDEO_MP4`.
Status: `PROCESSING`, `READY` e `FAILED`.

Filtros de `kastir_media_list`:

```ts
type ListMediaInput = PageInput & {
  search?: string;
  folderId?: string;
  category?: "IMAGE_RASTER" | "IMAGE_SVG" | "DOCUMENT_PDF" | "VIDEO_MP4";
  processingStatus?: "PROCESSING" | "READY" | "FAILED";
};
```

Nunca retornar `processingToken`. O `url` persistido é relativo, como
`/uploads/{mediaId}/{fileName}`; se o agente precisar de URL absoluta, incluir
um `publicUrl` derivado do origin público atual, sem substituir o campo
persistido.

### Scripts / custom code

Fonte: `lib/Modules/CustomCode/`, `prisma/schema/CustomCode.prisma`.

No CMS a entidade se chama `Snippet`, mas no MCP deve ser exposta como
`script`, que é o termo usado no painel e nos logs.

| Item | Campos de lista | Campos de detalhe / observações |
| --- | --- | --- |
| `script` | `id`, `name`, `location`, `status`, `priority`, `scopeType`, `scopedPageIds`, `triggerType`, `maxDisplays`, `displayResetDays`, `createdAt`, `updatedAt` | detalhe inclui `content` e `triggerConfig`; o servidor não executa o conteúdo; após publicação, o navegador pode executá-lo |
| `script_scope_page` | `pageId`, `title`, `slug` | páginas ativas disponíveis para `SPECIFIC_PAGES` |

Valores atuais:

```text
location: HEADER | BODY_START | BODY_END
status: DRAFT | PUBLISHED
scopeType: ALL_PAGES | SPECIFIC_PAGES
triggerType: SELECTOR_EVENT | PAGE_LOAD | SCROLL | REFERRER | null
```

`triggerConfig` (só no detalhe) depende do tipo:

```text
SELECTOR_EVENT → { selector, event: "click" | "submit" }
PAGE_LOAD      → { delaySeconds }
SCROLL         → { percentage }
REFERRER       → { matches }
```

Write usa envelope aninhado `trigger: { triggerType, triggerConfig } | null`
(mais `maxDisplays` / `displayResetDays`); a resposta serializa colunas flat.

Filtros de `kastir_scripts_list`:

```ts
type ListScriptsInput = PageInput & {
  search?: string;
  status?: "DRAFT" | "PUBLISHED";
  location?: "HEADER" | "BODY_START" | "BODY_END";
  scopeType?: "ALL_PAGES" | "SPECIFIC_PAGES";
};
```

O conteúdo do script e o `triggerConfig` devem ser omitidos na lista e
entregues por `kastir_scripts_get`; mutations retornam apenas metadados enxutos,
reduzindo consumo de contexto e exposição acidental de código.

### Split tests

Fonte: `lib/Modules/SplitTests/`, `prisma/schema/SplitTests.prisma`.

| Item | Campos | Observações |
| --- | --- | --- |
| `split_test` | `id`, `name`, `slug`, `status`, `authorId`, `activeDestinationCount`, `totalHits`, datas | detalhe inclui destinos ordenados e percentuais |
| `split_test_destination` | `id`, `campaignId`, `url`, `label`, `status`, `sortOrder`, `hitCount`, `theoreticalWeight`, `realPercent`, datas | `url` pode ser path interno ou URL HTTP(S) externa; mudanças são sensíveis |
| `split_test_daily_stat` | `campaignId`, `destinationId`, `day`, `hits` | agregado diário UTC consultado por `kastir_split_tests_stats` |

Status de campanha e destino: `ACTIVE` ou `PAUSED`. Uma campanha nova nasce
`PAUSED` e só redireciona depois de `status: "ACTIVE"`.

Filtros de `kastir_split_tests_list`:

```ts
type ListSplitTestsInput = PageInput & {
  search?: string;
  status?: "ACTIVE" | "PAUSED";
};
```

Na primeira versão, expor contadores atuais e percentuais calculados, mas não
os eventos brutos de redirecionamento. Os eventos são retidos/agregados por
job; para séries históricas será necessário criar um método de agregação
paginado com intervalo de datas e timezone documentados.

### Recursos administrativos opcionais

Estes itens são úteis, mas não precisam bloquear o MVP focado em conteúdo:

| Item | Acesso | Regra |
| --- | --- | --- |
| `site_settings_public` | Admin/Master | retornar apenas a projeção pública; nunca token Cloudflare criptografado |
| `audit_log` | Admin/Master | filtros por período, ator e `objectType`; paginação obrigatória |
| `operation` | ator que iniciou a operação | estado/progresso de jobs; não expor payload bruto do BullMQ |

Backup e migração (fase 22) ficaram **fora do escopo** deste MCP: não há
`backup_snapshot` nem ferramentas de export/import/restore planejadas aqui. Ver
`docs/reference/mcp-cms-acoes.md`.

## Ferramentas de leitura

| Ferramenta | Entrada principal | Retorno |
| --- | --- | --- |
| `kastir_site_get_context` | `includePageTemplate?`, `includeScriptTemplate?` | origin, título, versão, timezone, `capabilities` do caller, `starters.pageTemplate` + `starters.scriptTemplate` (`content` + `popupContent` com a flag; create não auto-semeia script) — conceitos de domínio vão no `instructions` do handshake, não neste payload |
| `kastir_guide_get` | `topic?` | índice dos tópicos sem `topic`; conteúdo de um tópico quando informado; manual estático sem I/O |
| `kastir_pages_list` | filtros de páginas + paginação | `PageResult<PageListItem>` |
| `kastir_page_folders_list` | `parentId?` | `PageResult<PageFolder>` ou árvore explicitamente solicitada |
| `kastir_pages_get` | `pageId`, `includeDeleted?` | `PageDetail`, com `contentTotal` (UTF-16), `contentBytes` e `contentSha256` |
| `kastir_pages_preview` | `pageId` ou `slug`, `contentStart?`, `contentLength?` | `contentTotal` (UTF-16, sem hash) por padrão; bloco no campo `html` e `nextStart` quando houver |
| `kastir_media_list` | filtros de mídia + paginação | `PageResult<MediaListItem>` |
| `kastir_media_folders_list` | `parentId?` | `PageResult<MediaFolder>` |
| `kastir_media_get` | `mediaId` | `MediaDetail`, sem `processingToken` |
| `kastir_media_download` | `mediaId` | URI temporária/recurso binário com expiração |
| `kastir_scripts_list` | filtros de scripts + paginação | `PageResult<ScriptListItem>` sem conteúdo |
| `kastir_scripts_get` | `scriptId` | `ScriptDetail` com conteúdo, escopos, `contentTotal` (UTF-16), `contentBytes` e `contentSha256` |
| `kastir_scripts_scope_pages_list` | busca + paginação | páginas elegíveis para vinculação |
| `kastir_split_tests_list` | filtros + paginação | `PageResult<SplitTestListItem>` |
| `kastir_split_tests_get` | `campaignId` | campanha com destinos, pesos e contadores atuais |
| `kastir_split_tests_stats` | `campaignId`, `from`, `to` | hits diários por destino em UTC, intervalo inclusivo |
| `kastir_audit_logs_list` | filtros + paginação | logs resumidos, sem payloads ou segredos |
| `kastir_operation_get` | `operationId` | status seguro de `media-webp` e `settings-rebuild`; não expõe payload do job |

As ferramentas de listagem devem retornar referências por ID e relações
resumidas. Por exemplo, `page.author` pode conter `id` e `name`, mas não deve
carregar usuário completo em cada página.

## Ferramentas de mutação

### Páginas

Criação e duplicação produzem `DRAFT` e não publicam o artefato. A resposta
inclui `data.activationRequired: true` e aponta para
`kastir_pages_publish`. Fluxo live: `update` → `publish`.

O "ligar" do switch do painel vira dois passos para o agente: `publish` quando
o rascunho tem alteração não publicada; se `publish` recusar com
`INVALID_STATE` ("sem alteração não publicada"), `activate` religa a revisão já
publicada, sem criar versão. `unpublish` é o "desligar" (Fora do ar).

| Ferramenta | Entrada | Risco |
| --- | --- | --- |
| `kastir_pages_create` | título, slug opcional, conteúdo opcional (vazio/omitido → seed do template; resposta com `usedStarterTemplate: true` + frase no `summary`), `folderId`, SEO | escrita |
| `kastir_pages_update` | `id`, campos parciais, `expectedContentSha256?` (vence), `expectedUpdatedAt?` | escrita draft-only; nunca publica; devolve `contentSha256` e `contentBytes` |
| `kastir_pages_patch` | `id`, `expectedContentSha256`, `operations` (1 a 50 de `{old, new}`; `old` não vazio; hash de 64 hexadecimais; resultado até 2 MiB em UTF-8) | escrita draft-only; busca e troca exata, tudo ou nada, só no conteúdo; nunca publica; argumento inválido chega como `VALIDATION_ERROR` "Invalid arguments for tool kastir_pages_patch", sem o campo nem o valor |
| `kastir_pages_duplicate` | `pageId` | escrita |
| `kastir_pages_publish` | `pageId` | publicação do rascunho atual; recusa `INVALID_STATE` quando não há alteração não publicada |
| `kastir_pages_activate` | `pageId` | religa a revisão já publicada (voltar ao ar), sem publicar o rascunho nem criar versão; `INVALID_STATE` se nunca publicada; mesmo escopo de publish |
| `kastir_pages_unpublish` | `pageId` | desativa; mantém `publishedRevisionId` |
| `kastir_pages_trash` | `pageId` | destrutivo reversível |
| `kastir_pages_restore` | `pageId` | escrita (lixeira) |
| `kastir_pages_revisions_list` | `pageId`, paginação | leitura |
| `kastir_pages_revisions_get` | `pageId`, `revisionId`, slice opcional | leitura; `contentTotal` em UTF-16, sem hash |
| `kastir_pages_revisions_diff` | `pageId`, `from`, `to` (`draft` ou id) | leitura; `from=publishedRevisionId` com `to="draft"` confere o rascunho antes de publicar |
| `kastir_pages_revisions_restore` | `pageId`, `revisionId`, `expectedUpdatedAt` | escrita; copia para o rascunho, não publica |
| `kastir_page_folders_create` | nome, `parentId?`, cor | escrita |
| `kastir_page_folders_update` | `id`, `name?`, `color?`, `parentId?` | escrita; nome/cor/movimento na mesma transação |
| `kastir_page_folders_delete` | — | não exposto nesta fase; aguarda exclusão reversível da hierarquia |

`kastir_pages_permanently_delete` não é uma tool exposta no MCP. O painel pode
ter uma operação interna equivalente, mas isso não amplia o contrato remoto.

### Mídias

| Ferramenta | Entrada | Risco |
| --- | --- | --- |
| `kastir_media_update` | `mediaId`, metadados parciais, `expectedUpdatedAt?` | escrita |
| `kastir_media_upload` | `folderId`, filename seguro, base64 padrão até 20 MiB, `alt?`, `description?` | escrita bounded e auditada |
| `kastir_media_replace` | `mediaId`, filename seguro, base64 padrão até 20 MiB, `confirmation: "REPLACE_MEDIA"` | destrutivo; compensável |
| `kastir_media_convert_to_webp` | `mediaId` | operação assíncrona; retornar `operationId` |
| `kastir_media_folders_create` | nome, `parentId?`, cor | escrita |
| `kastir_media_folders_update` | `id`, `name?`, `color?`, `parentId?` | escrita; nome/cor/movimento na mesma transação |
| `kastir_media_folders_delete` | — | não exposto nesta fase; aguarda exclusão reversível da hierarquia |

Delete e bulk delete de mídia não são tools MCP nesta versão. Upload e replace
recusam path arbitrário, filename inseguro, base64 não canônico e payload acima
de 20 MiB; replace exige confirmação antes da decodificação.

### Scripts

Criação e duplicação produzem `DRAFT`; o servidor não executa o conteúdo. A
resposta inclui `data.activationRequired: true` e aponta para
`kastir_scripts_publish`. Fluxo live: `update` → `publish`; se `publish` recusar
com `INVALID_STATE` ("sem alteração não publicada"), `kastir_scripts_activate`
religa a revisão já publicada sem criar versão. Depois de publicado, o
HTML/JavaScript é injetado no documento público e pode ser executado pelo
navegador dos visitantes.

| Ferramenta | Entrada | Risco |
| --- | --- | --- |
| `kastir_scripts_create` | nome, location, conteúdo, prioridade, escopo, `pageIds` (cuids, até 1000, repetidos viram um), `trigger?`, `maxDisplays?`, `displayResetDays?` | alto: injeta HTML/JS; trigger opcional de popup |
| `kastir_scripts_update` | `id`, campos parciais (incl. `trigger: null` para limpar; `pageIds` com o mesmo teto do create), `expectedContentSha256?` (vence), `expectedUpdatedAt?` | escrita draft-only; nunca publica; devolve `contentSha256` e `contentBytes` |
| `kastir_scripts_patch` | `id`, `expectedContentSha256`, `operations` (1 a 50 de `{old, new}`; `old` não vazio; hash de 64 hexadecimais; resultado até 2 MiB em UTF-8) | escrita draft-only; busca e troca exata sobre o código, tudo ou nada, só no conteúdo; nunca publica; argumento inválido chega como `VALIDATION_ERROR` "Invalid arguments for tool kastir_scripts_patch", sem o campo nem o valor |
| `kastir_scripts_duplicate` | `scriptId` | escrita |
| `kastir_scripts_trash` | `scriptId` | destrutivo reversível; sem hard delete |
| `kastir_scripts_publish` | `scriptId`, `confirmation: "PUBLISH_SCRIPT"` | alto: implanta o rascunho e recompila páginas afetadas; recusa `INVALID_STATE` quando não há alteração não publicada |
| `kastir_scripts_activate` | `scriptId`, `confirmation: "PUBLISH_SCRIPT"` | alto: recoloca no ar a revisão já publicada (sem publicar o rascunho nem criar versão) e recompila páginas afetadas; `INVALID_STATE` se nunca publicado; mesmo escopo de publish |
| `kastir_scripts_unpublish` | `scriptId`, `confirmation: "UNPUBLISH_SCRIPT"` | desativa; mantém `publishedRevisionId` |
| `kastir_scripts_revisions_list` | `scriptId`, paginação | leitura |
| `kastir_scripts_revisions_get` | `scriptId`, `revisionId`, slice opcional | leitura; `contentTotal` em UTF-16, sem hash |
| `kastir_scripts_revisions_diff` | `scriptId`, `from`, `to` (`draft` ou id) | leitura; `from=publishedRevisionId` com `to="draft"` confere o rascunho antes de publicar |
| `kastir_scripts_revisions_restore` | `scriptId`, `revisionId`, `expectedUpdatedAt` | escrita; copia para o rascunho, não publica |

O serviço atual valida tamanho e formação dos tags HTML, mas isso não equivale
a uma análise de segurança de JavaScript. O MCP exige escopo
`scripts:write`/`scripts:publish` e confirmação literal validada no servidor
para publish/activate (`PUBLISH_SCRIPT`) e unpublish (`UNPUBLISH_SCRIPT`). Soft-delete é exposto por `kastir_scripts_trash`;
exclusão permanente e purge/delete de revisão não estão expostos no MCP.

### Split tests

Criação começa `PAUSED` e não liga o redirect. A resposta inclui
`data.activationRequired: true`; para ativar, use `kastir_split_tests_update`
com `status: ACTIVE` depois de revisar os destinos.

| Ferramenta | Entrada | Risco |
| --- | --- | --- |
| `kastir_split_tests_create` | nome, slug opcional e pelo menos um destino | escrita |
| `kastir_split_tests_update` | `campaignId`, nome/slug/status | escrita |
| `kastir_split_tests_destinations_create` | `campaignId`, URL e label | altera redirecionamento |
| `kastir_split_tests_destinations_update` | IDs, URL/label/status/order | altera redirecionamento |
| `kastir_split_tests_destinations_reorder` | `campaignId`, todos os IDs na nova ordem | altera distribuição |
| `kastir_split_tests_trash` | `campaignId` | destrutivo reversível; sem hard delete |

Campanhas podem ir para a lixeira por `kastir_split_tests_trash`. Hard delete e
exclusão individual de destino não estão expostos no MCP.

Validar sempre `javascript:`, `data:`, `vbscript:`, URLs protocol-relative e
paths inválidos. A regra de manter ao menos um destino ativo deve continuar no
serviço de domínio, não no prompt do agente.

## Permissões e confirmação

O token MCP deve carregar o ator real (ID, role e scopes); nunca aceitar
`userId`, `authorId` ou `role` nos argumentos da ferramenta.
Scope concedido não substitui papel: descoberta e runtime exigem que ambos
autorizem o domínio, evitando elevação por token com scopes forjados.

Escopos sugeridos:

```text
cms:read
cms:pages:write
cms:pages:publish      # também autoriza kastir_pages_activate
cms:media:write
cms:scripts:write
cms:scripts:publish    # também autoriza kastir_scripts_activate
cms:split-tests:write
cms:settings:write
cms:logs:read
```

Mapeamento inicial de roles, coerente com `MENU_ITEMS`:

| Domínio | Leitura | Escrita/publicação | Exclusões irreversíveis |
| --- | --- | --- | --- |
| pages, media, scripts, split tests | Editor/Admin/Master | exigir scope específico; o runtime confere role/escopo | não expostas no MCP nesta fase |
| settings, logs | Admin/Master | Admin/Master | não expostas no MCP nesta fase |

Denylist do contrato: `kastir_pages_permanently_delete`,
`kastir_scripts_delete`, `kastir_page_folders_delete`,
`kastir_media_folders_delete`, `kastir_media_delete`,
`kastir_media_bulk_delete`, `kastir_split_tests_delete` e
`kastir_split_tests_destinations_delete` nunca aparecem em `tools/list`.

Ferramentas destrutivas devem:

- ter `destructiveHint: true` e nunca ficar escondidas dentro de uma
  ferramenta genérica de update;
- exigir literal de confirmação definido no contrato;
- informar no retorno o ID, o efeito e os artefatos afetados;
- registrar auditoria com o ator MCP.

## Operações assíncronas

Conversão de mídia e rebuilds usam BullMQ no código atual.
O MCP deve normalizar o retorno:

```ts
type OperationRef = {
  operationId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  resourceId?: string;
};
```

Não expor diretamente o objeto ou payload do BullMQ. `kastir_operation_get`
acompanha somente operações MCP que retornam `operationId`, hoje conversão
WebP e rebuild de settings.

## Recursos MCP e URI

Listagens devem continuar sendo ferramentas, pois aceitam filtros dinâmicos.
Recursos MCP podem oferecer detalhes estáveis para navegação:

```text
kastir://site/context
kastir://pages/{pageId}
kastir://media/{mediaId}
kastir://scripts/{scriptId}
kastir://split-tests/{campaignId}
kastir://operations/{operationId}
```

O recurso de mídia binária deve usar URI temporária e expiração. Não tornar
`public/uploads` nem diretório de backup uma fonte MCP anônima.

## Ordem recomendada de implementação

### V1 — leitura segura

1. autenticação do servidor e `cms:read`;
2. serializers sem segredos;
3. `pages_list/get`, `media_list/get`, `scripts_list/get` e
   `split_tests_list/get`;
4. pastas e `site_get_context`;
5. paginação, filtros, erros e testes de contrato.

### V1.1 — ações reversíveis

1. criar/editar páginas e metadados de mídia;
2. criar/editar scripts sem publicação automática;
3. criar/editar campanhas e destinos;
4. `expectedUpdatedAt` e auditoria do ator MCP.

### V2 — publicação e operações sensíveis

1. publish/activate/unpublish e rebuild observável;
2. conversão de mídia já exposta; upload/replace permanecem fora até contrato
   próprio e validação de segurança;
3. lixeira, exclusões e confirmações tipadas somente após serem expostas
   explicitamente;
4. settings e logs, com scopes administrativos (backup/migração ficou fora
   do escopo deste MCP).

## Pontos a resolver antes do código

- Definir o transporte: stdio local ou Streamable HTTP autenticado; não misturar
  credenciais de sessão do navegador com token de serviço MCP.
- Adicionar paginação real a pages/media, preferencialmente no serviço de
  domínio, sem quebrar os consumidores atuais.
- Criar consulta para `SplitRedirectDailyStat` antes de prometer histórico de
  split tests; documentar timezone e intervalo inclusivo.
- Definir limite total de bytes e mecanismo de upload para `sourceUri`.
- Scripts live exigem confirmação server-side; os literais estão definidos no
  catálogo e no schema MCP.
- Adicionar testes de autorização, vazamento de campos (`processingToken`,
  token Cloudflare, hashes/sessões) e concorrência.

## Fontes do mapeamento

- `AGENTS.md`
- `lib/Modules/Pages/Service.ts`, `FolderService.ts`, `Types.ts`
- `lib/Modules/Media/Service.ts`, `FolderService.ts`, `Types.ts`
- `lib/Modules/CustomCode/Service.ts`, `Types.ts`
- `lib/Modules/SplitTests/Service.ts`, `Types.ts`, `Aggregation.ts`
- `prisma/schema/Pages.prisma`, `Media.prisma`, `CustomCode.prisma`,
  `SplitTests.prisma`, `Settings.prisma`
- `lib/Modules/Panel/Permissions.ts`
