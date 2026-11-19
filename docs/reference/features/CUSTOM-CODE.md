# Função Secundária — Scripts (Código Customizado)

> Voltar ao [índice da documentação](../README.md) · Ver também [`PAGES.md`](./PAGES.md) (pipeline de publicação) · Menu "Scripts" em [`PANEL.md`](./PANEL.md)

## O que é

Referência: o recurso **"Custom Code" do Elementor Pro** — uma lista de *snippets* de código, cada um podendo misturar HTML/CSS/JS livremente, aplicados a **todas as páginas publicadas do site ou só a páginas específicas** (Display Conditions, ver seção própria abaixo). Exemplos de uso: um consent banner em todo o site, o script do GTM, um pixel de conversão só numa landing, ou qualquer script personalizado do time.

Diferente da versão anterior deste documento (que tinha só 3 campos fixos), agora é uma **lista de snippets independentes** — cada um escolhe seu próprio ponto de injeção.

## Estrutura de um Snippet

| Campo | Observação |
|---|---|
| **Nome** | Identifica o snippet na listagem (ex: "Consent Banner", "GTM") |
| **Local de Injeção** | Header, Body Início ou Body Fim — escolha única por snippet (ver tabela abaixo) |
| **Conteúdo** | Blob único de HTML/CSS/JS misturado — mesmo padrão de conteúdo usado em [`PAGES.md`](./PAGES.md). **Limite de 2MB** em bytes UTF-8 (`contentBytes`), igual página |
| **Estado** | No ar ou Fora do ar (ver Estados abaixo) |
| **Prioridade** | Número (1, 2, 3...) definindo a ordem de concatenação quando há mais de um snippet no mesmo Local de Injeção — menor número entra primeiro. Campo opcional (ver regra de desempate abaixo) |
| **Escopo** | "Todas as páginas" (padrão) ou "Páginas específicas" — ver seção Escopo por Página abaixo |

Não existe sistema de pastas aqui — é uma lista simples, sem necessidade de organização hierárquica.

## Papéis e threat model

Os três papéis do painel (Master, Administrador, Editor) **criam, editam e
publicam** scripts. Só a exclusão permanente na lixeira fica restrita a
Master/Administrador (paridade com Páginas).

Isso é deliberado: Editor opera o dia a dia do site, e Scripts é o canal
oficial de HTML/CSS/JS no HTML publicado. Publicar um snippet **é** injetar
código no site público — o mesmo poder de um stored XSS para todos os
visitantes, também via MCP (`cms:scripts:*`). Não é um buraco de autorização;
é o contrato do papel. Mudar isso (por exemplo, Editor só em rascunho)
exige decisão de produto, não um "fix" de refactor.

## Pontos de Injeção

| Local | Onde entra no HTML final | Uso típico |
|---|---|---|
| **Header** | Dentro de `<head>` | Tag padrão do GTM, meta tags globais, verificação de domínio |
| **Body Início** | Logo após a abertura de `<body>` | `<noscript>` do GTM, consent banner, pixels que precisam carregar cedo |
| **Body Fim** | Logo antes do fechamento de `</body>` | Scripts de analytics/chat que não precisam bloquear o carregamento inicial |

Múltiplos snippets podem apontar para o **mesmo** local de injeção (ex: GTM e um consent banner, ambos em Body Início) — todos os snippets **no ar** daquele local são concatenados no HTML final, na ordem definida pelo campo **Prioridade**.

### Ordem de concatenação e desempate

- Snippets no mesmo Local de Injeção são concatenados em ordem **crescente de Prioridade** (1 antes de 2, antes de 3...).
- Se a Prioridade não for definida, ou houver **conflito** (dois snippets com a mesma prioridade, ou nenhuma definida), o desempate é por **data de criação** — o que foi criado primeiro entra antes. Isso evita qualquer estado inconsistente mesmo se ninguém definir prioridade manualmente.

## Listagem de Scripts

| Coluna | Conteúdo |
|---|---|
| Nome | Nome do snippet |
| Local de Injeção | Header / Body Início / Body Fim |
| Prioridade | Número definido (ou "—" se não definido, com desempate por data de criação) |
| Escopo | "Todas as páginas" ou "N páginas específicas" |
| Estado | Switch **No ar** / **Fora do ar** / **Fora do ar · nunca publicado** direto na linha (ver Estados abaixo) |
| Última atualização | Data da última edição |

