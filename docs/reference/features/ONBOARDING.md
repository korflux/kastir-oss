# Instalação e Primeiro Acesso

> Voltar ao [índice da documentação](../README.md) · Stack em [`STACK.md`](../../STACK.md) · Papéis em [`USERS.md`](./USERS.md) · Página inicial em [`HOME.md`](./HOME.md)

## O que é

Diferente de um instalador tipo wizard do WordPress, o Kastir instala como **qualquer app Docker moderno**: um `Dockerfile` único no repositório, deploy direto a partir do GitHub, configuração por **variáveis de ambiente** lidas na subida do container. Não existe wizard, não existe rota `/admin/install`, e não existe passo manual de servidor — quem sobe o container já sai com o site no ar e a conta do Administrador Master pronta.

## Instalação de Referência: EasyPanel via GitHub

1. Criar um App no EasyPanel apontando pro repositório do Kastir no GitHub (o `Dockerfile` já está no repositório — ver [`STACK.md`](../../STACK.md)).
2. Provisionar **Postgres** e **Redis** — no EasyPanel, isso costuma ser um serviço-irmão dentro do mesmo projeto; em outro host Docker, pode ser qualquer instância externa. Nenhum dos dois roda dentro do container do Kastir.
3. Preencher as **variáveis de ambiente** do App (ver tabela completa em [`STACK.md`](../../STACK.md#variáveis-de-ambiente)) — no mínimo `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `MASTER_EMAIL` e `MASTER_PASSWORD`. Opcionalmente, `PANEL_LANGUAGE` já define o idioma da interface do painel (ex: `pt-BR`) desde o primeiro boot — sem isso, sobe em `en`.
4. Deploy. Na subida, o container roda as migrations pendentes e, se ainda não existir nenhum usuário Master no banco, **cria um automaticamente** a partir de `MASTER_EMAIL`/`MASTER_PASSWORD` (nome provisório = parte local do e-mail, editável no Perfil) e, se ainda não existir, **semeia** a singleton de `SiteSettings` com `SITE_TITLE` (ou vazio) — ver [`STACK.md`](../../STACK.md#bootstrap-de-sitesettings) e [`USERS.md`](./USERS.md#a-senha-do-master--sempre-via-variável-de-ambiente).
5. Acessar `/admin/login` e entrar com o e-mail/senha definidos nas variáveis de ambiente.

Qualquer outro host que rode Docker (VPS própria, Coolify etc.) segue exatamente o mesmo `Dockerfile` — EasyPanel é a instalação de referência **documentada**, não uma dependência do software. Nada no Kastir é específico do EasyPanel.

Os demais usuários entram depois via [convite](./USERS.md#convite-de-usuário--via-link-gerado-por-qualquer-administrador), gerado por qualquer Administrador dentro do painel — o bootstrap de instalação nunca cria mais de um usuário.

### Sem passo de domínio, CDN ou SMTP

- **Domínio:** o Kastir lê o host da própria requisição para gerar links — mesmo comportamento do instalador do WordPress, que nunca pergunta o domínio. Como a infraestrutura não é fixa (cada instalação tem seu próprio proxy/domínio na frente — EasyPanel, CloudFlare de quem instalou, ou outro), o Kastir não presume nada sobre isso além do header `Host` recebido. Se a detecção automática errar (proxies não convencionais), existe uma correção manual em [`SETTINGS.md`](./SETTINGS.md#4-endereço-url).
- **CDN e SMTP:** fora do escopo — CDN é opcional e configurado por quem instala (CloudFlare, se quiser, ver `STACK.md`), e SMTP só entraria numa fase futura, se algum fluxo de e-mail transacional for adicionado (ver `STACK.md` sobre o Brevo estar fora do MVP).

## Acesso ao Painel

O painel administrativo vive em **`/admin`** — uma rota fixa e reservada, separada de qualquer página publicada do site (ver arquitetura de publicação em [`PAGES.md`](./PAGES.md) e estrutura de rotas em `STACK.md`).

## Onboarding — Tour Guiado (Popups), opcional

Depois do primeiro login, um **tour de popups** aponta e explica, tela por tela, o que cada parte do painel faz: Páginas, Mídia, Scripts e Usuários, nessa ordem. Pode ser pulado ou dispensado a qualquer momento pelo usuário e não bloqueia o uso do painel. Logs não tem passo próprio, porque saiu do menu de topo. Os passos e suas âncoras (`tour-pages`, `tour-media`, `tour-custom-code`, `tour-users`) são definidos em `lib/Modules/Onboarding/Components/GuidedTour.tsx`. Abaixo de `lg`, o passo de um item que mora no overflow da BottomNav (ex.: Usuários) aponta para o botão "Mais" (atributo `data-tour-anchor-proxy`), e os itens primários apontam para o link visível da BottomNav; de `lg` em diante, o passo aponta para o link da nav superior.

## Página Inicial

A tela que aparece após o login (primeiro acesso ou login normal) não é um Dashboard de métricas — ver [`HOME.md`](./HOME.md) para o conteúdo atual e o que está planejado para o futuro.

## Decisões Fechadas

- ✅ Sem wizard interativo — instalação e bootstrap do Administrador Master são resolvidos por variáveis de ambiente, lidas uma única vez na subida do container (ver [`STACK.md`](../../STACK.md#variáveis-de-ambiente) e [`USERS.md`](./USERS.md#a-senha-do-master--sempre-via-variável-de-ambiente)).
- ✅ Distribuição via `Dockerfile` único; instalação de referência documentada: EasyPanel a partir do repositório GitHub. Qualquer host Docker funciona do mesmo jeito.
- ✅ O Tour guiado por popups (explicação das telas) continua sendo a única parte opcional/pulável do onboarding — roda só depois do primeiro login do Master.
- ✅ Painel administrativo vive na rota fixa `/admin`.
- ✅ Página inicial pós-login não é um Dashboard com métricas — ver `HOME.md`.
- ✅ Sem passo de domínio: detectado automaticamente pelo host da requisição, com correção manual disponível em `SETTINGS.md`.
- ✅ CDN e SMTP ficam fora do bootstrap: CDN é infraestrutura opcional de quem instala, SMTP é escopo futuro.
- ✅ Idioma do painel administrativo definido por variável de ambiente (`PANEL_LANGUAGE`), lida a cada boot — sem passo de wizard, sem campo em Configurações. Default `en` se não definida (ver `STACK.md`).

## Perguntas em Aberto

*(nenhuma pendência no momento)*
