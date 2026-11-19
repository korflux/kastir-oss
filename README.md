<!--
  README público do Kastir.
  Imagens: docs/assets/ (capturas do painel e GIF de demonstração, geradas com dados fictícios).
  Licença: FSL-1.1-ALv2 (ver LICENSE.md). Se a licença mudar, atualizar o badge, a seção "License" e o FAQ.
-->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/admin-brand/kastir-logo-dark.webp" />
    <img src="public/admin-brand/kastir-logo-light.webp" alt="Kastir" width="260" />
  </picture>
</p>

<h3 align="center">The micro-CMS for AI-generated pages.</h3>

<p align="center">
  Paste the HTML your AI wrote. Organize it. Publish it as a static file.<br />
  <strong>Zero framework between your page and your visitor.</strong>
</p>

<p align="center">
  <a href="#-quick-start"><strong>Quick start</strong></a> ·
  <a href="#-features">Features</a> ·
  <a href="#-let-your-ai-agent-run-the-cms">MCP</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-license">License</a>
</p>

<p align="center">
  <a href="./LICENSE.md"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-22c55e?style=flat-square" /></a>
  <img alt="Node 22" src="https://img.shields.io/badge/node-22_LTS-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/self--host-Docker-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-OAuth_2.1-8b5cf6?style=flat-square" />
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Kastir demo: paste HTML, publish, open the live static page" width="100%" />
</p>

---

## ✨ Why Kastir?

AI tools now write complete landing pages in seconds. Getting them **online, organized and fast** is still a chore: page builders want to rebuild your HTML, and most CMSs put a heavy runtime in front of every visitor.

Kastir takes the opposite path:

|                        | Typical CMS                         | **Kastir**                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------ |
| Your AI-generated HTML | Rebuilt in a page builder           | **Pasted as is.** Full HTML, CSS and JS                      |
| What visitors hit      | App server, plugins, database query | **A static `index.html` served by Nginx**                    |
| Who can operate it     | Humans clicking in a panel          | Humans **and AI agents** through a built-in MCP server       |
| Day-to-day workflow    | Varies                              | Folders, media, scripts, drafts, revisions, roles, audit log |
| Self-hosting           | Install wizards, plugins, updates   | **One Docker image** + Postgres + Redis + env vars           |

> **The name.** _Kastir_ comes from **cast**, as in molding: every page is cast into a final static HTML artifact and put in place, like precast concrete.

---

## 🧩 Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>📄 Pages</h3>
      Full-page HTML editor (CodeMirror), SEO fields, draft → publish, trash and restore, nested folders, duplicate, and private previews for drafts.
    </td>
    <td width="50%" valign="top">
      <h3>⚡ Static publishing</h3>
      Publishing compiles the page to <code>public/&lt;slug&gt;/index.html</code>. Nginx serves the file directly, with optional Cloudflare cache purge.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🕓 Revisions</h3>
      Every save is a snapshot. Compare versions with a diff, restore any of them, and pin the ones you want to keep.
    </td>
    <td valign="top">
      <h3>🖼️ Media library</h3>
      Images (optional WebP conversion), SVG, PDF and MP4, in folders with alt text and stable public URLs.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🧷 Custom code</h3>
      Inject HTML/JS into the head, body start or body end, globally or per page, plus popups with triggers.
    </td>
    <td valign="top">
      <h3>🔀 Split tests</h3>
      Weighted redirects at <code>/s/{slug}</code> with hit counters, to internal or external destinations.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>👥 Team and roles</h3>
      Master, Admin and Editor roles, enforced on the server. Invite links, password reset and an audit log.
    </td>
    <td valign="top">
      <h3>🤖 AI-native</h3>
      A remote MCP server with OAuth 2.1: agents create, edit and publish under the <strong>same rules</strong> as the panel.
    </td>
  </tr>
</table>

<p align="center">
  <img src="docs/assets/pages.png" alt="Pages list with folders" width="49%" />
  <img src="docs/assets/editor.png" alt="HTML page editor with SEO fields" width="49%" />
</p>
<p align="center">
  <img src="docs/assets/media.png" alt="Media library" width="49%" />
  <img src="docs/assets/split-tests.png" alt="Split tests" width="49%" />
</p>

There is also an admin bar on the live site for signed-in editors, a setup hub (settings, MCP connections, logs, backup export/import/restore), in-panel notifications, a guided tour on first login, and a panel in English and Brazilian Portuguese.

