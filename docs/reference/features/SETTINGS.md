# Configurações do Site

> Voltar ao [índice da documentação](../README.md) · Papéis em [`USERS.md`](./USERS.md) · Nome do site definido por variável de ambiente na instalação em [`ONBOARDING.md`](./ONBOARDING.md) · SEO por página em [`PAGES.md`](./PAGES.md)

## O que é

Equivalente a "Ajustes → Geral/Leitura" do WordPress: uma tela única com as configurações **globais da instalação** — diferente das configurações **por página** (Título/Descrição/Palavra-chave de SEO, que ficam no editor de cada página, ver [`PAGES.md`](./PAGES.md)). Aqui é o nível do site inteiro, não de uma página específica.

## Onde vive no menu

**7º item na sidebar**, **"Configurações"**, visível só para Administrador (Master ou comum) — mesma lógica de ocultação já usada para Usuários/Logs (ver [`PANEL.md`](./PANEL.md)). O menu principal passa de 6 para 7 itens; no mobile, cai dentro do item "Mais" do bottom nav junto com Usuários/Logs quando o usuário logado for Administrador.

## Permissões

**100% restrito ao Administrador** (Master e comuns) — Editor não vê nem acessa esta tela, mesma lógica de [`LOGS.md`](./LOGS.md) e da gestão de Usuários: não é uma tela de operação do dia a dia, e um erro aqui (ex: desmarcar indexação, trocar a página inicial) afeta o site inteiro de uma vez.

## Campos

