/**
 * Canonical didactic HTML for a brand-new page.
 * Shared by the panel editor seed and MCP create/site-context starters.
 */

export const NEW_PAGE_TEMPLATE_EN = `<!-- Kastir starter template — everything here is optional, edit or delete freely. -->
<!doctype html>
<html lang="en">
<head>
  <!-- CSS goes here. The page <title> and meta tags are set from the fields on the right, not here. -->
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; }
  </style>
</head>
<body>
  <!-- Visible page title -->
  <h1>Your page title</h1>

  <!-- Example image — click it in the editor to pick one from the Media Library -->
  <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='320'%3E%3Crect width='100%25' height='100%25' fill='%23e5e5e5'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='20' fill='%23737373' text-anchor='middle' dominant-baseline='middle'%3EImage placeholder%3C/text%3E%3C/svg%3E" alt="Placeholder" width="640" height="320">

  <p>Start writing your content here.</p>

  <!-- JavaScript goes here -->
  <script>
    // console.log("Hello from your page");
  </script>

  <!-- The Kastir admin bar only appears at the top for logged-in team members — visitors never see it. -->
</body>
</html>
`;

export const NEW_PAGE_TEMPLATE_PT_BR = `<!-- Modelo inicial do Kastir — tudo aqui é opcional, edite ou apague à vontade. -->
<!doctype html>
<html lang="pt-BR">
<head>
  <!-- O CSS entra aqui. O <title> e as meta tags da página são definidos pelos campos ao lado, não aqui. -->
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; }
  </style>
</head>
<body>
  <!-- Título visível da página -->
  <h1>Título da sua página</h1>

  <!-- Imagem de exemplo — clique nela no editor para escolher uma da Biblioteca de Mídia -->
  <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='320'%3E%3Crect width='100%25' height='100%25' fill='%23e5e5e5'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='20' fill='%23737373' text-anchor='middle' dominant-baseline='middle'%3EImagem de exemplo%3C/text%3E%3C/svg%3E" alt="Imagem de exemplo" width="640" height="320">

  <p>Comece a escrever seu conteúdo aqui.</p>

  <!-- O JavaScript entra aqui -->
  <script>
    // console.log("Olá a partir da sua página");
  </script>

  <!-- A barra do Kastir só aparece no topo para quem está autenticado no painel — visitantes nunca a veem. -->
</body>
</html>
`;

const TEMPLATES: Record<string, string> = {
  en: NEW_PAGE_TEMPLATE_EN,
  "pt-BR": NEW_PAGE_TEMPLATE_PT_BR,
};

/**
 * Locale key that will actually be used after fallback.
 * Exact keys: en, pt-BR. Loose Portuguese (pt, pt-PT, pt-*) maps to pt-BR
 * (same didactic HTML family); any other value falls back to en.
 */
export function resolveNewPageTemplateLocale(siteLanguage: string): string {
  if (siteLanguage in TEMPLATES) return siteLanguage;
  // Loose Portuguese → pt-BR template (not English); intentional vs strict enum.
  if (siteLanguage === "pt" || siteLanguage.toLowerCase().startsWith("pt-")) {
    return "pt-BR";
  }
  return "en";
}

export function getNewPageTemplate(siteLanguage: string): string {
  return (
    TEMPLATES[resolveNewPageTemplateLocale(siteLanguage)] ??
    NEW_PAGE_TEMPLATE_EN
  );
}