---

## 🤖 Let your AI agent run the CMS

Kastir ships a **remote MCP server** at `/api/mcp` (Streamable HTTP, OAuth 2.1 with dynamic client registration). Connect Claude, Codex, Cursor or any MCP client, approve the consent screen, and the agent can work with pages, media, scripts, split tests and settings.

```text
You:   "Create a landing page for the Black Friday campaign, put it in the
        Campaigns folder, and publish it at /black-friday."

Agent: kastir_pages_create  → draft saved
       kastir_pages_publish → live at https://your-site.com/black-friday/
```

The guardrails are built in. The agent goes through the same services, permissions and audit log as a human user. Updates land as drafts, and publishing is a separate, explicit step. The MCP **never exposes permanent deletion**.

Client setup guides: [`docs/reference/mcp-clientes.md`](./docs/reference/mcp-clientes.md) · Tool catalog: [`docs/reference/mcp-cms-catalogo.md`](./docs/reference/mcp-cms-catalogo.md)

---

## 🚀 Quick start

Build the image and run it against an external PostgreSQL and Redis:

```bash
git clone https://github.com/korflux/kastir-oss.git
cd kastir-oss
docker build -t kastir:local .

docker run -d --name kastir \
  -e DATABASE_URL=postgresql://user:pass@postgres.example/kastir \
  -e REDIS_URL=redis://:pass@redis.example:6379 \
  -e NEXTAUTH_SECRET="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_URL=https://cms.example.com \
  -e MASTER_EMAIL=admin@example.com \
  -e MASTER_PASSWORD=set-a-strong-password \
  -v kastir_public:/app/public \
  -p 8080:80 \
  kastir:local
```

Once migrations and the Master bootstrap finish, open `http://YOUR_HOST:8080/admin/login`.

> In production, generate `NEXTAUTH_SECRET` once and keep it in your secret manager. Changing it invalidates every session.

| Requirement                        | Notes                                                     |
| ---------------------------------- | --------------------------------------------------------- |
| Docker                             | The image bundles Next.js (panel) and Nginx (public edge) |
| PostgreSQL 16+                     | Source of truth                                           |
| Redis 7+                           | Queues and rate limits; set `maxmemory-policy noeviction` |
| Persistent volume on `/app/public` | **Required.** Holds published HTML, uploads and backups   |

**EasyPanel, Coolify or any Docker host:** point the app at this repo's `Dockerfile`, set the env vars, mount a volume on `/app/public` and route traffic to container port **80**. Do not expose port 3000; Next.js only listens on loopback inside the container.

Full deploy guide (volumes, ports, build-time notes): [`docs/DEPLOY.md`](./docs/DEPLOY.md).

<details>
<summary><strong>Environment variables</strong></summary>

| Variable             | Required | Description                                                          |
| -------------------- | :------: | -------------------------------------------------------------------- |
| `DATABASE_URL`       |   yes    | PostgreSQL connection string                                         |
| `REDIS_URL`          |   yes    | Redis connection string (queues and rate limits)                     |
| `NEXTAUTH_SECRET`    |   yes    | Auth secret, at least 32 random characters                           |
| `BETTER_AUTH_URL`    |   yes    | Public origin (cookies, CSRF, redirects); must match the browser URL |
| `MASTER_EMAIL`       |   yes    | Master account email, used on **first boot** only                    |
| `MASTER_PASSWORD`    |   yes    | Master password on first boot (at least 8 characters)                |
| `AUTH_TRUST_PROXY`   |    no    | `true` only behind a proxy that **overwrites** client IP headers     |
| `MASTER_FORCE_RESET` |    no    | `true` resyncs Master credentials on boot; recovery only             |
| `SITE_TITLE`         |    no    | Initial site title (editable later in the panel)                     |
| `PANEL_LANGUAGE`     |    no    | Panel language: `en` (default) or `pt-BR`                            |

`MASTER_EMAIL` and `MASTER_PASSWORD` create the Master only when none exists. Cloudflare purge credentials are set in the panel. See [`.env.example`](./.env.example) for the full template.

</details>

---

## 🧱 Architecture

