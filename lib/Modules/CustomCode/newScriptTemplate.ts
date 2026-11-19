/**
 * Canonical didactic HTML for a brand-new script / popup.
 * Shared by the panel seed and MCP site-context starters.
 *
 * Popup variant does NOT recreate data-kastir-trigger — compile wraps the
 * snippet; this starter is the inner author HTML (close is the author's job).
 *
 * Init (focus + Escape) waits until the compile wrapper becomes visible —
 * runtime only sets display=""; scripts still run at page parse while hidden.
 */

/** Shared close/open wiring for EN + PT-BR popup starters (single source). */
// This is only a seed: published popup HTML belongs to the author and is never
// rewritten when the starter evolves.
const POPUP_STARTER_SCRIPT = `<script>
(function () {
  var root = document.currentScript && document.currentScript.previousElementSibling;
  if (!root || !root.classList || !root.classList.contains("kastir-popup")) return;

  var previouslyFocused = null;
  var isOpen = false;
  var titleSequence = (window.__kastirPopupTitleSequence || 0) + 1;
  window.__kastirPopupTitleSequence = titleSequence;

  var title = root.querySelector("[data-kastir-popup-title]");
  if (title) {
    var titleId = "kastir-popup-title-" + titleSequence;
    title.id = titleId;
    root.setAttribute("aria-labelledby", titleId);
  }

  function wrapperEl() {
    return root.closest("[data-kastir-trigger]") || root;
  }

  function isShown(el) {
    if (!el) return false;
    if (el.style && el.style.display === "none") return false;
    return window.getComputedStyle(el).display !== "none";
  }

  function focusableElements() {
    return Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(function (element) {
      var style = window.getComputedStyle(element);
      return element.getAttribute("aria-hidden") !== "true" &&
        style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !isOpen) return;
    var elements = focusableElements();
    if (!elements.length) {
      event.preventDefault();
      if (typeof root.focus === "function") root.focus();
      return;
    }
    var first = elements[0];
    var last = elements[elements.length - 1];
    var active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKey(event) {
    if (event.key === "Escape") closePopup();
    else trapFocus(event);
  }

  function openPopup() {
    if (isOpen) return;
    isOpen = true;
    previouslyFocused = document.activeElement;
    document.addEventListener("keydown", onKey);
    var focusTarget = root.querySelector("[data-kastir-popup-close]");
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    else if (typeof root.focus === "function") root.focus();
  }

  function closePopup() {
    var wrap = wrapperEl();
    if (wrap) wrap.style.display = "none";
    document.removeEventListener("keydown", onKey);
    isOpen = false;
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
  }

  function syncOpenState() {
    if (isShown(wrapperEl())) openPopup();
    else if (isOpen) {
      document.removeEventListener("keydown", onKey);
      isOpen = false;
      previouslyFocused = null;
    }
  }

  root.querySelectorAll("[data-kastir-popup-close]").forEach(function (btn) {
    btn.addEventListener("click", closePopup);
  });
  root.addEventListener("click", function (event) {
    if (event.target === root) closePopup();
  });

  // Observe compile wrapper (or self if no trigger wrapper yet).
  var observeTarget = root.closest("[data-kastir-trigger]") || root;
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(syncOpenState).observe(observeTarget, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }
  // No wrapper → author preview / untriggered snippet: open once.
  if (!root.closest("[data-kastir-trigger]")) openPopup();
  else syncOpenState();
})();
</script>
`;

export const NEW_SCRIPT_TEMPLATE_EN = `<!-- Kastir script starter — everything here is optional, edit or delete freely. Injected as authored. -->
<!-- Pick ONE trigger in Details on the right. Compile wraps this in data-kastir-trigger — do not recreate that wrapper. -->
<!-- None = runs as soon as the page loads (in this script's scope). -->

<style>
  /* Keep styles scoped to this snippet. */
  .kastir-snippet { font: 400 .9375rem/1.5 system-ui, sans-serif; }
  .kastir-snippet .open-notice { font: inherit; cursor: pointer; }
</style>

<div class="kastir-snippet">
  <!-- Visible markup. Replace this with your banner, pixel, or popup body. -->
  <p>Your snippet content.</p>

  <!-- SELECTOR_EVENT — Details: CSS selector + click or submit.
       Example: selector .open-notice, event click. -->
  <button type="button" class="open-notice">Example target for SELECTOR_EVENT</button>

  <!-- PAGE_LOAD — Details: delay in seconds after the page loads. -->
  <!-- SCROLL — Details: percentage 1–100 of the page. -->
  <!-- REFERRER — Details: substring of the visitor's referrer URL. -->

  <!-- Popup? Add your own close (button + Escape). Runtime only shows the wrapper. -->
</div>

<script>
  // Runs when this snippet is injected. Keep it small and scoped.
  // console.log("Hello from your script");
</script>
`;

