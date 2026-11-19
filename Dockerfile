FROM node:22-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
# Store path estável para cache mount do BuildKit (EasyPanel/Docker local/painéis).
ENV PNPM_STORE_PATH=/pnpm/store

# Os binários pré-compilados do sharp exigem microarquitetura x86-64-v2
# (SSE4.2, POPCNT, SSSE3...). VMs KVM configuradas com o modelo de CPU genérico
# ("Common KVM processor") não expõem essas instruções, e o módulo falha ao
# carregar em runtime — a conversão WebP quebra sem erro visível nos logs.
#
# Compilar o sharp contra o libvips do sistema resolve: o binding é gerado com
# flags baseline, sem exigir v2. Alpine 3.24 community ainda é 8.18.2; sharp
# 0.35.5 pede libvips >=8.18.7 (`config.libvips` do package.json do sharp) —
# pino o piso no edge até um estável publicar 8.18.7+.
# SHARP_FORCE_GLOBAL_LIBVIPS=1 pula a checagem de versão do sharp: uma libvips
# abaixo do mínimo só apareceria em runtime, então o piso do apk abaixo (e o do
# stage `runner`) é a única barreira. Subiu de 8.18.3 junto com o sharp 0.35.5;
# ao subir o sharp de novo, reconferir `config.libvips` e este piso.
# ponytail: repo edge (rolling), trocar por v3.XX community quando vips>=8.18.7.
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
RUN apk add --no-cache build-base python3 pkgconf \
  && apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    'vips-dev>=8.18.7'
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate

FROM base AS dependencies

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Cache mount do store: acelera cold install quando o host tem BuildKit (padrão
# Docker moderno / EasyPanel). Sem BuildKit o build falha na sintaxe --mount —
# hosts sem BuildKit não são alvo de deploy do Kastir.
RUN --mount=type=cache,id=kastir-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

# Fase 34 / B1: UMA compile nativa na árvore full. O stage builder herda este
# node_modules (I1 / 8eac1af — next build carrega sharp e quebra com
# "Failed to collect page data" se só houver prebuild x86-64-v2). O stage
# production-dependencies revalida após --prod (e recompila só se o prune
# apagar os .node).
#
# argon2 (node-gyp-build) traz prebuild que em KVM genérica sem AVX2 mata o
# processo com SIGILL no primeiro hash (9795a76). node-gyp-build prefere
# build/Release local se existir — forçar rebuild baseline aqui.
RUN npm install -g --silent node-addon-api node-gyp \
  && cd /app/node_modules/sharp \
  && NODE_PATH=/usr/local/lib/node_modules node install/build.js \
  && ls src/build/Release/*.node \
  && cd /app/node_modules/argon2 \
  && NODE_PATH=/usr/local/lib/node_modules node-gyp rebuild \
  && ls build/Release/argon2.node

FROM dependencies AS production-dependencies

RUN --mount=type=cache,id=kastir-pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile

# I2/I3: runner copia ESTE node_modules. --prod em geral só remove devDeps e
# preserva os .node do stage pai; se um dia o pnpm reinstalasse sharp/argon2
# e voltasse o prebuild, recompilamos aqui (fail-safe — não embarcar prebuild).
RUN npm install -g --silent node-addon-api node-gyp \
  && if ! ls /app/node_modules/sharp/src/build/Release/*.node >/dev/null 2>&1; then \
       cd /app/node_modules/sharp \
       && NODE_PATH=/usr/local/lib/node_modules node install/build.js; \
     fi \
  && ls /app/node_modules/sharp/src/build/Release/*.node \
  && if [ ! -f /app/node_modules/argon2/build/Release/argon2.node ]; then \
       cd /app/node_modules/argon2 \
       && NODE_PATH=/usr/local/lib/node_modules node-gyp rebuild; \
     fi \
  && ls /app/node_modules/argon2/build/Release/argon2.node

FROM base AS builder

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# I1 / 8eac1af: o `next build` (coleta de page data da rota
# /api/admin/media/[mediaId]/convert) carrega o sharp em build time.
# O node_modules vem do stage `dependencies`, onde o sharp JÁ foi recompilado
# contra libvips com flags baseline (não o prebuild x86-64-v2). Em CPU KVM
# genérica ("Common KVM processor") o prebuild falha com
# "Failed to collect page data" — por isso a verificação abaixo é obrigatória.
# Não recompilar de novo aqui (fase 34): a compile única está em dependencies.
RUN ls /app/node_modules/sharp/src/build/Release/*.node
# I1: carregar o binding real antes do Next provar que a árvore recompilada
# funciona; um `ls` sozinho não detecta ABI/libvips quebrado.
RUN node -e "const sharp = require('sharp'); if (typeof sharp !== 'function') process.exit(1); console.log('sharp binding loaded')"

# Build-time env is ephemeral (layer only) and never used as runtime defaults.
# Placeholders satisfy prisma generate / next build; not real secrets.
RUN export \
  DATABASE_URL=postgresql://kastir:kastir@localhost:5432/kastir \
  REDIS_URL=redis://localhost:6379 \
  NEXTAUTH_SECRET=build-only-placeholder-at-least-32-chars \
  BETTER_AUTH_URL=http://localhost:3000 \
  AUTH_TRUST_PROXY=true \
  MASTER_EMAIL=build@example.com \
  MASTER_PASSWORD=build-only-placeholder \
  MASTER_FORCE_RESET=false \
  SITE_TITLE=Kastir \
  PANEL_LANGUAGE=en \
  && pnpm prisma generate \
  && pnpm build \
  && node scripts/bundle-bootstrap.mjs

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind Next only on loopback so traffic must enter via Nginx on :80.
ENV HOSTNAME=127.0.0.1
# nginx.conf sobrescreve XFF a partir de $remote_addr — o guard de spray
# por IP (signInIpRateLimiter) só corre com trust proxy ligado.
ENV AUTH_TRUST_PROXY=true

RUN apk add --no-cache nginx su-exec wget \
  && apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    'vips>=8.18.7' 'vips-cpp>=8.18.7' \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output includes a defensive full-project copy when Next cannot
# prove dynamic fs reads statically. Compiled routes already live under .next/;
# drop everything else so the public image has no application TypeScript.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
RUN find . -mindepth 1 -maxdepth 1 ! -name '.next' ! -name 'server.js' -exec rm -rf {} +

COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Baked public assets for first boot seed (admin-bar). Volume mounts hide /app/public.
COPY --from=builder /app/public /opt/kastir/public-seed
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Generated Prisma Client. bootstrap-runtime.mjs imports it as an external
# (unbundled) package — the find/rm-rf above deletes it along with the app
# TypeScript it's meant to strip, so it has to come back explicitly or the
# entrypoint fails before nginx/server.js ever start.
COPY --from=builder /app/app/generated ./app/generated
COPY --from=builder /app/app/icon.webp ./app/icon.webp
# Pre-bundled Master bootstrap (no lib/ TypeScript, no tsx at boot).
COPY --from=builder --chown=nextjs:nodejs /app/scripts/bootstrap-runtime.mjs ./scripts/bootstrap-runtime.mjs

RUN mkdir -p /app/.media-staging \
  && chown -R nextjs:nodejs /app/public /app/.media-staging /opt/kastir/public-seed

COPY nginx.conf /etc/nginx/nginx.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod 755 /docker-entrypoint.sh

VOLUME /app/public
EXPOSE 80

# Nginx listens on :80 (master typically root for privileged bind on Alpine).
# App traffic to Next is loopback-only; Node runs as nextjs via su-exec.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/admin/login || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
