# Início (Página Inicial)

> Voltar ao [índice da documentação](../README.md) · Instalação/Onboarding em [`ONBOARDING.md`](./ONBOARDING.md) · Menu lateral em [`PANEL.md`](./PANEL.md)

## O que é

A tela que aparece assim que o usuário loga — seja logo após a instalação (primeiro login do Master, ver [`ONBOARDING.md`](./ONBOARDING.md)), seja num login normal do dia a dia. **Não é um Dashboard de métricas** (decisão revertida em relação à versão anterior deste documento) — é um estado simples e direto, sem número, sem gráfico, sem tabela.

## Conteúdo (V1)

- Saudação personalizada com o **nome** do usuário logado (campo `name` em `User` — ver bootstrap/convite em [`USERS.md`](./USERS.md) / specs de Auth).
- Copy via **i18n do painel** (`PANEL_LANGUAGE`, ver [`STACK.md`](../../STACK.md)) — não hardcodar um único idioma. Exemplos:
  - `pt-BR`: **"Olá, {nome}! O que vamos criar hoje?"**
  - `en` (default): **"Hi, {name}! What are we creating today?"**
- Atalho para começar (no mínimo, **Nova Página** / **New Page**) — mantém o princípio de "nada de tela em branco sem direção", só que resolvido com uma frase e um botão em vez de um dashboard.

Nada além disso por enquanto — sem número de páginas por pasta, sem uploads recentes, sem últimos usuários ativos (essas métricas foram cogitadas numa versão anterior do produto e ficaram de fora do escopo atual).

## Futuro (fora do escopo atual)

Esta página é reservada para, futuramente, centralizar **avisos operacionais da própria instalação do Kastir** — por exemplo, aviso de nova versão disponível. Hoje esse tipo de informação só existe no rodapé do painel como link estático para o changelog no GitHub (ver [`PANEL.md`](./PANEL.md)). Nenhum comportamento de aviso de atualização está especificado ainda — só reservando o espaço conceitual da tela para isso.

## Decisões Fechadas

- ✅ Sem Dashboard de métricas por enquanto — nada de contagem de páginas, uploads recentes ou usuários ativos.
- ✅ Conteúdo V1: saudação personalizada (i18n via `PANEL_LANGUAGE`) + atalho para criar uma nova página.
- ✅ Arquivo próprio (`HOME.md`), separado do fluxo de instalação/onboarding.
- ✅ Quando os avisos de atualização existirem (escopo futuro, não faz parte do MVP), eles **convivem** com o link de changelog do rodapé do painel (`PANEL.md`) — não o substituem. Um mostra "tem atualização disponível" na Home, o outro continua sendo o link permanente pro histórico completo.

## Perguntas em Aberto

*(nenhuma pendência no momento)*
