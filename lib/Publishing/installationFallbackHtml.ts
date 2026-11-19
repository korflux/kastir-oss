/**
 * HTML servido em `/` quando não há home publicada (`public/index.html` ausente).
 * Visual alinhado à login/BrandRail — CSS inline (página estática, sem app shell).
 * Sem número de versão: fingerprint público; a versão mora no painel autenticado.
 */
export function buildInstallationFallbackHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Kastir instalado</title>
    <link rel="icon" href="/icon.webp" type="image/webp">
    <style>
      :root {
        color-scheme: light dark;
        --canvas: #f5f5f5;
        --ink: #0a0a0a;
        --muted: #737373;
        --card: #ffffff;
        --border: #e5e5e5;
        --green: #15cb18;
        --button: #0a0a0a;
        --button-ink: #fafafa;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --canvas: #0a0a0a;
          --ink: #fafafa;
          --muted: #a3a3a3;
          --card: #141414;
          --border: #262626;
          --button: #fafafa;
          --button-ink: #0a0a0a;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100svh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1.5rem;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: var(--canvas);
        color: var(--ink);
      }
      main {
        width: 100%;
        max-width: 28rem;
        border: 1px solid var(--border);
        border-radius: 1rem;
        background: color-mix(in srgb, var(--card) 85%, transparent);
        padding: 2rem 1.75rem;
        text-align: center;
      }
      .brand {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 2rem;
      }
      .brand .logo {
        width: 24px;
        height: 29px;
        object-fit: contain;
      }
      .brand .wordmark {
        width: 75px;
        height: 20px;
        object-fit: contain;
      }
      h1 {
        margin: 0;
        font-size: clamp(1.75rem, 4vw, 2.25rem);
        font-weight: 600;
        letter-spacing: -0.03em;
        line-height: 1.15;
      }
      p {
        margin: 0.75rem 0 0;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.5;
      }
      a.cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 1.75rem;
        min-height: 2.5rem;
        padding: 0 1.25rem;
        border-radius: 999px;
        background: var(--button);
        color: var(--button-ink);
        font-size: 0.9rem;
        font-weight: 500;
        text-decoration: none;
        transition: opacity 0.15s ease;
      }
      a.cta:hover { opacity: 0.9; }
      a.cta:focus-visible {
        outline: 2px solid var(--green);
        outline-offset: 3px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="/admin-brand/kastir-symbol-dark.webp">
          <img class="logo" src="/admin-brand/kastir-symbol-light.webp" width="24" height="29" alt="">
        </picture>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="/admin-brand/kastir-logo-dark.webp">
          <img class="wordmark" src="/admin-brand/kastir-logo-light.webp" width="75" height="20" alt="Kastir">
        </picture>
      </div>
      <h1>Kastir instalado</h1>
      <p>Acesse <a href="/admin">/admin</a> para configurar seu site e publicar a home.</p>
      <a class="cta" href="/admin">Acessar painel</a>
    </main>
    <script defer src="/_kastir/admin-bar.js" data-kastir-admin-bar="1"></script>
  </body>
</html>`;
}
