# Ações humanas do MCP do CMS Kastir (contrato 2.0.0)

Catálogo simples do que uma pessoa poderá pedir ao agente. Os nomes técnicos
das ferramentas aparecem entre parênteses apenas como referência.

## Site

- Ver informações gerais do site: título, domínio público, idioma, timezone e versão do Kastir (`kastir_site_get_context`).
- Consultar o manual sob demanda (`kastir_guide_get`), por índice ou tópico.
- Ver o **modelo HTML didático de página nova** no idioma do site (`kastir_site_get_context` → `starters.pageTemplate`).
- Ver configurações públicas do site (`kastir_settings_get`).
- Ver quais recursos estão habilitados no site (`kastir_site_get_context`).
- Ver o andamento de uma operação iniciada pelo agente (`kastir_operation_get`).

## Páginas

### Ver

- Ver todas as páginas.
- Ver somente páginas publicadas.
- Ver somente rascunhos.
- Ver páginas dentro de uma pasta.
- Procurar uma página pelo título ou slug.
- Ver uma página específica, incluindo seu conteúdo e SEO.
- Conferir o conteúdo do rascunho pelo hash (`contentSha256`) e pelo tamanho
  em bytes (`contentBytes`), sem reler o conteúdo inteiro. `contentTotal` conta
  unidades UTF-16 (CRLF vale 2; caractere fora do BMP vale 2), não bytes.
- Ver o histórico de revisões de uma página, abrir uma revisão e comparar com o rascunho.
- Comparar o rascunho com a revisão publicada antes de publicar
  (`kastir_pages_revisions_diff` com `from` na revisão publicada e `to="draft"`).
- Ver a lixeira de páginas.
- Ver uma prévia renderizada de uma página.
- Ver quem criou uma página e quando ela foi atualizada.
- Ver quantos scripts publicados afetam uma página.

Ferramentas relacionadas: `kastir_pages_list`, `kastir_pages_get`,
`kastir_pages_preview`, `kastir_pages_revisions_list`,
`kastir_pages_revisions_get`, `kastir_pages_revisions_diff`.

### Fazer

- Criar uma página (se `content` for omitido ou vazio, o MCP semeia o
  template didático no idioma do site e devolve esse HTML na resposta).
- Editar título, slug, conteúdo ou SEO de uma página (só o rascunho; não publica).
  Com o hash do conteúdo lido (`expectedContentSha256`), outra gravação que
  chegou antes resulta em conflito em vez de sobrescrita.
- Trocar um trecho do conteúdo sem reenviar a página inteira (`kastir_pages_patch`:
  de 1 a 50 buscas e trocas exatas, cada trecho buscado deve existir uma vez só,
  tudo ou nada, com o hash do rascunho lido; só o rascunho; não publica).
- Mover uma página para outra pasta.
- Duplicar uma página.
- Restaurar uma revisão antiga para o rascunho (não publica).
- Publicar o rascunho atual (recusa com `INVALID_STATE` quando não há alteração não publicada).
- Voltar ao ar uma página fora do ar sem alteração nova (`activate`: religa a revisão já publicada, sem criar versão; recusa página nunca publicada).
- Tirar uma página do ar (desativa; o ponteiro da revisão publicada permanece).
- Mandar uma página para a lixeira.
- Restaurar uma página da lixeira.
- Exclusão permanente de página **não está exposta no MCP**; deve ser feita pelo painel.

Ferramentas relacionadas: `kastir_pages_create`, `kastir_pages_update`,
`kastir_pages_patch`, `kastir_pages_duplicate`, `kastir_pages_publish`,
`kastir_pages_activate`, `kastir_pages_unpublish`, `kastir_pages_trash`,
`kastir_pages_restore`, `kastir_pages_revisions_restore`.

### Pastas de páginas

- Ver todas as pastas de páginas.
- Ver a árvore de pastas.
- Criar uma pasta.
- Renomear uma pasta.
- Alterar a cor de uma pasta.
- Excluir uma pasta **não está exposto no MCP**; a exclusão da hierarquia
  continua disponível somente no painel, quando aplicável.

Ferramentas relacionadas: `kastir_page_folders_list`,
`kastir_page_folders_create`, `kastir_page_folders_update`.

`kastir_page_folders_update` aceita `parentId` junto com nome/cor. O movimento
é atômico e rejeita Base, parent inexistente, ciclo e profundidade inválida.
Use `parentId: null` para promover a pasta à raiz.

## Mídias

### Ver

- Ver todas as mídias.
- Procurar uma mídia por nome, URL, texto alternativo ou descrição.
- Filtrar mídias por pasta.
- Filtrar mídias por tipo: imagem, SVG, PDF ou vídeo.
- Ver mídias que ainda estão processando.
- Ver mídias que falharam no processamento.
- Ver os detalhes de uma mídia: nome, arquivo, tipo, tamanho, alt e descrição.
- Ver a URL pública de uma mídia pronta.
- Baixar o arquivo de uma mídia.
- Ver todas as pastas de mídia.