Ações rápidas: **Editar**, **Duplicar** (copia conteúdo, local de injeção, prioridade e escopo, com sufixo `-copia` no nome, sempre como Rascunho — mesmo padrão de [`PAGES.md`](./PAGES.md)), **Excluir**.

## Estados: No ar e Fora do ar

O editor e a listagem de scripts seguem o modelo do switch descrito em
[`PAGES.md` › Switch No ar / Fora do ar](./PAGES.md#switch-no-ar--fora-do-ar),
com o mesmo cabeçalho (`EditorHeader`: switch, botão **Salvar** /
**Salvar e publicar**, indicador Não salvo, faixa de alterações salvas e
menu ⋯). Diferenças de Scripts:

- Um snippet fora do ar não é incluído no HTML compilado de nenhuma página.
- O menu ⋯ não tem **Pré-visualizar** (script não tem página própria); só
  **Salvar sem publicar**, com o script no ar e edição não salva.
- Scripts são criados pela listagem, então o editor não tem o estado
  **Criar**. Criar ou duplicar deixa o script fora do ar, sem prompt de
  ativação.
- Desligar o switch pede a confirmação "Tirar do ar? O script deixa de ser
  injetado no site. O rascunho e as versões ficam.".
- Ligar ou desligar dispara o rebuild em massa abaixo.

**MCP (paridade):** `kastir_scripts_create` e `kastir_scripts_duplicate`
retornam `data.activationRequired: true` e o summary aponta para
`kastir_scripts_publish`. `kastir_scripts_update` só grava o rascunho. O
"ligar" do painel é `kastir_scripts_publish` quando há alteração não
publicada; na recusa `INVALID_STATE` sem alteração,
`kastir_scripts_activate` religa a versão publicada sem criar versão (exige
`PUBLISH_SCRIPT` e recusa script nunca publicado). Desligar é
`kastir_scripts_unpublish`. Histórico: `kastir_scripts_revisions_*`.

## Salvar o rascunho: versão esperada, trava e edição parcial

Mesmas regras de [`PAGES.md` › Salvar o rascunho](./PAGES.md#salvar-o-rascunho-versão-esperada-trava-e-edição-parcial),
aplicadas ao snippet. A guarda de versão é comum a Páginas e Scripts
(`lib/Modules/Revisions/lifecycle.ts`) e o save está em
`lib/Modules/CustomCode/lifecycle.ts`. Pontos próprios de Scripts:

- **Versão esperada.** O painel envia `expectedUpdatedAt`; o MCP pode enviar
  `expectedContentSha256` (SHA-256 dos bytes UTF-8 do código, 64 hexadecimais),
  que, quando presente, vence e faz `expectedUpdatedAt` ser ignorado. Divergência
  é `CONFLICT` "Script was updated by another request", com o hash atual na
  mensagem quando a conferência é por hash.
- **Trava de linha.** O save trava a linha do snippet (`SELECT ... FOR UPDATE`) e
  monta o snapshot (nome, local, prioridade, escopo, páginas e gatilho) a partir
  da linha lida depois da trava, não do registro carregado antes dela. Assim um
  save conferido só pelo hash do conteúdo não regrava nome, escopo ou gatilho
  antigos sobre uma alteração concorrente desses campos. O save sem nenhuma
  mudança termina sem escrita, dentro da transação travada.
- **Edição parcial (MCP).** `kastir_scripts_patch` troca trechos do código do
  rascunho: de 1 a 50 operações `{old, new}`, `old` não vazio e com exatamente
  uma ocorrência, em sequência e tudo ou nada, com `expectedContentSha256`
  obrigatório e resultado até 2 MiB em UTF-8. Altera só o conteúdo; nome, local,
  escopo e gatilho seguem pelo update, e o patch nunca publica. Argumento inválido
  chega como `VALIDATION_ERROR` "Invalid arguments for tool kastir_scripts_patch",
  sem o campo nem o valor.
- **Hash e tamanhos.** `kastir_scripts_get`, update e patch devolvem
  `contentSha256` e `contentBytes` do conteúdo inteiro; `contentTotal` é em
  unidades UTF-16 (CRLF conta 2, caractere fora do BMP conta 2), inclusive em
  `kastir_scripts_revisions_get`, que não expõe hash.
- **`draftFingerprint`** é o SHA-256 do snapshot do snippet (campos acima), não do
  conteúdo; o MCP não o expõe e ele não serve para conferir o código gravado.
- **Conferir antes de publicar.** `kastir_scripts_revisions_diff` com
  `from=publishedRevisionId` (de `kastir_scripts_get`) e `to="draft"` mostra a
  mudança do código contra a revisão publicada.

Detalhes e erros em
[`mcp-cms-catalogo.md`](../mcp-cms-catalogo.md#edição-parcial-e-hash-de-conteúdo).

## Escopo por Página (Display Conditions)

Cada snippet define onde se aplica:

| Escopo | Comportamento |
|---|---|
| **Todas as páginas** (padrão) | Injetado em toda página publicada, no Local de Injeção escolhido |
| **Páginas específicas** | Um seletor de busca/múltipla escolha entre as páginas existentes define exatamente onde o snippet entra — útil para um pixel de conversão que só faz sentido numa landing específica, por exemplo |

Referência: o mesmo conceito de "Display Conditions" do Elementor Pro.

O seletor e a comparação de versões leem as páginas por
`GET /api/admin/custom-code/pages`, no DTO `{ id, title, slug }` e no shape
`{ items, total, page, pageSize }`. Dois usos, validados na borda por
`listScopePagesQuerySchema` (`lib/Modules/CustomCode/Schema.ts`):

- busca paginada: `q` (até 200 caracteres), `page` e `pageSize` (até 100);
- resolução por id: `ids=a,b,c`, cuids validados como o bulk (até
  `BULK_IDS_MAX`). Com `ids`, `q`/`page`/`pageSize` são ignorados. Serve para
  nomear páginas já selecionadas fora da lista carregada e as páginas do
  escopo na comparação. Página na lixeira não volta; o cliente mostra um
  fallback legível.

O total da busca paginada vem sempre de `page.count` (o `CustomCodeService`
não tem caminho alternativo sem essa contagem).

### Validação do escopo ao salvar (`pageIds`)

Criar e editar um script (painel `POST/PUT /api/admin/custom-code…` e tools
MCP `kastir_scripts_create`/`kastir_scripts_update`) validam `pageIds` na
borda, pelo mesmo schema (`pageIdsSchema` em `lib/Modules/CustomCode/Schema.ts`):

- cada item é um `cuid` (formato do `Page.id`) aparado;
- de 0 a **1000** itens, teto na constante `SCOPE_PAGE_IDS_MAX`; o limite vale
  para o payload bruto, antes do dedupe;
- ids repetidos viram uma ocorrência (mesma regra do bulk, `normalizeBulkIds`).

Fora disso a recusa é `VALIDATION_ERROR` (HTTP 400 no painel) com mensagem
fixa e segura, `Invalid script page scope: pageIds must contain at most 1000
valid page ids`, que não ecoa o payload e tem prioridade sobre o erro
genérico "Invalid snippet data". A validação roda antes de qualquer consulta ao
banco e vale também com `scopeType: ALL_PAGES`. Nas tools MCP o SDK recusa o
argumento antes do handler (o `maxItems` aparece no `tools/list`), então a
mensagem específica só existe no caminho do painel. Escopos já gravados com mais
de 1000 páginas não mudam até a próxima edição.

O seletor de escopo do painel não limita a seleção: acima de 1000 páginas a
recusa só acontece ao salvar (limitação registrada com `ponytail` em
`Schema.ts`).

## Rebuild em Massa — fila assíncrona

- Qualquer mudança de estado (publicar ou despublicar um snippet) dispara **rebuild automático**, recompilando **apenas as páginas afetadas pelo escopo daquele snippet**:
  - Escopo "Todas as páginas" → rebuild de **todas** as páginas publicadas.
  - Escopo "Páginas específicas" → rebuild só das páginas selecionadas — mais rápido, sem tocar no resto do site.
- O rebuild roda em **fila assíncrona em background** (worker sobre Redis, já presente na stack) — sem travar a tela do Administrador.
- Cada página processada regrava seu arquivo `.html` estático, seguindo o mesmo pipeline de publicação de `PAGES.md`.
- Mudar o **Escopo** de um snippet já publicado (ex: de "Todas as páginas" para "3 páginas específicas") também dispara rebuild — nesse caso, cobrindo a **união** do escopo antigo e do novo, para garantir que páginas removidas do escopo sejam recompiladas sem o snippet.

## Starter de script e popup (fases 36–37)

HTML canônico em `lib/Modules/CustomCode/newScriptTemplate.ts` (EN + PT-BR),
espelhando o de página:

| Variante | Função | Uso |
| --- | --- | --- |
| Base | `getNewScriptTemplate(language)` | Painel ao criar snippet (comentários dos 4 gatilhos); MCP `starters.scriptTemplate.content` com `includeScriptTemplate` |
| Popup | `getNewScriptTemplate(language, { popup: true })` | MCP `starters.scriptTemplate.popupContent` (mesma flag). O agente cola em `scripts_create.content` quando há `trigger`. **Não** é auto-semeado |

**Parceria com o runtime:** o compile envolve o snippet em
`<div data-kastir-trigger="…" style="display:none">`
(`lib/Publishing/compile.ts`). Ao disparar, `public-scripts/popup-triggers.ts`
só faz `wrapper.style.display = ""` — **não fecha**. Fechar é HTML do autor;
o starter de popup entrega o padrão acessível. O starter **não** recria o
wrapper `data-kastir-trigger`. O script do starter só foca/ESC quando o
wrapper fica visível (`MutationObserver`) — não no load da página.

O editor **não** abre bloco de ajuda ao escolher um gatilho — só os
campos do tipo. Como usar os quatro gatilhos (`SELECTOR_EVENT`,
`PAGE_LOAD`, `SCROLL`, `REFERRER`) está no starter de script novo.

Regras práticas (retornadas por `kastir_guide_get` no tópico `popups`):

- Preferir `SPECIFIC_PAGES` em popup (não `ALL_PAGES`).
- Usar `maxDisplays` em popup interruptivo.
- Não colocar dois `PAGE_LOAD` na mesma página.
- Sempre incluir UI de fechar se houver `trigger` (use `popupContent`).

O starter também prende `Tab`/`Shift+Tab` no overlay, gera um id de título
único por instância e avisa que, sem `trigger`, abre em toda página do escopo.
Essa mudança só afeta novos starters: popup HTML já publicado pertence ao
autor e não é reescrito.

## Validação Antes de Publicar

**Sim, uma validação simples** (não um linter completo) — checagem básica como tags `<script>`/`<style>` balanceadas e HTML minimamente bem-formado. Se falhar, a publicação é bloqueada com uma mensagem de erro, evitando quebrar todas as páginas do site de uma vez por um erro de sintaxe.

## Permissões

**Administrador (Master ou não) e Editor** criam, editam e publicam Scripts livremente — é uma das telas onde o Editor tem praticamente as mesmas permissões de um Administrador (ver tabela completa de papéis em [`USERS.md`](./USERS.md)).

## Registro em Logs

Publicar/despublicar um snippet gera **um único registro** em [`LOGS.md`](./LOGS.md) (ex: "Fulano publicou o snippet 'Consent Banner'") — o rebuild em massa que isso dispara **não** gera um registro por página recompilada, só o evento de origem.

## Página Excluída do Escopo — desativação automática

Se uma página que fazia parte do escopo "Páginas específicas" de um snippet é **movida para a Lixeira ou excluída permanentemente**, e isso deixa o snippet sem nenhuma página válida no escopo, o Kastir **desativa o snippet automaticamente** (volta para Rascunho) e gera um aviso na [Central de Notificações](./NOTIFICATIONS.md) para **Master e Administradores** (não para Editors) — a primeira das notificações automáticas do sistema. Na Lixeira o soft delete **não** dispara `ON DELETE CASCADE` sozinho: o sistema remove explicitamente a entrada de escopo (ou considera a página inválida) e só então checa se o escopo ficou vazio.

## Decisões Fechadas

- ✅ Prioridade numérica (1, 2, 3...) para ordem de concatenação; desempate por data de criação (mais antigo primeiro) quando não definida ou conflitante.
- ✅ Limite de 2MB por snippet, igual página.
- ✅ Switch No ar / Fora do ar direto na listagem, sem precisar abrir o editor, com a mesma regra de ligar do editor. Mesmo comportamento adotado em `PAGES.md`.
- ✅ Escopo por página (Display Conditions): snippet pode se aplicar a "Todas as páginas" ou a um conjunto de "Páginas específicas".
- ✅ Excluir uma página do escopo de um snippet, esvaziando-o, desativa o snippet automaticamente e notifica o Administrador (ver `NOTIFICATIONS.md`).
- ✅ A listagem de páginas (`PAGES.md`) mostra quando há scripts ativos naquela página.

## Perguntas em Aberto

*(nenhuma pendência no momento)*
