# Multi-Usuários — Papéis, Convite e Recuperação

> Voltar ao [índice da documentação](../README.md)

## Modelo de Instalação — esclarecimento de terminologia

O termo usado inicialmente foi "multitenancy", mas o modelo real é o do **WordPress tradicional (single-site)**:

- **Cada instalação do Kastir atende um único site/projeto.** Não existe um painel central controlando múltiplos sites de múltiplos clientes na mesma instância.
- O que existe é **multiusuário com controle de acesso por papel (RBAC)** dentro dessa instalação.
- Por ser open source, cada time/cliente sobe sua própria instância isolada — cada instalação tem seu próprio banco, seus próprios usuários, suas próprias páginas.

Isso simplifica o modelo de dados: não é necessário `tenant_id` espalhado pelo schema, isolamento de banco por cliente, nem um "Super Admin" global no sentido multi-tenant. Existe, porém, um único usuário especial por instalação: o **Administrador Master** (ver abaixo).

## Papéis

Apenas dois papéis, mais um status especial:

- **Administrador Master** — o único usuário criado no **bootstrap do container**, a partir das variáveis de ambiente `MASTER_EMAIL`/`MASTER_PASSWORD` no primeiro boot (ver [`ONBOARDING.md`](./ONBOARDING.md)). É sempre um Administrador, mas com um status protegido: nunca pode ser removido, e é o único com poder de controlar livremente os outros Administradores.
- **Administrador** — pode haver quantos forem necessários (**sem limite de usuários convidados**). Tem acesso quase total, mas não pode remover/rebaixar outros Administradores nem o Master (só o Master tem essa autoridade).
- **Editor** — acesso amplo ao dia a dia (Páginas, Mídia, Scripts, Notificações, próprio Perfil), mas **sem nenhum acesso à gestão de Usuários**.

O papel **Leitor foi removido** — avaliado como sem caso de uso real para o produto.

## Papéis & Permissões

| Papel | Páginas | Mídia | Pastas | Scripts | Notificações | Usuários | Logs | Configurações |
|---|---|---|---|---|---|---|---|---|
| **Master** | Criar / editar / publicar / excluir (lixeira) / **excluir permanentemente** | Upload / editar / excluir | Criar / colorir / excluir | Criar / editar / publicar | Ver | Gerenciar **todos**, inclusive outros Administradores — convidar, remover, mudar papel. **Nunca pode ser removido** | Ver | Editar |
| **Administrador** | Criar / editar / publicar / excluir (lixeira) / **excluir permanentemente** | Upload / editar / excluir | Criar / colorir / excluir | Criar / editar / publicar | Ver | Convidar novos usuários (Administrador ou Editor); gerenciar Editores (remover, mudar papel). **Não pode remover nem alterar outros Administradores ou o Master** | Ver | Editar |
| **Editor** | Criar / editar / **publicar direto** (sem aprovação) / excluir (lixeira) — **sem** excluir permanentemente | Upload / editar / excluir | Criar / colorir / **excluir** | Criar / editar / publicar | Ver | — (sem acesso a esta tela) | — (sem acesso a esta tela) | — (sem acesso a esta tela) |

- Editor tem praticamente as mesmas permissões operacionais de um Administrador (Páginas, Mídia, Pastas, Scripts, Notificações, Perfil próprio) — as únicas coisas fora do alcance dele são a gestão de Usuários, a tela de Logs, as Configurações do site (ver [`SETTINGS.md`](./SETTINGS.md)) e a **exclusão permanente** de páginas na Lixeira (só Master/Administrador — ver [`PAGES.md`](./PAGES.md)). Publicar Scripts como Editor injeta JS no site público — threat model em [`CUSTOM-CODE.md`](./CUSTOM-CODE.md).
- Editor publica direto — não existe fluxo de aprovação do Administrador. O mesmo vale para excluir página (vai para a Lixeira) e para **excluir pasta** (remove a pasta e move páginas/mídia dela para a Base daquela árvore — ver `PAGES.md`/`MEDIA.md`).
- Mídia é irrestrita para os três papéis (Master, Administrador, Editor) — basta estar autenticado no painel (ver [`MEDIA.md`](./MEDIA.md)).
- Master e Administrador enxergam rascunhos normalmente dentro do painel, como preview "ao vivo" (ver `PAGES.md`).

## Convite de Usuário — via link gerado por qualquer Administrador

Não há envio automático de e-mail (Brevo está **fora do escopo do MVP**). Qualquer Administrador (Master ou não) gera o convite manualmente e compartilha o link por onde quiser (WhatsApp, e-mail, Slack etc.):

