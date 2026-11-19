import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = process.cwd();

async function readProjectFile(fileName: string): Promise<string> {
  return readFile(root + "/" + fileName, "utf8");
}

/** Body of a named multi-stage target (from its FROM … AS name to the next FROM). */
function dockerfileStage(dockerfile: string, stageName: string): string {
  const marker = new RegExp(
    `^FROM\\s+\\S+(?:\\s+AS\\s+${stageName})\\s*$`,
    "im",
  );
  const match = marker.exec(dockerfile);
  if (!match || match.index === undefined) {
    return "";
  }
  const start = match.index + match[0].length;
  const rest = dockerfile.slice(start);
  const nextFrom = rest.search(/^\s*FROM\s+/m);
  return nextFrom === -1 ? rest : rest.slice(0, nextFrom);
}

describe("Docker runtime configuration", () => {
  it("keeps the production image on Node 22 with Nginx and a public volume", async () => {
    const dockerfile = await readProjectFile("Dockerfile");

    expect(dockerfile).toContain("FROM node:22-alpine AS runner");
    expect(dockerfile).toContain("corepack prepare pnpm@11.14.0");
    expect(dockerfile).toContain("apk add --no-cache nginx su-exec wget");
    expect(dockerfile).toContain("VOLUME /app/public");
    expect(dockerfile).toContain("EXPOSE 80");
    expect(dockerfile).toContain("HOSTNAME=127.0.0.1");
    // Image sits behind nginx that overwrites XFF — spray guard needs this.
    expect(dockerfileStage(dockerfile, "runner")).toMatch(
      /ENV AUTH_TRUST_PROXY=true/,
    );
    expect(dockerfile).not.toMatch(/AUTH_TRUST_PROXY=false/);
    expect(dockerfile).toContain("ENV SHARP_FORCE_GLOBAL_LIBVIPS=1");
    expect(dockerfile).toContain("build-base python3 pkgconf");
    expect(dockerfile).toContain("vips-dev>=8.18.7");
    expect(dockerfile).toContain(
      "npm install -g --silent node-addon-api node-gyp",
    );
    expect(dockerfile).toContain(
      "NODE_PATH=/usr/local/lib/node_modules node install/build.js",
    );
    expect(dockerfile).toContain("vips>=8.18.7");
    expect(dockerfile).toContain("vips-cpp>=8.18.7");
    expect(dockerfile).toContain("/opt/kastir/public-seed");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).not.toContain("HOSTNAME=0.0.0.0");
    expect(dockerfile).not.toContain("postgres:16");
    expect(dockerfile).not.toContain("redis:7");
  });

  it("ships a sourceless runner: bundled bootstrap, pruned standalone, no lib/", async () => {
    const dockerfile = await readProjectFile("Dockerfile");

    expect(dockerfile).toContain("node scripts/bundle-bootstrap.mjs");
    expect(dockerfile).toContain("bootstrap-runtime.mjs");
    // Drop Next file-tracer fallback source that lands in standalone.
    expect(dockerfile).toMatch(/find \. -mindepth 1 -maxdepth 1/);
    expect(dockerfile).toContain("! -name '.next'");
    expect(dockerfile).toContain("! -name 'server.js'");
    // Must not bake application TypeScript into the image.
    expect(dockerfile).not.toMatch(/COPY --from=builder.*\/lib\b/);
    expect(dockerfile).not.toContain("bootstrap-runtime.ts");
    expect(dockerfile).not.toContain("tsconfig.json");
    // Generated Prisma Client is compiled JS, not app source — it has to
    // survive the sourceless cleanup above or bootstrap-runtime.mjs fails
    // at boot (see the Dockerfile comment on this COPY).
    expect(dockerfile).toContain(
      "COPY --from=builder /app/app/generated ./app/generated",
    );
    expect(dockerfile).toContain(
      "COPY --from=builder /app/app/icon.webp ./app/icon.webp",
    );
  });

  it("runs migrations and the shared bootstrap before Nginx and Next", async () => {
    const entrypoint = await readProjectFile("docker-entrypoint.sh");

    expect(entrypoint).toContain("require_env DATABASE_URL");
    expect(entrypoint).toContain("require_env REDIS_URL");
    expect(entrypoint).toContain("require_env NEXTAUTH_SECRET");
    expect(entrypoint).toContain("require_env BETTER_AUTH_URL");
    expect(entrypoint).toContain("require_env MASTER_EMAIL");
    expect(entrypoint).toContain("require_env MASTER_PASSWORD");
    expect(entrypoint).toMatch(
      /AUTH_TRUST_PROXY(?::=true|=\$\{AUTH_TRUST_PROXY:-true\}|: "\$\{AUTH_TRUST_PROXY:=true\}")/,
    );
    expect(entrypoint).toContain("/opt/kastir/public-seed");
    expect(entrypoint).toContain("chown -R nextjs:nodejs /app/public");
    expect(entrypoint).toContain("prisma migrate deploy");
    expect(entrypoint).toContain("node scripts/bootstrap-runtime.mjs");
    expect(entrypoint).not.toContain("tsx scripts/bootstrap-runtime.ts");
    expect(entrypoint).toContain("nginx -g 'daemon off;' &");
    expect(entrypoint).toContain("exec su-exec nextjs node server.js");
  });

  it("proxies dynamic routes and serves published files with fallback locations", async () => {
    const nginx = await readProjectFile("nginx.conf");

    expect(nginx).toContain("proxy_pass http://kastir_next");
    expect(nginx).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for");
    expect(nginx).toContain("location ^~ /admin/");
    expect(nginx).toContain("location ^~ /api/");
    expect(nginx).toContain("location ^~ /s/");
    expect(nginx).toContain("location ^~ /p/");
    expect(nginx).toContain("location ^~ /_next/");
    expect(nginx).toContain("location ^~ /_next/static/");
    expect(nginx).toContain("location = /_kastir/admin-bar.js");
    expect(nginx).toContain("location ^~ /_kastir/backups/");
    expect(nginx).toContain("deny all");
    expect(nginx).toContain("public, max-age=3600");
    expect(nginx).toContain("location ~ ^/([^/]+)/index\\.html$");
    expect(nginx).toContain("return 301 /$1$is_args$args");
    expect(nginx).toContain("location = /index.html");
    expect(nginx).toContain("return 301 /$is_args$args");
    expect(nginx).toContain("location = /llms.txt");
    expect(nginx).toContain("root /app/public");
    expect(nginx).toContain("try_files $uri $uri/index.html @notfound");
    expect(nginx).toContain("try_files /index.html @nextjs");
    expect(nginx).toContain("location @nextjs");
    expect(nginx).toContain("location @notfound");
    expect(nginx).toContain("if (-f $document_root/.notfound-redirect)");
    expect(nginx).toContain("try_files /404.html =404");
    // Custom 404 body must keep HTTP 404 (not 200) — try_files alone would
    // serve 404.html with a 200 status since it just found a file; the
    // response has to route through error_page so the status stays 404.
    expect(nginx).toContain("error_page 404 /404.html");
    expect(nginx).toContain("location = /404.html {");
    expect(nginx).toContain("internal;");
    expect(nginx).not.toContain("@kastir_next");
    expect(nginx).toContain("client_max_body_size 210m");
    expect(nginx).toContain("X-Content-Type-Options nosniff always");
    expect(nginx).toContain("Referrer-Policy no-referrer always");
    expect(nginx).toMatch(/^\s*server_tokens off;\s*$/m);
  });

  it("declares charset utf-8 globally for text/html responses", async () => {
    // Fase 27: Lighthouse flagged missing/late charset on published HTML.
    const nginx = await readProjectFile("nginx.conf");
    const firstServerIndex = nginx.indexOf("server {");
    const httpBlock = nginx.slice(0, firstServerIndex);

    expect(httpBlock).toMatch(/^\s*charset utf-8;\s*$/m);

    // /llms.txt keeps its own local charset (text/plain, not text/html) intact
    // and not duplicated by the new global directive.
    const llmsBlock = nginx.match(
      /location = \/llms\.txt \{[\s\S]*?\n    \}/,
    )?.[0];
    expect(llmsBlock).toBeDefined();
    expect(llmsBlock).toContain("charset utf-8;");
    expect(nginx.match(/charset utf-8;/g)).toHaveLength(2);
  });

  it("serves /uploads as public static files without session-dependent rules", async () => {
    // Phase 21: the real 404 incident was missing bytes on disk (nginx-public),
    // not auth. Keep the delivery contract session-agnostic.
    const nginx = await readProjectFile("nginx.conf");
    const uploadsBlock = nginx.match(
      /location \^~ \/uploads\/ \{[\s\S]*?\n    \}/,
    )?.[0];

    expect(uploadsBlock).toBeDefined();
    expect(uploadsBlock).toContain("try_files $uri =404");
    expect(uploadsBlock).toContain('Cache-Control "public, max-age=3600"');
    expect(uploadsBlock).toContain("X-Kastir-Served-By nginx-public");
    expect(uploadsBlock).not.toMatch(/auth_request|auth_basic|proxy_pass/);
    expect(uploadsBlock).not.toMatch(/Vary:\s*Cookie/i);
    expect(nginx).not.toMatch(/location[^{]*uploads[^{]*\{[^}]*auth_/i);
  });

  it("excludes local tests and preserved E2E artifacts from the image context", async () => {
    const dockerignore = await readProjectFile(".dockerignore");

    expect(dockerignore).toContain("tests");
    expect(dockerignore).toContain("e2e");
    expect(dockerignore).toContain("spec");
    expect(dockerignore).toContain("public/e2e-*");
    expect(dockerignore).toContain("public/uploads/");
    expect(dockerignore).toContain(".media-staging/");
    expect(dockerignore).toContain(".tools/");
    expect(dockerignore).not.toContain("public/_kastir");
  });

  it("binds the local compose stack to loopback only", async () => {
    const compose = await readProjectFile("docker-compose.yml");

    expect(compose).toContain('"127.0.0.1:5432:5432"');
    expect(compose).toContain('"127.0.0.1:6379:6379"');
    expect(compose).not.toMatch(/"5432:5432"/);
    expect(compose).not.toMatch(/"6379:6379"/);
  });

  it("runs quality gates on homolog as well as main", async () => {
    const workflow = await readProjectFile(".github/workflows/quality.yml");
    const onPush = workflow.match(
      /push:\s*\n\s*branches:\s*\n([\s\S]*?)(?=\n\S|\npermissions:)/,
    )?.[1];

    expect(workflow).toMatch(/pull_request:[\s\S]*branches:[\s\S]*- homolog/);
    expect(onPush).toContain("- homolog");
    expect(onPush).toContain("- main");
  });

  // Fase 34 / I1 (8eac1af): next build carrega sharp na coleta de page data.
  // A árvore do builder NÃO pode ficar só com prebuild x86-64-v2 em CPU KVM.
  it("I1: builder has baseline sharp before next/pnpm build (8eac1af)", async () => {
    const dockerfile = await readProjectFile("Dockerfile");
    const dependencies = dockerfileStage(dockerfile, "dependencies");
    const builder = dockerfileStage(dockerfile, "builder");
    expect(dependencies.length).toBeGreaterThan(0);
    expect(builder.length).toBeGreaterThan(0);

    // Compile única (B1) na árvore full — builder herda, não usa só --prod.
    expect(dependencies).toMatch(/install\/build\.js/);
    expect(dependencies).toMatch(/node-gyp\s+rebuild/);
    expect(builder).toMatch(
      /COPY\s+--from=dependencies\s+\/app\/node_modules\s+\.\/node_modules/,
    );

    // Âncora semântica: o fix de build-time em CPU fraca (comentário ou corpo).
    expect(builder).toMatch(/8eac1af|Failed to collect page data|x86-64-v2/);

    // Só instruções RUN contam — comentários citam "next build" e confundem ordem.
    // Aceita rebuild (install/build.js) ou verificação do .node herdado (B1).
    const runBodies = builder.split(/^\s*RUN\s+/m).slice(1);
    const sharpRunIdx = runBodies.findIndex(
      (body) =>
        body.includes("install/build.js") || body.includes("src/build/Release"),
    );
    const sharpLoadIdx = runBodies.findIndex(
      (body) =>
        body.includes("require('sharp')") || body.includes('require("sharp")'),
    );
    const nextBuildRunIdx = runBodies.findIndex((body) =>
      /pnpm\s+build/.test(body),
    );
    expect(
      sharpRunIdx,
      "builder RUN must force/verify sharp baseline",
    ).toBeGreaterThanOrEqual(0);
    expect(
      nextBuildRunIdx,
      "builder RUN must run pnpm build",
    ).toBeGreaterThanOrEqual(0);
    expect(sharpRunIdx).toBeLessThan(nextBuildRunIdx);
    expect(
      sharpLoadIdx,
      "builder RUN must load sharp before Next",
    ).toBeGreaterThanOrEqual(0);
    expect(sharpLoadIdx).toBeLessThan(nextBuildRunIdx);
  });

  // I2 + I3: runner copia node_modules de production-dependencies com
  // sharp (libvips) e argon2 (anti-SIGILL) garantidos — 9795a76 família.
  // Após --prod: revalida .node e recompila só se o prune apagar (fail-safe).
  it("I2/I3: production-dependencies guarantees sharp and argon2 for the runner", async () => {
    const dockerfile = await readProjectFile("Dockerfile");
    const prod = dockerfileStage(dockerfile, "production-dependencies");
    const runner = dockerfileStage(dockerfile, "runner");
    expect(prod.length).toBeGreaterThan(0);
    expect(runner.length).toBeGreaterThan(0);

    expect(runner).toMatch(
      /COPY\s+--from=production-dependencies\s+\/app\/node_modules\s+\.\/node_modules/,
    );

    // Sharp baseline presente (rebuild ou revalidação pós --prod).
    expect(prod).toMatch(/src\/build\/Release/);
    expect(prod).toMatch(/install\/build\.js/);

    // argon2: node-gyp local beats prebuild (SIGILL on generic KVM).
    expect(prod).toMatch(/node-gyp\s+rebuild/);
    expect(prod).toMatch(/argon2/);
    expect(prod).toMatch(/build\/Release\/argon2\.node|SIGILL|9795a76/);
  });
});
