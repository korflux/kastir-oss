# Deploy self-hosted com Docker

Kastir é distribuído como uma única imagem Docker. O container contém o
Next.js e o Nginx, mas não contém Postgres nem Redis: esses serviços devem
ser externos e são configurados por variáveis de ambiente.

## Pré-requisitos

- Docker Engine compatível com imagens Linux `node:22-alpine`;
- um PostgreSQL 16+ acessível pelo container;
- um Redis acessível pelo container;
- um volume persistente montado em `/app/public`.

O volume é obrigatório porque contém as páginas HTML publicadas, `robots.txt`,
`sitemap.xml` e os uploads em `public/uploads/`. O restante do filesystem do
container pode ser recriado em cada deploy.

### Volume e assets da imagem

Volumes nomeados novos **substituem** o `/app/public` da imagem. No boot, o
entrypoint:

1. copia do seed imutável `/opt/kastir/public-seed` apenas arquivos **ainda
   ausentes** no volume (ex.: `public/_kastir/admin-bar.js`);
2. executa `chown` para o usuário `nextjs` (uid 1001), para que publicação e
   uploads funcionem em Linux (não só no Docker Desktop).

Uploads e HTML já gravados no volume **não** são sobrescritos pelo seed.

### Portas e processos

| Processo | Bind | Notas |
|----------|------|--------|
| Nginx | `0.0.0.0:80` | Front door; em Alpine o master costuma iniciar como root para a porta privilegiada |
| Next.js | `127.0.0.1:3000` | Apenas loopback; não publique a porta 3000 no host |

Upload de mídia: o Nginx aceita corpos de até **210 MB** (`client_max_body_size`),
alinhado aos limites do módulo de Mídia.

## Build e primeiro boot

Clone o repositório e construa a imagem:

```bash
docker build -t kastir:local .
```

Argumentos de build (`BUILD_*`) são opcionais e servem só para `prisma generate`
/ `next build` no stage de build — **não** viram defaults de runtime.

Suba o container com uma origem pública que corresponda à URL usada pelo navegador:

```bash
# Gere uma vez e salve o valor no gerenciador de segredos do deploy.
export NEXTAUTH_SECRET="$(openssl rand -hex 32)"

docker run -d --name kastir \
  -e DATABASE_URL=postgresql://usuario:senha@postgres.example/kastir \
  -e REDIS_URL=redis://:senha@redis.example:6379 \
  -e NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  -e BETTER_AUTH_URL=https://cms.example.com \
  -e AUTH_TRUST_PROXY=true \
  -e MASTER_EMAIL=admin@example.com \
  -e MASTER_PASSWORD=defina-uma-senha-forte \
  -e MASTER_FORCE_RESET=false \
  -e SITE_TITLE=Kastir \
  -e PANEL_LANGUAGE=en \
  -v kastir_public:/app/public \
  -p 8080:80 \
  kastir:local
```

`AUTH_TRUST_PROXY=true` é apropriado quando o Nginx do container (ou outro proxy
confiável) **define** `X-Forwarded-For` / `X-Real-IP` a partir da conexão real.
Não habilite se um proxy externo apenas repassar headers do cliente sem
sobrescrevê-los.

No primeiro boot, o entrypoint:

1. valida as env vars obrigatórias (falha clara se faltar alguma);
2. seed + `chown` de `/app/public`;
3. `prisma migrate deploy`;
4. bootstrap compartilhado do Master;
5. Nginx + Next.js.

Se o banco estiver vazio, o bootstrap cria o Administrador Master, SiteSettings
e as pastas-base. Boots seguintes são idempotentes.

Abra `/admin/login` depois que:

```bash
docker logs -f kastir
```

mostrar que migrations e bootstrap terminaram. O healthcheck da imagem consulta
`http://127.0.0.1/admin/login` periodicamente.

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---:|---|
| `DATABASE_URL` | Sim | Connection string do PostgreSQL externo. |
| `REDIS_URL` | Sim | Connection string do Redis externo. |
| `NEXTAUTH_SECRET` | Sim | Secret do Better Auth; use pelo menos 32 caracteres aleatórios. |
| `BETTER_AUTH_URL` | Sim | Origem pública usada por cookies, CSRF e redirects. |
| `AUTH_TRUST_PROXY` | Não | `true` somente atrás de proxy confiável que sobrescreve headers de IP; default `false`. |
| `MASTER_EMAIL` | Sim | E-mail usado para criar o Master no primeiro boot. |
| `MASTER_PASSWORD` | Sim | Senha usada para criar o Master no primeiro boot. |
| `MASTER_FORCE_RESET` | Não | `true` sincroniza credenciais do Master no boot; use somente como recuperação controlada. Default `false`. |
| `SITE_TITLE` | Não | Título inicial de SiteSettings; boots seguintes não sobrescrevem o valor salvo. |
| `PANEL_LANGUAGE` | Não | Idioma da interface do painel; default `en`. |

Nunca coloque valores reais em `.env.example`, no Dockerfile, no repositório ou
em tickets/logs compartilhados. Não use `MASTER_FORCE_RESET=true` contra o banco
de outra instalação.

## Atualização e persistência

Para atualizar a imagem, construa uma nova versão e recrie o container mantendo
o mesmo volume:

```bash
docker stop kastir
docker rm kastir
docker build -t kastir:local .
docker run ... -v kastir_public:/app/public -p 8080:80 kastir:local
```

O novo container reaplica migrations pendentes de forma idempotente. Não rode
`prisma migrate dev` no container.

Para validar a persistência local sem remover o volume:

```bash
docker stop kastir
docker start kastir
```

Depois do restart, confirme o login, uma página publicada, um upload público e
`/_kastir/admin-bar.js` (seed se o volume era novo).

## EasyPanel

No EasyPanel, crie um App apontando para o repositório público
https://github.com/korflux/kastir-oss.git, mantenha Postgres e Redis como serviços
externos, configure as variáveis acima no painel e monte um volume persistente
em `/app/public`. O App deve usar o Dockerfile do próprio repositório; não há
configuração específica do EasyPanel no código.

Após o deploy, confira logs de migrate/bootstrap, `/admin/login`, uma página
publicada e o volume após restart/redeploy antes de promover a v1.0.
