# Changelog

## Unreleased

### Breaking

- MCP `kastir_pages_update` e `kastir_scripts_update` deixam de publicar.
  Fluxo live: `update` (rascunho) → `kastir_pages_publish` /
  `kastir_scripts_publish`.
- `UPDATE_PUBLISHED_SCRIPT` deixa de existir. Publish/unpublish de script
  continuam exigindo `PUBLISH_SCRIPT` / `UNPUBLISH_SCRIPT`.
- Unpublish passa a desativar a revisão publicada sem zerar
  `publishedRevisionId`.
- Superfície nova: `kastir_{pages,scripts}_revisions_{list,get,diff,restore}`.
  Não há purge/delete de revisão no MCP.
- `kastir_settings_update` aceita `revisionRetentionLimit` (5–30). O campo é
  opcional: omitir preserva o valor vigente (não reseta para 5).

O major bump sai do commit `feat!:` (hook de push). Não editar
`package.json#version` à mão.
