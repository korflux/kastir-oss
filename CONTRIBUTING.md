# Contributing to Kastir

Thanks for your interest in Kastir. Bug reports, ideas and pull requests are welcome.

## Before you start

- **Bugs and ideas:** open an issue first, so we can agree on the approach before you write code.
- **Security issues:** never open a public issue. Follow [`SECURITY.md`](./SECURITY.md).
- **Project map:** [`AGENTS.md`](./AGENTS.md) describes the module layout, conventions and the rules that cannot be broken (for example, the MCP never exposes permanent deletion). It is written in Portuguese, like the technical docs in [`docs/`](./docs/README.md).

## Local setup

1. Install Node.js 22 LTS and pnpm 11.
2. Run PostgreSQL 16+ and Redis 7+ on localhost, natively or with `docker compose up -d`.
3. Configure and start the app:

   ```bash
   cp .env.example .env
   pnpm install
   pnpm prisma migrate dev
   pnpm dev
   ```

4. Open `http://localhost:3000/admin` and sign in with the `MASTER_*` values from `.env`.

## Pull requests

- Keep each PR focused on one change.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...). The commit type drives the automatic version bump.
- Run the quality gates before pushing:

  ```bash
  pnpm lint
  pnpm format:check
  pnpm test
  pnpm build
  ```

- If your change touches a feature that agents can use, update the MCP surface in the same PR (tools, `Instructions.ts`, `Guide.ts` and the tool catalog). Anything the panel can do, an agent should be able to do through MCP.
- Never commit `.env` files, credentials or real customer data. CI runs Gitleaks on every PR.

## License of contributions

Kastir is licensed under [FSL-1.1-ALv2](./LICENSE.md). By submitting a contribution, you agree that it is licensed under the same terms.
