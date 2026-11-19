# Documentação do Kastir

Mapa da pasta `docs/`. O mapa do código fica no [`AGENTS.md`](../AGENTS.md) da
raiz. Pasta nova ou renomeada entra nos dois arquivos no mesmo change.

A documentação técnica está em português (pt-BR); o [`README.md`](../README.md)
da raiz está em inglês.

| Arquivo ou pasta                                     | Conteúdo                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| [`DEPLOY.md`](./DEPLOY.md)                           | Deploy self-host com Docker: volumes, portas e variáveis de ambiente      |
| [`STACK.md`](./STACK.md)                             | Stack técnica, estrutura de pastas e convenções                           |
| [`DESIGN.md`](./DESIGN.md)                           | Design system do painel                                                   |
| [`reference/features/`](./reference/features/)       | Spec viva de cada módulo (Pages, Media, Users, Settings…)                 |
| [`reference/mcp-cms.md`](./reference/mcp-cms.md)     | Desenho do servidor MCP                                                   |
| [`reference/mcp-cms-catalogo.md`](./reference/mcp-cms-catalogo.md) | Catálogo das tools MCP                                      |
| [`reference/mcp-clientes.md`](./reference/mcp-clientes.md) | Como conectar clientes MCP (Claude, Codex, Grok, Antigravity)      |
| [`reference/database-schema.md`](./reference/database-schema.md) | Notas sobre o schema do banco                                 |
| [`reference/security-scan-checklist.md`](./reference/security-scan-checklist.md) | Checklist de scan de segurança               |

O manual operacional do MCP fica em
[`lib/Modules/Mcp/Guide.ts`](../lib/Modules/Mcp/Guide.ts): é código estático
servido pela tool `kastir_guide_get`, não uma cópia em `docs/reference/`.

## Onde colocar o quê

| Tipo de arquivo                                       | Destino                                  |
| ----------------------------------------------------- | ---------------------------------------- |
| Spec de produto ou feature por módulo                 | `docs/reference/features/<FEATURE>.md`   |
| Desenho técnico usado por vários módulos              | `docs/reference/`                        |
| Relatório de teste, coverage, log                     | **Não versionar**; ver `.gitignore`      |