### 1. Título do Site
Texto livre. Valor inicial vem da variável de ambiente `SITE_TITLE`, gravada no **seed de `SiteSettings` no mesmo bootstrap do Master** (ver [`STACK.md`](../../STACK.md#bootstrap-de-sitesettings) e [`ONBOARDING.md`](./ONBOARDING.md)) — se a env não for definida, o seed grava string vazia e o título precisa ser preenchido aqui antes de salvar. Editável a qualquer momento depois. Obrigatório (não pode ficar em branco). Boots seguintes **não** sobrescrevem o título já salvo a partir da env.

**Uso:** além de identificar a instalação no painel, funciona como **fallback de `<title>`** para páginas publicadas — quando o campo SEO — Título de uma página (ver `PAGES.md`) está vazio, o `<title>` compilado usa o padrão `{Título da Página} · {Título do Site}`.

### 2. Descrição (SEO)
Texto livre, meta description do site. **Fallback** da SEO — Descrição por página (`PAGES.md`): se uma página não define a própria descrição, essa aqui é usada no `<meta name="description">` compilado. Opcional.

### 3. Ícone do Site (favicon)
Seleciona uma imagem já enviada pela [Biblioteca de Mídia](./MEDIA.md) (reaproveita o mesmo seletor usado em outras telas) — recomenda-se PNG quadrado, mínimo 512×512px. Opcional; se não definido, nenhuma tag de ícone é injetada (comportamento padrão do navegador).

**Injeção:** igual ao script da Barra Superior (`PANEL.md`), a tag `<link rel="icon">` é **injetada automaticamente pelo próprio sistema** no `<head>` de toda página compilada — não é um campo de [Código Customizado](./CUSTOM-CODE.md), é fixo. Trocar o ícone dispara o mesmo rebuild em massa assíncrono de `CUSTOM-CODE.md`.

### 4. Endereço (URL)
Normalmente **não precisa ser preenchido** — o Kastir detecta o domínio sozinho a partir do host da requisição (ver "Sem passo de domínio" em `ONBOARDING.md`). Este campo existe como **correção manual** para os casos em que a detecção automática erra (ex: proxies não convencionais) ou quando a instalação muda de domínio depois de já estar no ar.

**Uso:** é a URL base usada para gerar links absolutos e estáveis — como os links da [Biblioteca de Mídia](./MEDIA.md) (`https://dominio.com/uploads/...`) e os links de convite/redefinição de senha (`USERS.md`) — em vez de depender do host de cada requisição individual, o que os deixaria instáveis.

**Salvar exige confirmação bloqueante:** divergir esse valor do domínio real quebra todos os links já gerados (mídia, convites) — mesmo padrão de confirmação usado em ações de risco elevado (ver exclusão em `MEDIA.md`). O gate mora no `Settings/Service` e vale também para `kastir_settings_update` (`confirmSiteUrl: true`).

### 5. Idioma do Site
Dropdown. **Não é o mesmo idioma da interface do painel** (UI administrativa, definido pela variável de ambiente `PANEL_LANGUAGE` — ver [`STACK.md`](../../STACK.md#variáveis-de-ambiente) e [`ONBOARDING.md`](./ONBOARDING.md)) — este campo define o `<html lang="...">` das **páginas publicadas**. Os dois podem divergir (ex: painel em português via `PANEL_LANGUAGE=pt-BR`, site publicado em inglês). Valor inicial default a definir; editável a qualquer momento depois.

### 6. Fuso Horário
Dropdown (lista de timezones IANA, ex: `America/Sao_Paulo`). Usado para **exibir** datas/horas no painel — em [`LOGS.md`](./LOGS.md), na Data de criação/publicação de páginas (`PAGES.md`) e na Central de Notificações (`NOTIFICATIONS.md`). O banco armazena tudo em UTC; a conversão para exibição usa este valor. Default: `UTC`.

### 7. Formato de Data
Dropdown com opções pré-definidas (ex: `DD/MM/AAAA`, `MM/DD/AAAA`, `AAAA-MM-DD`). Aplica-se a toda data exibida no painel. Default: `DD/MM/AAAA`.

### 8. Formato de Hora
`24 horas` ou `12 horas (AM/PM)`. Default: `24 horas`.

### 9. Semana Começa Em
`Domingo` ou `Segunda-feira` — afeta qualquer seletor de período/calendário no painel (ex: filtro de Data/hora em `LOGS.md`). Default: `Domingo`.

> **Escopo dos campos 6-9:** valem **só para o painel administrativo** — não têm nenhum efeito sobre o conteúdo HTML da página publicada, que é um blob solto fora do controle do Kastir (ver `PAGES.md`). Se uma página exibir datas, isso é responsabilidade de quem montou o HTML, não desta tela.

### 10. Página Inicial
Seletor entre as páginas **publicadas** existentes (ver [`PAGES.md`](./PAGES.md)). Define qual página responde pela URL raiz (`/`) do site.

- A página escolhida passa a responder em **duas URLs**: a raiz (`/`) e o próprio slug (`/<slug>`) — o mesmo conteúdo, sem duplicar o registro. Evita quebrar links que já apontam pro slug original ao mesmo tempo que resolve a URL raiz.
- **Sem página inicial definida** (default): `/` retorna 404, mesmo comportamento de uma página em rascunho — nenhuma landing padrão do Kastir é servida.
- Trocar a página inicial (sozinha) dispara rebuild **só das páginas envolvidas** (a nova e, se houver, a anterior) + regeneração do alias `/` e do `sitemap.xml` conforme necessário — **não** rebuild de todo o site. Rebuild em massa de **todas** as páginas publicadas fica para campos que afetam o HTML global (Ícone do Site, Indexável pelo Google, Permitir Crawlers de IA), ou para a união de tudo que mudou num único "Salvar Alterações".
- **Se a página definida como inicial for movida para a Lixeira ou excluída** (ver `PAGES.md`), o Kastir desfaz automaticamente a configuração (volta para "sem página inicial") e gera uma notificação — mesmo padrão do snippet desativado automaticamente em `CUSTOM-CODE.md`/`NOTIFICATIONS.md`.

### 11. Indexação e IA

Dois toggles independentes, mais o `sitemap.xml` (que não é configurável, só decorre dos outros dois).

**11a. Indexável pelo Google** — "Permitir que buscadores indexem este site". Default: **ligado**, mesmo default do WordPress em instalações novas.
- **Ligado:** nenhuma tag extra; site indexável normalmente; `robots.txt` permite tudo (`Allow: /`) e referencia o `sitemap.xml`.
- **Desligado:** todas as páginas recebem `<meta name="robots" content="noindex,nofollow">` (injeção automática, mesmo mecanismo do favicon) e o `robots.txt` vira bloqueio total (`Disallow: /`) — nesse caso o `sitemap.xml` deixa de ser referenciado no `robots.txt` (bloquear tudo e ainda anunciar o mapa do site é contraditório).

**11b. Permitir Crawlers de IA** — "Permitir que crawlers de treinamento de IA acessem este site", independente do toggle de Google. Default: **ligado** (mesma filosofia permissiva-por-padrão do resto do sistema).
- **Ligado:** nenhuma regra extra no `robots.txt` além da geral.
- **Desligado:** `robots.txt` ganha um bloco `Disallow: /` específico para uma lista curada de user-agents de IA conhecidos — GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, anthropic-ai, Google-Extended, CCBot, PerplexityBot, Bytespider, Applebot-Extended, Meta-ExternalAgent — **mesmo que 11a esteja ligado** (ou seja, dá pra permitir Google/Bing normalmente e bloquear só os crawlers de treinamento de IA). Lista mantida manualmente no código, revisão periódica esperada conforme novos crawlers de IA aparecem no mercado.

**`sitemap.xml`** — gerado automaticamente em `/sitemap.xml`, listando toda página **publicada** (URL + data de publicação como `<lastmod>`), incluindo o alias de Página Inicial quando definida. Não tem campo de configuração próprio: existe sempre que 11a está ligado, some do `robots.txt` (mas o arquivo em si pode continuar acessível diretamente) quando 11a está desligado.

Qualquer mudança em 11a ou 11b dispara rebuild em massa de **todas** as páginas publicadas + regeneração do `sitemap.xml`/`robots.txt` (mesma fila assíncrona de `CUSTOM-CODE.md`) — publicar/despublicar uma página individual também regenera o `sitemap.xml` sozinho, sem precisar de rebuild em massa.

### 12. Cache (CloudFlare)

Campos avançados, opcionais — ver mecanismo completo de purge em [`STACK.md`](../../STACK.md#cache).

| Campo | Observação |
|---|---|
| **CloudFlare API Token** | Token com permissão de "Zone → Cache Purge" — usado pra chamar a API "Purge by URL" a cada rebuild |
| **CloudFlare Zone ID** | Identifica qual zona/domínio no CloudFlare o purge deve afetar |

Sem esses dois campos preenchidos, o purge automático do CloudFlare simplesmente não dispara — não há cache local a se preocupar de qualquer forma, já que o Nginx (dentro do container) serve o arquivo direto do disco a cada request (ver `STACK.md`). Armazenado como campo sensível (nunca reexibido em texto puro depois de salvo, mesmo padrão de senha).

### 13. Conversão de Imagem (WebP)

Toggle único: **"Converter uploads para WebP automaticamente"**. Default: **ligado** — afeta só upload de imagem raster (jpg/jpeg/png/webp/gif) na [Biblioteca de Mídia](./MEDIA.md); SVG, PDF e vídeo nunca passam por esse processamento.

- **Ligado (padrão):** toda imagem raster enviada é convertida/recomprimida para `.webp` via `sharp` (ver [`STACK.md`](../../STACK.md)), com parâmetros fixos do sistema — não editáveis pelo usuário, mesma lógica de "sem tela própria" das credenciais de Cache acima:
  - Qualidade: **82**
  - Effort (esforço de compressão): **6** (o máximo — gera arquivo menor, exige mais CPU)
  - `smartSubsample` (conversão RGB→YUV precisa): **ativo**
- **Desligado:** o arquivo é salvo no formato original enviado (ainda dentro da lista branca de extensões de `MEDIA.md`), sem nenhuma conversão.
- **Processamento sempre assíncrono:** por usar o `effort` mais alto do WebP (a configuração mais lenta), a conversão roda na mesma fila em background sobre Redis usada pelo rebuild em massa (ver `STACK.md`/[`CUSTOM-CODE.md`](./CUSTOM-CODE.md)) — o upload nunca fica bloqueado esperando o encode terminar; o arquivo aparece na Biblioteca de Mídia assim que a fila processa.
- **Sem controle de "intensidade/nitidez do filtro":** esses dois parâmetros existem só no binário `cwebp` puro, não são expostos pelo `sharp`/libvips usado aqui — os três parâmetros acima (qualidade, effort, smartSubsample) já cobrem a maior parte do ganho de compressão sem exigir uma dependência de sistema extra na imagem.

## Salvar — uma única ação, um único rebuild

A tela tem um único formulário com um botão **"Salvar Alterações"** no final — não é campo por campo. Se a alteração incluir qualquer um dos campos que afetam o HTML compilado (Ícone do Site, Página Inicial, Indexável pelo Google, Permitir Crawlers de IA), o salvamento dispara **no máximo um** rebuild em massa cobrindo a união de tudo que mudou, em vez de um rebuild por campo alterado.

## Registro em Logs

Salvar Configurações gera **um único registro** em [`LOGS.md`](./LOGS.md) (ex: "Fulano atualizou as Configurações do site") — sem diff de campo a campo, mesmo padrão de metadado-only do resto do sistema.

## Decisões Fechadas

- ✅ 7º item fixo na sidebar, visível só para Administrador.
- ✅ Fuso horário, formato de data/hora e "semana começa em" valem só para o painel — nenhum efeito sobre o conteúdo da página publicada.
- ✅ Tela restrita a Administrador (Master e comuns); Editor sem acesso.
- ✅ Título e Descrição do site servem de fallback para os campos de SEO por página quando estes estão vazios.
- ✅ Ícone do site é injetado automaticamente pelo sistema (não é um campo de Código Customizado).
- ✅ Endereço (URL) é um campo de correção manual, não obrigatório no fluxo normal (domínio já é auto-detectado, ver `ONBOARDING.md`); salvar exige confirmação bloqueante.
- ✅ Idioma do Site é independente do idioma do painel escolhido na instalação.
- ✅ Página Inicial: página escolhida responde em `/` e no próprio slug ao mesmo tempo; sem página definida, `/` é 404; exclusão/lixeira da página escolhida desfaz a configuração automaticamente e notifica.
- ✅ Indexação: default ligado; desligar injeta `noindex` em todas as páginas e serve `robots.txt` bloqueando tudo.
- ✅ Permitir Crawlers de IA é um toggle **independente** do de Google — dá pra bloquear só crawlers de treinamento de IA (lista curada: GPTBot, ClaudeBot, CCBot etc.) mantendo indexação normal em buscadores.
- ✅ `sitemap.xml` gerado automaticamente (sem campo próprio), listado no `robots.txt` só quando indexação está ligada; regenerado a cada publicar/despublicar de página.
- ✅ Um único botão de salvar para toda a tela; no máximo um rebuild em massa por salvamento, mesmo que vários campos com esse efeito tenham mudado juntos.
- ✅ Um único registro em Logs por salvamento, sem diff campo a campo.
- ✅ Cache (CloudFlare): API Token + Zone ID opcionais, usados pro purge automático (ver `STACK.md`); sem cache local a purgar, já que o Nginx serve os arquivos direto do disco.
- ✅ Conversão de Imagem (WebP): toggle global, default ligado; parâmetros fixos (qualidade 82, effort 6, smartSubsample ativo) via `sharp`; processamento sempre assíncrono (fila Redis), nunca bloqueia o upload; sem controle de filtro/nitidez (exclusivo do `cwebp`, fora do escopo do `sharp`).
- ✅ Revisões a manter: inteiro global 5–30 (padrão 5) para Pages e Custom Code. Alterar o valor não apaga revisões na hora nem dispara rebuild; o próximo job de retenção aplica o corte. Até 3 revisões fixadas por recurso ficam fora dessa janela.

## Perguntas em Aberto

*(nenhuma pendência no momento)*
