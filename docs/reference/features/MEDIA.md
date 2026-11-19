# Biblioteca de Mídia

> Voltar ao [índice da documentação](../README.md) · Armazenamento definido em [`STACK.md`](../../STACK.md) · Sistema de pastas igual [`PAGES.md`](./PAGES.md)

## O que é

Equivalente à Media Library do WordPress: uma tela única onde o time sobe arquivos de mídia (imagens, documentos, vídeo — uma a uma ou em massa), pega o link para colar no HTML da página (ver [`PAGES.md`](./PAGES.md)), edita metadados e apaga o que não precisa mais.

## Armazenamento

- Pasta local dentro do container, em um volume Docker persistente: `public/uploads/<mediaFileId>/` (ver `STACK.md`) — precisa estar mapeado pelo host, senão os uploads somem a cada redeploy da imagem. O caminho usa o `id` do arquivo, não o nome/posição da pasta de Mídia: renomear ou mover uma pasta nunca move arquivo em disco nem muda a URL pública.

### Tipos Aceitos e Limites

**Proposta (a validar):** lista branca de extensões — nunca "aceita qualquer arquivo". Cada categoria tem processamento e limite próprios:

| Categoria | Extensões | Processamento no upload | Limite |
|---|---|---|---|
| Imagem (raster) | jpg, jpeg, png, webp, gif | Convertida/comprimida para **WebP** automaticamente (toggle e parâmetros em [`SETTINGS.md`](./SETTINGS.md#13-conversão-de-imagem-webp)) | 20MB |
| Imagem (vetor) | svg | **Sanitizada** (remove `<script>`/handlers; recusa texto envolvente, `@import` e `data:text/html`) — nunca rasterizada | 20MB |
| Documento | pdf | Nenhum — armazenado como está | 20MB |
| Vídeo | mp4 | Nenhum — armazenado como está, sem transcodificação (candidato a fase futura) | 200MB |

- **Acima de 1MB numa imagem raster**, um popup recomenda salvar/exportar em **WebP ou AVIF** antes de subir — aviso educativo, **não bloqueia o upload**. Não se aplica a SVG, PDF ou vídeo.
- **Validação real de tipo** (assinatura/magic bytes do arquivo), não só a extensão do nome — bloqueia um arquivo disfarçado (ex: um `.exe` renomeado para `.jpg`) antes de gravar no disco.
- Itens que não são imagem (PDF, vídeo) mostram um **ícone de tipo de arquivo** na listagem, em vez de thumbnail — gerar preview real de PDF/vídeo fica para uma fase futura.

## Ações da Tela

| Ação | Comportamento |
|---|---|
| **Upload único** | Seleciona um arquivo por vez |
| **Upload em massa** | Seleciona ou arrasta vários arquivos de uma vez |
| **Arrastar e soltar (drag-and-drop)** | Área de upload aceita arquivos soltos diretamente, single ou em massa |
| **Pegar link** | Botão de copiar a URL pública do arquivo (`https://dominio.com/uploads/.../arquivo.webp`), pronta para colar em uma tag `<img>`, `<a>` ou `<video>` no HTML da página, conforme o tipo |
| **Editar nome/metadados** | Renomear o arquivo/registro e editar Alt/Descrição (ver seção abaixo) |
| **Substituir arquivo** | Faz upload de um novo arquivo **mantendo o mesmo nome/URL** do original, de qualquer tipo aceito — útil para atualizar mídia sem quebrar páginas já publicadas que referenciam aquele link. Dispara **purge automático** do CloudFlare (se configurado) para aquela URL (ver `STACK.md`) — sem CDN configurado, a troca já é imediata, já que o Nginx serve o arquivo direto do disco |
| **Apagar (um item)** | Exige **confirmação bloqueante** antes de excluir de fato |
| **Selecionar e apagar em massa** | Seleção múltipla de itens, com a mesma confirmação bloqueante antes de excluir |

### Por que a confirmação é sempre exibida (não só quando "está em uso")

Como o conteúdo da página é um blob de HTML solto (ver `PAGES.md`), o Kastir **não rastreia** quais arquivos estão referenciados em quais páginas. Por isso a confirmação de exclusão é **sempre** exibida com o aviso genérico de que o arquivo pode estar em uso em alguma página publicada — não é uma verificação real de uso, é uma precaução. A alternativa "Substituir arquivo" existe justamente para quem sabe que o arquivo está em uso e quer trocar o conteúdo sem quebrar o link.

## Uso do Arquivo na Página — link direto, sem "tag"/shortcode

A forma de usar um arquivo da Biblioteca dentro de uma página é **copiar o link direto** (URL) e colar manualmente na tag correspondente do HTML (`<img>`, `<a href>`, `<video>`...) — igual ao fluxo do WordPress.

**Por que não um sistema de tag/shortcode** (ex: `[imagem id=42]`): isso exigiria o Kastir **interpretar e reescrever** o HTML no momento da publicação para resolver a tag na URL real — exatamente o tipo de processamento que a arquitetura de páginas evita (ver "Por que não Astro" em `PAGES.md`). Um link direto mantém o princípio de zero processamento extra sobre o conteúdo colado.

## Organização em Pastas

**Mesmas regras de UX de [`PAGES.md`](./PAGES.md)** (Base + 3 níveis + cores), mas **árvore de dados separada** — pastas de Mídia não são as mesmas pastas de Páginas (ver [`STACK.md`](../../STACK.md#pastas--duas-árvores-paralelas)):

- Pasta obrigatória **"Base"** (da mídia) — todo upload sem pasta definida cai nela; não pode ser excluída; **pode ser renomeada** (rótulo livre, flag de default permanece).
- Subpastas com **limite de 3 níveis de aninhamento**.
- Cor por pasta: **hex livre** ou uma das **6 cores pré-definidas** (Azul `#3B82F6`, Verde `#22C55E`, Amarelo `#EAB308`, Roxo `#A855F7`, Laranja `#F97316`, Rosa `#EC4899`).
- **Excluir pasta de mídia:** remove a pasta; arquivos que estavam nela (e em subpastas) vão para a **Base de mídia** — nenhum arquivo é apagado. Master, Administrador e **Editor** podem excluir pastas de mídia (exceto a Base).

## Busca

Necessária para o MVP. Busca por: **nome do arquivo**, **URL**, **texto alternativo (alt)** e **descrição** — cobrindo todos os metadados de um item, não só o nome.

## Nome Duplicado no Upload

**Proposta (a validar):** seguindo o padrão do WordPress, ao subir um arquivo com nome já existente, o Kastir **acrescenta um sufixo numérico automaticamente** (`foto.webp` → `foto-1.webp` → `foto-2.webp`), sem bloquear o upload nem pedir confirmação. Simples, previsível, e evita que dois arquivos colidam silenciosamente no disco.

## Metadados por Arquivo (SEO/Acessibilidade)

Cada item da Biblioteca de Mídia tem, além do arquivo em si:

| Campo | Uso |
|---|---|
| **Nome** | Nome de exibição na biblioteca (editável, independente do nome do arquivo no disco) |
| **Texto Alternativo (alt)** | Descrição curta para acessibilidade e SEO — o equivalente ao "Alt Text" do WordPress. Mais relevante pra imagem, mas o campo existe pra qualquer tipo (ajuda na busca interna) |
| **Descrição** | Campo livre, mais longo, para contexto adicional (opcional) |

> **Nuance importante:** como o conteúdo da página é um blob de HTML colado manualmente, esses campos de Alt/Descrição são **metadados da própria Biblioteca de Mídia** (úteis para busca e organização interna) — eles não são injetados automaticamente na tag `<img>` dentro do HTML da página. Quem monta a página é responsável por incluir o atributo `alt="..."` manualmente ao referenciar a imagem.

## Permissões

**Acesso irrestrito para Master, Administrador e Editor** — upload, edição de metadados (nome/alt/descrição), substituição e exclusão (individual ou em massa) estão disponíveis para os três papéis igualmente. Não há distinção por papel nesta tela; basta estar autenticado no painel (ver tabela completa em [`USERS.md`](./USERS.md)).

## Limite de Espaço em Disco Total

**Proposta:** sem cota artificial de software por instalação — o limite real é o espaço em disco disponível no volume onde `public/uploads/` está montado, monitorado e expandido por quem administra a infraestrutura (EasyPanel ou outro host Docker). Sem teto configurável no Kastir por enquanto.

## Decisões Fechadas

- ✅ Aceita mais que imagem: imagem raster (jpg/png/webp/gif, convertida pra WebP por padrão — toggle e parâmetros em `SETTINGS.md`), SVG (sanitizado, não rasterizado), PDF e MP4 — lista branca de extensões, nunca "qualquer arquivo". Limite 20MB pra imagem/SVG/PDF, 200MB pra vídeo.
- ✅ Conversão para WebP roda sempre em fila assíncrona (Redis), nunca bloqueia o upload — necessário pelos parâmetros de compressão mais lentos escolhidos (ver `SETTINGS.md`).
- ✅ Validação de tipo por assinatura real do arquivo, não só extensão do nome — bloqueia upload disfarçado.
- ✅ Popup (não bloqueante) recomendando WebP/AVIF acima de 1MB vale só pra imagem raster.
- ✅ Uso de arquivo na página é só **link direto** — sem sistema de tag/shortcode.
- ✅ Exclusão sempre pede **confirmação bloqueante**; existe alternativa de **"Substituir arquivo"** mantendo o mesmo nome/URL.
- ✅ Upload único, em massa, e via drag-and-drop.
- ✅ Seleção múltipla com exclusão em massa (mesma confirmação).
- ✅ Mesmas regras de pastas de `PAGES.md` (Base + subpastas até 3 níveis + 6 cores + hex livre), com **árvore de dados própria** (não compartilha pastas com Páginas).
- ✅ Busca necessária: por nome, URL, alt e descrição.
- ✅ Sem limite de espaço em disco total por instalação (bound apenas pelo disco do volume persistente).
- ✅ Sem distinção de papel: Master, Administrador e Editor têm acesso irrestrito à Biblioteca de Mídia.

## Perguntas em Aberto

*(nenhuma pendência no momento)*
