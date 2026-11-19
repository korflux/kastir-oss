#!/bin/sh
set -e

cd /app

require_env() {
  # shellcheck disable=SC2154
  eval "value=\${$1-}"
  if [ -z "$value" ]; then
    echo "[Kastir] Missing required environment variable: $1" >&2
    exit 1
  fi
}

require_env DATABASE_URL
require_env REDIS_URL
require_env NEXTAUTH_SECRET
require_env BETTER_AUTH_URL
require_env MASTER_EMAIL
require_env MASTER_PASSWORD

# Spray de login por IP exige AUTH_TRUST_PROXY. O nginx do image sobrescreve
# X-Real-IP/X-Forwarded-For a partir de $remote_addr, então true é seguro.
# Operador ainda pode forçar false com -e AUTH_TRUST_PROXY=false.
: "${AUTH_TRUST_PROXY:=true}"
export AUTH_TRUST_PROXY

mkdir -p /app/public /app/.media-staging

# Named volumes replace the image's /app/public. Seed baked assets (admin-bar,
# etc.) only when the destination file is missing so uploads/HTML on the volume
# are never overwritten.
if [ -d /opt/kastir/public-seed ]; then
  find /opt/kastir/public-seed -type f | while IFS= read -r src; do
    rel=${src#/opt/kastir/public-seed/}
    dest="/app/public/${rel}"
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
    fi
  done
fi

# Volume mounts are often root-owned; Node runs as nextjs (uid 1001).
chown -R nextjs:nodejs /app/public /app/.media-staging

./node_modules/.bin/prisma migrate deploy
node scripts/bootstrap-runtime.mjs

nginx -t
nginx -g 'daemon off;' &

# Force the internal Next.js bind regardless of any PORT/HOSTNAME the host
# platform injects (e.g. EasyPanel sets PORT=80 to match EXPOSE 80). Nginx
# owns :80; Next must always stay on loopback:3000 to match nginx.conf's
# upstream, or the two processes race for the same port.
export PORT=3000
export HOSTNAME=127.0.0.1

exec su-exec nextjs node server.js