Ferramentas relacionadas: `kastir_media_list`, `kastir_media_get`,
`kastir_media_download`, `kastir_media_folders_list`.

### Fazer

- Enviar uma mídia nova em base64 padrão, com limite de 20 MiB.
- Substituir os bytes de uma mídia com confirmação `REPLACE_MEDIA`.
- Exclusão de mídia **não está exposta no MCP**; use o painel.
- Definir nome, texto alternativo e descrição de uma mídia.
- Editar os metadados de uma mídia.
- Converter uma imagem para WebP.
- Criar uma pasta de mídia.
- Renomear uma pasta de mídia.
- Alterar a cor de uma pasta de mídia.
- Mover uma pasta de mídia ou promovê-la à raiz usando `parentId`.
- Exclusão de pasta de mídia **não está exposta no MCP**.

Ferramentas relacionadas: `kastir_media_upload`, `kastir_media_replace`, `kastir_media_update`,
`kastir_media_convert_to_webp`, `kastir_media_folders_create`,
`kastir_media_folders_update`.

`kastir_media_folders_update` persiste `parentId` no mesmo update de nome/cor e
usa as mesmas proteções da árvore de pastas de páginas.

## Scripts e códigos personalizados

No painel, esses itens são chamados de scripts; internamente, o CMS os chama
de `Snippet`.

### Ver

- Ver todos os scripts.
- Ver somente scripts publicados.
- Ver somente rascunhos.
- Procurar um script pelo nome.
- Filtrar scripts por local de injeção: cabeçalho, início do body ou fim do body.
- Ver o conteúdo de um script específico.
- Conferir o código do rascunho pelo hash (`contentSha256`) e pelo tamanho em
  bytes (`contentBytes`); `contentTotal` conta unidades UTF-16, não bytes.
- Ver o histórico de revisões de um script, abrir uma revisão e comparar com o rascunho.
- Comparar o rascunho com a revisão publicada antes de publicar
  (`kastir_scripts_revisions_diff` com `from` na revisão publicada e `to="draft"`).
- Ver se o script tem **gatilho de popup** (`triggerType`) e caps de
  exibição (`maxDisplays` / `displayResetDays`) — na listagem sem o
  `triggerConfig` completo.
- Ver o detalhe do gatilho (`triggerConfig`) junto com o conteúdo.
- Ver se o script afeta todas as páginas ou páginas específicas.
- Ver quais páginas são afetadas por um script.
- Ver quais páginas estão disponíveis para receber um script.

Ferramentas relacionadas: `kastir_scripts_list`, `kastir_scripts_get`,
`kastir_scripts_scope_pages_list`, `kastir_scripts_revisions_list`,
`kastir_scripts_revisions_get`, `kastir_scripts_revisions_diff`.

### Fazer

- Criar um script.
- Editar nome, local, conteúdo, prioridade e escopo de um script (só o rascunho; não publica).
  Com o hash do conteúdo lido (`expectedContentSha256`), outra gravação que
  chegou antes resulta em conflito em vez de sobrescrita.
- Trocar um trecho do código sem reenviar o script inteiro (`kastir_scripts_patch`:
  de 1 a 50 buscas e trocas exatas, cada trecho buscado deve existir uma vez só,
  tudo ou nada, com o hash do rascunho lido; só o rascunho; não publica).
- Configurar um **gatilho de popup** opcional no script:
  - seletor CSS com `click` ou `submit` (`SELECTOR_EVENT`);
  - atraso após carregar a página (`PAGE_LOAD`);
  - percentual de scroll (`SCROLL`);
  - match em `document.referrer` (`REFERRER`);
  - limite de exibições por navegador (`maxDisplays` + `displayResetDays`).
- Remover o gatilho (`trigger: null` no update).
- Associar um script a páginas específicas (até 1000 páginas por script, por
  ids `cuid` de `kastir_scripts_scope_pages_list`; repetidos viram um).
- Alterar um script para afetar todas as páginas.
- Duplicar um script.
- Restaurar uma revisão antiga para o rascunho (não publica).
- Publicar o rascunho atual com confirmação `PUBLISH_SCRIPT` (recusa com `INVALID_STATE` quando não há alteração não publicada).
- Voltar ao ar um script fora do ar sem alteração nova com `activate` e confirmação `PUBLISH_SCRIPT` (religa a revisão já publicada, sem criar versão; recusa script nunca publicado).
- Tirar um script do ar com confirmação `UNPUBLISH_SCRIPT` (desativa; o ponteiro permanece).
- Mover um script para a lixeira; exclusão permanente e purge de revisão não estão expostos no MCP.

Ferramentas relacionadas: `kastir_scripts_create`, `kastir_scripts_update`,
`kastir_scripts_patch`, `kastir_scripts_duplicate`, `kastir_scripts_publish`,
`kastir_scripts_activate`, `kastir_scripts_unpublish`, `kastir_scripts_trash`,
`kastir_scripts_revisions_restore`.

