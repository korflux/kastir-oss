# Clientes MCP — conectar ao Kastir

Como conectar Claude, Codex, Grok e Antigravity ao servidor MCP remoto do
Kastir (`/api/mcp`, Streamable HTTP + OAuth 2.1 + DCR). Contrato 2.0.0:
`update` de página/script é rascunho; `publish` é a fronteira live.

URL canônica do recurso (use **exatamente** este path; trailing slash é
tolerado no `resource`, mas host/scheme/porta precisam bater com
`BETTER_AUTH_URL`):

```text
https://<seu-dominio>/api/mcp
```

Descoberta OAuth:

- Protected resource: `/.well-known/oauth-protected-resource`
- Authorization server: `/.well-known/oauth-authorization-server/api/auth`

## Claude

1. Adicionar um conector MCP remoto (Custom / Remote MCP) com a URL
   `https://<seu-dominio>/api/mcp`.
2. Completar o fluxo OAuth no browser (consent de scopes).
3. Verificar: `tools/list` lista as tools `kastir_*`; chamar
   `kastir_site_get_context` e uma mutation (ex.: criar pasta de teste).
   `kastir_pages_update` / `kastir_scripts_update` só gravam rascunho —
   conteúdo live exige `kastir_pages_publish` / `kastir_scripts_publish`.
   Para voltar ao ar o que já foi publicado, sem alteração nova (publish
   recusa com `INVALID_STATE`), use `kastir_pages_activate` /
   `kastir_scripts_activate`.

## Codex (OpenAI)

Arquivo típico `~/.codex/mcp.json` (ou equivalente da versão em uso):

```json
{
  "mcpServers": {
    "kastir": {
      "type": "http",
      "url": "https://<seu-dominio>/api/mcp"
    }
  }
}
```

Notas:

- O `resource` no authorize/token deve ser a URL do MCP (com ou sem `/` final).
- O metadata do AS anuncia `registration_endpoint` (DCR). Se o handshake falhar,
  capture em qual etapa (descoberta / DCR / token / POST `/api/mcp`) e o
  valor literal de `resource` enviado.

Verificação: `tools/list` + `kastir_pages_list` + uma mutation pequena.

## Grok (xAI)

**Remoto nativo: sim.** Documentação xAI:

- [Remote MCP Tools](https://docs.x.ai/developers/tools/remote-mcp)
- [MCP Servers](https://docs.x.ai/build/features/mcp-servers) — transporte HTTP
  com OAuth automático no CLI (`grok mcp add --transport http …`).

Exemplo CLI:

```bash
grok mcp add --transport http kastir https://<seu-dominio>/api/mcp
```

No produto web (Connectors), adicionar conector custom com a mesma URL e
completar OAuth.

Caminho escolhido: **nativo remoto**. `mcp-remote` só se o cliente for stdio.

## Antigravity (Google)

**Remoto HTTP: sim (config `serverUrl`).** OAuth genérico MCP é uneven:

- Docs oficiais: [Antigravity MCP](https://antigravity.google/docs/mcp) —
  suporta `stdio` e `serverUrl` (Streamable HTTP/SSE), com bloco `oauth` opcional.
- Relatos da comunidade (2026): OAuth MCP padrão nem sempre funciona; bridge
  via `npx mcp-remote <url>` continua válido.

Caminho preferido:

1. Tentar remoto nativo com a URL do Kastir + OAuth embutido.
2. Se falhar no OAuth: stdio com bridge:

```json
{
  "mcpServers": {
    "kastir": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<seu-dominio>/api/mcp"]
    }
  }
}
```

## Por que o servidor **não** valida `Origin` (E10)

A recomendação da spec MCP de checar `Origin` mira servidores **locais**
(defesa DNS rebinding contra `localhost`). O Kastir é remoto, atrás de Bearer
+ rate limit por token. Clientes não-browser (Codex CLI, `mcp-remote`, SDKs)
**não enviam `Origin`**; exigir o header mataria exatamente os provedores que
precisamos suportar. Não implementar validação de `Origin` aqui.

## Checklist manual (resultado da fase)

Preencher após testar em cada cliente:

| Provedor | Conecta? | `tools/list` | Leitura | Mutation | Notas |
| --- | --- | --- | --- | --- | --- |
| Claude | _(manual)_ | | | | |
| Codex | _(manual)_ | | | | Ver T1 se falhar |
| Grok | nativo documentado | | | | |
| Antigravity | nativo ou `mcp-remote` | | | | |

## Contrato de resposta (fase 35)

- Respostas só em `content[0].text` (JSON) — sem `structuredContent`.
- Mutations: `{ "ok": true, "summary": "…", "data": { … } }` (sem eco do registro
  inteiro; `summary` cita o id, nunca o titulo digitado pelo usuário).
- `pages_get` / `scripts_get` / `pages_preview`: sem corpo longo por padrão;
  use `contentStart` / `contentLength` e `nextStart` para blocos.
- `site_get_context`: `capabilities` derivadas do caller; template HTML só com
  `includePageTemplate: true`.
