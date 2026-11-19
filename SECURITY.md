# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's
[private vulnerability reporting](../../security/advisories/new)
("Security" tab, then "Report a vulnerability"). Include:

- the affected version or commit;
- steps to reproduce, or a proof of concept;
- the impact you expect (data exposure, privilege escalation, and so on).

We will acknowledge the report, investigate, and keep you informed until a fix is released. Please give us reasonable time to ship a fix before disclosing publicly.

## Supported versions

Security fixes go into the latest release on `main`.

## Scope notes for self-hosters

- Keep `NEXTAUTH_SECRET` and database credentials in your secret manager, never in the image or the repository.
- Set `AUTH_TRUST_PROXY=true` only behind a proxy that overwrites client IP headers.
- Leave `MASTER_FORCE_RESET=false` outside recovery.
- MCP connections act with the permissions of the user who approved them. Review them in **Setup → Connections**.