> A plataforma só revela/oculta o snippet no momento do gatilho; overlay,
> botão de fechar e ESC ficam no HTML/CSS/JS do próprio script.
>
> O servidor não executa o HTML/JavaScript durante a chamada. Depois da
> publicação, o conteúdo é injetado nas páginas públicas do escopo e pode
> executar no navegador dos visitantes; a confirmação é validada no servidor.

## Edição parcial e hash de conteúdo (páginas e scripts)

Vale para `kastir_pages_patch` e `kastir_scripts_patch`; o detalhe técnico está
em [`mcp-cms-catalogo.md`](./mcp-cms-catalogo.md#edição-parcial-e-hash-de-conteúdo).

- **Limites de entrada:** de 1 a 50 operações por chamada; o trecho buscado
  (`old`) não pode ser vazio e deve existir exatamente uma vez no conteúdo
  corrente; o hash esperado (`expectedContentSha256`) é obrigatório e tem 64
  hexadecimais; o resultado respeita 2 MiB em UTF-8. O casamento é exato, sem
  normalizar CRLF nem Unicode.
- **Entrada inválida** (51 operações, `old` vazio, campo fora da lista
  permitida, hash sem 64 hexadecimais ou ausente) chega como
  `VALIDATION_ERROR` "Invalid arguments for tool <tool>", sem o campo nem o
  valor enviado. Trecho ausente ou repetido chega como `VALIDATION_ERROR` com o
  número da operação (a partir de 0) e a contagem encontrada. Nesses casos nada
  é gravado.
- **Conflito:** hash diferente do atual resulta em `CONFLICT` com o hash atual
  na mensagem. Quando o `expectedContentSha256` é enviado, ele é a única versão
  conferida e `expectedUpdatedAt` é ignorado, então publicar, ativar ou tirar
  do ar entre a leitura e a gravação não gera conflito falso.
- **O que prova a gravação:** `contentSha256` e `contentBytes` voltam no get, no
  update e no patch. `draftFingerprint` é o hash do conjunto (título, slug,
  conteúdo, SEO e pasta; no script, os campos do snippet), não do conteúdo, e
  não serve para conferir o conteúdo gravado.
- **Permissão:** o patch exige o mesmo escopo de escrita do update e conta no
  mesmo limite de mutações por minuto.

## Split tests / testes A/B

### Ver

- Ver todos os testes A/B.
- Ver somente testes ativos.
- Ver somente testes pausados.
- Procurar um teste pelo nome ou slug.
- Ver os detalhes de um teste.
- Ver os destinos de um teste na ordem configurada.
- Ver quais destinos estão ativos ou pausados.
- Ver a quantidade de acessos de cada destino.
- Ver o percentual real de acessos de cada destino.
- Ver o peso teórico de distribuição dos destinos ativos.
- Ver o total de acessos de uma campanha.
- Ver estatísticas diárias UTC no intervalo informado; o intervalo é inclusivo.

Ferramentas relacionadas: `kastir_split_tests_list`,
`kastir_split_tests_get`, `kastir_split_tests_stats`.

### Fazer

- Criar um teste A/B.
- Definir o nome, slug e destinos iniciais.
- Editar o nome de um teste.
- Editar o slug de um teste.
- Ativar ou pausar um teste.
- Adicionar um destino.
- Editar a URL, nome ou status de um destino.
- Ativar ou pausar um destino.
- Reordenar os destinos.
- Mover uma campanha para a lixeira; hard delete e exclusão de destino não
  estão expostos no MCP.

Ferramentas relacionadas: `kastir_split_tests_create`,
`kastir_split_tests_update`, `kastir_split_tests_destinations_create`,
`kastir_split_tests_destinations_update`,
`kastir_split_tests_destinations_reorder`, `kastir_split_tests_trash`.

Um teste novo nasce `PAUSED`; use `kastir_split_tests_update` com
`status: "ACTIVE"` somente depois de revisar os destinos.

> Alterar ou excluir destinos pode mudar o redirecionamento dos visitantes.
> URLs externas devem ser tratadas como uma ação de alto risco.

## Logs e auditoria

- Ver o histórico de alterações do CMS.
- Filtrar logs por período.
- Filtrar logs por usuário.
- Filtrar logs por área: páginas, mídias, scripts, usuários, configurações ou split tests.
- Ver quem publicou, editou ou excluiu um item.

Ferramenta relacionada: `kastir_audit_logs_list`.

## Permissões resumidas

| Ação | Editor | Admin | Master |
| --- | --- | --- | --- |
| Ver páginas, mídias, scripts e split tests | Sim | Sim | Sim |
| Criar e editar conteúdo | Com escopo de escrita | Com escopo de escrita | Com escopo de escrita |
| Publicar páginas | Escopo de publish | Escopo de publish | Escopo de publish |
| Publicar/alterar scripts live | Confirmação server-side + escopo | Confirmação server-side + escopo | Confirmação server-side + escopo |
| Exclusões permanentes via MCP | Não expostas | Não expostas | Não expostas |
| Ver logs e configurações | Não | Sim | Sim |

O servidor valida papel e scope em conjunto tanto na descoberta quanto na
execução; um token com scope incompatível com o papel não amplia permissões.