1. Administrador define nome + papel (Administrador ou Editor) e clica em "Gerar convite".
2. Kastir cria um **link único com token** (ex: `kastir.dominio.com/admin/invite/<token>` — rota em inglês sob `/admin`, ver estrutura de pastas em [`STACK.md`](../../STACK.md)) e exibe para o Administrador copiar.
3. Administrador envia esse link pelo canal que preferir.
4. Quem recebe o link clica, informa o **e-mail** e define a própria **senha** nessa mesma tela, e cai logado no painel com o papel já atribuído. É neste passo — não no convite — que o e-mail do usuário é registrado.
5. **O token expira em 24h.** Depois disso o link é cancelado automaticamente — não há reenvio, é preciso gerar um novo convite do zero.
6. **Sem limite de usuários convidados** — quantos Administradores e Editores forem necessários.

## Controle entre Administradores — o papel do Master

- **Troca de papel revoga sessões do painel e tokens OAuth** (access + refresh) do alvo — o papel novo vale no próximo request, sem refresh persistente do papel antigo.
- **O Master pode remover ou alterar qualquer outro usuário livremente** — outros Administradores ou Editores.
- **Um Administrador comum não pode remover nem alterar outro Administrador** (nem o Master) — evita que dois Administradores entrem em conflito de autoridade entre si. Um Administrador comum pode, no entanto, convidar novos usuários e gerenciar Editores normalmente.
- **O Master nunca pode ser removido**, por ninguém, em nenhuma circunstância.

## Esqueci Minha Senha — mesmo padrão do convite (sem e-mail)

Sem Brevo, não há recuperação self-service (exigiria um canal fora de banda para provar identidade). O fluxo reaproveita a mecânica de link/token do convite, disparado por um Administrador para um usuário existente:

1. Usuário esquece a senha e avisa um Administrador por fora do sistema (WhatsApp, Slack etc.).
2. Administrador acessa Usuários → "Gerar link de redefinição" para aquele usuário (Editor ou outro Administrador comum — nunca para o Master, ver abaixo).
3. Kastir gera um link com token (mesma expiração de 24h do convite).
4. Administrador compartilha o link manualmente; usuário clica e define a nova senha.

Não é self-service — sempre depende de uma ação de um Administrador. Trade-off aceitável para um time pequeno/interno no MVP.

## A Senha do Master — sempre via Variável de Ambiente

Diferente de qualquer outro usuário, a senha do **Master nunca é redefinida por outro Administrador dentro do painel** — nem mesmo se existirem outros Administradores na instalação. Ninguém tem autoridade sobre a conta do Master de dentro do sistema; isso é proposital, para que o status protegido do Master seja consistente (se qualquer Administrador pudesse resetar a senha do Master, o "não pode ser removido/alterado" perderia sentido).

Como a infraestrutura não é fixa (cada instalação roda num host Docker diferente — EasyPanel, VPS própria etc.), não dá pra assumir acesso SSH garantido do jeito que o `wp-cli` do WordPress assume. Em vez disso, o Master é criado e recuperado inteiramente por **variáveis de ambiente** do container (ver [`ONBOARDING.md`](./ONBOARDING.md) e [`STACK.md`](../../STACK.md#variáveis-de-ambiente)):

1. **Criação (primeiro boot):** se não existe nenhum Master no banco ainda, o Kastir cria um usando `MASTER_EMAIL`/`MASTER_PASSWORD`. Em qualquer boot seguinte, com o Master já existente, essas duas variáveis são **ignoradas** — um redeploy comum nunca reseta a senha por acidente.
2. **Recuperação/reset:** definir `MASTER_FORCE_RESET=true` (junto de `MASTER_EMAIL`/`MASTER_PASSWORD` com os valores desejados) e reiniciar o container. Só nesse boot, o Kastir força a atualização do e-mail/senha do Master já existente, ignorando o fato de já ter sido criado antes.
3. Depois de confirmar o login, recomenda-se remover `MASTER_FORCE_RESET` da configuração — deixar ligado funciona (o Kastir resincroniza a cada boot), mas é uma escolha explícita de quem administra a instalação, não o padrão esperado.

Funciona em qualquer host Docker, sem depender de SSH — só exige poder editar variáveis de ambiente e reiniciar o container, operação nativa de qualquer painel Docker (EasyPanel incluso).

## Perguntas em Aberto

*(nenhuma pendência no momento)*