```mermaid
flowchart LR
    V([Visitor]) -->|GET /my-page/| N
    E([Editor]) -->|/admin| N
    A([AI agent]) -->|MCP · OAuth 2.1| N

    subgraph C [Kastir container]
      N[Nginx :80] -->|static files| F[(public/&lt;slug&gt;/index.html<br/>public/uploads/)]
      N -->|/admin · /api| X[Next.js :3000<br/>panel · APIs · MCP · jobs]
      X -->|compile on publish| F
    end

    X --> P[(PostgreSQL<br/>source of truth)]
    X --> R[(Redis<br/>BullMQ · rate limits)]
```

**The publish flow:**

1. The editor (or an agent) saves the page; content and a revision snapshot go to PostgreSQL.
2. On publish, the compiler writes plain HTML under `public/`.
3. Nginx serves that file to anonymous visitors, with no app runtime involved.
4. Side effects (script rebuilds, CDN purge, notifications) run as background jobs.

On boot, a reconcile step rebuilds any published page whose HTML is missing on disk, so hosts that reset volumes recover on their own.

| Layer         | Choice                                                   |
| ------------- | -------------------------------------------------------- |
| App           | Next.js 16 (App Router), panel only; TypeScript, Node 22 |
| Public edge   | Nginx inside the same image                              |
| Data          | PostgreSQL 16 + Prisma 7                                 |
| Jobs / limits | Redis + BullMQ + rate limiting                           |
| Auth          | better-auth (email/password, server-side sessions)       |
| UI            | Tailwind CSS, shadcn/ui, CodeMirror                      |
| Media         | Sharp (WebP), disk storage                               |
| Agents        | Model Context Protocol SDK + OAuth 2.1                   |
| Tests         | Vitest (unit and integration)                            |

---

## 🛠️ Local development

Requirements: **Node.js 22 LTS**, **pnpm 11** (pinned in `package.json`), plus PostgreSQL 16+ and Redis 7+ on localhost. Run them natively or with `docker compose up -d`.

```bash
cp .env.example .env     # adjust DATABASE_URL, REDIS_URL, MASTER_* and NEXTAUTH_SECRET
pnpm install
pnpm prisma migrate dev
pnpm dev                 # http://localhost:3000/admin
```

| Command         | What it does                                             |
| --------------- | -------------------------------------------------------- |
| `pnpm dev`      | Builds the public scripts and starts Next dev            |
| `pnpm test`     | Vitest suite (integration tests opt in, see `AGENTS.md`) |
| `pnpm lint`     | ESLint                                                   |
| `pnpm build`    | Production build                                         |
| `pnpm validate` | Lint, tests and build validation                         |

Code conventions, module layout and invariants are in [`AGENTS.md`](./AGENTS.md). Technical docs live in [`docs/`](./docs/README.md) (written in Portuguese).

---

## 🤝 Contributing

Issues and pull requests are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first. To report a vulnerability, follow [`SECURITY.md`](./SECURITY.md) and **do not** open a public issue.

---

## 📜 License

Kastir is **[Fair Source](https://fair.io)** software, released under the **[Functional Source License, Version 1.1, ALv2 Future License](./LICENSE.md)** (FSL-1.1-ALv2).

| ✅ You can                                                      | ❌ You can't                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Self-host Kastir for your company, your clients or yourself     | Offer Kastir, or something substantially similar, as a commercial product or hosted service that competes with it |
| Use it commercially: build and publish sites for paying clients | Remove the license or copyright notices                                                                           |
| Read, modify and fork the code                                  | Use the Kastir name and logo as your own brand                                                                    |
| Contribute back                                                 |                                                                                                                   |

**It becomes open source over time.** Each release automatically converts to the **Apache License 2.0** two years after it is published.

<details>
<summary><strong>FAQ</strong></summary>

**Can my agency use Kastir to host client sites?**
Yes. Using Kastir to deliver your own services (sites, landing pages, campaigns) is a permitted purpose, even when you charge for it.

**Can I sell "Kastir hosting" or launch a CMS product built on Kastir?**
No. That is a competing use. Reach out through [korflux.com.br](https://korflux.com.br) if you want a commercial agreement.

**Is this "open source"?**
Not under the OSI definition until each version's two-year change date. Until then it is _source-available_ under fair-source terms; after that, it is Apache 2.0.

</details>

---

<p align="center">
  <sub><strong>Cast the page. Ship the HTML. Keep the visitor fast.</strong></sub><br />
  <sub>Made by <a href="https://korflux.com.br">Korflux</a></sub>
</p>
