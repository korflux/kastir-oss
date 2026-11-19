# Revisões

Snapshots imutáveis e completos de Pages e Custom Code. A política mora em
`lib/Modules/Revisions/`; cada recurso adapta os próprios campos.

## Modelo

- `PageRevision` e `SnippetRevision` são tabelas concretas, com FK para o
  recurso e para o autor. Não há tipo polimórfico na entrada.
- O registro atual de `Page`/`Snippet` continua sendo o rascunho.
  `publishedRevisionId` aponta o snapshot que está no ar.
- Cada snapshot cobre os campos editáveis. Save só atualiza o rascunho e
  não cria revisão. Restore copia uma revisão para o rascunho e também não
  fotografa o draft substituído. O HTTP de publish lê só o rascunho
  gravado; no painel, quem publica com edição não salva salva antes.
- Publish materializa o rascunho atual (cria ou reusa revisão), aponta o
  ponteiro e só então compila esse snapshot. Sem alteração após a primeira
  publicação, Publish é recusado com `INVALID_STATE` ("… has no
  unpublished changes") antes de qualquer efeito. Activate religa a
  revisão apontada (recompila o ponteiro, sem criar revisão) e recusa
  recurso nunca publicado. Publish com rascunho diferente num recurso fora
  do ar também o põe no ar e sinaliza `activatedDuringPublish`; o painel
  não exibe mais aviso para isso.
- O "ligar" do painel e do MCP combina os dois: publish primeiro e, só na
  recusa "sem alteração", activate. Assim vai ao ar o rascunho, ou a
  revisão igual a ele no instante da recusa (janela entre recusa e
  activate registrada como `ponytail` em `turnOn`). Regra de UI em
  [`PAGES.md` › Switch No ar / Fora do ar](./PAGES.md#switch-no-ar--fora-do-ar).
- A revisão publicada nunca é removida. A janela normal é a configuração
  global 5–30 (padrão 5) em Configurações; até 3 revisões podem ser
  fixadas por recurso.
- `fingerprint` (`draftFingerprint` no rascunho, visto pelo painel) é o SHA-256
  do snapshot inteiro: em páginas, título, slug, conteúdo, SEO e pasta; em
  scripts, os campos do snippet. Deduplica revisões idênticas e alimenta os
  selos do painel. Não é o hash do conteúdo: o hash do conteúdo
  (`contentSha256`, SHA-256 dos bytes UTF-8 do conteúdo) é um campo à parte,
  calculado na hora pelas leituras e gravações do MCP, sem coluna nem
  migration. A fórmula do `fingerprint` não mudou.
- A versão esperada do save é a guarda comum `createRevisionLifecycleGuards`
  (`lib/Modules/Revisions/lifecycle.ts`), usada por Páginas e Scripts:
  `expectedContentSha256`, quando enviado, é a única versão conferida e
  `expectedUpdatedAt` é ignorado (publish, activate e unpublish mudam
  `updatedAt` sem mudar o conteúdo); sem ele vale `expectedUpdatedAt`. A
  divergência é `CONFLICT` "… was updated by another request", com o hash
  atual na mensagem quando a conferência é por hash. Restore continua
  exigindo `expectedUpdatedAt`.

## Leitura pública

Compile, rebuild, reconcile e artefatos públicos usam só o snapshot
apontado por `publishedRevisionId`, inclusive o slug. Sem ponteiro válido
não há fallback para o rascunho. Preview privado lê o rascunho; só
redireciona à URL pública quando o rascunho é idêntico à revisão
publicada.

**Ordem disco → banco (decisão, não regra):** Publish/Ativar/Desativar
escrevem ou removem o HTML e só então commitam o ponteiro. Falha lançada
desfaz o disco (`restoreFile`). Crash de processo no meio deixa arquivo e
ponteiro divergentes até o reconcile do boot. Aceito em 2026-08-13 (review
R13). Não é débito a zerar. Reabrir só com evidência; upgrade mínimo:
arquivo `.tmp` + `rename` depois do commit.

## Deploy e rollback

As migrações `add_revision_retention_limit` e
`add_page_and_snippet_revisions` são aditivas. Rollback operacional:
restaurar o backup `.kastir` tirado antes do deploy (o pacote recria só
as revisões live e os ponteiros). Não há passo de produção nesta fase —
release fica para um envio posterior aprovado. Instalações existentes
recebem retenção 5; mudar o limite em Configurações só vale no próximo
job `expire-revision-history`.

## Consultas

List/Get/Diff administrativos ficam em
`/api/admin/pages/:id/revisions` e
`/api/admin/custom-code/:id/revisions`. IDs são conferidos pelo recurso;
diff compara revisão↔rascunho ou revisão↔revisão com `-`/`+` e
word-level só em linhas adjacentes pareadas. O diff compara só o conteúdo,
linha a linha e sem hunks; o `\r` de um CRLF fica no texto da linha. No MCP,
`to="draft"` compara com o rascunho atual.

Restore e pin/unpin ficam em
`/api/admin/pages/:id/revisions/:revisionId/{restore,pin}` e o equivalente
de Custom Code. Restore exige `expectedUpdatedAt` e nunca publica. Pin aceita no máximo
3 revisões por recurso.

## Painel

O histórico compartilhado mora em `lib/Modules/Revisions/Components/`
(`RevisionHistoryPanel`, `RevisionCompareBar`, `RevisionDiffPane`,
`revisionFieldChanges.ts`, `useRevisionHistory`). O cabeçalho dos
editores (switch, botão principal, menu ⋯) está em
[`PAGES.md` › Editor de Página](./PAGES.md#editor-de-página).

**Bloco Versões.** Fica no Details (depois da SEO description nas
páginas; depois do último campo nos scripts). A linha **Rascunho** vem
no topo, com um de quatro selos (`draftRowState`): "não salvo" (edição
na tela), "não publicado" (salvo e diferente da versão publicada, ou
nunca publicado), "igual ao ar" (item no ar com rascunho igual à versão
publicada) ou "igual à publicada" (item fora do ar com rascunho igual à
versão publicada guardada). Depois, as versões da mais nova para a mais antiga,
em linhas-botão com data e hora, autor e código curto (prefixo de 7 do
`fingerprint`). A versão apontada leva **No ar** com o item no ar e
**Publicada** com o item fora do ar. O alfinete aparece ao passar o
mouse ou focar a linha, fica sempre visível e preenchido na fixada e
anuncia o estado com `aria-pressed`. O cabeçalho mostra
"<total> de <limite> · <fixadas>/3 fixadas"; o rodapé explica a
retenção. O quarto pin mostra "Já há 3 versões fixadas. Desafixe uma
para fixar esta." sem chamar o servidor. Falha ao carregar mostra
alerta com **Tentar de novo**.

**Comparação.** Clicar numa versão troca a área de código por uma
comparação somente leitura (CodeMirror, nome acessível "Código da
versão") na direção **conteúdo do editor
→ versão**: `−` é o que sai do rascunho ao restaurar, `+` é o que volta.
Trechos iguais longos ficam recolhidos e abrem por clique, um a um ou
com **Expandir tudo**. A barra de comparação mostra a direção, a
contagem `+N −N`, a legenda e o bloco "Outros campos que mudam", com
valor atual → valor da versão (ou "Nenhum. Só o código muda."). Campos
de Pages: nome, slug, pasta (por caminho), SEO title, description e
keyword. Campos de Scripts: nome, local, prioridade, escopo, páginas do
escopo (por nome, via filtro `ids` de
`GET /api/admin/custom-code/pages`), gatilho, configuração do gatilho,
máximo de exibições e dias para reiniciar a contagem. Durante a
comparação o formulário mostra "Edição pausada enquanto você compara."
e switch, botão principal e menu ⋯ ficam pausados. **Voltar a editar**
ou clicar em Rascunho volta ao editor com o conteúdo intacto.

**Layout.** Os dois editores montam o Details com props opt-in de
`DetailsPanel` (`components/Shared/DetailsPanel.tsx`): `flowOnMobile`
(abaixo de `lg` o painel cresce com o conteúdo e a seção inteira rola),
`wide` (coluna Details de até 20rem, para data e selo caberem na mesma
linha do bloco Versões) e `detailsNotice` (aviso fixo fora da rolagem,
usado pela nota "Edição pausada enquanto você compara.").

**Restaurar.** **Restaurar esta versão no rascunho** fica desabilitado,
com o motivo ao lado, quando há edição não salva ou a versão é idêntica
ao rascunho. A confirmação mostra data e autor, "Nada é publicado.", as
linhas `+N / −N`, os campos que mudam e, se o rascunho tiver alterações
salvas não publicadas, o aviso de que serão substituídas. Confirmado, o
rascunho recebe a versão, nada é publicado e um aviso oferece
**Desfazer**. Com o item no ar, o resultado fica como alteração salva
não publicada até o próximo **Salvar e publicar**.

**Desfazer** existe só na mesma tela, enquanto o aviso está visível:
regrava o rascunho anterior pelo salvar normal, com o `updatedAt`
devolvido pelo restore, sem publicar. `CONFLICT` (outra sessão mexeu)
não sobrescreve nada. Recarregar a página encerra a chance de desfazer;
desfazer persistente exigiria migration e ficou fora.

O job diário `expire-revision-history` aplica o limite global vigente.
Recursos publicados sem ponteiro recebem snapshot inicial no reconcile
de boot. O pacote de backup exporta só as revisões live.

## MCP

`kastir_pages_update` e `kastir_scripts_update` gravam só o rascunho.
O MCP reproduz o switch do painel:

| Quando | Tool |
|---|---|
| Alterar um trecho do rascunho sem reenviar o conteúdo | `kastir_pages_patch` / `kastir_scripts_patch` (busca e troca exata com `expectedContentSha256`; grava só o rascunho, não cria revisão nem publica) |
| Conferir o rascunho antes de publicar | `kastir_pages_revisions_diff` / `kastir_scripts_revisions_diff` com `from=publishedRevisionId` (do get) e `to="draft"` |
| Há alteração não publicada, ou o item nunca foi publicado | `kastir_pages_publish` / `kastir_scripts_publish` (cria revisão) |
| Publish recusou com `INVALID_STATE` sem alteração e o item está fora do ar | `kastir_pages_activate` / `kastir_scripts_activate` (religa a revisão publicada, sem criar revisão; recusa item nunca publicado) |
| Tirar do ar | `kastir_pages_unpublish` / `kastir_scripts_unpublish` (sem zerar o ponteiro) |

Activate usa o mesmo serviço e o mesmo escopo de publish; em scripts,
exige `PUBLISH_SCRIPT`. Histórico:
`kastir_{pages,scripts}_revisions_{list,get,diff,restore}`. Restore
exige `expectedUpdatedAt` e nunca publica. Não há pin, purge nem delete
de revisão no MCP.

As leituras de revisão (`kastir_{pages,scripts}_revisions_get`) e o
`kastir_pages_preview` devolvem `contentTotal` em unidades UTF-16 (CRLF conta 2,
caractere fora do BMP conta 2) e não expõem `contentSha256` nem
`contentBytes`: revisão é histórico imutável e o preview é o HTML compilado, não
o rascunho. Hash e bytes vêm de `kastir_pages_get`, `kastir_scripts_get`, update
e patch.

Limites de entrada do patch (`kastir_pages_patch` e `kastir_scripts_patch`):
de 1 a 50 operações `{old, new}`, `old` não vazio, `expectedContentSha256`
obrigatório com 64 hexadecimais, resultado até 2 MiB em UTF-8. Argumento
inválido é recusado antes do handler e chega pela rota `/api/mcp` como
`VALIDATION_ERROR` "Invalid arguments for tool <tool>", sem o campo nem o valor;
`old` ausente ou repetido é `VALIDATION_ERROR` com o índice da operação e a
contagem encontrada. Todas as recusas deixam rascunho, `updatedAt` e revisões
como estavam. Erros completos em
[`mcp-cms-catalogo.md`](../mcp-cms-catalogo.md#edição-parcial-e-hash-de-conteúdo).
