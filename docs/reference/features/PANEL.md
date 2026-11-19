# Painel — Estrutura e Navegação

> Voltar ao [índice da documentação](../README.md) · Design System em [`DESIGN.md`](../../DESIGN.md)

## O que é

A casca (shell) do painel administrativo: navegação, layout responsivo e a barra fixa de usuário logado. É o "wrapper" onde as telas de cada função (Páginas, Mídia, Scripts, Usuários, Logs) são renderizadas. O painel inteiro vive sob a rota fixa **`/admin`** (ver [`ONBOARDING.md`](./ONBOARDING.md)).

## Responsividade — Mobile First

- Construído **mobile first**: o layout base é pensado para telas pequenas primeiro, depois expandido para desktop.
- **Full width**: o painel não segue o `--page-max-width` do `DESIGN.md` (esse limite é para a documentação/marketing) — o painel usa a largura total da viewport, já que tabelas de páginas/mídia/logs se beneficiam do espaço extra.
- Funciona tanto em desktop quanto em mobile — administração no celular precisa ser viável (ex: aprovar/publicar uma página rápida pelo celular), mesmo que a edição de conteúdo HTML seja mais confortável no desktop.

## Menu Lateral (referência: wp-admin)

| Item | Leva para |
|---|---|
| **Início** | Página inicial — ver [`HOME.md`](./HOME.md) |
| **Páginas** | Listagem de pastas e páginas — ver [`PAGES.md`](./PAGES.md) |
| **Mídia** | Biblioteca de mídia — ver [`MEDIA.md`](./MEDIA.md) |
| **Scripts** | Código customizado (Header / Body Início / Body Fim) — ver [`CUSTOM-CODE.md`](./CUSTOM-CODE.md) |
| **Usuários** | Gestão de usuários e papéis — ver [`USERS.md`](./USERS.md) |
| **Logs** | Auditoria de alterações — ver [`LOGS.md`](./LOGS.md) |
| **Configurações** | Ajustes globais do site — ver [`SETTINGS.md`](./SETTINGS.md) |

Clicar em um item do menu troca o conteúdo da área principal — a casca (menu + barra superior) permanece fixa.

- Itens visíveis no menu dependem do papel do usuário logado (ex: Editor não vê Usuários, Logs nem Configurações — ver tabela de permissões em [`USERS.md`](./USERS.md), [`LOGS.md`](./LOGS.md) e [`SETTINGS.md`](./SETTINGS.md)).

### Desktop — sidebar lateral, com estado colapsado

Menu fixo à esquerda. Tem um estado **colapsado**: os itens somem, ficam só os ícones (economiza espaço horizontal para as tabelas de conteúdo). Expandir/colapsar é uma preferência de exibição, não afeta navegação.

### Mobile — menu inferior (bottom nav)

Em telas pequenas, o menu lateral vira um **menu inferior fixo**, no mesmo padrão de apps mobile (ícones fixos na base da tela, sempre acessíveis, sem precisar abrir um drawer).

Com até 7 itens no menu, o bottom nav é **determinístico** (não “o que couber visualmente”):

- **Itens principais (sempre na barra):** Início, Páginas, Mídia, Scripts.
- **“Mais”:** Usuários, Logs e Configurações — só para Master/Administrador (Editor não vê esses itens e **não** precisa do agrupador “Mais”).
- Breakpoint de referência: abaixo de **768px** = BottomNav; a partir de **768px** = Sidebar.

## Barra Superior Fixa

Uma barra fixa no topo, presente em **dois contextos diferentes**, com o mesmo conteúdo:

1. **Dentro do painel** — sempre visível.
2. **No site publicado**, sobreposta à página, **apenas para quem está logado no Kastir** — mesmo comportamento da admin bar do WordPress no front-end. Um visitante anônimo nunca vê essa barra.

Conteúdo da barra:

| Item | Comportamento |
|---|---|
| **Painel** | Link de volta para o painel administrativo (Início) |
| **Tema** | Ícone sol/lua para alternar entre claro e escuro (ver [`DESIGN.md`](../../DESIGN.md)) — afeta o painel e a própria barra; nunca o conteúdo da página publicada, que é HTML do usuário fora do controle do Kastir |
| **Notificações** | Ícone de sino com contador de não lidas — abre a [Central de Notificações](./NOTIFICATIONS.md). Visível apenas dentro do painel |
| **Perfil** | É aqui — e só aqui — que fica o próprio perfil do usuário. **Todos:** ver papel e sair. **Editar nome** no painel. **E-mail e senha:** (1) **Master** — nunca pelo painel; só via `MASTER_EMAIL` / `MASTER_PASSWORD` e, se necessário, `MASTER_FORCE_RESET` (ver [`USERS.md`](./USERS.md)); (2) **usuários convidados** — e-mail/senha no painel com **reautenticação** da senha atual (fluxo completo na Fase 7, quando esses usuários existem). Não existe tela de "Perfil" no menu lateral |
| **Editar esta página** | Aparece apenas no contexto do site publicado: deep-link direto para o editor daquela página específica no painel |

### Nota técnica — como a barra aparece em cima de um arquivo estático

Como a página publicada é um arquivo `.html` estático (ver arquitetura em [`PAGES.md`](./PAGES.md)), a barra não pode depender de renderização por request no servidor. A solução: todo HTML compilado recebe um **pequeno script do próprio sistema** (injetado automaticamente no publish, à parte dos campos de [Código Customizado](./CUSTOM-CODE.md), que são editáveis pelo usuário — este é fixo e não editável):

1. **A página carrega inteira primeiro** — o script da barra é o **último recurso a carregar**, sem competir com o carregamento do conteúdo. Isso é intencional: prioridade zero é a performance da página para o visitante comum.
2. Só depois disso o script verifica se existe uma sessão válida do Kastir (cookie de autenticação).
3. Se não houver sessão, o script não faz mais nada — zero impacto adicional para o visitante público.
4. Se houver sessão, busca os dados do usuário logado numa rota da API do painel e injeta a barra no topo da página via JavaScript.
5. **Tem que ser ultra leve** — script mínimo, sem dependências, carregado de forma diferida (`defer`/lazy).

Isso preserva o princípio de performance pura para o visitante anônimo (o caminho crítico da maioria dos acessos), e só paga o custo de uma chamada de API extra — depois da página já estar de pé — para quem já está autenticado.

## Rodapé do Painel

O painel (não o site publicado) tem um **rodapé fixo** exibindo a **versão do Kastir** rodando naquela instalação, com **link para o GitHub** — útil para diagnosticar bugs e saber se uma atualização está pendente.

## Decisões Fechadas

- ✅ **Master:** e-mail e senha **somente** por variáveis de ambiente (`MASTER_EMAIL` / `MASTER_PASSWORD` / `MASTER_FORCE_RESET`). O Perfil no painel permite editar **nome**, ver papel e sair — não oferece troca de e-mail/senha do Master.
- ✅ **Usuários convidados (Fase 7+):** editar e-mail e demais campos sensíveis do Perfil exige reautenticação com a senha atual.
- ✅ BottomNav: primários Início / Páginas / Mídia / Scripts; “Mais” = Usuários / Logs / Configurações (quando o papel enxerga).
- ✅ Link de versão no rodapé: `https://github.com/korflux/kastir-oss/releases` até existir um `CHANGELOG.md` versionado no repositório.

## Perguntas em Aberto

*(nenhuma pendência no momento)*