export const NEW_SCRIPT_TEMPLATE_PT_BR = `<!-- Modelo inicial de script do Kastir — tudo aqui é opcional, edite ou apague à vontade. Injetado como escrito. -->
<!-- Escolha UM gatilho nos campos do Details à direita. O compile envolve isto em data-kastir-trigger — não recrie o wrapper. -->
<!-- Nenhum = roda assim que a página carrega (no escopo deste script). -->

<style>
  /* Mantenha os estilos com escopo neste trecho. */
  .kastir-snippet { font: 400 .9375rem/1.5 system-ui, sans-serif; }
  .kastir-snippet .open-notice { font: inherit; cursor: pointer; }
</style>

<div class="kastir-snippet">
  <!-- Markup visível. Troque por banner, pixel ou corpo de popup. -->
  <p>Conteúdo do seu snippet.</p>

  <!-- SELECTOR_EVENT — Details: seletor CSS + clique ou envio.
       Exemplo: seletor .open-notice, evento click. -->
  <button type="button" class="open-notice">Alvo de exemplo para SELECTOR_EVENT</button>

  <!-- PAGE_LOAD — Details: atraso em segundos após o carregamento. -->
  <!-- SCROLL — Details: porcentagem 1–100 da página. -->
  <!-- REFERRER — Details: trecho da URL de origem do visitante. -->

  <!-- Popup? Feche você (botão + Escape). O runtime só mostra o wrapper. -->
</div>

<script>
  // Roda quando este snippet é injetado. Prefira trecho pequeno e com escopo.
  // console.log("Olá a partir do seu script");
</script>
`;

export const NEW_POPUP_TEMPLATE_EN = `<!-- Kastir popup starter — compile wraps this in data-kastir-trigger (do not recreate). -->
<!-- Runtime only sets display="" on fire; YOU must close (button + Escape). Init waits until wrapper is shown. -->
<!-- Without a trigger, this popup opens on every page in the script scope. -->
<div
  class="kastir-popup"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)"
>
  <div style="background:#fff;color:#111;max-width:28rem;width:calc(100% - 2rem);padding:1.25rem;border-radius:.5rem;box-shadow:0 10px 40px rgba(0,0,0,.2)">
    <h2 data-kastir-popup-title style="margin:0 0 .75rem;font:600 1.125rem/1.3 system-ui,sans-serif">Notice</h2>
    <p style="margin:0 0 1rem;font:400 .9375rem/1.5 system-ui,sans-serif">Replace this message with your content.</p>
    <button type="button" data-kastir-popup-close style="font:600 .875rem system-ui,sans-serif;padding:.5rem .9rem;border:0;border-radius:.375rem;background:#111;color:#fff;cursor:pointer">
      Close
    </button>
  </div>
</div>
${POPUP_STARTER_SCRIPT}`;

export const NEW_POPUP_TEMPLATE_PT_BR = `<!-- Modelo de popup do Kastir — o compile envolve isto em data-kastir-trigger (não recrie). -->
<!-- O runtime só faz display=""; FECHAR é do autor (botão + Escape). Init espera o wrapper aparecer. -->
<!-- Sem gatilho, este popup abre em toda página do escopo do script. -->
<div
  class="kastir-popup"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)"
>
  <div style="background:#fff;color:#111;max-width:28rem;width:calc(100% - 2rem);padding:1.25rem;border-radius:.5rem;box-shadow:0 10px 40px rgba(0,0,0,.2)">
    <h2 data-kastir-popup-title style="margin:0 0 .75rem;font:600 1.125rem/1.3 system-ui,sans-serif">Aviso</h2>
    <p style="margin:0 0 1rem;font:400 .9375rem/1.5 system-ui,sans-serif">Substitua esta mensagem pelo seu conteúdo.</p>
    <button type="button" data-kastir-popup-close style="font:600 .875rem system-ui,sans-serif;padding:.5rem .9rem;border:0;border-radius:.375rem;background:#111;color:#fff;cursor:pointer">
      Fechar
    </button>
  </div>
</div>
${POPUP_STARTER_SCRIPT}`;

const BASE_TEMPLATES: Record<string, string> = {
  en: NEW_SCRIPT_TEMPLATE_EN,
  "pt-BR": NEW_SCRIPT_TEMPLATE_PT_BR,
};

const POPUP_TEMPLATES: Record<string, string> = {
  en: NEW_POPUP_TEMPLATE_EN,
  "pt-BR": NEW_POPUP_TEMPLATE_PT_BR,
};

/**
 * Locale key that will actually be used after fallback.
 * Same rules as newPageTemplate (pt* → pt-BR, else en).
 */
export function resolveNewScriptTemplateLocale(siteLanguage: string): string {
  if (siteLanguage in BASE_TEMPLATES) return siteLanguage;
  if (siteLanguage === "pt" || siteLanguage.toLowerCase().startsWith("pt-")) {
    return "pt-BR";
  }
  return "en";
}

export function getNewScriptTemplate(
  siteLanguage: string,
  options?: { popup?: boolean },
): string {
  const locale = resolveNewScriptTemplateLocale(siteLanguage);
  if (options?.popup) {
    return POPUP_TEMPLATES[locale] ?? NEW_POPUP_TEMPLATE_EN;
  }
  return BASE_TEMPLATES[locale] ?? NEW_SCRIPT_TEMPLATE_EN;
}
