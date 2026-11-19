# Central de Notificações

> Voltar ao [índice da documentação](../README.md) · Acesso pela Barra Superior em [`PANEL.md`](./PANEL.md)

## O que é

Diferente da trilha de auditoria em [`LOGS.md`](./LOGS.md) — que registra **ações feitas por usuários** — a Central de Notificações mostra avisos gerados **automaticamente pelo próprio Kastir** quando uma ação indireta impacta outra parte do sistema. É o lugar para coisas que o Administrador precisa saber, mas que ninguém "fez" diretamente — efeitos colaterais do sistema, não ações de um usuário.

## Acesso

Um ícone de sino na [Barra Superior](./PANEL.md#barra-superior-fixa), visível para **Administradores (Master e comuns) e Editores** — cada um vê as notificações relevantes ao que tem acesso (ver [`USERS.md`](./USERS.md)). Não faz parte do menu lateral principal (que fica reservado às funções centrais — Páginas, Mídia, Scripts, Usuários, Logs e Configurações — ver [`SETTINGS.md`](./SETTINGS.md)).

### Indicador — badge numérico

O sino mostra um **badge numérico** com a contagem de não lidas (teto visual "9+" para não estourar o layout) — padrão comum de Gmail/Slack/GitHub. Usa o componente **Badge — Solid** do `DESIGN.md` (fundo escuro, texto claro) — não o vermelho de destaque (`Ember`), que no novo Design System é reservado **exclusivamente** para estados destrutivos/erro, não para contadores informativos.

## Estrutura de uma Notificação

| Campo | Exemplo |
|---|---|
| Data/hora | 2026-07-14 15:10 |
| Mensagem | "O script 'Pixel Black Friday' foi desativado automaticamente porque a página 'Landing BF' foi excluída." |
| Link relacionado | Deep-link direto para o snippet afetado |
| Lida / Não lida | Estado de leitura |

## Primeiro Tipo de Notificação: Snippet Desativado Automaticamente

Relacionado ao [Escopo por Página](./CUSTOM-CODE.md#escopo-por-página-display-conditions) dos Scripts: quando uma página que fazia parte do escopo "Páginas específicas" de um snippet é **excluída**, o Kastir:

1. Remove a página do escopo daquele snippet.
2. Se o snippet ficar **sem nenhuma página válida no escopo**, ele é automaticamente **desativado** (estado volta para Rascunho) — evita um snippet "Publicado" que não aponta para lugar nenhum.
3. Gera uma notificação avisando **Master e Administradores** do que aconteceu e por quê, com link direto para revisar o snippet. **Editors não recebem** este tipo (efeito de configuração global do site); outros tipos futuros podem ser relevantes a Editors conforme o acesso.

## Retenção

Prática recomendada (GitHub/Linear/Slack): **notificações não lidas nunca expiram sozinhas** — ficam até serem lidas ou descartadas manualmente, porque são acionáveis. **Notificações lidas somem da lista automaticamente após 30 dias** — sem perda real de informação, já que o evento original permanece registrado permanentemente em [`LOGS.md`](./LOGS.md).

## Decisões Fechadas

- ✅ Editor também recebe notificações relevantes, não só o Administrador.
- ✅ Indicador ativo: badge numérico no sino (teto "9+"), usando o componente **Badge — Solid** (neutro) do `DESIGN.md` — não o vermelho `Ember`, reservado a estados destrutivos/erro.
- ✅ Retenção: não lidas são permanentes até ação; lidas somem da lista após 30 dias (evento original continua nos Logs).

## Perguntas em Aberto

*(nenhuma pendência no momento)*
