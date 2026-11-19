# Página de Logs

> Voltar ao [índice da documentação](../README.md)

## O que é

Uma trilha de auditoria: o que foi alterado, por qual usuário, e quando. Referência funcional: plugins de activity log do WordPress (ex: "Simple History") — uma lista cronológica, filtrável, de ações relevantes feitas dentro do painel.

## Eventos Registrados

| Categoria | Eventos |
|---|---|
| Páginas | Criou / editou / publicou / despublicou / moveu para lixeira / restaurou / excluiu permanentemente página |
| Pastas | Criou / renomeou / mudou cor / excluiu pasta |
| Mídia | Upload / renomeou / editou alt-descrição / excluiu arquivo |
| Scripts (Código Customizado) | Criou / editou / publicou / despublicou / excluiu snippet — **um único registro por evento**, mesmo que isso dispare rebuild em massa de centenas de páginas (ver [`CUSTOM-CODE.md`](./CUSTOM-CODE.md)) |
| Usuários | Convidou usuário / usuário aceitou convite / mudou papel / removeu usuário / gerou link de redefinição de senha |
| Configurações | Atualizou Configurações do site — **um único registro por salvamento**, sem diff campo a campo (ver [`SETTINGS.md`](./SETTINGS.md)) |

## Estrutura de um Registro

Somente metadado — **sem diff de conteúdo** (sem antes/depois do HTML), consistente com a decisão de não ter versionamento de página (`PAGES.md`).

| Campo | Exemplo |
|---|---|
| Data/hora | 2026-07-14 14:32 |
| Usuário | João (Editor) |
| Ação | Publicou página |
| Alvo | "Landing Black Friday" (`/promo/black-friday`) |

## Filtros (obrigatórios no MVP)

- **Usuário**
- **Data/hora** (período)
- **Objeto** (Página, Mídia, Pasta, Script, Usuário, Configurações)

## Retenção

**Indefinida, sem expiração automática.** Como o registro é só metadado (sem diff de conteúdo), o custo de armazenamento é irrelevante mesmo em uso intenso (~100 eventos/dia gira em torno de 11MB/ano) — o cuidado real é indexar bem por usuário, data e tipo de objeto para manter os filtros rápidos com o tempo.

## Permissões

**100% restrito ao Administrador** (Master e comuns) — Editor não tem acesso a esta tela, mesmo tendo acesso amplo às demais funções (ver `USERS.md`). É uma tela de auditoria, não de operação do dia a dia.

## Perguntas em Aberto

*(nenhuma pendência no momento)*
