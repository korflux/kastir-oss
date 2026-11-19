# Função Principal — Páginas

> Voltar ao [índice da documentação](../README.md) · Stack técnica em [`STACK.md`](../../STACK.md)

## O que é

A função central do Kastir: permitir que qualquer pessoa do time suba uma página inteira (feita via IA, em HTML/CSS/JS pronto) através de um formulário simples de colar/upload — sem depender de deploy, sem tocar em código, e sem que o CMS influencie a performance da página final.

Referência de conteúdo: o fluxo que o time já usa hoje em WordPress + Elementor — um widget de HTML onde entra tudo junto (HTML, CSS e JS misturados num bloco só).

## Formato de Conteúdo

- Cada página é armazenada como **um blob único de HTML** (CSS e JS inline dentro do próprio HTML). Um campo de conteúdo por página, sem separação estrutural entre HTML/CSS/JS.
- O Postgres é a **fonte da verdade** do conteúdo.
- **Limite máximo de 2MB de HTML por página**, medido em bytes UTF-8 (`contentBytes`; `contentTotal` conta unidades UTF-16 e não serve para o limite). Salvamento é bloqueado acima do limite, com aviso para usar a Biblioteca de Mídia (ver [`MEDIA.md`](./MEDIA.md)) em vez de colar imagens em base64 direto no HTML.
- O conteúdo é gravado exatamente como chega: sem trim, sem normalizar CRLF nem Unicode e sem sanitizar. Por isso o hash do conteúdo gravado (`contentSha256`) corresponde byte a byte ao que o autor enviou. Versão esperada, trava e edição parcial estão em [Salvar o rascunho](#salvar-o-rascunho-versão-esperada-trava-e-edição-parcial).
- **Revisões** — snapshots completos e imutáveis em `PageRevision`, com ponteiro `publishedRevisionId` para o que está no ar. Salvar só grava o rascunho; uma versão nasce só ao publicar. No painel, publicar é ligar o switch **No ar / Fora do ar** ou clicar **Salvar e publicar** (ver [Switch No ar / Fora do ar](#switch-no-ar--fora-do-ar)). Modelo e histórico em [`REVISIONS.md`](./REVISIONS.md).

## Organização em Pastas

Um menu de Pastas separado dentro da tela de Páginas (ver navegação geral em [`PANEL.md`](./PANEL.md)):

- Existe uma pasta obrigatória chamada **"Base"** — toda página que não tiver uma pasta definida cai automaticamente nela. Ela não pode ser excluída (é o "sem categoria" do WordPress).
- É possível criar outras pastas e **subpastas**, com **limite de 3 níveis de aninhamento** (Pasta → Subpasta → Sub-subpasta).
- **Toda pasta, incluindo a Base, pode ter uma cor** — escolhida por **hex livre** ou por uma das **6 cores pré-definidas**:

  | Nome | Hex |
  |---|---|
  | Azul | `#3B82F6` |
  | Verde | `#22C55E` |
  | Amarelo | `#EAB308` |
  | Roxo | `#A855F7` |
  | Laranja | `#F97316` |
  | Rosa | `#EC4899` |

- A tela de Pastas também é onde fica o atalho para **criar uma nova página**.

### Ações sobre Pastas

| Ação | Comportamento |
|---|---|
| **Criar** | Nova pasta ou subpasta (respeitando o limite de 3 níveis). **Master, Administrador e Editor** |
| **Renomear** | Edita o nome de exibição — inclusive a pasta **Base** (rótulo livre; o papel de default fica na flag `isBase`, não na string "Base") |
| **Colorir** | Hex livre ou uma das 6 cores pré-definidas |
| **Excluir** | A pasta é removida; **todas as páginas que estavam dentro dela (e de eventuais subpastas) são movidas para a pasta "Base"** — nenhuma página é excluída no processo, só a pasta em si deixa de existir. A pasta **Base** nunca pode ser excluída. **Master, Administrador e Editor** podem excluir pastas (exceto a Base). Pastas de Páginas são uma árvore **separada** das pastas de Mídia (ver [`STACK.md`](../../STACK.md) e [`MEDIA.md`](./MEDIA.md)) |

> **Tensão com o Design System:** o `DESIGN.md` restringe cor cromática a um único acento (ver documento) — mas cor de pasta é dado funcional do usuário (como labels do GitHub), não decoração de UI. Tratamento proposto: cores de pasta são uma **exceção deliberada e escopada** (só existem dentro dos badges/indicadores de pasta), não uma violação da regra "sem cor cromática" do sistema — o resto do painel continua seguindo o Design System à risca.

## Listagem de Páginas

Dentro de uma pasta, a lista de páginas mostra:

| Coluna | Conteúdo |
|---|---|
| Nome | Título da página + ícone de copiar (apagado) + path (`/` na home, `/{slug}` nas demais). O clique copia a URL pública absoluta; vale também se a página estiver fora do ar. |
| Autor | Quem criou a página |
| Slug | URL da página |
| Pasta | Pasta atual (com a cor correspondente) |
| Data de criação | Data em que a página foi criada |
| Data de publicação | Data da última publicação — **se a página está em Rascunho, mostra apenas "Rascunho"** (sem data) |
| Estado | Switch **No ar** / **Fora do ar** / **Fora do ar · nunca publicada** direto na linha, com a mesma regra do editor sobre o rascunho salvo (ver [Switch No ar / Fora do ar](#switch-no-ar--fora-do-ar)). No mobile mostra rótulo curto, com o nome acessível completo |
| Scripts | Indicador/badge quando a página tem um ou mais [Scripts](./CUSTOM-CODE.md) ativos com escopo específico apontando para ela (ex: "2 scripts ativos") |

Ações rápidas por linha:

- **Editar** — abre o editor de código da página (ver seção abaixo)
- **Duplicar** — cria uma cópia completa da página (conteúdo, SEO, pasta) como **Rascunho**, com o slug original + sufixo `-copia` (ex: `promo-black-friday` → `promo-black-friday-copia`)
- **Ver** — abre a página (publicada, ou preview de rascunho para Admin/Editor — ver estados abaixo)
- **Copiar URL** — ao lado do título, cluster menor com o path; copia `origem + path`
- **Excluir** — move a página para a **Lixeira** (ver seção "Lixeira" abaixo). Não é uma exclusão imediata/definitiva.

## Estados: Rascunho, Publicado e Lixeira

| Estado | Quem vê | Comportamento |
|---|---|---|
| **Rascunho** | Administrador e Editor (preview interno, "como se estivesse no ar") | Visitante público recebe **404** na URL — a página simplesmente não existe publicamente ainda |
| **Publicado** | Todo mundo | Arquivo estático `.html` existe e é servido normalmente |
| **Lixeira** | Ninguém — nem Administrador, nem Editor, nem em preview | Arquivo `.html` (se havia) é removido do disco; conteúdo fica bloqueado até ser restaurado; excluída **permanentemente** após 30 dias |

- **Editor publica direto** — não existe fluxo de aprovação do Administrador (ver [`USERS.md`](./USERS.md) para papéis completos).
- **Tirar do ar** (desligar o switch; despublicar no servidor) remove o arquivo `.html` estático **imediatamente** do disco — a URL cai em 404 na hora, sem arquivo órfão. O rascunho, as versões e o ponteiro da versão publicada ficam.
- O 404 de uma página em rascunho não é um bloqueio ativo — é consequência natural de o arquivo ainda não existir no diretório público (ver arquitetura abaixo).

### Switch No ar / Fora do ar

O switch é o publicar, no editor e na listagem (o mesmo modelo vale para
[Scripts](./CUSTOM-CODE.md)). Rótulos: **No ar**, **Fora do ar** e **Fora do
ar · nunca publicada**. Item nunca publicado também pode ser ligado.

- **Ligar** coloca no ar exatamente o conteúdo do editor (na listagem, o
  rascunho salvo). Com edição não salva, ou em página nova, salva antes; se o
  salvar falha, nada é publicado. Em seguida chama publicar. Se o servidor
  recusar com `INVALID_STATE` "… has no unpublished changes" (rascunho igual à
  versão publicada; a recusa acontece antes de qualquer efeito), chama ativar
  e essa versão volta ao ar sem criar versão nova. Quem decide se há alteração
  não publicada é o servidor, nunca uma comparação no navegador. Avisos:
  "Salvo e publicado.", "Publicado." ou "De volta ao ar.". Se a publicação
  falha depois do salvar, o rascunho fica salvo, o switch volta a Fora do ar e
  aparece a mensagem segura do servidor.
- **Desligar** pede confirmação: "Tirar do ar? A URL passa a dar 404. O
  rascunho e as versões ficam.". Confirmado, a página sai do ar e a edição não
  salva continua no editor. Cancelado, nada muda.
- Nenhum caminho da UI coloca no ar uma versão diferente do rascunho salvo ou
  do editor. Criar ou duplicar deixa a página fora do ar, sem prompt de
  ativação; ligar o switch numa página nova cria e publica.

As regras de estado (`getEditorHeaderState`) e o encadeamento de ligar
(`turnOn`) moram em `lib/Modules/Revisions/Components/revisionEditorState.ts`
e são compartilhados pelos dois editores e pelas duas listagens.

**MCP (paridade):** `kastir_pages_create` e `kastir_pages_duplicate` retornam
`data.activationRequired: true` e apontam para `kastir_pages_publish`.
`kastir_pages_update` só grava o rascunho. O "ligar" do painel é
`kastir_pages_publish` quando há alteração não publicada; na recusa
`INVALID_STATE` sem alteração, `kastir_pages_activate` religa a versão
publicada sem criar versão (e recusa página nunca publicada). Desligar é
`kastir_pages_unpublish`. Histórico: `kastir_pages_revisions_*`.

## Lixeira (Exclusão em Duas Etapas)

Excluir uma página (Rascunho ou Publicada) **não apaga de fato** — move para a Lixeira, mesmo padrão do "Trash" do WordPress.

- **Quem pode excluir (Lixeira):** Administrador (Master ou não) e **Editor**, sem fluxo de aprovação — mesma lógica de "publica direto" (ver [`USERS.md`](./USERS.md)).
- Se a página estava **Publicada**, o arquivo `.html` estático é removido do disco **imediatamente** — a URL cai em 404 para o visitante público na hora, igual à despublicação.
- Enquanto está na Lixeira, **ninguém acessa o conteúdo da página** — nem Administrador, nem Editor, nem como preview interno. É preciso **restaurar** primeiro para voltar a vê-la ou editá-la.
- O slug permanece reservado enquanto a página está na Lixeira — evita colisão se ela for restaurada.
- **Ações disponíveis na Lixeira:**
  - **Restaurar** — a página volta como **Rascunho** (precisa ser publicada novamente para reaparecer no ar). Disponível para Master, Administrador e Editor.
  - **Excluir Permanentemente** — apaga o registro de vez, imediatamente, sem esperar os 30 dias. Exige confirmação bloqueante. **Somente Master e Administrador** — Editor **não** pode excluir permanentemente (só mover para Lixeira / restaurar).
- **Retenção automática:** 30 dias após ir para a Lixeira, a página é **excluída permanentemente** por um job em background (mesmo worker/fila sobre Redis usado no rebuild em massa — ver [`CUSTOM-CODE.md`](./CUSTOM-CODE.md) e `STACK.md`).
- Registrado em [`LOGS.md`](./LOGS.md) como eventos distintos: "moveu para lixeira", "restaurou" e "excluiu permanentemente".

## Editor de Página

Ao abrir uma página (via "Editar" na listagem), os campos editáveis são:

| Campo | Observação |
|---|---|
| **Slug** | URL da página — editável a qualquer momento. **Se deixado em branco, é preenchido automaticamente a partir do Título**, e nunca colide com nenhum outro slug existente (sufixo numérico automático se preciso). **Se digitado manualmente pelo usuário, precisa ser único** — salvar é bloqueado com erro se o slug já existir em outra página |
| **Título** | Nome de exibição da página (o mesmo que aparece na coluna "Nome" da listagem) |
| **Conteúdo** | O blob de HTML/CSS/JS (ver Formato de Conteúdo acima) |
| **SEO — Título** | Meta title (`<title>`) — pode ser diferente do Título geral, para otimizar como aparece no Google. Se vazio, usa o fallback `{Título da Página} · {Título do Site}` (ver [`SETTINGS.md`](./SETTINGS.md)) |
| **SEO — Descrição** | Meta description. Se vazio, usa a Descrição (SEO) definida em [`SETTINGS.md`](./SETTINGS.md) como fallback |
| **SEO — Palavra-chave** | Meta keywords (valor de SEO limitado nos buscadores atuais, mas incluído conforme solicitado) |

Cabeçalho do editor (`EditorHeader`, compartilhado com Scripts):

- **Switch No ar / Fora do ar** ao lado do título — ver [Switch No ar / Fora do ar](#switch-no-ar--fora-do-ar).
- **Botão principal**, cujo rótulo diz se mexe no ar: **Criar** em página nova; **Salvar** fora do ar (só grava o rascunho; aviso "Rascunho salvo. Continua fora do ar."); **Salvar e publicar** no ar (salva, se houver edição, e publica). No ar e sem pendência, **Salvar e publicar** fica desabilitado.
- Indicador **Não salvo** ao lado do botão enquanto há edição não salva.
- Faixa "Há alterações salvas que ainda não estão no ar." abaixo do cabeçalho quando a página está no ar com rascunho salvo diferente da versão publicada e sem edição não salva.
- **Menu ⋯** com as ações raras. A primeira linha mostra "Versão no ar: <data e hora> · <autor>" (ou "Ainda não publicada"). **Salvar sem publicar** aparece só com a página no ar e edição não salva: grava o rascunho e o ar não muda. **Pré-visualizar** salva sem publicar, se houver edição, e abre `/p/<slug>` (pré-visualização autenticada existente) em nova aba; com erro no salvar, a aba não abre. Item indisponível não aparece no menu.
- Controle indisponível fica desabilitado com o motivo visível (formulário inválido, nada a salvar, nada a publicar, página nova). Durante a comparação de versão, switch, botão e menu pausam com a dica "Pausado durante a comparação" (ver [`REVISIONS.md`](./REVISIONS.md)).
- **Excluir** (lixeira) fica sozinho na ponta direita.

> Isso resolve a dúvida que estava em aberto: sim, existem campos estruturados (Título, Slug, SEO) **fora** do blob de HTML — só o conteúdo em si (a página renderizada) é que fica dentro do blob único.

## Salvar o rascunho: versão esperada, trava e edição parcial

Painel e MCP gravam pelo mesmo serviço (`pageService.updatePage`), então as
regras abaixo valem para os dois. O código está em
`lib/Modules/Pages/lifecycle.ts` (save e patch) e a guarda de versão, comum a
Páginas e Scripts, em `lib/Modules/Revisions/lifecycle.ts`.

- **Versão esperada.** O painel envia `expectedUpdatedAt`, a versão que leu. O
  MCP e outros chamadores podem enviar `expectedContentSha256`, o SHA-256 dos
  bytes UTF-8 do conteúdo lido (64 hexadecimais). Quando o hash é enviado, só ele
  é conferido e `expectedUpdatedAt` é ignorado: publicar, ativar e tirar do ar
  mudam `updatedAt` sem mudar o conteúdo, e a conferência por data daria
  conflito falso. Sem o hash, vale `expectedUpdatedAt`.
- **Conflito.** Versão divergente resulta em `CONFLICT` "Page was updated by
  another request"; quando a conferência é por hash, a mensagem traz o hash
  atual (`current contentSha256: <hash>`). O painel não mudou: o editor já trata
  essa mensagem, e o rascunho gravado pela outra sessão permanece.
- **Trava de linha.** O save trava a linha da página (`SELECT ... FOR UPDATE`,
  helper comum `lib/Modules/Shared/RowLock.ts`), confere a versão e grava na
  mesma transação. Duas gravações simultâneas com a
  mesma versão esperada resultam em uma gravação e um `CONFLICT`. Sem alteração
  de campo nenhum, o save termina sem escrita (nada muda em `updatedAt`).
- **Hash e tamanhos.** `contentSha256` (hexadecimal minúsculo) e `contentBytes`
  (bytes UTF-8) cobrem o conteúdo inteiro e são calculados na hora, sem coluna
  nem migration. `contentTotal`, nas tools MCP de leitura, é em unidades UTF-16:
  CRLF conta 2 e caractere fora do BMP conta 2, inclusive nas leituras de
  revisão e no preview, que não expõem hash.
- **Edição parcial (MCP).** `kastir_pages_patch` troca trechos do rascunho sem
  reenviar o conteúdo: de 1 a 50 operações `{old, new}`, `old` não vazio e com
  exatamente uma ocorrência, aplicadas em sequência e tudo ou nada, com
  `expectedContentSha256` obrigatório e resultado até 2 MiB em UTF-8. Altera só o
  conteúdo; título, slug, SEO e pasta seguem pelo update. Argumento inválido
  chega como `VALIDATION_ERROR` "Invalid arguments for tool kastir_pages_patch",
  sem o campo nem o valor. Detalhes e erros em
  [`mcp-cms-catalogo.md`](../mcp-cms-catalogo.md#edição-parcial-e-hash-de-conteúdo).
- **`draftFingerprint`** é o SHA-256 do snapshot (título, slug, conteúdo, SEO e
  pasta), usado pelo painel e na deduplicação de revisões; não é o hash do
  conteúdo e não serve para conferir o que foi gravado. A fórmula não mudou.
- **Conferir antes de publicar.** `kastir_pages_revisions_diff` com
  `from=publishedRevisionId` (de `kastir_pages_get`) e `to="draft"` mostra o que
  o rascunho muda no conteúdo em relação à revisão publicada.

## Arquitetura de Publicação (por que é rápido)

**Decisão:** Next.js único para o painel administrativo, com um **pipeline de publicação estática** para as páginas publicadas — nenhum framework renderiza a página por request.

```
┌─────────────────────────────┐
│   Painel Admin (Next.js)    │  ← autenticado, dinâmico (App Router / RSC)
└──────────────┬──────────────┘
               │ ao publicar (switch ou "Salvar e publicar")
               ▼
   compila HTML final (conteúdo + scripts globais de Código Customizado)
               │
               ▼
┌─────────────────────────────┐
│  Arquivo estático (.html)   │  ← gravado no volume persistente do container
└──────────────┬──────────────┘
               │
               ▼
   Nginx (mesmo container) + CloudFlare (CDN, opcional)
               │
               ▼
        Visitante final ← zero Node/React no caminho
```

**Por que não Astro:** a ideia de "renderizar só o necessário" (islands do Astro) é resolvida de forma ainda mais radical aqui — a página publicada não é renderizada a cada request por nenhum framework, é um arquivo `.html` estático servido direto pelo web server. Isso supera em performance tanto SSR do Astro quanto SSR/ISR do Next.js, porque não existe passo de renderização no caminho crítico. O Next.js só entra em cena no momento da edição/publicação (uso interno, autenticado), nunca na entrega ao visitante final.

- Formulários de contato/captura na página publicada: **serviço externo** (embed de terceiro) — fora do escopo do Kastir.
- Quando um script global de [Código Customizado](./CUSTOM-CODE.md) muda, **todas** as páginas já publicadas são recompiladas automaticamente — ver detalhes do rebuild em massa em `CUSTOM-CODE.md`.

## Decisões Fechadas

- ✅ Subpastas limitadas a 3 níveis de aninhamento.
- ✅ Slug em branco → auto-preenchido a partir do Título, nunca duplica. Slug digitado manualmente → precisa ser único, bloqueante se repetido.
- ✅ 6 cores pré-definidas para pastas (Azul, Verde, Amarelo, Roxo, Laranja, Rosa), além do hex livre.
- ✅ "Duplicar" copia tudo (conteúdo, SEO, pasta) com sufixo `-copia` no slug, sempre como Rascunho.
- ✅ Switch No ar / Fora do ar direto na listagem, sem precisar abrir o editor, com a mesma regra de ligar do editor.
- ✅ Excluir página é soft delete (Lixeira): Master, Administrador e Editor movem para Lixeira; **Excluir Permanentemente** (manual) é **só Master/Administrador**; o job de retenção de 30 dias apaga permanentemente no sistema (sem papel de usuário); ninguém acessa o conteúdo sem restaurar antes; visitante público cai em 404.
- ✅ Excluir uma pasta move as páginas dela para a "Base" — não exclui as páginas. Editor também exclui pasta (exceto Base). Base pode ser renomeada; não pode ser excluída.
- ✅ Árvore de pastas de Páginas é independente da de Mídia (mesmas regras de UX, dados separados).

## Perguntas em Aberto

*(nenhuma pendência no momento)*
